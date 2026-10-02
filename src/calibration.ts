// calibration.ts — score the playtester against games where the answer is known.
//
// A calibration game writes a truth log on stderr (which no model sees), one JSON
// line per turn: {"cal":1, "t":<turn>, "ev":[<events>], ...}, after a first line
// {"cal":1, "knobs":{...}} naming its switches. An answer key maps each criterion
// to a rule over those switches and events. Grading compares the jury's verdicts,
// each probability judge's P(met) and the deterministic checks with that truth.
//
// Nothing here knows about any particular game: calibration/game.mjs (Harrow Gate)
// is the first game to write the log, calibration/answer-key.json its key.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PanelVerdict } from './panel.js';
import type { VerifierReport } from './verifiers.js';
import { readProbability, type ScorerResult } from './scorers.js';

export type TruthRule =
  | { anyEvent: string }
  | { noEvent: string }
  | { knob: string; equals: unknown }
  | { minEvents: { event: string; count: number } };

export type AnswerKey = {
  rules: Record<string, TruthRule>;
  /** Truth for the deterministic checks. `absorbing` and `ignoredInputs` are graded today. */
  verifiers?: { absorbing?: TruthRule; ignoredInputs?: TruthRule };
};

export type TruthLog = { variant: string; knobs: Record<string, unknown>; events: string[] };

/** Parse a game's stderr into its switches and every event, in order. Non-log lines are ignored. */
export function parseTruthLog(stderr: string): TruthLog | null {
  let knobs: Record<string, unknown> | null = null;
  let variant = 'custom';
  const events: string[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let o: { cal?: number; knobs?: Record<string, unknown>; variant?: string; ev?: unknown };
    try { o = JSON.parse(line); } catch { continue; }
    if (o.cal !== 1) continue;
    if (o.knobs && typeof o.knobs === 'object') { knobs = o.knobs; variant = typeof o.variant === 'string' ? o.variant : variant; }
    if (Array.isArray(o.ev)) for (const e of o.ev) if (typeof e === 'string') events.push(e);
  }
  return knobs ? { variant, knobs, events } : null;
}

export function truthFor(rule: TruthRule, log: TruthLog): boolean {
  if ('anyEvent' in rule) return log.events.includes(rule.anyEvent);
  if ('noEvent' in rule) return !log.events.includes(rule.noEvent);
  if ('knob' in rule) return log.knobs[rule.knob] === rule.equals;
  return log.events.filter((e) => e === rule.minEvents.event).length >= rule.minEvents.count;
}

export type GradedCell = {
  variant: string;
  seat: string;
  criterion: string;
  truth: boolean;
  /** The jury's verdict; null when no juror answered. */
  jury: boolean | null;
  /** Each probability judge's P(met), by scorer id. */
  p: Record<string, number | null>;
};

export type GradedVerifier = { variant: string; seat: string; check: 'absorbing' | 'ignoredInputs'; truth: boolean; fired: boolean };

export type Graded = { cells: GradedCell[]; verifiers: GradedVerifier[]; seats: number; skipped: string[] };

type SeatMeta = { seat?: { id?: string }; panel?: PanelVerdict | null; scores?: ScorerResult[]; verifiers?: VerifierReport };

