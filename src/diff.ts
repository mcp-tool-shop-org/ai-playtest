// diff.ts — compare two finished runs of the same game and name what got worse.
//
// The studio's rule is to rank builds against each other instead of trusting a
// single absolute score, and teams act on regressions with evidence attached
// (docs/research-5.md). So `ai-playtest diff` reads a base run and a head run,
// lists every finding that got worse with the transcript turn that shows it, and
// exits non-zero unless a person has accepted each finding by id.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRun, isEmptyDegradedPanel, ReportError, type SeatSummary } from './report.js';
import { readProbability } from './scorers.js';

export type FindingKind =
  | 'criterion-lost'
  | 'alive-lost'
  | 'softlock-new'
  | 'ignored-up'
  | 'seat-error';

export type Repro = {
  seat: string;
  transcript: string;
  turn: number | null;
  /** The inputs that led there, in order, read back from the transcript. */
  inputs: string[];
  evidence: string;
};

export type Finding = {
  /** Stable across runs, so an acceptance can name it: `<kind>:<subject>`. */
  id: string;
  kind: FindingKind;
  subject: string;
  base: string;
  head: string;
  /** A second opinion from a probability judge when one scored the head run. */
  scorerNote?: string;
  repro: Repro[];
  accepted?: Acceptance;
};

export type Improvement = { id: string; base: string; head: string };

export type Acceptance = { id: string; note: string; head?: string };

export type DiffResult = {
  base: string;
  head: string;
  seats: { base: number; head: number };
  findings: Finding[];
  improvements: Improvement[];
  /** Acceptances that matched nothing in this diff. */
  unusedAcceptances: Acceptance[];
};

/**
 * How much the share of ignored inputs must rise before it counts. Two plays of
 * the same build already differ by chance, so a small rise is noise.
 */
export const IGNORED_RISE = 0.25;

type Verdict = { met: boolean; evidence: string; turn: number | null };

/** The verdict a seat's run carries for one criterion: jury first, then the seat's own critique. */
function verdictFor(s: SeatSummary, id: string): Verdict | null {
  const panel = isEmptyDegradedPanel(s.panel) ? undefined : s.panel;
  const row = panel?.criteria.find((c) => c.id === id) ?? s.critique?.criteria.find((c) => c.id === id);
  if (!row) return null;
  const r = row as { met: boolean; evidence?: string; turn?: number };
  return { met: r.met, evidence: r.evidence ?? '', turn: typeof r.turn === 'number' ? r.turn : null };
}

function aliveOf(s: SeatSummary): boolean | null {
  if (s.panel && !isEmptyDegradedPanel(s.panel)) return s.panel.alive;
  return s.critique?.alive ?? null;
}

