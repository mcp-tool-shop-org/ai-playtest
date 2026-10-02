// rescore.ts — score a finished run again, from its saved transcripts, without replaying it.
//
// Replaying a run to get a new judgment means replaying the game and every player
// turn; on 2026-10-02 that cost a full 25-minute Escape the Valley rerun on a rented
// GPU, only because the judges had been refused the first time. A probability judge
// reads text, so it can read the transcript.txt each seat already wrote.
//
// It also lets criteria change after the fact. `score` uses the CURRENT config's
// criteria, so a criterion rewritten as one observable claim can be checked against
// old transcripts for a fraction of a cent.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaytestConfig } from './config.js';
import type { DecisionsClient } from './decisions.js';
import { createScorer, fitText, type ScorerResult } from './scorers.js';

export type RescoredSeat = { seat: string; results: ScorerResult[] };

export async function rescoreRun(cfg: PlaytestConfig, runDir: string, decisions: DecisionsClient | undefined): Promise<RescoredSeat[]> {
  const out: RescoredSeat[] = [];
  for (const name of (await readdir(runDir)).sort()) {
    const dir = join(runDir, name);
    if (!(await stat(dir)).isDirectory()) continue;
    let meta: Record<string, unknown>;
    let transcript: string;
    try {
      meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
      transcript = await readFile(join(dir, 'transcript.txt'), 'utf8');
    } catch {
      continue; // not a seat directory
    }
    const results: ScorerResult[] = [];
    for (const sc of cfg.scorers) {
      const { state, clipped } = fitText(transcript, sc.maxStateTokens);
      results.push(await createScorer(sc, { decisions }).scoreState(state, clipped, cfg.criteria));
    }
    // Replace this scorer's earlier reading, keep any other scorer's.
    const kept = (Array.isArray(meta.scores) ? meta.scores as ScorerResult[] : []).filter((r) => !results.some((n) => n.scorer === r.scorer));
    meta.scores = [...kept, ...results];
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    out.push({ seat: name, results });
  }
  return out;
}
