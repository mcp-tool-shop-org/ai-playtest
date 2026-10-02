// In-process tests for the score and diff verbs. main() ends with process.exit on
// every failure, so exit is replaced with a throw that carries the code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './cli.js';

class Exit extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

let root: string;
let out: string;
let err: string;
// A real process.exit never returns; the first call is the one that counts.
let firstExit: number | undefined;
const savedKey = process.env.OPENROUTER_API_KEY;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-playtest-cli-'));
  out = '';
  err = '';
  firstExit = undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { firstExit ??= code ?? 0; throw new Exit(code ?? 0); }) as never);
  vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => { out += s; return true; }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { err += s; return true; }) as never);
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  await rm(root, { recursive: true, force: true });
});

async function exitCode(argv: string[]): Promise<number> {
  firstExit = undefined;
  try {
    await main(argv);
    return 0;
  } catch (e) {
    if (e instanceof Exit) return firstExit ?? e.code;
    throw e;
  }
}

async function config(extra: object = {}): Promise<string> {
  const path = join(root, 'game.playtest.json');
  await writeFile(path, JSON.stringify({
    name: 'cli test',
    game: { command: 'node', args: ['-e', ''], promptPatterns: ['>\\s*$'] },
    seats: [
      { id: 'a', family: 'mistral', model: 'mistral-small:24b', provider: 'ollama' },
      { id: 'b', family: 'qwen', model: 'qwen3:14b', provider: 'ollama' },
    ],
    criteria: [{ id: 'cost', check: 'An action spends a resource whose amount the player can see.' }],
    persona: 'You are a curious traveller trying every exit.',
    runsDir: 'runs',
    ...extra,
  }));
  return path;
}

async function seat(label: string, id: string, met: boolean): Promise<void> {
  const dir = join(root, 'runs', label, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify({
    seat: { id, family: id, model: `${id}-model` }, turnsPlayed: 4, endedBy: 'exit', error: null, critiqueError: null,
  }));
  await writeFile(join(dir, 'critique.json'), JSON.stringify({ alive: true, summary: 's', criteria: [{ id: 'cost', met, evidence: 'oil 3 to 2', turn: 2 }] }));
  await writeFile(join(dir, 'transcript.txt'), '═══ turn 1 ── screen\nA room.\n>\n> light lamp\n═══ turn 2 ── screen\nOil 2.\n>\n> west\n');
}

describe('diff verb', () => {
  it('needs both --base and --head', async () => {
    expect(await exitCode(['diff', await config(), '--base', 'v1'])).toBe(1);
  });

  it('names a missing run with exit 2', async () => {
    const cfg = await config();
    await seat('v1', 'a', true);
    expect(await exitCode(['diff', cfg, '--base', 'v1', '--head', 'nope'])).toBe(2);
    expect(err).toMatch(/no run at/);
  });

  it('exits 5 on an open finding and writes the diff report into the head run', async () => {
    const cfg = await config();
    await seat('v1', 'a', true);
    await seat('v2', 'a', false);
    expect(await exitCode(['diff', cfg, '--base', 'v1', '--head', 'v2'])).toBe(5);
    expect(out).toContain('OPEN     criterion-lost:cost: 1/1 met -> 0/1 met');
    const md = await readFile(join(root, 'runs', 'v2', 'DIFF-v1.md'), 'utf8');
    expect(md).toContain('criterion-lost:cost');
    expect(JSON.parse(await readFile(join(root, 'runs', 'v2', 'DIFF-v1.json'), 'utf8')).kind).toBe('diff');
  });

  it('exits 0 once every finding is accepted, and warns about acceptances that match nothing', async () => {
    const cfg = await config();
    await seat('v1', 'a', true);
    await seat('v2', 'a', false);
    const accept = join(root, 'accept.json');
    await writeFile(accept, JSON.stringify({ accepted: [
      { id: 'criterion-lost:cost', note: 'lamp cut on purpose' },
      { id: 'alive-lost:world', note: 'old' },
    ] }));
    expect(await exitCode(['diff', cfg, '--base', 'v1', '--head', 'v2', '--accept', accept])).toBe(0);
    expect(out).toContain('accepted criterion-lost:cost');
    expect(out).toContain('warn: acceptance alive-lost:world matched nothing');
  });

  it('prints improvements and exits 0 when nothing got worse', async () => {
    const cfg = await config();
    await seat('v1', 'a', false);
    await seat('v2', 'a', true);
    expect(await exitCode(['diff', cfg, '--base', 'v1', '--head', 'v2'])).toBe(0);
    expect(out).toContain('better   criterion-gained:cost');
  });

  it('refuses a missing or malformed acceptance file with exit 2', async () => {
    const cfg = await config();
    await seat('v1', 'a', true);
    await seat('v2', 'a', false);
    expect(await exitCode(['diff', cfg, '--base', 'v1', '--head', 'v2', '--accept', join(root, 'none.json')])).toBe(2);
    const bad = join(root, 'bad.json');
    await writeFile(bad, '{"accepted":[{"id":"criterion-lost:cost"}]}');
    expect(await exitCode(['diff', cfg, '--base', 'v1', '--head', 'v2', '--accept', bad])).toBe(2);
    expect(err).toMatch(/has no note/);
  });
});

