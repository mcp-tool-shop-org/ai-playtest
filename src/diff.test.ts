import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffRuns, parseAcceptances, openFindings, renderDiff, transcriptInputs, transcriptTurns, IGNORED_RISE } from './diff.js';
import { ReportError } from './report.js';

type SeatOpts = {
  met?: Record<string, boolean>;
  alive?: boolean;
  absorbingFrom?: number;
  ignored?: number;
  turns?: number;
  endedBy?: string;
  jev?: Record<string, number>;
  inputs?: string[];
};

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ai-playtest-diff-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function transcriptOf(inputs: string[]): string {
  const blocks = inputs.map((input, i) => `═══ turn ${i + 1} ── screen (prompt, 5ms)\nA room.\n>\n> ${input}\n`);
  blocks.push(`═══ turn ${inputs.length + 1} ── screen (exit, 5ms)\nThe end.\n`);
  return `# ai-playtest transcript -- test\n\n${blocks.join('\n')}`;
}

async function seat(run: string, id: string, o: SeatOpts = {}): Promise<void> {
  const dir = join(root, run, id);
  await mkdir(dir, { recursive: true });
  const turns = o.turns ?? 10;
  const criteria = Object.entries(o.met ?? {}).map(([cid, met]) => ({ id: cid, met, evidence: `${cid} evidence`, turn: 3 }));
  const ignoredInputs = Array.from({ length: turns }, (_, i) => ({
    turn: i + 1, input: `in${i + 1}`, kind: i < (o.ignored ?? 0) ? 'identical-screen' : 'changed',
  }));
  const meta = {
    seat: { id, family: id, model: `${id}-model` },
    turnsPlayed: turns,
    endedBy: o.endedBy ?? 'exit',
    error: o.endedBy === 'error' ? 'game crashed' : null,
    critiqueError: null,
    verifiers: {
      absorbing: o.absorbingFrom === undefined ? null : {
        hashes: ['a', 'b'], turnSpan: 4, firstTurn: o.absorbingFrom, lastTurn: o.absorbingFrom + 4,
        distinctEntryInputs: ['down'], kind: 'review', falsePositiveModes: [],
      },
      ignoredInputs,
      parser: { turns: [], unknownRate: 0, listsEmpty: true },
      terminal: { kind: 'none', turn: null, inAbsorbingComponent: false },
      noProgress: [], entityLeads: [], stateInvariants: { applied: false, hpNegative: [], inventoryDropped: [] },
    },
    ...(o.jev ? {
      scores: [{
        scorer: 'jev', kind: 'jev', model: 'typesafe/jev-1.13', band: [0.35, 0.65], stateChars: 100, clipped: false,
        scores: Object.entries(o.jev).map(([cid, p]) => ({ id: cid, p })),
      }],
    } : {}),
  };
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta));
  await writeFile(join(dir, 'critique.json'), JSON.stringify({ alive: o.alive ?? true, summary: `${id} summary`, criteria }));
  await writeFile(join(dir, 'transcript.txt'), transcriptOf(o.inputs ?? ['north', 'east', 'down', 'up']));
}

const diff = (accepted = [] as Parameters<typeof diffRuns>[4]) =>
  diffRuns(join(root, 'v1'), join(root, 'v2'), { base: 'v1', head: 'v2' }, ['moves', 'cost'], accepted);

describe('transcriptInputs', () => {
  it('reads the player inputs in order, without the final screen', () => {
    expect(transcriptInputs(transcriptOf(['go north', 'take seal']))).toEqual(['go north', 'take seal']);
  });

  it('takes the last "> " line of a turn, not a quoted line in the screen', () => {
    const t = '═══ turn 1 ── screen (prompt, 3ms)\n> a quoted line in the game\n>\n> look\n';
    expect(transcriptInputs(t)).toEqual(['look']);
  });

  it('leaves out setup answers and the runner\'s quit sequence, which the player did not choose', () => {
    const t = [
      '═══ setup ── screen (4ms)', 'Character name:', '> Wren', '',
      '═══ turn 1 ── screen (prompt, 3ms)', 'A room.', '> look', '',
      '═══ turn 2 ── screen (prompt, 3ms)', 'A room.', '> quit', '',
      '═══ turn 2 ── screen (quit, 3ms)', 'Save first?', '> quit', '',
      '═══ turn 2 ── screen (exit, 3ms)', 'Goodbye.', '',
    ].join('\n');
    expect(transcriptTurns(t).map((x) => [x.turn, x.reason, x.input])).toEqual([
      [null, 'setup', 'Wren'], [1, 'prompt', 'look'], [2, 'prompt', 'quit'], [2, 'quit', 'quit'], [2, 'exit', ''],
    ]);
    // The player's own "quit" counts; the runner's does not.
    expect(transcriptInputs(t)).toEqual(['look', 'quit']);
  });
});

