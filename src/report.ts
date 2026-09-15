// report.ts — the aggregate: one table of criteria by family, the verdict count,
// and every dead spot and confusion named with its seat. Reads the per-seat
// artifacts back from disk so a report can be rebuilt without replaying.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Critique } from './critic.js';
import type { Seat } from './config.js';
import { renderCoverageLine, type Coverage } from './coverage.js';
import type { PanelVerdict } from './panel.js';
import { renderAbsorbingLine, type VerifierReport } from './verifiers.js';
import { summarizeRuns, type RunStats } from './stats.js';

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

export async function readRun(runDir: string): Promise<SeatSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(runDir);
  } catch {
    // An unguarded readdir surfaced as a raw ENOENT with no indication that a
    // wrong --label was the actual cause.
    throw new ReportError(`no run directory at ${runDir}`, 'check --label matches a run under runsDir');
  }
  const out: SeatSummary[] = [];
  for (const e of entries.sort()) {
    const dir = join(runDir, e);
    if (!(await stat(dir)).isDirectory()) continue;
    let meta: { seat: Seat; turnsPlayed: number; endedBy: string; error: string | null; critiqueError: string | null; coverage?: Coverage; panel?: PanelVerdict | null; verifiers?: VerifierReport };
    try {
      meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    } catch {
      continue;
    }
    let crit: Critique | null = null;
    try {
      const raw = JSON.parse(await readFile(join(dir, 'critique.json'), 'utf8'));
      crit = raw && Array.isArray(raw.criteria) ? (raw as Critique) : null;
    } catch {
      crit = null;
    }
    out.push({ seat: meta.seat, turnsPlayed: meta.turnsPlayed, endedBy: meta.endedBy, error: meta.error ?? null, critique: crit, critiqueError: meta.critiqueError ?? null, coverage: meta.coverage, panel: meta.panel ?? null, verifiers: meta.verifiers });
  }
  return out;
}

