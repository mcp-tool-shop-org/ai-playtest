import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseTruthLog, truthFor, gradeRuns, summarize, renderCalibration, type AnswerKey } from '../src/calibration.js';
import { lintCriteria, validateConfig } from '../src/config.js';
import { runAll } from '../src/run.js';
import type { ChatClient } from '../src/openrouter.js';

const GAME = resolve(__dirname, '..', 'calibration', 'game.mjs');
const KEY: AnswerKey = JSON.parse(readFileSync(resolve(__dirname, '..', 'calibration', 'answer-key.json'), 'utf8'));
const CRITERIA = JSON.parse(readFileSync(resolve(__dirname, '..', 'calibration', 'criteria.json'), 'utf8')).criteria;

/** Play a build with fixed inputs; return what the player saw and the parsed truth log. */
function play(variant: string, inputs: string[]) {
  const r = spawnSync(process.execPath, [GAME, '--variant', variant], { input: inputs.join('\n') + '\n', encoding: 'utf8' });
  return { out: r.stdout, err: r.stderr, log: parseTruthLog(r.stderr)! };
}

const WIN = ['north', 'east', 'light lamp', 'take seal', 'west', 'south', 'west', 'west'];

describe('Harrow Gate builds', () => {
  it('baseline: the healthy build can be won, with every positive signal on the record', () => {
    const { out, log } = play('baseline', ['east', 'west', 'east', 'west', ...WIN]);
    expect(out).toContain('Find the warden\'s seal');
    expect(out).toContain('You can type:');
    expect(out).toContain('The bell in the chapel tower tolls');
    expect(out).toContain('the west road opens');
    for (const e of ['tick', 'cost', 'changed-on-return', 'win']) expect(log.events).toContain(e);
    expect(log.events).not.toContain('dead-end');
  });

  it('is deterministic: the same inputs give the same screens and the same log', () => {
    expect(play('baseline', WIN).out).toBe(play('baseline', WIN).out);
    expect(play('baseline', WIN).err).toBe(play('baseline', WIN).err);
  });

  it('still-world: nothing happens on its own however long you wait', () => {
    const { out, log } = play('still-world', Array(12).fill('wait'));
    expect(out).not.toContain('tolls');
    expect(log.events).not.toContain('tick');
  });

  it('refusal voice: a character, a system message, or an open gate', () => {
    expect(play('baseline', ['west', 'west']).out).toContain('Warden Sela steps into the arch');
    expect(play('baseline', ['west', 'west']).log.events).toContain('refusal:character');
    const sys = play('system-refusal', ['west', 'west']);
    expect(sys.out).toContain('[ACCESS DENIED]');
    expect(sys.log.events).toContain('refusal:system');
    const open = play('open-gate', ['west', 'west']);
    expect(open.out).toContain('Nobody stops you');
    expect(open.log.events.some((e) => e.startsWith('refusal'))).toBe(false);
  });

  it('bare-prompt: a lone ">" and no list of what to type', () => {
    const { out } = play('bare-prompt', ['look']);
    expect(out).not.toContain('You can type:');
    expect(out).not.toContain('Exits:');
    expect(out.trimEnd().endsWith('>')).toBe(true);
  });

  it('deaf: every input gets the same answer', () => {
    const { out, log } = play('deaf', ['north', 'take seal', 'dance']);
    const answers = out.split('What do you do?').slice(1, 4).map((s) => s.trim().split('\n')[0]);
    expect(new Set(answers).size).toBe(1);
    expect(log.events.filter((e) => e === 'ignored')).toHaveLength(3);
  });

  it('no-cost: the archive is lit and the seal costs nothing', () => {
    const { out, log } = play('no-cost', ['north', 'east', 'take seal']);
    expect(out).toContain('You take the warden\'s brass seal');
    expect(out).not.toContain('oil');
    expect(log.events).not.toContain('cost');
  });

  it('no-goal: the intro never says what to do', () => {
    expect(play('no-goal', ['look']).out).not.toContain('Find the warden\'s seal');
  });

  it('same-text: a place reads the same on every visit', () => {
    const { log } = play('same-text', ['east', 'west', 'east', 'west', 'east']);
    expect(log.events).toContain('revisit');
    expect(log.events).not.toContain('changed-on-return');
  });

  it('trapdoor: the cellar locks the player in, with no exits from then on', () => {
    const { out, log } = play('trapdoor', ['east', 'down', 'up', 'look', 'wait', 'up']);
    expect(out).toContain('The trapdoor slams shut above you');
    expect(out).toContain('Exits: none.');
    expect(log.events).toContain('dead-end');
    expect(log.events.filter((e) => e === 'stuck').length).toBeGreaterThanOrEqual(4);
  });

  it('the shipped criteria pass the compound-criterion lint', () => {
    expect(lintCriteria(CRITERIA)).toEqual([]);
  });
});

describe('the answer key', () => {
  it('turns the truth log into a yes or no per criterion', () => {
    // Chapel and back (a return visit to the square), then the win path from the square.
    const healthy = play('baseline', ['east', 'west', ...WIN]).log;
    const bleak = play('bleak', ['east', 'down', 'up', 'up', 'look', 'wait']).log;
    const truth = (log: typeof healthy) => Object.fromEntries(Object.entries(KEY.rules).map(([id, r]) => [id, truthFor(r, log)]));
    expect(truth(healthy)).toEqual({
      'world-moves': true, 'character-refuses': false, 'input-listed': true, 'responds-to-input': true,
      'spends-resource': true, 'goal-stated': true, 'place-changes': true, 'never-stuck': true,
    });
    expect(truth(bleak)).toMatchObject({
      'world-moves': false, 'input-listed': false, 'spends-resource': false, 'goal-stated': false, 'never-stuck': false,
    });
    expect(truthFor(KEY.verifiers!.absorbing!, bleak)).toBe(true);
  });
});

