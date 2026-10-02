// profile-report.ts — read a persona profile's runs back from disk and write PERSONAS.md.
//
// A profile run plays each persona as its own label, `<label>--<persona>`, and
// records the resolved profile in `<label>/profile.json`. Everything the
// separation test needs is already on disk: inputs in each transcript, coverage
// and verifier blocks in each seat's meta.json. So `report` can rebuild the
// profile report without replaying anything.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRun, ReportError } from './report.js';
import { transcriptInputs } from './diff.js';
import { judgeProfile, renderProfile, type ProfileResult, type ResolvedProfile, type SeatTrace } from './personas.js';

export const personaLabel = (label: string, persona: string) => `${label}--${persona}`;

export function profilePath(runsDir: string, label: string): string {
  return join(runsDir, label, 'profile.json');
}

export async function saveProfile(runsDir: string, label: string, profile: ResolvedProfile): Promise<void> {
  await mkdir(join(runsDir, label), { recursive: true });
  await writeFile(profilePath(runsDir, label), JSON.stringify(profile, null, 2) + '\n', 'utf8');
}

export async function loadProfile(runsDir: string, label: string): Promise<ResolvedProfile | null> {
  const p = profilePath(runsDir, label);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as ResolvedProfile;
  } catch {
    throw new ReportError(`${p} is not valid JSON`, 'run the profile again, or restore the file');
  }
}

async function tracesFor(runDir: string): Promise<SeatTrace[]> {
  if (!existsSync(runDir)) return [];
  const seats = await readRun(runDir);
  return Promise.all(seats.map(async (s) => {
    let inputs: string[] = [];
    try {
      inputs = transcriptInputs(await readFile(join(runDir, s.seat.id, 'transcript.txt'), 'utf8'));
    } catch {
      // No transcript: signals that need inputs come out as null.
    }
    return { inputs, turnsPlayed: s.turnsPlayed, coverage: s.coverage, verifiers: s.verifiers };
  }));
}

export async function writeProfileReport(name: string, runsDir: string, label: string, profile: ResolvedProfile): Promise<{ path: string; result: ProfileResult }> {
  const traces: Record<string, SeatTrace[]> = {};
  for (const p of profile.personas) traces[p.id] = await tracesFor(join(runsDir, personaLabel(label, p.id)));
  const result = judgeProfile(profile, traces);
  const dir = join(runsDir, label);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'PERSONAS.md');
  await writeFile(path, renderProfile(name, label, result), 'utf8');
  await writeFile(join(dir, 'PERSONAS.json'), JSON.stringify({ kind: 'persona-profile', name, label, ...result }, null, 2) + '\n', 'utf8');
  return { path, result };
}
