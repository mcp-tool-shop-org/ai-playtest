// The edges of grading: malformed logs, missing files, unanswered juries,
// unscored judges and empty sections. The happy path is in calibration.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTruthLog, truthFor, gradeRuns, summarize, renderCalibration, type Graded, type TruthLog } from '../src/calibration.js';

const log = (o: object) => JSON.stringify({ cal: 1, ...o });

describe('parseTruthLog', () => {
  it('ignores prose, broken JSON, other tools\' JSON and non-string events', () => {
    const t = parseTruthLog([
      'Warning: something',
      '{not json',
      '{"cal":2,"knobs":{"x":1}}',
      log({ knobs: { worldMoves: false } }),
      log({ t: 1, ev: ['tick', 7, null, 'cost'] }),
      log({ t: 2 }),
    ].join('\r\n'));
    expect(t).toEqual({ variant: 'custom', knobs: { worldMoves: false }, events: ['tick', 'cost'] });
  });

  it('returns null when the game never named its switches', () => {
    expect(parseTruthLog(log({ t: 1, ev: ['tick'] }))).toBeNull();
  });
});

describe('truthFor', () => {
  const t: TruthLog = { variant: 'v', knobs: { refusal: 'system' }, events: ['tick', 'tick', 'cost'] };
  it('reads every rule kind', () => {
    expect(truthFor({ anyEvent: 'cost' }, t)).toBe(true);
    expect(truthFor({ noEvent: 'dead-end' }, t)).toBe(true);
    expect(truthFor({ noEvent: 'tick' }, t)).toBe(false);
    expect(truthFor({ knob: 'refusal', equals: 'character' }, t)).toBe(false);
    expect(truthFor({ minEvents: { event: 'tick', count: 2 } }, t)).toBe(true);
    expect(truthFor({ minEvents: { event: 'tick', count: 3 } }, t)).toBe(false);
  });
});

describe('gradeRuns edges', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ai-playtest-cal-edge-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function seatDir(variant: string, seat: string, files: Record<string, string>) {
    const dir = join(root, variant, 'L', seat);
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  }

  it('skips what it cannot grade and says why', async () => {
    await writeFile(join(root, 'notes.txt'), 'not a variant');
    await mkdir(join(root, 'other-label-only', 'X'), { recursive: true });
    await seatDir('a', 'no-stderr', { 'meta.json': '{}' });
    await seatDir('a', 'no-log', { 'meta.json': '{}', 'stderr.txt': 'plain text\n' });
    await writeFile(join(root, 'a', 'L', 'REPORT.md'), '# r');
    const g = await gradeRuns(root, 'L', { rules: { moves: { anyEvent: 'tick' } } });
    expect(g.seats).toBe(0);
    expect(g.skipped).toEqual(['a/no-log: no truth log in stderr.txt', 'a/no-stderr: no meta.json or stderr.txt']);
  });

  it('reads an unanswered jury as null, a missing score as null, and falls back to the folder name for the seat', async () => {
    await seatDir('a', 'folder-name', {
      'meta.json': JSON.stringify({
        panel: { criteria: [{ id: 'moves', met: false, answeredCount: 0 }] },
        scores: [{ scorer: 'jev', scores: [{ id: 'other', p: 0.4 }] }],
      }),
      'stderr.txt': [log({ knobs: {} }), log({ t: 1, ev: ['tick'] })].join('\n'),
    });
    const g = await gradeRuns(root, 'L', {
      rules: { moves: { anyEvent: 'tick' }, gone: { noEvent: 'tick' } },
      verifiers: { absorbing: { anyEvent: 'dead-end' } },
    });
    expect(g.cells).toEqual([
      { variant: 'custom', seat: 'folder-name', criterion: 'moves', truth: true, jury: null, p: { jev: null } },
      { variant: 'custom', seat: 'folder-name', criterion: 'gone', truth: false, jury: null, p: { jev: null } },
    ]);
    // No verifier block on the seat: nothing to grade, nothing invented.
    expect(g.verifiers).toEqual([]);
  });

  it('grades the ignored-input check from the verifier block', async () => {
    await seatDir('a', 's', {
      'meta.json': JSON.stringify({ seat: { id: 's' }, verifiers: { absorbing: null, ignoredInputs: [] } }),
      'stderr.txt': [log({ variant: 'deaf', knobs: { reacts: false } }), log({ t: 1, ev: ['ignored'] })].join('\n'),
    });
    const g = await gradeRuns(root, 'L', { rules: {}, verifiers: { ignoredInputs: { anyEvent: 'ignored' }, absorbing: { anyEvent: 'dead-end' } } });
    expect(g.verifiers).toEqual([
      { variant: 'deaf', seat: 's', check: 'absorbing', truth: false, fired: false },
      { variant: 'deaf', seat: 's', check: 'ignoredInputs', truth: true, fired: false },
    ]);
  });
});