describe('check and run guards', () => {
  it('check warns about a criterion that bundles two claims', async () => {
    const cfg = await config({ criteria: [{ id: 'cost', check: 'Shooting costs ammo, so there is a reason to hold fire.' }] });
    expect(await exitCode(['check', cfg])).toBe(0);
    expect(out).toContain('ok: cli test');
    expect(out).toMatch(/warn: criterion cost .*Split it into one observable claim per criterion/);
  });

  it('run refuses scorers without OPENROUTER_API_KEY before playing anything', async () => {
    expect(await exitCode(['run', await config({ scorers: [{ kind: 'jev' }] }), '--label', 'v1'])).toBe(3);
    expect(err).toMatch(/config\.scorers needs it/);
  });
});

describe('score verb', () => {
  it('prints a scorer the provider refused as unscored, and still rebuilds the report', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-TEST';
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' }));
    const cfg = await config({ scorers: [{ kind: 'jev' }] });
    await seat('v1', 'a', true);
    expect(await exitCode(['score', cfg, '--label', 'v1'])).toBe(0);
    expect(out).toMatch(/\[a\] jev: unscored \(/);
  });

  it('needs --label', async () => {
    expect(await exitCode(['score', await config({ scorers: [{ kind: 'jev' }] })])).toBe(1);
  });

  it('needs scorers in the config', async () => {
    expect(await exitCode(['score', await config(), '--label', 'v1'])).toBe(2);
    expect(err).toMatch(/no scorers/);
  });

  it('needs OPENROUTER_API_KEY', async () => {
    expect(await exitCode(['score', await config({ scorers: [{ kind: 'jev' }] }), '--label', 'v1'])).toBe(3);
  });

  it('names a missing run, and a run with no transcripts, with exit 2', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-TEST';
    const cfg = await config({ scorers: [{ kind: 'jev' }] });
    expect(await exitCode(['score', cfg, '--label', 'v1'])).toBe(2);
    await mkdir(join(root, 'runs', 'v1'), { recursive: true });
    expect(await exitCode(['score', cfg, '--label', 'v1'])).toBe(2);
    expect(err).toMatch(/no seat transcripts/);
  });

  it('scores the saved transcripts, prints each seat, and rebuilds the report', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-TEST';
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent.push(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'typesafe/jev-1.13', answers: { cost: { type: 'noul', noul: 0.88 } }, usage: { cost: 0.0001 } }) };
    });
    const cfg = await config({ scorers: [{ kind: 'jev' }] });
    await seat('v1', 'a', true);
    expect(await exitCode(['score', cfg, '--label', 'v1'])).toBe(0);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).state).toContain('light lamp');
    expect(out).toContain('[a] jev: cost 0.88');
    expect(existsSync(join(root, 'runs', 'v1', 'REPORT.md'))).toBe(true);
  });
});

