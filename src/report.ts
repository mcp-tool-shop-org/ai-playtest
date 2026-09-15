// report.ts — the aggregate: one table of criteria by family, the verdict count,
// and every dead spot and confusion named with its seat. Reads the per-seat
// artifacts back from disk so a report can be rebuilt without replaying.

import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Critique } from './critic.js';
import type { Seat } from './config.js';
import { VERSION } from './config.js';
import { renderCoverageLine, type Coverage } from './coverage.js';
import type { PanelVerdict } from './panel.js';
import { renderAbsorbingLine, type VerifierReport } from './verifiers.js';
import { summarizeRuns, type CriterionPosterior, type RunStats } from './stats.js';

/** Report artefact format. Bump when honesty rules (jury splits, unanswered met, stamps) change. */
export const REPORT_FORMAT = 1;

export type SeatSummary = {
  seat: Seat;
  turnsPlayed: number;
  endedBy: string;
  error: string | null;
  critique: Critique | null;
  critiqueError: string | null;
  coverage?: Coverage;
  panel?: PanelVerdict | null;
  verifiers?: VerifierReport;
};

export class ReportError extends Error {
  readonly code = 'E_REPORT';
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

export type SkippedSeatDir = { name: string; why: 'missing meta' | 'invalid JSON' | 'missing seat' | 'incomplete meta' };

export type RunContents = SeatSummary[] & { skipped: SkippedSeatDir[] };

function skipWhyFromMetaRead(err: unknown): 'missing meta' | 'invalid JSON' {
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
  if (code === 'ENOENT') return 'missing meta';
  return 'invalid JSON';
}

export async function readRun(runDir: string): Promise<RunContents> {
  let entries: string[];
  try {
    entries = await readdir(runDir);
  } catch {
    // An unguarded readdir surfaced as a raw ENOENT with no indication that a
    // wrong --label was the actual cause.
    throw new ReportError(`no run directory at ${runDir}`, 'check --label matches a run under runsDir');
  }
  const out: SeatSummary[] = [];
  const skipped: SkippedSeatDir[] = [];
  for (const e of entries.sort()) {
    const dir = join(runDir, e);
    if (!(await stat(dir)).isDirectory()) continue;
    let raw: string;
    try {
      raw = await readFile(join(dir, 'meta.json'), 'utf8');
    } catch (err) {
      skipped.push({ name: e, why: skipWhyFromMetaRead(err) });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped.push({ name: e, why: 'invalid JSON' });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped.push({ name: e, why: 'invalid JSON' });
      continue;
    }
    const meta = parsed as {
      seat?: Seat;
      turnsPlayed: number;
      endedBy: string;
      error: string | null;
      critiqueError: string | null;
      coverage?: Coverage;
      panel?: PanelVerdict | null;
      verifiers?: VerifierReport;
    };
    const seat = meta.seat;
    if (!seat || typeof seat !== 'object' || !seat.id || !seat.family || !seat.model) {
      skipped.push({ name: e, why: 'missing seat' });
      continue;
    }
    if (typeof meta.turnsPlayed !== 'number' || !Number.isFinite(meta.turnsPlayed) || typeof meta.endedBy !== 'string' || meta.endedBy.length === 0) {
      skipped.push({ name: e, why: 'incomplete meta' });
      continue;
    }
    let crit: Critique | null = null;
    try {
      const critiqueRaw = JSON.parse(await readFile(join(dir, 'critique.json'), 'utf8'));
      crit = asCritique(critiqueRaw);
    } catch {
      crit = null;
    }
    out.push({ seat, turnsPlayed: meta.turnsPlayed, endedBy: meta.endedBy, error: meta.error ?? null, critique: crit, critiqueError: meta.critiqueError ?? null, coverage: meta.coverage, panel: meta.panel ?? null, verifiers: meta.verifiers });
  }
  return Object.assign(out, { skipped });
}

function asCritique(raw: unknown): Critique | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.criteria)) return null;
  const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    alive: Boolean(c.alive),
    summary: typeof c.summary === 'string' ? c.summary : '',
    criteria: c.criteria as Critique['criteria'],
    highlights: strs(c.highlights),
    deadSpots: strs(c.deadSpots),
    confusions: strs(c.confusions),
    wouldPlayAgain: Boolean(c.wouldPlayAgain),
  };
}