function ignoredShare(s: SeatSummary): number | null {
  const v = s.verifiers;
  if (!v || s.turnsPlayed <= 0) return null;
  const ignored = v.ignoredInputs.filter((x) => x.kind !== 'changed').length;
  return ignored / s.turnsPlayed;
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(x: number | null): string {
  return x === null ? 'n/a' : `${Math.round(x * 100)}%`;
}

/** Read the player's inputs from a transcript, one per turn, in order. */
export function transcriptInputs(text: string): string[] {
  const inputs: string[] = [];
  for (const block of text.split(/^═══ turn \d+/m).slice(1)) {
    const lines = block.split('\n');
    let last: string | null = null;
    for (const line of lines) {
      const m = /^> (.+)$/.exec(line);
      if (m) last = m[1];
    }
    inputs.push(last ?? '');
  }
  return inputs;
}

async function reproFor(runDir: string, s: SeatSummary, turn: number | null, evidence: string): Promise<Repro> {
  const transcript = join(runDir, s.seat.id, 'transcript.txt');
  let inputs: string[] = [];
  try {
    inputs = transcriptInputs(await readFile(transcript, 'utf8'));
  } catch {
    // A missing transcript leaves the repro without inputs; the finding still stands.
  }
  const upTo = turn === null ? inputs : inputs.slice(0, turn);
  // The last screen of a finished game has no input after it.
  while (upTo.length > 0 && upTo[upTo.length - 1] === '') upTo.pop();
  return { seat: s.seat.id, transcript, turn, inputs: upTo, evidence };
}

function majority(votes: boolean[]): boolean {
  return votes.filter(Boolean).length * 2 > votes.length;
}

function tally(votes: boolean[]): string {
  return `${votes.filter(Boolean).length}/${votes.length} met`;
}

/** What a probability judge on the head run says about a lost criterion. */
function scorerNote(head: SeatSummary[], id: string): string | undefined {
  const ps: number[] = [];
  let band: [number, number] = [0.35, 0.65];
  for (const s of head) {
    for (const r of s.scores ?? []) {
      if (r.error) continue;
      const p = r.scores.find((x) => x.id === id)?.p ?? null;
      if (p !== null) { ps.push(p); band = r.band; }
    }
  }
  const p = mean(ps);
  if (p === null) return undefined;
  const read = readProbability(p, band);
  const verb = read === 'met' ? 'disagrees' : read === 'not met' ? 'agrees' : 'is unsure';
  return `probability judge ${verb}: P(met) ${p.toFixed(2)} on the head run`;
}

export function matchAcceptance(f: Finding, headLabel: string, accepted: Acceptance[]): Acceptance | undefined {
  return accepted.find((a) => a.id === f.id && (a.head === undefined || a.head === headLabel));
}

export async function diffRuns(
  baseDir: string,
  headDir: string,
  labels: { base: string; head: string },
  criterionIds: string[],
  accepted: Acceptance[] = [],
): Promise<DiffResult> {
  const base = await readRun(baseDir);
  const head = await readRun(headDir);
  if (base.length === 0) throw new ReportError(`no readable seats in ${baseDir}`, 'diff needs a finished base run');
  if (head.length === 0) throw new ReportError(`no readable seats in ${headDir}`, 'diff needs a finished head run');

  const findings: Finding[] = [];
  const improvements: Improvement[] = [];

  for (const id of criterionIds) {
    const b = base.map((s) => verdictFor(s, id)).filter((v): v is Verdict => v !== null);
    const hPairs = head.map((s) => ({ s, v: verdictFor(s, id) })).filter((x): x is { s: SeatSummary; v: Verdict } => x.v !== null);
    if (b.length === 0 || hPairs.length === 0) continue;
    const bMet = majority(b.map((v) => v.met));
    const hMet = majority(hPairs.map((x) => x.v.met));
    const cells = { base: tally(b.map((v) => v.met)), head: tally(hPairs.map((x) => x.v.met)) };
    if (bMet && !hMet) {
      const repro = await Promise.all(
        hPairs.filter((x) => !x.v.met).map((x) => reproFor(headDir, x.s, x.v.turn, x.v.evidence)),
      );
      findings.push({ id: `criterion-lost:${id}`, kind: 'criterion-lost', subject: id, ...cells, scorerNote: scorerNote(head, id), repro });
    } else if (!bMet && hMet) {
      improvements.push({ id: `criterion-gained:${id}`, ...cells });
    }
  }

  const bAlive = base.map(aliveOf).filter((v): v is boolean => v !== null);
  const hAlive = head.map((s) => ({ s, v: aliveOf(s) })).filter((x): x is { s: SeatSummary; v: boolean } => x.v !== null);
  if (bAlive.length > 0 && hAlive.length > 0) {
    const cells = {
      base: `${bAlive.filter(Boolean).length}/${bAlive.length} alive`,
      head: `${hAlive.filter((x) => x.v).length}/${hAlive.length} alive`,
    };
    const bm = majority(bAlive);
    const hm = majority(hAlive.map((x) => x.v));
    if (bm && !hm) {
      const repro = await Promise.all(hAlive.filter((x) => !x.v).map((x) => {
        const summary = (x.s.panel && !isEmptyDegradedPanel(x.s.panel) ? x.s.panel.critiques?.find((c) => c.critique)?.critique?.summary : x.s.critique?.summary) ?? '';
        return reproFor(headDir, x.s, null, summary);
      }));
      findings.push({ id: 'alive-lost:world', kind: 'alive-lost', subject: 'world', ...cells, repro });
    } else if (!bm && hm) {
      improvements.push({ id: 'alive-gained:world', ...cells });
    }
  }

  const bLocks = base.filter((s) => s.verifiers?.absorbing);
  const hLocks = head.filter((s) => s.verifiers?.absorbing);
  if (bLocks.length === 0 && hLocks.length > 0) {
    const repro = await Promise.all(hLocks.map((s) => {
      const a = s.verifiers!.absorbing!;
      return reproFor(headDir, s, a.firstTurn, `screens stopped leading anywhere new from turn ${a.firstTurn} to ${a.lastTurn}`);
    }));
    findings.push({
      id: 'softlock-new:screen-graph', kind: 'softlock-new', subject: 'screen-graph',
      base: `0/${base.length} seats`, head: `${hLocks.length}/${head.length} seats`, repro,
    });
  } else if (bLocks.length > 0 && hLocks.length === 0) {
    improvements.push({ id: 'softlock-gone:screen-graph', base: `${bLocks.length}/${base.length} seats`, head: `0/${head.length} seats` });
  }

  const bShare = mean(base.map(ignoredShare).filter((x): x is number => x !== null));
  const hShares = head.map((s) => ({ s, x: ignoredShare(s) })).filter((p): p is { s: SeatSummary; x: number } => p.x !== null);
  const hShare = mean(hShares.map((p) => p.x));
  if (bShare !== null && hShare !== null && hShare - bShare >= IGNORED_RISE) {
    const repro = await Promise.all(hShares.map((p) => {
      const first = p.s.verifiers!.ignoredInputs.find((x) => x.kind !== 'changed');
      return reproFor(headDir, p.s, first?.turn ?? null, first ? `"${first.input}" left the screen unchanged` : 'no single turn');
    }));
    findings.push({ id: 'ignored-up:inputs', kind: 'ignored-up', subject: 'inputs', base: `${pct(bShare)} ignored`, head: `${pct(hShare)} ignored`, repro });
  }

  const bErr = base.filter((s) => s.endedBy === 'error').length;
  const hErrSeats = head.filter((s) => s.endedBy === 'error');
  if (hErrSeats.length > bErr) {
    const repro = await Promise.all(hErrSeats.map((s) => reproFor(headDir, s, s.turnsPlayed, s.error ?? 'ended by error')));
    findings.push({
      id: 'seat-error:play', kind: 'seat-error', subject: 'play',
      base: `${bErr}/${base.length} ended by error`, head: `${hErrSeats.length}/${head.length} ended by error`, repro,
    });
  }

  const used = new Set<Acceptance>();
  for (const f of findings) {
    const a = matchAcceptance(f, labels.head, accepted);
    if (a) { f.accepted = a; used.add(a); }
  }

  return {
    base: labels.base,
    head: labels.head,
    seats: { base: base.length, head: head.length },
    findings,
    improvements,
    unusedAcceptances: accepted.filter((a) => !used.has(a)),
  };
}

/** Parse an acceptance file: `{ "accepted": [{ "id", "note", "head"? }] }`. A note is required. */
export function parseAcceptances(raw: string, path: string): Acceptance[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReportError(`${path} is not valid JSON`, 'expected { "accepted": [{ "id": "criterion-lost:<id>", "note": "why this is fine" }] }');
  }
  const list = (parsed as { accepted?: unknown })?.accepted;
  if (!Array.isArray(list)) {
    throw new ReportError(`${path} has no "accepted" array`, 'expected { "accepted": [{ "id": "...", "note": "..." }] }');
  }
  return list.map((a, i) => {
    const e = a as { id?: unknown; note?: unknown; head?: unknown };
    if (typeof e.id !== 'string' || e.id.length === 0) throw new ReportError(`${path}: accepted[${i}] has no id`, 'copy the id from the diff report');
    if (typeof e.note !== 'string' || e.note.trim().length === 0) {
      throw new ReportError(`${path}: accepted[${i}] (${e.id}) has no note`, 'say why the change is fine; an acceptance without a reason is a silenced alarm');
    }
    if (e.head !== undefined && typeof e.head !== 'string') throw new ReportError(`${path}: accepted[${i}].head must be a run label`, 'omit it to accept the finding in every head run');
    return { id: e.id, note: e.note.trim(), ...(typeof e.head === 'string' ? { head: e.head } : {}) };
  });
}