describe('diffRuns', () => {
  it('reports nothing when the head run matches the base', async () => {
    for (const r of ['v1', 'v2']) {
      await seat(r, 'a', { met: { moves: true, cost: true } });
      await seat(r, 'b', { met: { moves: true, cost: true } });
    }
    const d = await diff();
    expect(d.findings).toEqual([]);
    expect(renderDiff('G', d)).toContain('Nothing got worse');
  });

  it('names a criterion the jury stopped passing, with the turn and the inputs that led there', async () => {
    await seat('v1', 'a', { met: { moves: true, cost: true } });
    await seat('v1', 'b', { met: { moves: true, cost: true } });
    await seat('v2', 'a', { met: { moves: true, cost: false }, inputs: ['north', 'east', 'light lamp', 'west'] });
    await seat('v2', 'b', { met: { moves: true, cost: false } });
    const d = await diff();
    expect(d.findings.map((f) => f.id)).toEqual(['criterion-lost:cost']);
    const f = d.findings[0];
    expect(f.base).toBe('2/2 met');
    expect(f.head).toBe('0/2 met');
    expect(f.repro[0]).toMatchObject({ seat: 'a', turn: 3, inputs: ['north', 'east', 'light lamp'], evidence: 'cost evidence' });
  });

  it('keeps setup answers in a repro, because the game needs them, and cuts at the verdict turn', async () => {
    await seat('v1', 'a', { met: { cost: true } });
    await seat('v2', 'a', { met: { cost: false } });
    await writeFile(join(root, 'v2', 'a', 'transcript.txt'), [
      '═══ setup ── screen (4ms)', 'Character name:', '> Wren', '',
      '═══ turn 1 ── screen (prompt, 3ms)', 'A room.', '> north', '',
      '═══ turn 2 ── screen (prompt, 3ms)', 'A hall.', '> light lamp', '',
      '═══ turn 3 ── screen (prompt, 3ms)', 'Lit.', '> west', '',
      '═══ turn 3 ── screen (quit, 3ms)', 'Bye.', '> quit', '',
    ].join('\n'));
    const d = await diff();
    expect(d.findings[0].repro[0].inputs).toEqual(['Wren', 'north', 'light lamp', 'west']);
  });

  it('lists a criterion that started passing as an improvement, not a finding', async () => {
    await seat('v1', 'a', { met: { moves: false, cost: true } });
    await seat('v2', 'a', { met: { moves: true, cost: true } });
    const d = await diff();
    expect(d.findings).toEqual([]);
    expect(d.improvements.map((i) => i.id)).toEqual(['criterion-gained:moves']);
  });

  it('adds the probability judge as a second opinion without changing the finding', async () => {
    await seat('v1', 'a', { met: { moves: true, cost: true } });
    await seat('v2', 'a', { met: { moves: true, cost: false }, jev: { cost: 0.9 } });
    const d = await diff();
    expect(d.findings[0].scorerNote).toBe('probability judge disagrees: P(met) 0.90 on the head run');
    expect(openFindings(d)).toHaveLength(1);
  });

  it('flags a world that stopped feeling alive', async () => {
    await seat('v1', 'a', { alive: true });
    await seat('v2', 'a', { alive: false });
    expect((await diff()).findings.map((f) => f.id)).toEqual(['alive-lost:world']);
  });

  it('flags a new soft-lock lead and points at the turn the screens stopped leading anywhere', async () => {
    await seat('v1', 'a');
    await seat('v2', 'a', { absorbingFrom: 2, inputs: ['north', 'down', 'up', 'up'] });
    const f = (await diff()).findings.find((x) => x.kind === 'softlock-new')!;
    expect(f.head).toBe('1/1 seats');
    expect(f.repro[0]).toMatchObject({ turn: 2, inputs: ['north', 'down'] });
  });

  it('flags ignored input only when it rises by at least the threshold', async () => {
    await seat('v1', 'a', { ignored: 1 });
    await seat('v2', 'a', { ignored: 1 + Math.ceil(IGNORED_RISE * 10) - 1 });
    expect((await diff()).findings).toEqual([]);
    await seat('v2', 'a', { ignored: 1 + Math.ceil(IGNORED_RISE * 10) });
    expect((await diff()).findings.map((f) => f.id)).toEqual(['ignored-up:inputs']);
  });

  it('flags more seats ending in error', async () => {
    await seat('v1', 'a');
    await seat('v2', 'a', { endedBy: 'error' });
    const f = (await diff()).findings.find((x) => x.kind === 'seat-error')!;
    expect(f.repro[0].evidence).toBe('game crashed');
  });

  it('keeps an accepted finding in the report but not among the open ones', async () => {
    await seat('v1', 'a', { met: { cost: true } });
    await seat('v2', 'a', { met: { cost: false } });
    const d = await diff([{ id: 'criterion-lost:cost', note: 'lamp removed on purpose' }, { id: 'alive-lost:world', note: 'stale' }]);
    expect(d.findings[0].accepted?.note).toBe('lamp removed on purpose');
    expect(openFindings(d)).toEqual([]);
    expect(d.unusedAcceptances.map((a) => a.id)).toEqual(['alive-lost:world']);
    const md = renderDiff('G', d);
    expect(md).toContain('Nothing open.');
    expect(md).toContain('Acceptances that matched nothing');
  });

  it('honours an acceptance scoped to another head label only for that label', async () => {
    await seat('v1', 'a', { met: { cost: true } });
    await seat('v2', 'a', { met: { cost: false } });
    const d = await diff([{ id: 'criterion-lost:cost', note: 'fine in v3', head: 'v3' }]);
    expect(openFindings(d)).toHaveLength(1);
  });

  it('warns that a one-seat side is one judge', async () => {
    await seat('v1', 'a', { met: { cost: true } });
    await seat('v2', 'a', { met: { cost: false } });
    expect(renderDiff('G', await diff())).toContain('one judge');
  });

  it('refuses a run with no readable seats', async () => {
    await mkdir(join(root, 'v1'), { recursive: true });
    await seat('v2', 'a');
    await expect(diff()).rejects.toBeInstanceOf(ReportError);
  });
});