describe('persona profiles', () => {
  const ECHO = join(process.cwd(), 'test', 'fixtures', 'echo-game.mjs');
  const critique = JSON.stringify({ alive: true, summary: 'It answers.', criteria: [{ id: 'cost', met: false, evidence: 'none', turn: 1 }], highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: true });

  async function echoConfig(personas?: object): Promise<string> {
    return config({
      game: { command: process.execPath, args: [ECHO], promptPatterns: ['What do you do\\?\\s*$', 'Character name:\\s*$'], promptQuietMs: 150, idleQuietMs: 2000, screenTimeoutMs: 20000 },
      setup: [{ match: 'Character name:\\s*$', answer: 'Wren' }],
      turns: 3,
      ...(personas ? { personas } : {}),
    });
  }

  // Ollama, stubbed: the critic gets a critique; a player's input depends on its play style.
  function stubOllama(): void {
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> };
      const all = body.messages.map((m) => m.content).join(' ');
      let content = 'wait';
      if (all.includes('"alive"')) content = critique;
      else if (all.includes('Talk to everyone')) content = 'talk to the priest';
      return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content }, done_reason: 'stop', prompt_eval_count: 50 }) };
    });
  }

  it('plays control and each persona as its own label, and writes PERSONAS.md', async () => {
    stubOllama();
    const cfg = await echoConfig();
    expect(await exitCode(['run', cfg, '--label', 'p1', '--profile', 'player', '--personas', 'reader,tinkerer', '--serial', '--seats', 'a'])).toBe(0);
    for (const l of ['p1--control', 'p1--reader', 'p1--tinkerer']) expect(existsSync(join(root, 'runs', l, 'REPORT.md')), l).toBe(true);
    const md = await readFile(join(root, 'runs', 'p1', 'PERSONAS.md'), 'utf8');
    expect(md).toContain('`player` profile');
    expect(md, md).toContain('| reader | 1 | share:talk,examine ↑ | 100% | 0% | 10% | **distinct** |');
    expect(md, md).toContain('| tinkerer | 1 | offPath ↑ | 0% | 0% | 10% | played like control |');
    expect(out).toContain('personas: 1/2 played distinctly');
    const saved = JSON.parse(await readFile(join(root, 'runs', 'p1', 'profile.json'), 'utf8'));
    expect(saved.personas.map((p: { id: string }) => p.id)).toEqual(['control', 'reader', 'tinkerer']);
  }, 60_000);

  it('rebuilds PERSONAS.md with report, from the saved profile', async () => {
    stubOllama();
    const cfg = await echoConfig({ profile: 'player', only: ['reader'] });
    expect(await exitCode(['run', cfg, '--label', 'p2', '--serial', '--seats', 'a'])).toBe(0);
    await writeFile(join(root, 'runs', 'p2', 'PERSONAS.md'), 'stale');
    out = '';
    expect(await exitCode(['report', cfg, '--label', 'p2'])).toBe(0);
    expect(out).toContain('PERSONAS.md');
    expect(await readFile(join(root, 'runs', 'p2', 'PERSONAS.md'), 'utf8')).toContain('`player` profile');
  }, 60_000);

  it('refuses --runs with a profile, --personas without one, and an unknown profile', async () => {
    const cfg = await echoConfig();
    expect(await exitCode(['run', cfg, '--profile', 'player', '--runs', '2'])).toBe(1);
    expect(await exitCode(['run', cfg, '--personas', 'reader'])).toBe(1);
    expect(await exitCode(['run', cfg, '--profile', 'astrology'])).toBe(2);
    expect(err).toMatch(/unknown persona profile/);
  });

  it('notes a persona left out for want of a briefing', async () => {
    stubOllama();
    const cfg = await echoConfig();
    expect(await exitCode(['run', cfg, '--label', 'p3', '--profile', 'scientific', '--personas', 'briefed', '--serial', '--seats', 'a'])).toBe(0);
    expect(out).toContain('note: briefed left out');
  }, 60_000);
});
