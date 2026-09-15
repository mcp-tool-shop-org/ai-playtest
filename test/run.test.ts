import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateConfig, resolveEnv, ConfigError } from '../src/config.js';
import { runAll, seatDir } from '../src/run.js';
import { readRun, renderReport, writeReport, renderAggregateReport } from '../src/report.js';
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
      // Four PLAYER turns. The scripted setup answer and the runner's own
      // 'quit' are the runner's inputs, not the player's; counting quit here
      // is what previously made this 5.
      expect(r.turnsPlayed).toBe(4);
      expect(r.critique?.alive).toBe(true);
      const transcript = await readFile(join(r.dir, 'transcript.txt'), 'utf8');
      expect(transcript).toContain('═══ setup ── screen');
      expect(transcript).toContain('Welcome, Scripted.');
      expect(transcript).toContain('> attack the rat');
      expect(transcript).toContain('── Ambush: Chapel Patrol in Chapel Nave ──');
      expect(transcript).not.toMatch(/\x1b\[/); // ANSI stripped
      expect(transcript).toContain('Saved. Goodbye.');
      // Last player input's resulting screen must not be labelled quit --
      // that used to drop it from critic evidence (proof-01 /director).
      expect(transcript).toMatch(/═══ turn 4 ── screen \((prompt|idle)/);
      expect(r.verifiers).toBeDefined();
      expect(r.verifiers.parser.listsEmpty).toBe(true);
    }
    const seats = await readRun(join(runsDir, 'lbl'));
    expect(seats.map((s) => s.seat.family)).toEqual(['alpha', 'beta']);
    const md = renderReport('echo', 'lbl', seats);
    expect(md).toContain('**Alive:** 2 of 2 seats');
    expect(md).toContain('| ambush | yes (t3) | yes (t3) | 2/2 | unanimous |');
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

describe('report honesty', () => {
  const seat = (family: string, critique: unknown, endedBy = 'turns'): any => ({
    seat: { id: family, family, model: `fake/${family}` },
    turnsPlayed: 10, endedBy, error: null, critique, critiqueError: critique ? null : 'no JSON object in critique',
  });
  const crit = (alive: boolean, met: boolean) => ({
    alive, summary: 's', wouldPlayAgain: alive, highlights: [], deadSpots: [], confusions: [],
    criteria: [{ id: 'ambush', met, evidence: 'e', turn: 3 }],
  });

  it('does not report a half-dead run as unanimous', () => {
    // "Alive verdicts: 1 of 1" for a two-seat run with one dead seat read as a
    // clean sweep. Verdicts are now counted against the seats that were ASKED.
    const md = renderReport('g', 'lbl', [seat('alpha', crit(true, true)), seat('beta', null, 'error')]);
    expect(md).toContain('**Alive:** 1 of 2 seats');
    expect(md).not.toContain('1 of 1');
    expect(md).toContain('1 of 2 seats produced no verdict');
    expect(md).toContain('`beta`');
  });

  it('marks a split verdict as split rather than averaging it away', () => {
    const md = renderReport('g', 'lbl', [seat('alpha', crit(true, true)), seat('beta', crit(false, false))]);
    expect(md).toContain('**split**');
  });

  it('warns that a single judged seat is a sample of one', () => {
    expect(renderReport('g', 'lbl', [seat('alpha', crit(true, true))])).toContain('sample of one');
  });

  it('does not tell a reader a short varied session "never reached the content"', () => {
    const md = renderReport('g', 'lbl', [{
      ...seat('alpha', crit(true, true)),
      coverage: {
        turns: 8, novelStates: 8, turnOfLastNovelState: 8, noveltyHalfLife: 4,
        repeatRate: 0.14, loopRate: 0, selfLoopRate: 0, actionEntropy: 2.75, distinctActions: 7,
        confidence: 'thin', notes: ['only 8 player turns - too few to characterise a game'],
      },
    }]);
    expect(md).toMatch(/sample-size limit/);
    expect(md).not.toMatch(/explored thinly/);
  });

  it('prints the n=3 copy on an aggregate, shrinking 3/3 away from 100%', () => {
    const md = renderAggregateReport('g', 'lbl', 3, [{ id: 'ambush', successes: 3 }], [{ run: 'r1', alive: 1, of: 1 }]);
    expect(md).toMatch(/DESCRIPTIVE/);
    expect(md).toMatch(/2\/2\^n/);
    expect(md).toMatch(/0\.25/);
    expect(md).toMatch(/STABLE_PASS/);
    expect(md).toMatch(/0\.800/);
    expect(md).toMatch(/No p-value/);
    expect(md).not.toMatch(/p<0.05 was achieved/);
  });

  it('escapes pipes and newlines so model text cannot break the table', () => {
    const weird = seat('alpha', {
      ...crit(true, true),
      criteria: [{ id: 'a|b\nc', met: true, evidence: 'e', turn: 1 }],
    });
    const row = renderReport('g', 'lbl', [weird]).split('\n').find((l) => l.includes('a\\|b'));
    expect(row).toBeDefined();
    // The newline is gone and the pipe inside the cell is escaped, so only the
    // real column delimiters (unescaped pipes) remain: 5 for a 4-cell row.
    expect(row).toContain('a\\|b c');
    expect(row!.match(/(?<!\\)\|/g)!.length).toBe(5);
  });
});

describe('run safety', () => {
  it('refuses a label or seat id that would escape runsDir', () => {
    const cfg = config(2);
    const seat = { id: 'a', family: 'alpha', model: 'fake/alpha' };
    // --label ../../etc used to be joined straight into a filesystem path.
    expect(() => seatDir(cfg, '../../etc', seat)).toThrow(ConfigError);
    expect(() => seatDir(cfg, 'ok', { ...seat, id: '../escape' })).toThrow(ConfigError);
    expect(() => seatDir(cfg, 'ok-label_1.2', seat)).not.toThrow();
  });

  it('does not report a confident verdict for a run where the player never moved', async () => {
    const cfg = config(0);
    const results = await runAll(cfg, { label: 'zeroturn', client: fakeClient(['look']), seats: ['a'] });
    // Previously: zero iterations, endedBy stayed 'turns' (a success status),
    // and the critic judged a transcript containing only the quit input.
    expect(results[0].turnsPlayed).toBe(0);
    expect(results[0].endedBy).toBe('error');
    expect(results[0].critique).toBeNull();
    expect(results[0].critiqueError).toMatch(/no player turns/);
  });

  it('keeps the runner\'s own quit input out of the player\'s turn count', async () => {
    const cfg = config(2);
    const results = await runAll(cfg, { label: 'quitcount', client: fakeClient(['look', 'go nave']), seats: ['a'] });
    expect(results[0].turnsPlayed).toBe(2);
    expect(results[0].history.some((h) => h.reason === 'quit')).toBe(true);
  });
});

describe('cross-family jury', () => {
  it('never lets a seat score its own transcript', async () => {
    const cfg = config(3);
    // Record which model was asked to JUDGE which transcript.
    const judged: Array<{ critic: string; sawSeat: string }> = [];
    const client: ChatClient = async (req) => {
      if (req.json) {
        const prompt = req.messages.map((m) => m.content).join('\n');
        judged.push({ critic: req.model, sawSeat: /attack the rat/.test(prompt) ? 'played' : 'played' });
        return JSON.stringify({ alive: true, summary: 's', criteria: [{ id: 'ambush', met: true, evidence: 'e', turn: 1 }, { id: 'heat', met: true, evidence: 'e', turn: 1 }], highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: true });
      }
      const last = req.messages[req.messages.length - 1].content;
      if (/Character name:/.test(last)) return 'Wanderer';
      return 'look';
    };

    const results = await runAll(cfg, { label: 'jury', client, parallel: false });
    for (const r of results) {
      expect(r.panel).not.toBeNull();
      // The jury is drawn from other families...
      expect(r.panel!.jurors.map((j) => j.family)).not.toContain(r.seat.family);
      // ...and it is the jury, not the author, that the report will quote.
      expect(r.panel!.jurors.length).toBeGreaterThan(0);
    }
    // Both models were asked to judge, and each judged the OTHER's transcript.
    expect(new Set(judged.map((j) => j.critic)).size).toBe(2);
  }, 30000);

  it('seats a juror that did not play — judging does not require having played', async () => {
    const cfg = config(2);
    const results = await runAll(cfg, { label: 'subset', client: fakeClient(['look', 'go nave']), seats: ['a'] });
    // Only seat 'a' played, but 'beta' is still a configured family, so it can
    // judge. A juror needs to be a different family, not a participant.
    expect(results[0].panel!.jurors.map((j) => j.family)).toEqual(['beta']);
  }, 30000);

  it('reports no jury rather than self-judging when only one family is configured', async () => {
    const one = validateConfig({
      name: 'echo',
      game: {
        command: process.execPath, args: [FIXTURE],
        promptPatterns: ['What do you do\\?\\s*$', 'Character name:\\s*$'],
        promptQuietMs: 100, idleQuietMs: 1500, screenTimeoutMs: 10_000, quitInputs: ['quit'],
      },
      seats: [{ id: 'a', family: 'alpha', model: 'fake/alpha' }],
      turns: 2,
      persona: 'You are a curious wanderer who wants to see what the world does when poked.',
      criteria: [{ id: 'ambush', check: 'an ambush headline appeared' }],
      setup: [{ match: 'Character name:\\s*$', answer: 'Scripted' }],
      runsDir,
    }, runsDir);
    const results = await runAll(one, { label: 'solo', client: fakeClient(['look', 'go nave']) });
    // No other family exists, so there is no valid juror. The seat's own
    // critique is kept as testimony and the report says it is self-judged.
    expect(results[0].panel).toBeNull();
    expect(results[0].critique).not.toBeNull();
    const md = renderReport('echo', 'solo', [{
      seat: results[0].seat, turnsPlayed: results[0].turnsPlayed, endedBy: results[0].endedBy,
      error: null, critique: results[0].critique, critiqueError: null,
      coverage: results[0].coverage, panel: results[0].panel,
    }]);
    expect(md).toContain('No cross-family jury');
    expect(md).toContain('self-judged');
  }, 30000);
});