describe('parseAcceptances', () => {
  it('reads ids, notes and an optional head label', () => {
    expect(parseAcceptances('{"accepted":[{"id":"x","note":" ok ","head":"v2"}]}', 'a.json')).toEqual([{ id: 'x', note: 'ok', head: 'v2' }]);
  });

  it('requires a note, because an acceptance without a reason is a silenced alarm', () => {
    expect(() => parseAcceptances('{"accepted":[{"id":"x","note":""}]}', 'a.json')).toThrow(/has no note/);
  });

  it('rejects malformed files with a hint', () => {
    expect(() => parseAcceptances('nope', 'a.json')).toThrow(ReportError);
    expect(() => parseAcceptances('{}', 'a.json')).toThrow(/no "accepted" array/);
  });

  it('needs an id on every entry, and a string head when one is given', () => {
    expect(() => parseAcceptances('{"accepted":[{"note":"x"}]}', 'a.json')).toThrow(/accepted\[0\] has no id/);
    expect(() => parseAcceptances('{"accepted":[{"id":"x","note":"y","head":3}]}', 'a.json')).toThrow(/head must be a run label/);
  });
});

/** Write a seat with a hand-built meta.json, for shapes the seat() helper does not make. */
async function rawSeat(run: string, id: string, meta: Record<string, unknown>, critique?: object, transcript?: string): Promise<void> {
  const dir = join(root, run, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify({
    seat: { id, family: id, model: `${id}-model` }, turnsPlayed: 4, endedBy: 'exit', error: null, critiqueError: null, ...meta,
  }));
  if (critique) await writeFile(join(dir, 'critique.json'), JSON.stringify(critique));
  if (transcript !== undefined) await writeFile(join(dir, 'transcript.txt'), transcript);
}

const juror = { id: 'j', family: 'j', model: 'j-model' };
const panel = (met: boolean, alive: boolean, summary = 'the jury summary') => ({
  jurors: [juror],
  critiques: [{ seat: juror, critique: { alive, summary, criteria: [], highlights: [], deadSpots: [], confusions: [], wouldPlayAgain: false } }],
  criteria: [{ id: 'cost', met, metCount: met ? 1 : 0, answeredCount: 1, split: false }],
  alive,
});