/** Grade every seat under each <root>/<variant>/<label>/<seat>/ that has meta.json and a truth log. */
export async function gradeRuns(root: string, label: string, key: AnswerKey): Promise<Graded> {
  const out: Graded = { cells: [], verifiers: [], seats: 0, skipped: [] };
  for (const variantDir of (await readdir(root)).sort()) {
    const runDir = join(root, variantDir, label);
    if (!(await isDir(runDir))) continue;
    for (const seatDir of (await readdir(runDir)).sort()) {
      const dir = join(runDir, seatDir);
      if (!(await isDir(dir))) continue;
      let meta: SeatMeta;
      let log: TruthLog | null;
      try {
        meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
        log = parseTruthLog(await readFile(join(dir, 'stderr.txt'), 'utf8'));
      } catch {
        out.skipped.push(`${variantDir}/${seatDir}: no meta.json or stderr.txt`);
        continue;
      }
      if (!log) { out.skipped.push(`${variantDir}/${seatDir}: no truth log in stderr.txt`); continue; }
      out.seats++;
      const seat = meta.seat?.id ?? seatDir;
      for (const [criterion, rule] of Object.entries(key.rules)) {
        const v = meta.panel?.criteria.find((c) => c.id === criterion);
        const p: Record<string, number | null> = {};
        for (const s of meta.scores ?? []) p[s.scorer] = s.scores.find((x) => x.id === criterion)?.p ?? null;
        out.cells.push({ variant: log.variant, seat, criterion, truth: truthFor(rule, log), jury: v && v.answeredCount > 0 ? v.met : null, p });
      }
      for (const check of ['absorbing', 'ignoredInputs'] as const) {
        const rule = key.verifiers?.[check];
        if (!rule || !meta.verifiers) continue;
        const fired = check === 'absorbing' ? meta.verifiers.absorbing !== null : ignoredShare(meta.verifiers) >= IGNORED_FIRES_AT;
        out.verifiers.push({ variant: log.variant, seat, check, truth: truthFor(rule, log), fired });
      }
    }
  }
  return out;
}

/**
 * The ignored-input check holds a row for every input, so "any row" fired on
 * every transcript. A share decides it instead. On cal-01, every healthy
 * build stayed at 18% or below and the deaf build reached 38–50%.
 */
export const IGNORED_FIRES_AT = 0.25;