/**
 * Markdown table cells hold model-written text, which contains pipes and
 * newlines often enough that an unescaped cell silently breaks the table and
 * shifts every column after it.
 */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderReport(name: string, label: string, seats: SeatSummary[], expectedCriteria?: string[]): string {
  const answeredIds = Array.from(new Set(seats.flatMap((s) =>
    (s.panel?.criteria ?? s.critique?.criteria ?? []).map((c) => c.id))));
  // Rows used to come only from what the critics happened to return, so a
  // criterion every critic skipped vanished from the report with no sign that
  // anything was missing. When the caller supplies the config's criteria, the
  // unanswered ones are listed too.
  const missingIds = (expectedCriteria ?? []).filter((id) => !answeredIds.includes(id));
  const criteriaIds = [...answeredIds, ...missingIds];
  const lines: string[] = [];
  lines.push(`# ${name} — AI playtest report (${label})`);
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
  // one dead seat. Verdicts are reported against the seats that were ASKED.
  lines.push(`**Seats:** ${seats.length} (${seats.map((s) => s.seat.family).join(', ')}). **Alive:** ${alive} of ${seats.length} seats. **Would play again:** ${seats.filter((s) => s.panel ? s.panel.wouldPlayAgainCount * 2 > s.panel.jurors.length : s.critique?.wouldPlayAgain).length} of ${seats.length}.`);
  lines.push('');
  if (unjudged.length > 0) {
    lines.push(`> **${unjudged.length} of ${seats.length} seats produced no verdict** — the counts above are out of ${seats.length}, not out of ${judged.length}. ` +
      unjudged.map((s) => `\`${s.seat.family}\` (ended by ${s.endedBy}${s.critiqueError ? `; ${s.critiqueError}` : ''})`).join(', ') + '.');
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
  lines.push(`| criterion | ${seats.map((s) => s.seat.family).join(' | ')} | met | agreement |`);
  lines.push(`|---|${seats.map(() => '---').join('|')}|---|---|`);
  for (const id of criteriaIds) {
    const rowOf = (s: SeatSummary) =>
      s.panel?.criteria.find((c) => c.id === id) ?? s.critique?.criteria.find((c) => c.id === id);
    const cells = seats.map((s) => {
      const v = rowOf(s);
      if (!v) return '—';
      const split = 'split' in v && v.split ? '!' : '';
      return v.met ? `yes${split}${v.turn !== null ? ` (t${v.turn})` : ''}` : `no${split}`;
    });
    const answered = seats.filter((s) => rowOf(s)).length;
    const met = seats.filter((s) => rowOf(s)?.met).length;
    // Disagreement is information about the CRITERION, not noise to average
    // away: evaluators applying the same rubric to the same artifact agree far
    // less than intuition suggests, so a split verdict most often means the
    // criterion is under-specified.
    const split = answered > 1 && met > 0 && met < answered;
    // A 1-seat run still has a jury. Agreement used to be em-dash whenever
    // fewer than 2 *seats* answered, which hid juror splits behind `no!` and
    // a blank agreement column (proof-01).
    const panelRow = seats.length === 1 ? seats[0].panel?.criteria.find((c) => c.id === id) : undefined;
    const agreement = panelRow
      ? (panelRow.answeredCount < 2 ? '—' : panelRow.split ? `**split** ${panelRow.metCount}/${panelRow.answeredCount}` : 'unanimous')
      : (answered < 2 ? '—' : split ? '**split**' : 'unanimous');
    lines.push(`| ${cell(id)} | ${cells.join(' | ')} | ${met}/${seats.length} | ${agreement} |`);
  }
  if (missingIds.length > 0) {
    lines.push('');
    lines.push(`> **${missingIds.length} criterion/criteria went unanswered by every judge:** ${missingIds.map((i) => `\`${i}\``).join(', ')}. An unanswered criterion is not a failed one — it usually means the check was phrased in a way no judge could evaluate from a transcript.`);
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
    lines.push(`### ${s.seat.family} — ${s.seat.model}`);
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
      lines.push(`**Jury verdict** (${p.jurors.map((j) => j.family).join(', ')}): alive ${p.aliveCount}/${p.jurors.length}, would play again ${p.wouldPlayAgainCount}/${p.jurors.length}.`);
      lines.push('');
      lines.push(`*${s.seat.family}'s own reading of its own play — testimony, not a score:* alive ${s.critique.alive ? 'yes' : 'no'}, would play again ${s.critique.wouldPlayAgain ? 'yes' : 'no'}.`);
    } else {
      lines.push(`**Alive:** ${s.critique.alive ? 'yes' : 'no'}. **Would play again:** ${s.critique.wouldPlayAgain ? 'yes' : 'no'}. *(self-judged — no other family was seated)*`);
    }
    lines.push('');
    lines.push(s.critique.summary);
    lines.push('');
    for (const c of (s.panel?.criteria ?? s.critique.criteria)) {
      const panelRow = s.panel?.criteria.find((x) => x.id === c.id);
      const split = panelRow?.split ? ` — **jurors split ${panelRow.metCount}/${panelRow.answeredCount}**` : '';
      lines.push(`- ${c.met ? '✔' : '✘'} **${c.id}**${c.turn !== null ? ` (turn ${c.turn})` : ''}: ${cell(c.evidence)}${split}`);
    }
    lines.push('');
    if (s.critique.highlights.length) { lines.push('Highlights:'); for (const h of s.critique.highlights) lines.push(`- ${h}`); lines.push(''); }
    if (s.critique.deadSpots.length) { lines.push('Dead spots:'); for (const h of s.critique.deadSpots) lines.push(`- ${h}`); lines.push(''); }
    if (s.critique.confusions.length) { lines.push('Confusions:'); for (const h of s.critique.confusions) lines.push(`- ${h}`); lines.push(''); }
  }
  lines.push('## Every dead spot, by seat');
  lines.push('');
  const dead = [
    ...seats.flatMap((s) => (s.panel?.critiques ?? []).flatMap((c) =>
      (c.critique?.deadSpots ?? []).map((d) => `- [juror ${c.seat.family} on ${s.seat.family}] ${d}`))),
    ...seats.flatMap((s) => (s.critique?.deadSpots ?? []).map((d) => `- [${s.seat.family}] ${d}`)),
  ];
  lines.push(dead.length ? dead.join('\n') : '- none reported');
  lines.push('');
  lines.push('## Every confusion, by seat');
  lines.push('');
  const conf = [
    ...seats.flatMap((s) => (s.panel?.critiques ?? []).flatMap((c) =>
      (c.critique?.confusions ?? []).map((d) => `- [juror ${c.seat.family} on ${s.seat.family}] ${d}`))),
    ...seats.flatMap((s) => (s.critique?.confusions ?? []).map((d) => `- [${s.seat.family}] ${d}`)),
  ];
  lines.push(conf.length ? conf.join('\n') : '- none reported');
  lines.push('');
  return lines.join('\n');
}

export async function writeReport(name: string, runDir: string, label: string, expectedCriteria?: string[]): Promise<string> {
  const seats = await readRun(runDir);
  const md = renderReport(name, label, seats, expectedCriteria);
  const path = join(runDir, 'REPORT.md');
  await writeFile(path, md, 'utf8');
  return path;
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

export async function writeAggregateReport(
  name: string,
  dir: string,
  label: string,
  runCount: number,
  perCriterion: Array<{ id: string; successes: number }>,
  worstOfN: Array<{ run: string; alive: number; of: number }>,
): Promise<string> {
  const md = renderAggregateReport(name, label, runCount, perCriterion, worstOfN);
  const path = join(dir, 'REPORT.md');
  await writeFile(path, md, 'utf8');
  return path;
}