describe('grading', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'ai-playtest-cal-')); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  async function seat(variant: string, id: string, stderr: string, meta: object) {
    const dir = join(root, variant, 'g1', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'stderr.txt'), stderr);
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ seat: { id }, ...meta }));
  }
  const verdict = (id: string, met: boolean) => ({ id, met, evidence: '', turn: null, metCount: met ? 1 : 0, answeredCount: 1, split: false });

  it('scores the jury, each probability judge and the deterministic checks against the truth', async () => {
    const key: AnswerKey = { rules: { moves: { anyEvent: 'tick' } }, verifiers: { absorbing: { minEvents: { event: 'stuck', count: 2 } } } };
    const log = (events: string[]) => [`{"cal":1,"variant":"v","knobs":{}}`, `{"cal":1,"t":1,"ev":${JSON.stringify(events)}}`].join('\n');
    // moves true; jury says yes (TP); jev confident yes; absorbing fired and true (TP)
    await seat('a', 's1', log(['tick', 'stuck', 'stuck']), { panel: { criteria: [verdict('moves', true)] }, scores: [{ scorer: 'jev', scores: [{ id: 'moves', p: 0.9 }] }], verifiers: { absorbing: {}, ignoredInputs: [] } });
    // moves false; jury says yes (FP); jev confident no; absorbing fired but false (FP)
    await seat('b', 's2', log([]), { panel: { criteria: [verdict('moves', true)] }, scores: [{ scorer: 'jev', scores: [{ id: 'moves', p: 0.1 }] }], verifiers: { absorbing: {}, ignoredInputs: [] } });
    // moves false; jury no (TN); jev uncertain; absorbing silent (TN)
    await seat('c', 's3', log([]), { panel: { criteria: [verdict('moves', false)] }, scores: [{ scorer: 'jev', scores: [{ id: 'moves', p: 0.5 }] }], verifiers: { absorbing: null, ignoredInputs: [] } });
    // no truth log: skipped, never guessed
    await seat('d', 's4', 'plain stderr, no log', { panel: { criteria: [verdict('moves', true)] } });

    const g = await gradeRuns(root, 'g1', key);
    expect(g.seats).toBe(3);
    expect(g.skipped).toHaveLength(1);
    const s = summarize(g);
    expect(s.criteria[0].jury).toMatchObject({ tp: 1, fp: 1, tn: 1, fn: 0, accuracy: 2 / 3 });
    expect(s.criteria[0].scorers.jev).toMatchObject({ confident: 2, correct: 2, uncertain: 1 });
    expect(s.criteria[0].scorers.jev.brier).toBeCloseTo(((0.9 - 1) ** 2 + 0.1 ** 2 + 0.5 ** 2) / 3);
    expect(s.verifiers.absorbing).toMatchObject({ tp: 1, fp: 1, tn: 1, fn: 0, precision: 0.5, recall: 1 });
    expect(s.ece.jev).not.toBeNull();
    const md = renderCalibration('g1', g, s);
    expect(md).toContain('## Where the jury was wrong');
    expect(md).toContain('`v` / s2 / moves: truth no, jury yes');
  });
});

describe('end to end: a real playtest run over Harrow Gate, graded from the saved stderr', () => {
  let runsDir: string;
  beforeAll(async () => { runsDir = await mkdtemp(join(tmpdir(), 'ai-playtest-cal-run-')); });
  afterAll(async () => { await rm(runsDir, { recursive: true, force: true }); });

  it('the runner keeps the truth log out of the transcript and the grader finds it', async () => {
    const cfg = validateConfig({
      name: 'harrow', game: { command: process.execPath, args: [GAME, '--variant', 'still-world'], promptPatterns: ['What do you do\\?\\s*$', '^>\\s*$'], promptQuietMs: 100, idleQuietMs: 1500, screenTimeoutMs: 10_000, quitInputs: ['quit'] },
      seats: [{ id: 'a', family: 'alpha', model: 'fake/alpha' }, { id: 'b', family: 'beta', model: 'fake/beta' }],
      turns: 3, persona: 'You are playing a short text adventure set in a walled town.', criteria: CRITERIA, runsDir: join(runsDir, 'still-world'),
    }, runsDir);
    const moves = ['north', 'east', 'light lamp'];
    const n = new Map<string, number>();
    // A lenient jury: says every criterion is met. still-world has no ticks, so world-moves is a false positive.
    const client: ChatClient = async (req) => req.json
      ? JSON.stringify({ alive: true, summary: 's', criteria: CRITERIA.map((c: { id: string }) => ({ id: c.id, met: true, evidence: 'e', turn: 1 })), highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: true })
      : (() => { const i = n.get(req.model) ?? 0; n.set(req.model, i + 1); return moves[i % moves.length]; })();
    const results = await runAll(cfg, { label: 'e2e', client, parallel: false, turnRetrySleepMs: 1 });
    expect(results).toHaveLength(2);
    const transcript = await readFile(join(results[0].dir, 'transcript.txt'), 'utf8');
    expect(transcript).not.toContain('"cal":1'); // models never see the truth
    const g = await gradeRuns(runsDir, 'e2e', KEY);
    expect(g.seats).toBe(2);
    const s = summarize(g);
    const worldMoves = s.criteria.find((c) => c.criterion === 'world-moves')!;
    expect(worldMoves.positives).toBe(0);
    expect(worldMoves.jury.fp).toBe(2);
  }, 30000);
});