function ignoredShare(v: VerifierReport): number {
  const rows = v.ignoredInputs;
  return rows.length === 0 ? 0 : rows.filter((x) => x.kind !== 'changed').length / rows.length;
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

export type Confusion = { tp: number; fp: number; tn: number; fn: number; unanswered: number };

export type CriterionSummary = {
  criterion: string;
  cases: number;
  positives: number;
  jury: Confusion & { accuracy: number | null };
  scorers: Record<string, {
    confident: number;
    correct: number;
    uncertain: number;
    unscored: number;
    /** Mean squared error of P(met) against truth (0 perfect, 0.25 is a coin flip at 0.5). */
    brier: number | null;
  }>;
};

export type CalibrationSummary = {
  criteria: CriterionSummary[];
  /** Expected calibration error per scorer over all criteria, 5 equal-width bins. */
  ece: Record<string, number | null>;
  verifiers: Record<string, Confusion & { precision: number | null; recall: number | null }>;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function summarize(g: Graded, band: [number, number] = [0.35, 0.65]): CalibrationSummary {
  const ids = [...new Set(g.cells.map((c) => c.criterion))];
  const scorerIds = [...new Set(g.cells.flatMap((c) => Object.keys(c.p)))];
  const criteria = ids.map((criterion) => {
    const cells = g.cells.filter((c) => c.criterion === criterion);
    const j: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0, unanswered: 0 };
    for (const c of cells) {
      if (c.jury === null) j.unanswered++;
      else if (c.jury && c.truth) j.tp++;
      else if (c.jury && !c.truth) j.fp++;
      else if (!c.jury && !c.truth) j.tn++;
      else j.fn++;
    }
    const scorers: CriterionSummary['scorers'] = {};
    for (const id of scorerIds) {
      let confident = 0, correct = 0, uncertain = 0, unscored = 0, sq = 0, n = 0;
      for (const c of cells) {
        const p = c.p[id] ?? null;
        const read = readProbability(p, band);
        if (read === 'unscored') { unscored++; continue; }
        sq += (p! - (c.truth ? 1 : 0)) ** 2; n++;
        if (read === 'uncertain') { uncertain++; continue; }
        confident++;
        if ((read === 'met') === c.truth) correct++;
      }
      scorers[id] = { confident, correct, uncertain, unscored, brier: n > 0 ? sq / n : null };
    }
    const answered = j.tp + j.fp + j.tn + j.fn;
    return { criterion, cases: cells.length, positives: cells.filter((c) => c.truth).length, jury: { ...j, accuracy: ratio(j.tp + j.tn, answered) }, scorers };
  });

  const ece: Record<string, number | null> = {};
  for (const id of scorerIds) {
    const pairs = g.cells.map((c) => [c.p[id] ?? null, c.truth] as const).filter((x): x is readonly [number, boolean] => x[0] !== null);
    if (pairs.length === 0) { ece[id] = null; continue; }
    let total = 0;
    for (let b = 0; b < 5; b++) {
      const lo = b / 5, hi = (b + 1) / 5;
      const bin = pairs.filter(([p]) => p >= lo && (b === 4 ? p <= hi : p < hi));
      if (bin.length === 0) continue;
      const conf = bin.reduce((a, [p]) => a + p, 0) / bin.length;
      const acc = bin.filter(([, t]) => t).length / bin.length;
      total += (bin.length / pairs.length) * Math.abs(conf - acc);
    }
    ece[id] = total;
  }

  const verifiers: CalibrationSummary['verifiers'] = {};
  for (const check of [...new Set(g.verifiers.map((v) => v.check))]) {
    const vs = g.verifiers.filter((v) => v.check === check);
    const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0, unanswered: 0 };
    for (const v of vs) {
      if (v.fired && v.truth) c.tp++;
      else if (v.fired) c.fp++;
      else if (v.truth) c.fn++;
      else c.tn++;
    }
    verifiers[check] = { ...c, precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn) };
  }
  return { criteria, ece, verifiers };
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function renderCalibration(label: string, g: Graded, s: CalibrationSummary): string {
  const lines: string[] = [];
  lines.push(`# Calibration: ${label}`);
  lines.push('');
  lines.push(`${g.seats} seat transcript(s) graded against the game's own truth log${g.skipped.length ? `; ${g.skipped.length} skipped` : ''}.`);
  lines.push('');
  lines.push('## The jury');
  lines.push('');
  lines.push('| criterion | cases | true | accuracy | TP | FP | TN | FN | unanswered |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of s.criteria) {
    lines.push(`| ${c.criterion} | ${c.cases} | ${c.positives} | ${pct(c.jury.accuracy)} | ${c.jury.tp} | ${c.jury.fp} | ${c.jury.tn} | ${c.jury.fn} | ${c.jury.unanswered} |`);
  }
  const scorerIds = Object.keys(s.ece);
  for (const id of scorerIds) {
    lines.push('');
    lines.push(`## Probability judge: ${id}`);
    lines.push('');
    lines.push(`Expected calibration error over all criteria: **${s.ece[id] === null ? '—' : s.ece[id]!.toFixed(3)}** (0 is perfectly calibrated).`);
    lines.push('');
    lines.push('| criterion | correct when confident | uncertain | Brier |');
    lines.push('|---|---|---|---|');
    for (const c of s.criteria) {
      const x = c.scorers[id];
      if (!x) continue;
      lines.push(`| ${c.criterion} | ${x.correct}/${x.confident} | ${x.uncertain} | ${x.brier === null ? '—' : x.brier.toFixed(3)} |`);
    }
  }
  if (Object.keys(s.verifiers).length > 0) {
    lines.push('');
    lines.push('## Deterministic checks');
    lines.push('');
    lines.push('| check | precision | recall | TP | FP | TN | FN |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const [check, v] of Object.entries(s.verifiers)) {
      lines.push(`| ${check} | ${pct(v.precision)} | ${pct(v.recall)} | ${v.tp} | ${v.fp} | ${v.tn} | ${v.fn} |`);
    }
  }
  const misses = g.cells.filter((c) => c.jury !== null && c.jury !== c.truth);
  if (misses.length > 0) {
    lines.push('');
    lines.push('## Where the jury was wrong');
    lines.push('');
    for (const m of misses) lines.push(`- \`${m.variant}\` / ${m.seat} / ${m.criterion}: truth ${m.truth ? 'yes' : 'no'}, jury ${m.jury ? 'yes' : 'no'}`);
  }
  if (g.skipped.length > 0) {
    lines.push('');
    lines.push('## Skipped');
    lines.push('');
    for (const sk of g.skipped) lines.push(`- ${sk}`);
  }
  lines.push('');
  return lines.join('\n');
}
