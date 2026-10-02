import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rescoreRun } from './rescore.js';
import { SCORER_DEFAULTS } from './scorers.js';
import type { PlaytestConfig } from './config.js';
import type { DecisionsClient } from './decisions.js';

let runDir: string;
beforeEach(async () => { runDir = await mkdtemp(join(tmpdir(), 'ai-playtest-rescore-')); });
afterEach(async () => { await rm(runDir, { recursive: true, force: true }); });

const criteria = [
  { id: 'moves', check: 'Something changes without the player causing it.' },
  { id: 'cost', check: 'An action spends a resource whose amount the player can see.' },
];
const cfg = {
  criteria,
  scorers: [{ id: 'jev', kind: 'jev' as const, ...SCORER_DEFAULTS.jev }],
} as unknown as PlaytestConfig;

async function seat(name: string, meta: object, transcript = '═══ turn 1\nThe bell tolls.\n>\n> look\n'): Promise<string> {
  const dir = join(runDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta));
  await writeFile(join(dir, 'transcript.txt'), transcript);
  return dir;
}

describe('rescoreRun', () => {
  it('scores each seat from its saved transcript against the current criteria', async () => {
    const states: string[] = [];
    const decisions: DecisionsClient = async (req) => {
      states.push(String(req.state));
      expect(Object.keys(req.questions)).toEqual(['moves', 'cost']);
      return { model: req.model, answers: { moves: { type: 'noul', noul: 0.9 }, cost: { type: 'noul', noul: 0.2 } }, cost: 0.0001 };
    };
    await seat('a', { seat: { id: 'a' } });
    await seat('b', { seat: { id: 'b' } }, '═══ turn 1\nA quiet square.\n');
    const out = await rescoreRun(cfg, runDir, decisions);
    expect(out.map((s) => s.seat)).toEqual(['a', 'b']);
    expect(out[0].results[0].scores).toEqual([{ id: 'moves', p: 0.9 }, { id: 'cost', p: 0.2 }]);
    expect(states[0]).toContain('The bell tolls.');
    expect(states[1]).toContain('A quiet square.');
  });

  it('replaces the same scorer\'s earlier reading and keeps any other scorer\'s', async () => {
    const decisions: DecisionsClient = async (req) => ({ model: req.model, answers: { moves: { type: 'noul', noul: 0.7 }, cost: { type: 'noul', noul: 0.4 } } });
    const dir = await seat('a', {
      seat: { id: 'a' },
      turnsPlayed: 3,
      scores: [
        { scorer: 'jev', scores: [{ id: 'moves', p: 0.1 }] },
        { scorer: 'other', scores: [{ id: 'moves', p: 0.5 }] },
      ],
    });
    await rescoreRun(cfg, runDir, decisions);
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    expect(meta.turnsPlayed).toBe(3);
    expect(meta.scores.map((s: { scorer: string }) => s.scorer)).toEqual(['other', 'jev']);
    expect(meta.scores[1].scores).toEqual([{ id: 'moves', p: 0.7 }, { id: 'cost', p: 0.4 }]);
  });

  it('skips files and directories that are not seats', async () => {
    await writeFile(join(runDir, 'REPORT.md'), '# report');
    await mkdir(join(runDir, 'empty'));
    await seat('a', { seat: { id: 'a' } });
    const out = await rescoreRun(cfg, runDir, async (req) => ({ model: req.model, answers: { moves: { type: 'noul', noul: 0.5 }, cost: { type: 'noul', noul: 0.5 } } }));
    expect(out.map((s) => s.seat)).toEqual(['a']);
  });

  it('records a provider failure on the seat instead of throwing', async () => {
    const dir = await seat('a', { seat: { id: 'a' } });
    const out = await rescoreRun(cfg, runDir, async () => { throw new Error('HTTP 503'); });
    expect(out[0].results[0].error).toMatch(/503/);
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    expect(meta.scores[0].error).toMatch(/503/);
  });
});