/**
 * Markdown table cells hold model-written text, which contains pipes and
 * newlines often enough that an unescaped cell silently breaks the table and
 * shifts every column after it.
 */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Escape model prose so it cannot impersonate markdown headings or break tables. */
function mdSafe(s: unknown): string {
  if (typeof s !== 'string') return '';
  return cell(s.split(/\r?\n/).map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '')).join('\n'));
}

function generatorStamp(): string {
  return `_Generated by @mcptoolshop/ai-playtest ${VERSION} (report format ${REPORT_FORMAT})._`;
}

function jurorAnswered(p: PanelVerdict): number {
  const critiques = p.critiques ?? [];
  if (critiques.length === 0) return p.jurors.length;
  return critiques.filter((c) => c.critique).length;
}

function wouldPlayAgainOf(s: SeatSummary): boolean {
  if (s.panel) {
    const answered = jurorAnswered(s.panel);
    if (answered === 0) return false;
    return s.panel.wouldPlayAgainCount * 2 > answered;
  }
  return s.critique?.wouldPlayAgain === true;
}

export function renderReport(name: string, label: string, seats: SeatSummary[], expectedCriteria?: string[], skipped: SkippedSeatDir[] = []): string {
  const answeredIds = Array.from(new Set(seats.flatMap((s) =>
    (s.panel?.criteria ?? s.critique?.criteria ?? []).map((c) => c.id))));
  // Rows used to come only from what the critics happened to return, so a
  // criterion every critic skipped vanished from the report with no sign that
  // anything was missing. When the caller supplies the config's criteria, the
  // unanswered ones are listed too — in config order, extras appended.
  const expected = expectedCriteria ?? [];
  const missingIds = expected.filter((id) => !answeredIds.includes(id));
  const unexpectedIds = expected.length > 0 ? answeredIds.filter((id) => !expected.includes(id)) : [];
  const criteriaIds = expected.length > 0 ? [...expected, ...unexpectedIds] : [...answeredIds];
  const asked = seats.length + skipped.length;
  const columnNames = [...seats.map((s) => cell(s.seat?.family ?? 'unknown')), ...skipped.map((s) => cell(s.name))];
  const lines: string[] = [];
  lines.push(`# ${name} — AI playtest report (${label})`);
  lines.push('');
  lines.push(generatorStamp());
  lines.push('');
  // The headline is the JURY's reading where there was one. A seat's own
  // critique of its own transcript is testimony, not a score.
  const juried = seats.filter((s) => s.panel);
  const judged = seats.filter((s) => s.critique || s.panel);
  const unjudged = seats.filter((s) => !s.critique && !s.panel);
  const verdictOf = (s: SeatSummary): boolean | null =>
    s.panel ? s.panel.alive : s.critique ? s.critique.alive : null;
  const alive = seats.filter((s) => verdictOf(s) === true).length;
  // Counting verdicts against `judged` alone made a run where half the seats
  // died read as unanimous -- "Alive verdicts: 1 of 1" for a two-seat run with
  // one dead seat. Verdicts are reported against the seats that were ASKED,
  // including directories whose meta.json could not be read.
  // Would-play-again uses the same denominator as panel.alive (answering
  // jurors), so a dropped juror is not a 'no' vote.
  lines.push(`**Seats:** ${asked} (${columnNames.join(', ')}). **Alive:** ${alive} of ${asked} seats. **Would play again:** ${seats.filter(wouldPlayAgainOf).length} of ${asked}.`);
  lines.push('');
  if (unjudged.length > 0) {
    lines.push(`> **${unjudged.length} of ${asked} seats produced no verdict** — the counts above are out of ${asked}, not out of ${judged.length}. ` +
      unjudged.map((s) => `\`${s.seat.family}\` (ended by ${s.endedBy}${s.critiqueError ? `; ${s.critiqueError}` : ''})`).join(', ') + '.');
    lines.push('');
  }
  if (skipped.length > 0) {
    lines.push(`> **${skipped.length} of ${asked} seat directories could not be read** — they still count in the denominator above, not dropped. ` +
      skipped.map((s) => `\`${s.name}\` (${s.why})`).join(', ') + '.');
    lines.push('');
  }
  if (judged.length === 1) {
    lines.push('> Single judged seat. One run of one model is a sample of one: repeated runs of a fixed configuration have been measured spanning ~19 percentage points. Treat this as a lead to reproduce, not a measurement.');
    lines.push('');
  }
  if (juried.length > 0) {
    const sizes = Array.from(new Set(juried.map((s) => s.panel!.jurors.length)));
    lines.push(`Each transcript was judged by ${sizes.join('/')} juror${sizes.some((n) => n > 1) ? 's' : ''} from families that did not produce it. A seat never scores its own play; its own reading is kept below as testimony.`);
    lines.push('');
    for (const s of juried) {
      const p = s.panel!;
      if (p.jurors.length < 2 || typeof p.nEff !== 'number') continue;
      const ratio = p.nEff / p.jurors.length;
      lines.push(`Jury n_eff for \`${s.seat.family}\`: ${p.nEff.toFixed(2)} of ${p.jurors.length} (mean |φ| ${p.meanPhi.toFixed(3)}).`);
      if (ratio < 0.5) {
        lines.push(`> n_eff/k = ${ratio.toFixed(2)} < 0.5 -- extra jurors are not buying independent votes. The score is the author-off judge; disagreement is a flag, not an average.`);
      }
      lines.push('');
    }
    const contested = juried.filter((s) => s.panel!.dispersion > 0);
    if (contested.length > 0) {
      lines.push(`> **Jurors disagreed on some criteria.** ${contested.map((s) => `\`${s.seat.family}\` ${Math.round(s.panel!.dispersion * 100)}%`).join(', ')}. Disagreement is information about the CRITERIA, not noise — a split usually means the check is under-specified rather than that the game is ambiguous.`);
      lines.push('');
    }
  } else if (judged.length > 0) {
    lines.push('> **No cross-family jury.** Only one family was seated, so each verdict below is a model judging its own play. Self-evaluation is least reliable exactly where these criteria live — subjective judgements — so treat these as testimony, not measurement. Seat a second family to get a jury.');
    lines.push('');
  }
  lines.push('## Criteria by family');
  lines.push('');
  lines.push(`| criterion | ${columnNames.join(' | ')} | met | agreement |`);
  lines.push(`|---|${columnNames.map(() => '---').join('|')}|---|---|`);
  for (const id of criteriaIds) {
    const rowOf = (s: SeatSummary) =>
      s.panel?.criteria.find((c) => c.id === id) ?? s.critique?.criteria.find((c) => c.id === id);
    const cells = [
      ...seats.map((s) => {
        const v = rowOf(s);
        if (!v) return '—';
        const split = 'split' in v && v.split ? '!' : '';
        return v.met ? `yes${split}${v.turn !== null ? ` (t${v.turn})` : ''}` : `no${split}`;
      }),
      ...skipped.map(() => '—'),
    ];
    const yes = seats.filter((s) => rowOf(s)?.met === true).length;
    const no = seats.filter((s) => {
      const v = rowOf(s);
      return Boolean(v) && v!.met === false;
    }).length;
    const unanswered = asked - yes - no;
    const answered = yes + no;
    // Disagreement is information about the CRITERION, not noise to average
    // away: evaluators applying the same rubric to the same artifact agree far
    // less than intuition suggests, so a split verdict most often means the
    // criterion is under-specified.
    const split = answered > 1 && yes > 0 && yes < answered;
    // A 1-seat run still has a jury. Agreement used to be em-dash whenever
    // fewer than 2 *seats* answered, which hid juror splits behind `no!` and
    // a blank agreement column (proof-01).
    const panelRow = seats.length === 1 ? seats[0].panel?.criteria.find((c) => c.id === id) : undefined;
    const agreement = panelRow
      ? (panelRow.answeredCount < 2 ? '—' : panelRow.split ? `**split** ${panelRow.metCount}/${panelRow.answeredCount}` : 'unanimous')
      : (answered < 2 ? '—' : split ? '**split**' : 'unanimous');
    // Unanswered must not share the failed bucket: 1 yes + 1 em-dash is 1/0/1,
    // not 1/2. When every seat answered, keep the compact met/asked form.
    const metCell = unanswered > 0 ? `${yes}/${no}/${unanswered}` : `${yes}/${asked}`;
    lines.push(`| ${cell(id)} | ${cells.join(' | ')} | ${metCell} | ${agreement} |`);
  }
  if (missingIds.length > 0) {
    lines.push('');
    lines.push(`> **${missingIds.length} criterion/criteria went unanswered by every judge:** ${missingIds.map((i) => `\`${i}\``).join(', ')}. An unanswered criterion is not a failed one — it usually means the check was phrased in a way no judge could evaluate from a transcript.`);
  } else if (criteriaIds.some((id) => {
    const rowOf = (s: SeatSummary) =>
      s.panel?.criteria.find((c) => c.id === id) ?? s.critique?.criteria.find((c) => c.id === id);
    return seats.some((s) => !rowOf(s)) || skipped.length > 0;
  })) {
    lines.push('');
    lines.push('> Some criteria were unanswered by some seats (met is yes/no/unanswered). An em-dash is unanswered, not a fail.');
  }
  lines.push('');
  if (seats.some((s) => s.coverage)) {
    lines.push('## How much each seat actually saw');
    lines.push('');
    lines.push('A verdict is only as good as the play behind it. These are computed from the turn records alone — no instrumentation of the game.');
    lines.push('');
    for (const s of seats) {
      if (!s.coverage) continue;
      lines.push(`- **${cell(s.seat.family)}** — ${renderCoverageLine(s.coverage)}`);
      for (const n of s.coverage.notes) lines.push(`  - ${cell(n)}`);
    }
    const thin = seats.filter((s) => s.coverage?.confidence === 'thin');
    if (thin.length > 0) {
      const shortOnly = thin.every((s) =>
        (s.coverage?.notes ?? []).every((n) => /too few/.test(n)) &&
        (s.coverage?.notes ?? []).length > 0 &&
        (s.coverage?.repeatRate ?? 0) < 0.5 &&
        (s.coverage?.loopRate ?? 0) < 0.25);
      lines.push('');
      if (shortOnly) {
        lines.push(`> ${thin.length} of ${seats.length} seats ran fewer than 10 turns. That is a sample-size limit, not an exploration failure -- do not read it as "they never reached the content."`);
      } else {
        lines.push(`> ${thin.length} of ${seats.length} seats explored thinly. Weigh their claims about content they may never have reached accordingly.`);
      }
    }
    lines.push('');
  }
  if (seats.some((s) => s.verifiers)) {
    lines.push('## Deterministic checks (transcript only)');
    lines.push('');
    lines.push('These are precise and partial. They are not a trap proof and not a contradiction verdict. kind=review: a human must decide.');
    lines.push('');
    for (const s of seats) {
      if (!s.verifiers) continue;
      const v = s.verifiers;
      lines.push(`- **${cell(s.seat.family)}** -- ${renderAbsorbingLine(v.absorbing)}`);
      if (v.terminal.kind !== 'none') {
        lines.push(`  - session finished: **${v.terminal.kind}** at turn ${v.terminal.turn}${v.terminal.inAbsorbingComponent ? ' (inside an absorbing SCC of the observed graph)' : ''}`);
      } else {
        lines.push('  - session finished: no victory/death regex matched (lists empty, or the session did not finish)');
      }
      const ignored = v.ignoredInputs.filter((i) => i.kind !== 'changed');
      if (ignored.length) {
        lines.push(`  - ignored inputs: ${ignored.length} (${ignored.slice(0, 6).map((i) => `t${i.turn} ${i.kind} "${cell(i.input)}"`).join('; ')})`);
      }
      if (v.parser.listsEmpty) {
        lines.push(`  - parser classifier unused (empty unparsed/refused lists); unknown rate ${Math.round(v.parser.unknownRate * 100)}%`);
      } else {
        lines.push(`  - parser unknown rate ${Math.round(v.parser.unknownRate * 100)}%`);
      }
      for (const w of v.noProgress) {
        lines.push(`  - no-progress window t${w.startTurn}--t${w.endTurn} (Jaccard ${w.jaccard.toFixed(2)}; FP: a long puzzle solved by reading)`);
      }
      for (const e of v.entityLeads.slice(0, 5)) {
        lines.push(`  - entity lead: ${cell(e.token)} -- ${cell(e.note)}`);
      }
    }
    lines.push('');
  }
  lines.push('## Verdicts');
  lines.push('');
  for (const s of seats) {
    lines.push(`### ${cell(s.seat?.family ?? 'unknown')} — ${cell(s.seat?.model ?? '')}`);
    lines.push('');
    lines.push(`Turns played: ${s.turnsPlayed} (ended by ${s.endedBy}${s.error ? `; error: ${s.error}` : ''}).`);
    if (!s.critique) {
      // critique and critiqueError can BOTH be null when critique.json is
      // independently unreadable; saying "no turns played" there is simply
      // false for a seat that completed its run.
      lines.push(`No critique: ${s.critiqueError ?? (s.turnsPlayed > 0 ? `the critique for this seat could not be read back (it played ${s.turnsPlayed} turns)` : 'no turns played')}.`);
      lines.push('');
      continue;
    }
    if (s.panel) {
      const p = s.panel;
      const answered = jurorAnswered(p);
      const failed = (p.critiques ?? []).filter((c) => c.error && !c.critique);
      const denom = answered === p.jurors.length
        ? `${p.aliveCount}/${p.jurors.length}`
        : `${p.aliveCount}/${answered} answered (${failed.length} juror${failed.length === 1 ? '' : 's'} failed)`;
      const wpa = answered === p.jurors.length
        ? `${p.wouldPlayAgainCount}/${p.jurors.length}`
        : `${p.wouldPlayAgainCount}/${answered}`;
      lines.push(`**Jury verdict** (${p.jurors.map((j) => cell(j.family)).join(', ')}): alive ${denom}, would play again ${wpa}.`);
      if (failed.length > 0) {
        lines.push(`Juror errors: ${failed.map((c) => `${cell(c.seat.family)}: ${mdSafe(c.error)}`).join('; ')}.`);
      }
      lines.push('');
      lines.push(`*${cell(s.seat.family)}'s own reading of its own play — testimony, not a score:* alive ${s.critique.alive ? 'yes' : 'no'}, would play again ${s.critique.wouldPlayAgain ? 'yes' : 'no'}.`);
    } else {
      lines.push(`**Alive:** ${s.critique.alive ? 'yes' : 'no'}. **Would play again:** ${s.critique.wouldPlayAgain ? 'yes' : 'no'}. *(self-judged — no other family was seated)*`);
    }
    lines.push('');
    lines.push(mdSafe(s.critique.summary));
    lines.push('');
    for (const c of (s.panel?.criteria ?? s.critique.criteria ?? [])) {
      const panelRow = s.panel?.criteria.find((x) => x.id === c.id);
      const split = panelRow?.split ? ` — **jurors split ${panelRow.metCount}/${panelRow.answeredCount}**` : '';
      lines.push(`- ${c.met ? '✔' : '✘'} **${cell(c.id)}**${c.turn !== null ? ` (turn ${c.turn})` : ''}: ${cell(c.evidence ?? '')}${split}`);
    }
    lines.push('');
    if (s.critique.highlights?.length) { lines.push('Highlights:'); for (const h of s.critique.highlights) lines.push(`- ${mdSafe(h)}`); lines.push(''); }
    if (s.critique.deadSpots?.length) { lines.push('Dead spots:'); for (const h of s.critique.deadSpots) lines.push(`- ${mdSafe(h)}`); lines.push(''); }
    if (s.critique.confusions?.length) { lines.push('Confusions:'); for (const h of s.critique.confusions) lines.push(`- ${mdSafe(h)}`); lines.push(''); }
  }
  lines.push('## Every dead spot, by seat');
  lines.push('');
  const dead = [
    ...seats.flatMap((s) => (s.panel?.critiques ?? []).flatMap((c) =>
      (c.critique?.deadSpots ?? []).map((d) => `- [juror ${cell(c.seat.family)} on ${cell(s.seat.family)}] ${mdSafe(d)}`))),
    ...seats.flatMap((s) => (s.critique?.deadSpots ?? []).map((d) => `- [${cell(s.seat.family)}] ${mdSafe(d)}`)),
  ];
  lines.push(dead.length ? dead.join('\n') : '- none reported');
  lines.push('');
  lines.push('## Every confusion, by seat');
  lines.push('');
  const conf = [
    ...seats.flatMap((s) => (s.panel?.critiques ?? []).flatMap((c) =>
      (c.critique?.confusions ?? []).map((d) => `- [juror ${cell(c.seat.family)} on ${cell(s.seat.family)}] ${mdSafe(d)}`))),
    ...seats.flatMap((s) => (s.critique?.confusions ?? []).map((d) => `- [${cell(s.seat.family)}] ${mdSafe(d)}`)),
  ];
  lines.push(conf.length ? conf.join('\n') : '- none reported');
  lines.push('');
  return lines.join('\n');
}

