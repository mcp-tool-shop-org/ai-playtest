import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateConfig, resolveEnv, ConfigError } from '../src/config.js';
import { runAll } from '../src/run.js';
import { readRun, renderReport, writeReport } from '../src/report.js';
import { createOpenRouterClient } from '../src/openrouter.js';
import type { ChatClient } from '../src/openrouter.js';

const FIXTURE = resolve(__dirname, 'fixtures', 'echo-game.mjs');
let runsDir: string;

beforeAll(async () => { runsDir = await mkdtemp(join(tmpdir(), 'ai-playtest-')); });
afterAll(async () => { await rm(runsDir, { recursive: true, force: true }); });

function config(turns: number) {
  return validateConfig({
    name: 'echo',
    game: {
      command: process.execPath,
      args: [FIXTURE],
      promptPatterns: ['What do you do\\?\\s*$', 'Character name:\\s*$'],
      promptQuietMs: 100,
      idleQuietMs: 1500,
      screenTimeoutMs: 10_000,
      quitInputs: ['quit'],
    },
    seats: [
      { id: 'a', family: 'alpha', model: 'fake/alpha' },
      { id: 'b', family: 'beta', model: 'fake/beta' },
    ],
    turns,
    persona: 'You are a curious wanderer who wants to see what the world does when poked.',
    criteria: [
      { id: 'ambush', check: 'an ambush headline appeared' },
      { id: 'heat', check: 'the street noticed a kill' },
    ],
    setup: [{ match: 'Character name:\\s*$', answer: 'Scripted' }],
    runsDir,
  }, runsDir);
}

/** A scripted "model": answers the name prompt, then plays a fixed sequence, then critiques. */
function fakeClient(script: string[]): ChatClient {
  const perModel = new Map<string, number>();
  return async (req) => {
    if (req.json) {
      return JSON.stringify({ alive: true, summary: `${req.model} says it moved`, criteria: [{ id: 'ambush', met: true, evidence: 'saw the patrol', turn: 3 }, { id: 'heat', met: true, evidence: 'heat 5', turn: 2 }], highlights: ['t3'], deadSpots: [`${req.model} found nothing dead`], confusions: [], wouldPlayAgain: true });
    }
    const last = req.messages[req.messages.length - 1].content;
    if (/Character name:/.test(last)) return 'Wanderer';
    const n = perModel.get(req.model) ?? 0;
    perModel.set(req.model, n + 1);
    return script[n % script.length];
  };
}

describe('runAll over the echo game', () => {
  it('plays N turns per seat in parallel, quits cleanly, critiques, and writes the artifacts + report', async () => {
    const cfg = config(4);
    // The name prompt is answered by the setup script (no turn spent); then
    // look / attack / ambush-me / go nave; the quit sequence ('quit') records
    // one more turn.
    const results = await runAll(cfg, { label: 'lbl', client: fakeClient(['look', 'attack the rat', 'ambush-me', 'go nave']) });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.endedBy).toBe('turns');
      expect(r.turnsPlayed).toBe(4 + 1);
      expect(r.critique?.alive).toBe(true);
      const transcript = await readFile(join(r.dir, 'transcript.txt'), 'utf8');
      expect(transcript).toContain('═══ setup ── screen');
      expect(transcript).toContain('Welcome, Scripted.');
      expect(transcript).toContain('> attack the rat');
      expect(transcript).toContain('── Ambush: Chapel Patrol in Chapel Nave ──');
      expect(transcript).not.toMatch(/\x1b\[/); // ANSI stripped
      expect(transcript).toContain('Saved. Goodbye.');
    }
    const seats = await readRun(join(runsDir, 'lbl'));
    expect(seats.map((s) => s.seat.family)).toEqual(['alpha', 'beta']);
    const md = renderReport('echo', 'lbl', seats);
    expect(md).toContain('**Alive verdicts:** 2 of 2');
    expect(md).toContain('| ambush | yes (t3) | yes (t3) | 2/2 |');
    expect(md).toContain('[alpha] fake/alpha found nothing dead');
    const path = await writeReport('echo', join(runsDir, 'lbl'), 'lbl');
    expect(await readFile(path, 'utf8')).toContain('# echo — AI playtest report (lbl)');
  });

  it('records a seat whose game exits early as ended by exit and still critiques the turns it played', async () => {
    const cfg = config(6);
    const results = await runAll(cfg, { label: 'early', client: fakeClient(['look', 'quit']), seats: ['a'] });
    expect(results).toHaveLength(1);
    expect(results[0].endedBy).toBe('exit');
    // look, quit -- the second input ends the game before the budget (the
    // name prompt was scripted setup, not a turn).
    expect(results[0].turnsPlayed).toBe(2);
    expect(results[0].critique).not.toBeNull();
  });
});

describe('config', () => {
  it('rejects two seats of one family and resolves $ENV values', () => {
    expect(() => validateConfig({ name: 'x', game: { command: 'node', args: [], promptPatterns: ['>'] }, seats: [{ id: 'a', family: 'f', model: 'm' }, { id: 'b', family: 'f', model: 'm2' }], persona: 'p'.repeat(30), criteria: [{ id: 'c', check: 'x' }] }, '/tmp')).toThrow(ConfigError);
    expect(resolveEnv({ KEY: '$MY_SECRET', PLAIN: 'v' }, { MY_SECRET: 's3' })).toEqual({ KEY: 's3', PLAIN: 'v' });
    expect(() => resolveEnv({ KEY: '$MISSING' }, {})).toThrow(ConfigError);
  });
});

describe('openrouter client', () => {
  it('retries transient failures and surfaces a coded error on 401', async () => {
    let n = 0;
    const client = createOpenRouterClient({
      apiKey: 'k', retries: 2, sleep: async () => {},
      fetchImpl: async () => { n++; return n < 3 ? { ok: false, status: 503, text: async () => 'busy' } : { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'look' } }] }) }; },
    });
    expect(await client({ model: 'm', messages: [], maxTokens: 5, temperature: 0 })).toBe('look');
    expect(n).toBe(3);
    const unauth = createOpenRouterClient({ apiKey: 'k', retries: 2, sleep: async () => {}, fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'nope' }) });
    await expect(unauth({ model: 'm', messages: [], maxTokens: 5, temperature: 0 })).rejects.toMatchObject({ code: 'E_OPENROUTER', status: 401 });
  });
});
