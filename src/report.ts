// report.ts — the aggregate: one table of criteria by family, the verdict count,
// and every dead spot and confusion named with its seat. Reads the per-seat
// artifacts back from disk so a report can be rebuilt without replaying.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Critique } from './critic.js';
import type { Seat } from './config.js';

export type SeatSummary = {
  seat: Seat;
  turnsPlayed: number;
  endedBy: string;
  error: string | null;
  critique: Critique | null;
  critiqueError: string | null;
};

export async function readRun(runDir: string): Promise<SeatSummary[]> {
  const entries = await readdir(runDir);
  const out: SeatSummary[] = [];
  for (const e of entries.sort()) {
    const dir = join(runDir, e);
    if (!(await stat(dir)).isDirectory()) continue;
    let meta: { seat: Seat; turnsPlayed: number; endedBy: string; error: string | null; critiqueError: string | null };
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
    out.push({ seat: meta.seat, turnsPlayed: meta.turnsPlayed, endedBy: meta.endedBy, error: meta.error ?? null, critique: crit, critiqueError: meta.critiqueError ?? null });
  }
  return out;
}

export function renderReport(name: string, label: string, seats: SeatSummary[]): string {
  const criteriaIds = Array.from(new Set(seats.flatMap((s) => s.critique?.criteria.map((c) => c.id) ?? [])));
  const lines: string[] = [];
  lines.push(`# ${name} — AI playtest report (${label})`);
  lines.push('');
  const judged = seats.filter((s) => s.critique);
  const alive = judged.filter((s) => s.critique!.alive).length;
  lines.push(`**Seats:** ${seats.length} (${seats.map((s) => s.seat.family).join(', ')}). **Judged:** ${judged.length}. **Alive verdicts:** ${alive} of ${judged.length}. **Would play again:** ${judged.filter((s) => s.critique!.wouldPlayAgain).length} of ${judged.length}.`);
  lines.push('');
  lines.push('## Criteria by family');
  lines.push('');
  lines.push(`| criterion | ${seats.map((s) => s.seat.family).join(' | ')} | met |`);
  lines.push(`|---|${seats.map(() => '---').join('|')}|---|`);
  for (const id of criteriaIds) {
    const cells = seats.map((s) => {
      const v = s.critique?.criteria.find((c) => c.id === id);
      if (!v) return '—';
      return v.met ? `yes${v.turn !== null ? ` (t${v.turn})` : ''}` : 'no';
    });
    const met = seats.filter((s) => s.critique?.criteria.find((c) => c.id === id)?.met).length;
    lines.push(`| ${id} | ${cells.join(' | ')} | ${met}/${judged.length} |`);
  }
  lines.push('');
  lines.push('## Verdicts');
  lines.push('');
  for (const s of seats) {
    lines.push(`### ${s.seat.family} — ${s.seat.model}`);
    lines.push('');
    lines.push(`Turns played: ${s.turnsPlayed} (ended by ${s.endedBy}${s.error ? `; error: ${s.error}` : ''}).`);
    if (!s.critique) {
      lines.push(`No critique: ${s.critiqueError ?? 'no turns played'}.`);
      lines.push('');
      continue;
    }
    lines.push(`**Alive:** ${s.critique.alive ? 'yes' : 'no'}. **Would play again:** ${s.critique.wouldPlayAgain ? 'yes' : 'no'}.`);
    lines.push('');
    lines.push(s.critique.summary);
    lines.push('');
    for (const c of s.critique.criteria) {
      lines.push(`- ${c.met ? '✔' : '✘'} **${c.id}**${c.turn !== null ? ` (turn ${c.turn})` : ''}: ${c.evidence}`);
    }
    lines.push('');
    if (s.critique.highlights.length) { lines.push('Highlights:'); for (const h of s.critique.highlights) lines.push(`- ${h}`); lines.push(''); }
    if (s.critique.deadSpots.length) { lines.push('Dead spots:'); for (const h of s.critique.deadSpots) lines.push(`- ${h}`); lines.push(''); }
    if (s.critique.confusions.length) { lines.push('Confusions:'); for (const h of s.critique.confusions) lines.push(`- ${h}`); lines.push(''); }
  }
  lines.push('## Every dead spot, by seat');
  lines.push('');
  const dead = seats.flatMap((s) => (s.critique?.deadSpots ?? []).map((d) => `- [${s.seat.family}] ${d}`));
  lines.push(dead.length ? dead.join('\n') : '- none reported');
  lines.push('');
  lines.push('## Every confusion, by seat');
  lines.push('');
  const conf = seats.flatMap((s) => (s.critique?.confusions ?? []).map((d) => `- [${s.seat.family}] ${d}`));
  lines.push(conf.length ? conf.join('\n') : '- none reported');
  lines.push('');
  return lines.join('\n');
}

export async function writeReport(name: string, runDir: string, label: string): Promise<string> {
  const seats = await readRun(runDir);
  const md = renderReport(name, label, seats);
  const path = join(runDir, 'REPORT.md');
  await writeFile(path, md, 'utf8');
  return path;
}