describe('summarize and render edges', () => {
  const g: Graded = {
    seats: 3,
    skipped: ['b/x: no truth log in stderr.txt'],
    cells: [
      { variant: 'v', seat: 's1', criterion: 'c', truth: true, jury: false, p: { jev: 1, other: null } },
      { variant: 'v', seat: 's2', criterion: 'c', truth: false, jury: null, p: { jev: 0.5, other: null } },
      { variant: 'v', seat: 's3', criterion: 'c', truth: false, jury: false, p: { jev: 0.9, other: null } },
    ],
    verifiers: [
      { variant: 'v', seat: 's1', check: 'absorbing', truth: true, fired: false },
      { variant: 'v', seat: 's2', check: 'absorbing', truth: false, fired: false },
    ],
  };

  it('counts misses, the unanswered, the uncertain and the unscored', () => {
    const s = summarize(g);
    const c = s.criteria[0];
    expect(c.jury).toMatchObject({ tp: 0, fp: 0, tn: 1, fn: 1, unanswered: 1, accuracy: 0.5 });
    expect(c.scorers.jev).toMatchObject({ confident: 2, correct: 1, uncertain: 1, unscored: 0 });
    expect(c.scorers.other).toEqual({ confident: 0, correct: 0, uncertain: 0, unscored: 3, brier: null });
    // p = 1 lands in the top bin, which includes its upper edge.
    expect(s.ece.jev).toBeGreaterThan(0);
    expect(s.ece.other).toBeNull();
    expect(s.verifiers.absorbing).toMatchObject({ tp: 0, fn: 1, tn: 1, precision: null, recall: 0 });
  });

  it('renders dashes for what could not be computed, the misses, and the skipped', () => {
    const md = renderCalibration('L', g, summarize(g));
    expect(md).toContain('3 seat transcript(s) graded');
    expect(md).toContain('; 1 skipped');
    expect(md).toContain('## Probability judge: other');
    expect(md).toContain('Expected calibration error over all criteria: **—**');
    expect(md).toContain('| c | 0/0 | 0 | — |');
    expect(md).toContain('| absorbing | — | 0% |');
    expect(md).toContain('`v` / s1 / c: truth yes, jury no');
    expect(md).toContain('## Skipped');
  });

  it('leaves out the sections that have nothing in them', () => {
    const empty: Graded = { seats: 0, skipped: [], cells: [], verifiers: [] };
    const md = renderCalibration('L', empty, summarize(empty));
    expect(md).not.toContain('Probability judge');
    expect(md).not.toContain('Deterministic checks');
    expect(md).not.toContain('Where the jury was wrong');
    expect(md).not.toContain('Skipped');
  });

  it('skips a scorer row for a criterion that scorer never saw', () => {
    const s = summarize(g);
    delete (s.criteria[0].scorers as Record<string, unknown>).other;
    expect(renderCalibration('L', g, s)).not.toContain('| c | 0/0 | 0 | — |');
  });
});