export function openFindings(d: DiffResult): Finding[] {
  return d.findings.filter((f) => !f.accepted);
}

export function renderDiff(name: string, d: DiffResult): string {
  const open = openFindings(d);
  const lines: string[] = [
    `# ${name}: ${d.base} → ${d.head}`,
    '',
    `${d.seats.base} seat${d.seats.base === 1 ? '' : 's'} in the base run, ${d.seats.head} in the head run.`,
    open.length === 0
      ? (d.findings.length === 0 ? '**Nothing got worse.**' : `**Nothing open.** ${d.findings.length} finding${d.findings.length === 1 ? ' is' : 's are'} accepted.`)
      : `**${open.length} open finding${open.length === 1 ? '' : 's'}.** Fix the build, or accept each by id with a note.`,
    '',
  ];
  if (d.seats.base < 2 || d.seats.head < 2) {
    lines.push('> One seat on a side means one judge\'s verdict. Treat a flip as a lead to read, not a verdict.', '');
  }
  if (d.findings.length > 0) {
    lines.push('## What got worse', '');
    for (const f of d.findings) {
      lines.push(`### \`${f.id}\`${f.accepted ? ' (accepted)' : ''}`, '');
      lines.push(`${f.base} → ${f.head}`);
      if (f.scorerNote) lines.push('', f.scorerNote);
      if (f.accepted) lines.push('', `Accepted${f.accepted.head ? ` for ${f.accepted.head}` : ''}: ${f.accepted.note}`);
      for (const r of f.repro) {
        lines.push('', `- **${r.seat}**${r.turn !== null ? `, turn ${r.turn}` : ''}: ${r.evidence || 'no evidence quoted'}`);
        lines.push(`  - transcript: \`${r.transcript}\``);
        if (r.inputs.length > 0) lines.push(`  - inputs: ${r.inputs.map((i) => `\`${i}\``).join(' → ')}`);
      }
      lines.push('');
    }
  }
  if (d.improvements.length > 0) {
    lines.push('## What got better', '');
    for (const i of d.improvements) lines.push(`- \`${i.id}\`: ${i.base} → ${i.head}`);
    lines.push('');
  }
  if (d.unusedAcceptances.length > 0) {
    lines.push('## Acceptances that matched nothing', '');
    for (const a of d.unusedAcceptances) lines.push(`- \`${a.id}\`${a.head ? ` (head ${a.head})` : ''}: ${a.note}`);
    lines.push('', 'Remove them once the finding they excused is gone for good.', '');
  }
  return lines.join('\n');
}