describe('diffRuns with juries and edge shapes', () => {
  it('reads the jury panel ahead of the seat critique, and quotes the jury summary when the world dies', async () => {
    await rawSeat('v1', 'a', { panel: panel(true, true) }, { alive: false, summary: 'own', criteria: [{ id: 'cost', met: false }] });
    await rawSeat('v2', 'a', { panel: panel(false, false) }, { alive: true, summary: 'own', criteria: [{ id: 'cost', met: true }] });
    const d = await diff();
    expect(d.findings.map((f) => f.id)).toEqual(['criterion-lost:cost', 'alive-lost:world']);
    // The panel row carries no evidence or turn, and there is no transcript: the repro says so instead of inventing one.
    expect(d.findings[0].repro[0]).toMatchObject({ turn: null, evidence: '', inputs: [] });
    expect(d.findings[1].repro[0].evidence).toBe('the jury summary');
  });

  it('falls back to the seat critique when the panel degraded to nothing', async () => {
    const degraded = { jurors: [juror], critiques: [{ seat: juror, critique: null, error: 'timeout' }], criteria: [], alive: false, degraded: 'every juror failed' };
    await rawSeat('v1', 'a', { panel: degraded }, { alive: true, summary: 'fine', criteria: [{ id: 'cost', met: true }] });
    await rawSeat('v2', 'a', { panel: degraded }, { alive: true, summary: 'fine', criteria: [{ id: 'cost', met: true }] });
    expect((await diff()).findings).toEqual([]);
  });

  it('lists a world that came alive and a soft-lock that went away as improvements', async () => {
    await seat('v1', 'a', { alive: false, absorbingFrom: 3 });
    await seat('v2', 'a', { alive: true });
    expect((await diff()).improvements.map((i) => i.id)).toEqual(['alive-gained:world', 'softlock-gone:screen-graph']);
  });

  it('refuses a head run with no readable seats', async () => {
    await seat('v1', 'a');
    await mkdir(join(root, 'v2'), { recursive: true });
    await expect(diff()).rejects.toThrow(/no readable seats in .*v2/);
  });

  it('skips a scorer that failed, and says when the scorer is unsure or agrees', async () => {
    await seat('v1', 'a', { met: { cost: true, moves: true } });
    await rawSeat('v2', 'a', {
      scores: [
        { scorer: 'broken', kind: 'jev', model: 'm', band: [0.35, 0.65], stateChars: 1, clipped: false, scores: [{ id: 'cost', p: 0.99 }], error: 'HTTP 503' },
        { scorer: 'jev', kind: 'jev', model: 'm', band: [0.35, 0.65], stateChars: 1, clipped: false, scores: [{ id: 'cost', p: 0.5 }, { id: 'moves', p: 0.1 }] },
      ],
    }, { alive: true, summary: 's', criteria: [{ id: 'cost', met: false }, { id: 'moves', met: false }] });
    const notes = Object.fromEntries((await diff()).findings.map((f) => [f.subject, f.scorerNote]));
    expect(notes.cost).toBe('probability judge is unsure: P(met) 0.50 on the head run');
    expect(notes.moves).toBe('probability judge agrees: P(met) 0.10 on the head run');
  });

  it('names a seat with no ignored turn of its own, and an error seat with no message', async () => {
    await seat('v1', 'a');
    await seat('v1', 'b');
    await seat('v2', 'a', { ignored: 10 });
    await rawSeat('v2', 'b', { endedBy: 'error', verifiers: { absorbing: null, ignoredInputs: [] } }, undefined, transcriptOf(['x']));
    const d = await diff();
    const ignored = d.findings.find((f) => f.kind === 'ignored-up')!;
    expect(ignored.repro.map((r) => r.evidence)).toEqual(['"in1" left the screen unchanged', 'no single turn']);
    expect(d.findings.find((f) => f.kind === 'seat-error')!.repro[0].evidence).toBe('ended by error');
  });
});

describe('renderDiff wording', () => {
  it('counts open findings in the plural and shows each one with its evidence', async () => {
    await seat('v1', 'a', { met: { moves: true, cost: true } });
    await seat('v2', 'a', { met: { moves: false, cost: false } });
    const md = renderDiff('G', await diff());
    expect(md).toContain('**2 open findings.**');
    expect(md).toContain('- **a**, turn 3: cost evidence');
  });

  it('says how many findings are accepted, and for which run', async () => {
    await seat('v1', 'a', { met: { moves: true, cost: true } });
    await seat('v2', 'a', { met: { moves: false, cost: false } });
    const md = renderDiff('G', await diff([
      { id: 'criterion-lost:moves', note: 'bell removed', head: 'v2' },
      { id: 'criterion-lost:cost', note: 'lamp removed' },
      { id: 'seat-error:play', note: 'old crash', head: 'v1' },
    ]));
    expect(md).toContain('**Nothing open.** 2 findings are accepted.');
    expect(md).toContain('Accepted for v2: bell removed');
    expect(md).toContain('Accepted: lamp removed');
    expect(md).toContain('- `seat-error:play` (head v1): old crash');
  });

  it('uses the singular for one finding', async () => {
    await seat('v1', 'a', { met: { cost: true } });
    await seat('v2', 'a', { met: { cost: false } });
    expect(renderDiff('G', await diff())).toContain('**1 open finding.**');
    expect(renderDiff('G', await diff([{ id: 'criterion-lost:cost', note: 'ok' }]))).toContain('1 finding is accepted.');
  });

  it('says when a repro has no turn and no evidence', () => {
    const md = renderDiff('G', {
      base: 'v1', head: 'v2', seats: { base: 2, head: 2 }, improvements: [], unusedAcceptances: [],
      findings: [{ id: 'x:y', kind: 'alive-lost', subject: 'y', base: '2/2', head: '0/2', repro: [{ seat: 'a', transcript: 't', turn: null, inputs: [], evidence: '' }] }],
    });
    expect(md).toContain('- **a**: no evidence quoted');
    expect(md).not.toContain('one judge');
  });
});
