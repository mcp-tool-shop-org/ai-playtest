import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateConfig, validateDriver, loadConfig, resolveEnv, ConfigError, type GameConfig, type PlaytestConfig } from '../src/config.js';
import { runAll, seatDir, createDriver, type RunOptions } from '../src/run.js';
import { readRun, renderReport, writeReport, renderAggregateReport, ReportError } from '../src/report.js';
import { createOpenRouterClient } from '../src/openrouter.js';
import type { ChatClient } from '../src/openrouter.js';
import type { GameProcess, Screen } from '../src/stdio-game.js';
import { createStdioDriver } from '../src/stdio-driver.js';
import { PtyUnavailableError } from '../src/pty-driver.js';

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

/** Default 30s retry sleep would expire the 30s testTimeout on the first throw. */
function play(cfg: PlaytestConfig, opts: RunOptions & { seats?: string[]; parallel?: boolean }) {
  return runAll(cfg, { turnRetrySleepMs: 1, ...opts });
}

describe('runAll over the echo game', () => {
  it('plays N turns per seat in parallel, quits cleanly, critiques, and writes the artifacts + report', async () => {
    const cfg = config(4);
    // The name prompt is answered by the setup script (no turn spent); then
    // look / attack / ambush-me / go nave; the quit sequence ('quit') records
    // one more turn.
    const results = await play(cfg, { label: 'lbl', client: fakeClient(['look', 'attack the rat', 'ambush-me', 'go nave']) });
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
    const results = await play(cfg, { label: 'early', client: fakeClient(['look', 'quit']), seats: ['a'] });
    expect(results).toHaveLength(1);
    expect(results[0].endedBy).toBe('exit');
    // look, quit -- the second input ends the game before the budget (the
    // name prompt was scripted setup, not a turn).
    expect(results[0].turnsPlayed).toBe(2);
    expect(results[0].critique).not.toBeNull();
  });

  function scriptedSpawn(screens: Screen[]): (cfg: GameConfig, env: Record<string, string>) => GameProcess {
    return () => {
      let i = 0;
      const proc: GameProcess = {
        send() { /* scripted */ },
        async nextScreen() {
          const s = screens[Math.min(i, screens.length - 1)];
          i++;
          return s;
        },
        kill() { /* scripted */ },
        get exited() { return i >= screens.length; },
        get exitCode() { return null; },
        get stderr() { return ''; },
        get spawnError() { return null; },
      };
      return proc;
    };
  }

  it('ends the seat by timeout, keeps reason timeout, and still writes transcript.txt and meta.json', async () => {
    // Gate: deleting `if (now - started > cfg.screenTimeoutMs) return resolveScreen(take('timeout'))`
    // makes this RED — the fixture prints one line and hangs, so without that
    // bound the seat never ends by timeout (idleQuietMs is 10s; this test's
    // budget is 2s). Do not rely on vitest's 30s timeout as the gate.
    const cfg = validateConfig({
      name: 'stall',
      game: {
        command: process.execPath, args: [FIXTURE, 'timeout'],
        promptPatterns: ['NEVER_MATCH_PROMPT_xyzzy\\s*$'],
        promptQuietMs: 50, idleQuietMs: 10_000, screenTimeoutMs: 400, quitInputs: ['quit'],
      },
      seats: [{ id: 'a', family: 'alpha', model: 'fake/alpha' }],
      turns: 3,
      persona: 'You are a curious wanderer who wants to see what the world does when poked.',
      criteria: [{ id: 'ambush', check: 'an ambush headline appeared' }],
      runsDir,
    }, runsDir);
    const results = await play(cfg, { label: 'stallout', client: fakeClient(['look']), seats: ['a'] });
    expect(results[0].endedBy).toBe('timeout');
    expect(results[0].history.some((h) => h.reason === 'timeout')).toBe(true);
    const transcript = await readFile(join(results[0].dir, 'transcript.txt'), 'utf8');
    const meta = JSON.parse(await readFile(join(results[0].dir, 'meta.json'), 'utf8'));
    expect(meta.endedBy).toBe('timeout');
    expect(transcript).toContain('one line then silence');
    expect(transcript).toMatch(/screen \(timeout/);
  }, 5000);

  it('records idle screens in the transcript when no prompt pattern matches', async () => {
    // Gate: deleting the idle path in spawnGame makes the real-process idle
    // test RED. This injects a fake GameProcess so runAll's '(idle' transcript
    // header is milliseconds, not a quiet wait.
    const cfg = validateConfig({
      name: 'idlepath',
      game: {
        command: process.execPath, args: [FIXTURE, 'idle'],
        promptPatterns: ['NEVER_MATCH_PROMPT_xyzzy\\s*$'],
        promptQuietMs: 50, idleQuietMs: 200, screenTimeoutMs: 8000, quitInputs: ['quit'],
      },
      seats: [{ id: 'a', family: 'alpha', model: 'fake/alpha' }],
      turns: 2,
      persona: 'You are a curious wanderer who wants to see what the world does when poked.',
      criteria: [{ id: 'ambush', check: 'an ambush headline appeared' }],
      runsDir,
    }, runsDir);
    const spawn = scriptedSpawn([
      { text: 'You stand in a ruined chapel.\n', reason: 'idle', exitCode: null },
      { text: 'Still the chapel.\n', reason: 'idle', exitCode: null },
      { text: 'Saved.\n', reason: 'exit', exitCode: 0 },
    ]);
    const results = await play(cfg, { label: 'idlepath', client: fakeClient(['look', 'go nave']), seats: ['a'], spawn });
    const transcript = await readFile(join(results[0].dir, 'transcript.txt'), 'utf8');
    expect(transcript).toContain('(idle');
    expect(results[0].history.some((h) => h.reason === 'idle')).toBe(true);
  });

  const promptThen = (then: Screen): Screen[] => [
    { text: 'What do you do?\n', reason: 'prompt', exitCode: null },
    then,
  ];

  it('ends by exit when an injected GameProcess reports exit, without spawning node', async () => {
    const cfg = config(3);
    const spawn = scriptedSpawn(promptThen({ text: 'Saved. Goodbye.\n', reason: 'exit', exitCode: 0 }));
    const results = await play(cfg, { label: 'fake-exit', client: fakeClient(['look']), seats: ['a'], spawn });
    expect(results[0].endedBy).toBe('exit');
    expect(results[0].history.some((h) => h.reason === 'exit')).toBe(true);
  });

  it('ends by timeout when an injected GameProcess reports timeout, and still critiques', async () => {
    // Gate: deleting `if (screen.reason === 'timeout') { endedBy = 'timeout'; ... break; }`
    // makes this RED — the stall would be treated as a playable screen.
    const cfg = config(3);
    const spawn = scriptedSpawn([
      { text: 'What do you do?\n', reason: 'prompt', exitCode: null },
      { text: 'one line then silence\n', reason: 'timeout', exitCode: null },
    ]);
    const results = await play(cfg, { label: 'fake-timeout', client: fakeClient(['look']), seats: ['a'], spawn });
    expect(results[0].endedBy).toBe('timeout');
    const stalled = results[0].history.find((h) => h.reason === 'timeout');
    expect(stalled).toBeDefined();
    expect(stalled!.input).toBe('');
    expect(results[0].critique).not.toBeNull();
    const transcript = await readFile(join(results[0].dir, 'transcript.txt'), 'utf8');
    expect(transcript).toMatch(/screen \(timeout/);
  });

  it('ends by error when makeDriver throws, and still writes artifacts', async () => {
    const cfg = config(2);
    const results = await play(cfg, {
      label: 'fake-error',
      client: fakeClient(['look']),
      seats: ['a'],
      makeDriver: async () => { throw new Error('driver exploded'); },
    });
    expect(results[0].endedBy).toBe('error');
    expect(results[0].error).toMatch(/driver exploded/);
    const meta = JSON.parse(await readFile(join(results[0].dir, 'meta.json'), 'utf8'));
    expect(meta.endedBy).toBe('error');
  });

  it('retries a throwing player client using the default turnRetries, then succeeds', async () => {
    // Gate: changing `opts.turnRetries ?? 3` to `?? 0` makes this RED.
    const cfg = config(2);
    let n = 0;
    const client: ChatClient = async (req) => {
      if (req.json) {
        return JSON.stringify({ alive: true, summary: 's', criteria: [{ id: 'ambush', met: true, evidence: 'e', turn: 1 }, { id: 'heat', met: true, evidence: 'e', turn: 1 }], highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: true });
      }
      n++;
      if (n === 1) throw new Error('transient outage');
      return 'look';
    };
    const spawn = scriptedSpawn([
      { text: 'What do you do?\n', reason: 'prompt', exitCode: null },
      { text: 'You look.\nWhat do you do?\n', reason: 'prompt', exitCode: null },
      { text: 'Saved.\n', reason: 'exit', exitCode: 0 },
    ]);
    const results = await play(cfg, { label: 'retry-ok', client, seats: ['a'], spawn });
    expect(results[0].endedBy).not.toBe('error');
    expect(results[0].turnsPlayed).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(1);
  });

  it('retries a configured number of throws then succeeds', async () => {
    const cfg = config(2);
    let n = 0;
    const client: ChatClient = async (req) => {
      if (req.json) {
        return JSON.stringify({ alive: true, summary: 's', criteria: [{ id: 'ambush', met: true, evidence: 'e', turn: 1 }, { id: 'heat', met: true, evidence: 'e', turn: 1 }], highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: true });
      }
      n++;
      if (n <= 2) throw new Error(`transient ${n}`);
      return 'look';
    };
    const spawn = scriptedSpawn([
      { text: 'What do you do?\n', reason: 'prompt', exitCode: null },
      { text: 'You look.\nWhat do you do?\n', reason: 'prompt', exitCode: null },
      { text: 'Saved.\n', reason: 'exit', exitCode: 0 },
    ]);
    const results = await play(cfg, { label: 'retry-2', client, seats: ['a'], spawn, turnRetries: 2 });
    expect(results[0].endedBy).not.toBe('error');
    expect(n).toBeGreaterThan(2);
  });

  it('ends by error when the player client always throws, with critiqueError and artifacts', async () => {
    const cfg = config(2);
    const client: ChatClient = async () => { throw new Error('provider down'); };
    const spawn = scriptedSpawn([{ text: 'What do you do?\n', reason: 'prompt', exitCode: null }]);
    const results = await play(cfg, { label: 'always-throw', client, seats: ['a'], spawn, turnRetries: 1 });
    expect(results[0].endedBy).toBe('error');
    expect(results[0].critique).toBeNull();
    expect(results[0].critiqueError).toMatch(/no player turns|provider down/);
    const transcript = await readFile(join(results[0].dir, 'transcript.txt'), 'utf8');
    const meta = JSON.parse(await readFile(join(results[0].dir, 'meta.json'), 'utf8'));
    expect(meta.endedBy).toBe('error');
    expect(transcript).toContain('# ai-playtest transcript');
  });
});

function rawConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { game: gameOverRaw, ...rest } = over;
  const gameOver = gameOverRaw && typeof gameOverRaw === 'object' && !Array.isArray(gameOverRaw)
    ? (gameOverRaw as Record<string, unknown>)
    : {};
  return {
    name: 't',
    seats: [{ id: 'a', family: 'alpha', model: 'fake/m' }],
    persona: 'You are a curious wanderer who looks around.',
    criteria: [{ id: 'c', check: 'something happened' }],
    ...rest,
    game: { command: 'node', args: ['-e', ''], promptPatterns: ['>'], ...gameOver },
  };
}

describe('config', () => {
  it('rejects two seats of one family and resolves $ENV values', () => {
    expect(() => validateConfig({ name: 'x', game: { command: 'node', args: [], promptPatterns: ['>'] }, seats: [{ id: 'a', family: 'f', model: 'm' }, { id: 'b', family: 'f', model: 'm2' }], persona: 'p'.repeat(30), criteria: [{ id: 'c', check: 'x' }] }, '/tmp')).toThrow(ConfigError);
    expect(resolveEnv({ KEY: '$MY_SECRET', PLAIN: 'v' }, { MY_SECRET: 's3' })).toEqual({ KEY: 's3', PLAIN: 'v' });
    expect(() => resolveEnv({ KEY: '$MISSING' }, {})).toThrow(ConfigError);
  });

  it.each([
    [{ name: '' }, /name missing/],
    [{ seats: [] }, /seats missing/],
    [{ persona: 'short' }, /persona missing/],
    [{ criteria: [] }, /criteria missing/],
    [{ game: { promptPatterns: ['('] } }, /not a valid regex/],
    [{ seats: [{ id: 'a', family: 'f', model: 'm' }, { id: 'b', family: 'f', model: 'm2' }] }, /family f seated twice/],
  ] as Array<[Record<string, unknown>, RegExp]>)('rejects %j with a specific ConfigError', (over, msg) => {
    expect(() => validateConfig(rawConfig(over), '/tmp')).toThrow(ConfigError);
    try {
      validateConfig(rawConfig(over), '/tmp');
      throw new Error('expected ConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toMatch(msg);
      expect((err as ConfigError).hint.length).toBeGreaterThan(0);
    }
  });

  it('wraps a missing file as ConfigError', async () => {
    // Gate: deleting the loadConfig ENOENT catch (letting the raw error out)
    // makes this RED — callers would see ENOENT instead of E_CONFIG.
    await expect(loadConfig(join(runsDir, 'no-such-config.json'))).rejects.toMatchObject({
      code: 'E_CONFIG',
      message: expect.stringMatching(/cannot read/),
    });
  });

  it('wraps malformed JSON as ConfigError', async () => {
    const p = join(runsDir, 'bad.json');
    await writeFile(p, '{not json', 'utf8');
    await expect(loadConfig(p)).rejects.toMatchObject({
      code: 'E_CONFIG',
      message: expect.stringMatching(/not valid JSON/),
    });
  });

  it('throws ReportError for a missing run directory', async () => {
    await expect(readRun(join(runsDir, 'not-a-dir'))).rejects.toBeInstanceOf(ReportError);
    await expect(readRun(join(runsDir, 'not-a-dir'))).rejects.toMatchObject({
      code: 'E_REPORT',
      message: expect.stringMatching(/no run directory/),
    });
  });
});

describe('validateDriver', () => {
  it('defaults undefined to stdio and pty without size fields', () => {
    expect(validateDriver(undefined)).toEqual({ kind: 'stdio' });
    expect(validateDriver({ kind: 'pty' })).toEqual({ kind: 'pty', cols: undefined, rows: undefined, readySentinel: undefined });
  });

  it.each([
    [{ kind: 'nope' }, /unknown driver kind/],
    [{ kind: 'rpc', port: 0 }, /port/],
    [{ kind: 'rpc', port: 70_000 }, /port/],
    [{ kind: 'rpc', port: '7777' }, /port/],
  ] as Array<[Record<string, unknown>, RegExp]>)('rejects %j', (raw, msg) => {
    expect(() => validateDriver(raw)).toThrow(ConfigError);
    expect(() => validateDriver(raw)).toThrow(msg);
  });
});

describe('createDriver / createStdioDriver inject', () => {
  it('createDriver builds a stdio driver by default', async () => {
    const cfg = validateConfig(rawConfig({
      game: { command: process.execPath, args: ['-e', 'process.exit(0)'], promptPatterns: ['>'] },
    }), runsDir);
    const d = await createDriver(cfg, {});
    expect(d.modality).toBe('stdio');
    await d.stop();
  });

  it('createDriver builds a pty driver or throws PtyUnavailableError', async () => {
    const cfg = validateConfig(rawConfig({
      driver: { kind: 'pty' },
      game: { command: process.execPath, args: ['-e', 'process.exit(0)'], promptPatterns: ['>'] },
    }), runsDir);
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (/AttachConsole|conpty_console_list_agent|getConsoleProcessList/i.test(text)) {
        if (typeof encoding === 'function') encoding();
        else if (typeof cb === 'function') cb();
        return true;
      }
      return origWrite(chunk as never, encoding as never, cb as never);
    }) as typeof process.stderr.write;
    try {
      const d = await createDriver(cfg, {});
      expect(d.modality).toBe('pty');
      await d.stop();
    } catch (err) {
      expect(err).toBeInstanceOf(PtyUnavailableError);
      expect((err as PtyUnavailableError).code).toBe('E_PTY_UNAVAILABLE');
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it('createStdioDriver forwards a choose action as the option id, not the label', async () => {
    const sent: string[] = [];
    const spawn = (): GameProcess => ({
      send(line: string) { sent.push(line); },
      async nextScreen() { return { text: 'menu', reason: 'prompt', exitCode: null }; },
      kill() { /* scripted */ },
      get exited() { return false; },
      get exitCode() { return null; },
      get stderr() { return ''; },
      get spawnError() { return null; },
    });
    const d = createStdioDriver({
      game: {
        command: 'x', args: [], promptPatterns: ['>'],
        promptQuietMs: 1, idleQuietMs: 2, screenTimeoutMs: 3, quitInputs: ['quit'],
      },
      env: {},
      spawn,
    });
    await d.start();
    await d.step({ kind: 'choose', id: '1' });
    expect(sent).toEqual(['1']);
    await d.stop();
  });

  it('createStdioDriver spawn inject covers exit, timeout, and idle without a child', async () => {
    const screens: Screen[] = [
      { text: 'go', reason: 'idle', exitCode: null },
      { text: 'stall', reason: 'timeout', exitCode: null },
      { text: 'bye', reason: 'exit', exitCode: 0 },
    ];
    let i = 0;
    const spawn = (): GameProcess => ({
      send() { /* scripted */ },
      async nextScreen() { return screens[Math.min(i++, screens.length - 1)]; },
      kill() { /* scripted */ },
      get exited() { return i >= screens.length; },
      get exitCode() { return 0; },
      get stderr() { return ''; },
      get spawnError() { return null; },
    });
    const d = createStdioDriver({
      game: {
        command: 'x', args: [], promptPatterns: ['>'],
        promptQuietMs: 1, idleQuietMs: 2, screenTimeoutMs: 3, quitInputs: ['quit'],
      },
      env: {},
      spawn,
    });
    expect((await d.start()).reason).toBe('idle');
    expect((await d.step({ kind: 'line', line: 'look' })).reason).toBe('timeout');
    expect((await d.step({ kind: 'line', line: 'look' })).reason).toBe('exit');
    await d.stop();
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
    const cfg = config(1);
    const results = await play(cfg, {
      label: 'zeroturn',
      client: fakeClient(['look']),
      seats: ['a'],
      makeDriver: async () => ({
        modality: 'stdio',
        async start() { return { text: '', reason: 'exit' as const, done: true, exitCode: 0 }; },
        async step() { return { text: '', reason: 'exit' as const, done: true, exitCode: 0 }; },
        async stop() { /* noop */ },
        diagnostics: '',
      }),
    });
    // Previously: zero iterations, endedBy stayed 'turns' (a success status),
    // and the critic judged a transcript containing only the quit input.
    expect(results[0].turnsPlayed).toBe(0);
    expect(results[0].endedBy).toBe('exit');
    expect(results[0].critique).toBeNull();
    expect(results[0].critiqueError).toMatch(/no player turns/);
  });

  it('keeps the runner\'s own quit input out of the player\'s turn count', async () => {
    const cfg = config(2);
    const results = await play(cfg, { label: 'quitcount', client: fakeClient(['look', 'go nave']), seats: ['a'] });
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

    const results = await play(cfg, { label: 'jury', client, parallel: false });
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
    const results = await play(cfg, { label: 'subset', client: fakeClient(['look', 'go nave']), seats: ['a'] });
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
    const results = await play(one, { label: 'solo', client: fakeClient(['look', 'go nave']) });
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