export function isAggregateMarkdown(md: string): boolean {
  const first = md.trimStart().split('\n', 1)[0] ?? '';
  return /-- multi-run aggregate \(/.test(first);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function sidecarIsAggregate(path: string): Promise<boolean> {
  const sidecar = await readOptional(path);
  if (!sidecar) return false;
  try {
    const parsed = JSON.parse(sidecar) as { kind?: string };
    return Boolean(parsed && parsed.kind === 'multi-run-aggregate');
  } catch {
    return false;
  }
}

export async function isAggregateDir(dir: string): Promise<boolean> {
  if (await sidecarIsAggregate(join(dir, 'REPORT.json'))) return true;
  if (await sidecarIsAggregate(join(dir, 'aggregate.json'))) return true;
  const md = await readOptional(join(dir, 'REPORT.md'));
  return md !== null && isAggregateMarkdown(md);
}

function isRunSiblingName(name: string, label: string): boolean {
  const prefix = `${label}-r`;
  if (!name.startsWith(prefix)) return false;
  const rest = name.slice(prefix.length);
  return rest.length > 0 && /^[0-9]+$/.test(rest);
}

export async function listRunSiblings(runsDir: string, label: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names.sort()) {
    if (!isRunSiblingName(n, label)) continue;
    try {
      if ((await stat(join(runsDir, n))).isDirectory()) out.push(n);
    } catch {
      // Name raced out from under us; skip.
    }
  }
  return out;
}

export function criterionMetBySeats(
  results: Array<{ panel?: { criteria: Array<{ id: string; met: boolean }> } | null; critique?: { criteria: Array<{ id: string; met: boolean }> } | null }>,
  id: string,
): boolean {
  const votes = results.map((r) => {
    const row = r.panel?.criteria.find((c) => c.id === id) ?? r.critique?.criteria.find((c) => c.id === id);
    return row?.met ?? false;
  });
  return votes.filter(Boolean).length * 2 > votes.length;
}

export async function writeReport(name: string, runDir: string, label: string, expectedCriteria?: string[]): Promise<string> {
  if (await isAggregateDir(runDir)) {
    throw new ReportError(
      `${runDir} is a multi-run aggregate, not a single-run directory`,
      `rebuild a single run with --label ${label}-r01, or let report rebuild the aggregate from ${label}-r*`,
    );
  }
  const seats = await readRun(runDir);
  if (seats.length === 0) {
    const skipped = seats.skipped;
    if (skipped.length > 0) {
      throw new ReportError(
        `no readable seats in ${runDir} (${skipped.length} skipped)`,
        skipped.map((s) => `${s.name}: ${s.why}`).join('; '),
      );
    }
    const existing = await readOptional(join(runDir, 'REPORT.md'));
    if (existing && existing.trim().length > 0) {
      throw new ReportError(
        `refusing to overwrite non-empty REPORT.md at ${runDir} with a 0-seat report`,
        'this directory has no seat artifacts',
      );
    }
    throw new ReportError(
      `no seat directories in ${runDir}`,
      'check --label, or run the playtest first',
    );
  }
  const md = renderReport(name, label, seats, expectedCriteria, seats.skipped);
  const path = join(runDir, 'REPORT.md');
  await writeFile(path, md, 'utf8');
  return path;
}

export async function writeAggregateFromRuns(
  name: string,
  dir: string,
  label: string,
  criterionIds: string[],
  runLabels: string[],
  runsDir: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const worstOfN: Array<{ run: string; alive: number; of: number }> = [];
  const successes = Object.fromEntries(criterionIds.map((id) => [id, 0]));
  for (const runLabel of runLabels) {
    const seats = await readRun(join(runsDir, runLabel));
    for (const id of criterionIds) if (criterionMetBySeats(seats, id)) successes[id]++;
    const alive = seats.filter((s) => (s.panel ? s.panel.alive : s.critique?.alive) === true).length;
    worstOfN.push({ run: runLabel, alive, of: seats.length + seats.skipped.length });
  }
  return writeAggregateReport(
    name, dir, label, runLabels.length,
    criterionIds.map((id) => ({ id, successes: successes[id] })),
    worstOfN,
  );
}

export function renderAggregateReport(
  name: string,
  label: string,
  runCount: number,
  perCriterion: Array<{ id: string; successes: number }>,
  worstOfN: Array<{ run: string; alive: number; of: number }>,
): string {
  const stats: RunStats = summarizeRuns(perCriterion, runCount);
  const lines: string[] = [];
  lines.push(`# ${name} -- multi-run aggregate (${label}, n=${runCount})`);
  lines.push('');
  lines.push(generatorStamp());
  lines.push('');
  lines.push(stats.warning);
  lines.push('');
  lines.push(`Minimum achievable p at n=${runCount} is 2/2^${runCount} = ${stats.minP}. First n that can clear α=0.05 is ${stats.firstInferentialN}.`);
  lines.push('');
  lines.push('## Per-criterion Beta-Binomial');
  lines.push('');
  lines.push('| criterion | s/n | posterior mean | 95% equal-tail | stability |');
  lines.push('|---|---|---|---|---|');
  for (const p of stats.posteriors) {
    lines.push(`| ${cell(p.id)} | ${p.successes}/${p.n} | ${p.mean.toFixed(3)} | ${p.ciLow.toFixed(3)}–${p.ciHigh.toFixed(3)} | ${p.stability} |`);
  }
  lines.push('');
  lines.push('3/3 is not 100%: mean (s+1)/(n+2). A CI is not "95% chance the true rate is in this interval."');
  lines.push('');
  lines.push('## Worst-of-n beside the mean');
  lines.push('');
  const rates = worstOfN.map((w) => w.of === 0 ? 0 : w.alive / w.of);
  const mean = rates.length === 0 ? 0 : rates.reduce((a, b) => a + b, 0) / rates.length;
  const floor = rates.length === 0 ? 0 : Math.min(...rates);
  lines.push(`Mean alive rate ${mean.toFixed(2)}; worst-of-n ${floor.toFixed(2)}. A build averaging 0.64 with a 0.51 floor is a different product from one averaging 0.64 with a 0.62 floor.`);
  for (const w of worstOfN) lines.push(`- ${cell(w.run)}: ${w.alive}/${w.of} alive`);
  lines.push('');
  return lines.join('\n');
}

export type AggregatePayload = {
  kind: 'multi-run-aggregate';
  label: string;
  runCount: number;
  generator: { name: string; version: string; reportFormat: number };
  posteriors: CriterionPosterior[];
  worstOfN: Array<{ run: string; alive: number; of: number }>;
  runs: string[];
  minP: number;
  warning: string;
};

function aggregatePayload(
  label: string,
  runCount: number,
  stats: RunStats,
  worstOfN: Array<{ run: string; alive: number; of: number }>,
): AggregatePayload {
  return {
    kind: 'multi-run-aggregate',
    label,
    runCount,
    generator: { name: '@mcptoolshop/ai-playtest', version: VERSION, reportFormat: REPORT_FORMAT },
    posteriors: stats.posteriors,
    worstOfN,
    runs: worstOfN.map((w) => w.run),
    minP: stats.minP,
    warning: stats.warning,
  };
}

export async function writeAggregateReport(
  name: string,
  dir: string,
  label: string,
  runCount: number,
  perCriterion: Array<{ id: string; successes: number }>,
  worstOfN: Array<{ run: string; alive: number; of: number }>,
): Promise<string> {
  const md = renderAggregateReport(name, label, runCount, perCriterion, worstOfN);
  const stats = summarizeRuns(perCriterion, runCount);
  const payload = aggregatePayload(label, runCount, stats, worstOfN);
  const path = join(dir, 'REPORT.md');
  await writeFile(path, md, 'utf8');
  const json = JSON.stringify(payload, null, 2) + '\n';
  await writeFile(join(dir, 'REPORT.json'), json, 'utf8');
  await writeFile(join(dir, 'aggregate.json'), json, 'utf8');
  return path;
}
