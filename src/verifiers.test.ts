import { describe, it, expect } from 'vitest';
import {
  tarjanScc, detectAbsorbing, classifyIgnored, classifyParser, detectTerminal,
  detectNoProgress, entityAppearanceGrid, runVerifiers, renderAbsorbingLine,
  DEFAULT_VERIFIERS,
} from './verifiers.js';
import type { TurnRecord } from './player.js';

const t = (turn: number, screen: string, input: string, reason = 'prompt'): TurnRecord =>
  ({ turn, screen, input, reason, ms: 10 });

describe('tarjanScc', () => {
  it('finds a two-node cycle as one component', () => {
    const sccs = tarjanScc(['a', 'b', 'c'], [['a', 'b'], ['b', 'a'], ['a', 'c']]);
    const cycle = sccs.find((c) => c.includes('a') && c.includes('b'));
    expect(cycle).toBeDefined();
    expect(cycle).toHaveLength(2);
    expect(sccs.find((c) => c.length === 1 && c[0] === 'c')).toBeDefined();
  });

  it('treats a single node with a self-loop as an SCC', () => {
    const sccs = tarjanScc(['a'], [['a', 'a']]);
    expect(sccs).toEqual([['a']]);
  });
});

describe('detectAbsorbing', () => {
  it('fires on a ping-pong the 2-gram loopRate is built for, plus the occupancy and input tests', () => {
    const h = Array.from({ length: 8 }, (_, i) =>
      t(i + 1, i % 2 ? 'Nave' : 'Alcove', i % 2 ? 'go alcove' : 'go nave'));
    const hit = detectAbsorbing(h, 4);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('review');
    expect(hit!.turnSpan).toBe(8);
    expect(hit!.distinctEntryInputs.length).toBeGreaterThanOrEqual(2);
    expect(hit!.falsePositiveModes.join(' ')).toMatch(/hub-camp/);
    expect(hit!.falsePositiveModes.join(' ')).toMatch(/budget/);
    expect(renderAbsorbingLine(hit)).not.toMatch(/softlock|unwinnable|stuck|deadlock/i);
    expect(renderAbsorbingLine(hit)).toMatch(/kind=review/);
    expect(renderAbsorbingLine(hit)).toMatch(/not AG\(EF\(goal\)\)/);
  });

  it('does not fire on a hub the player camped with one input (the 2-input guard)', () => {
    // Mutation target: deleting the `inputs.length < 2` check makes this RED.
    const h = Array.from({ length: 8 }, (_, i) => t(i + 1, 'Chapel Nave', 'look'));
    expect(detectAbsorbing(h, 4)).toBeNull();
  });

  it('does not fire when the final SCC has an outgoing edge', () => {
    // Mutation target: deleting the outgoing-edge guard makes this RED.
    const h = [
      t(1, 'A', 'go b'), t(2, 'B', 'go a'), t(3, 'A', 'go b'), t(4, 'B', 'go a'),
      t(5, 'A', 'go b'), t(6, 'B', 'go c'), t(7, 'C', 'wait'), t(8, 'C', 'look'),
    ];
    expect(detectAbsorbing(h, 4)).toBeNull();
  });

  it('does not fire below the occupancy floor', () => {
    // Mutation target: deleting the minTurns check makes this RED.
    const h = [
      t(1, 'A', 'go b'), t(2, 'B', 'go a'), t(3, 'A', 'go b'),
    ];
    expect(detectAbsorbing(h, 4)).toBeNull();
  });

  it('never labels a miss as a softlock either', () => {
    expect(renderAbsorbingLine(null)).not.toMatch(/softlock/i);
    expect(renderAbsorbingLine(null)).toMatch(/none/);
  });
});

describe('classifyIgnored', () => {
  it('names identical-screen turns instead of only reporting a rate', () => {
    const h = [t(1, 'Nave', 'look'), t(2, 'Nave', 'look'), t(3, 'Alcove', 'go alcove')];
    const rows = classifyIgnored(h);
    expect(rows[1].kind).toBe('identical-screen');
    expect(rows[2].kind).toBe('changed');
  });
});

describe('classifyParser', () => {
  it('reports unknownRate=1 and listsEmpty when both lists are empty -- it must not guess', () => {
    const h = [t(1, 'You cannot do that.', 'frob'), t(2, 'Nave', 'look')];
    const r = classifyParser(h, DEFAULT_VERIFIERS);
    expect(r.listsEmpty).toBe(true);
    expect(r.unknownRate).toBe(1);
    expect(r.turns.every((x) => x.classification === 'unknown')).toBe(true);
  });

  it('splits unparsed from refused when the author supplied lists', () => {
    const cfg = { ...DEFAULT_VERIFIERS, unparsed: ['not understood', 'don.t know'], refused: ['cannot go that way'] };
    const h = [
      t(1, 'I don\'t know the word "xyzzy".', 'xyzzy'),
      t(2, 'You cannot go that way.', 'go north'),
      t(3, 'You go north. The nave.', 'go north'),
    ];
    const r = classifyParser(h, cfg);
    expect(r.listsEmpty).toBe(false);
    expect(r.turns.map((x) => x.classification)).toEqual(['unparsed', 'refused', 'accepted']);
    expect(r.unknownRate).toBe(0);
  });
});

describe('detectTerminal', () => {
  it('answers the binary a reader wants first, and composes with absorbing', () => {
    const cfg = { ...DEFAULT_VERIFIERS, victory: ['You (win|escaped)'], death: ['You (die|have died)'] };
    const win = [t(1, 'Nave', 'look'), t(2, 'You win.', 'wait')];
    expect(detectTerminal(win, cfg, null)).toEqual({ kind: 'victory', turn: 2, inAbsorbingComponent: false });
    const dead = [t(1, 'Nave', 'look'), t(2, 'You have died.', 'wait')];
    expect(detectTerminal(dead, cfg, { hashes: [], turnSpan: 4, firstTurn: 1, lastTurn: 2, distinctEntryInputs: ['a', 'b'], kind: 'review', falsePositiveModes: [] }).kind).toBe('death');
    expect(detectTerminal([t(1, 'Nave', 'look')], cfg, null).kind).toBe('none');
  });
});

describe('detectNoProgress', () => {
  it('flags a window of identical screens that is not just examine-as-no-op', () => {
    const h = Array.from({ length: 8 }, (_, i) => t(i + 1, 'Chapel Nave\nHP 10', i % 2 ? 'wait' : 'north'));
    const windows = detectNoProgress(h, 5, ['examine', 'look']);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0].startTurn).toBe(1);
  });

  it('does not flag a configured no-op verb window (the examine-a-statue FP)', () => {
    // Mutation target: deleting the noOpVerbs skip makes this RED.
    const h = Array.from({ length: 6 }, (_, i) => t(i + 1, 'Statue\nNothing happens.', 'examine statue'));
    expect(detectNoProgress(h, 5, ['examine'])).toEqual([]);
  });
});

describe('entityAppearanceGrid', () => {
  it('flags a capitalized name that vanishes for a long gap as a lead, not a verdict', () => {
    const h = [
      t(1, 'Brother Aldric greets you.', 'talk'),
      t(2, 'The nave is empty.', 'look'),
      t(3, 'The nave is empty.', 'look'),
      t(4, 'The nave is empty.', 'look'),
      t(5, 'The nave is empty.', 'look'),
      t(6, 'The nave is empty.', 'look'),
      t(7, 'The nave is empty.', 'look'),
      t(8, 'Brother Aldric returns.', 'talk'),
    ];
    const leads = entityAppearanceGrid(h);
    const aldric = leads.find((l) => l.token.includes('Aldric'));
    expect(aldric).toBeDefined();
    expect(aldric!.note).toMatch(/lead/);
    expect(aldric!.note).not.toMatch(/contradiction verdict/);
  });
});

describe('runVerifiers', () => {
  it('excludes setup and quit from every check', () => {
    const h = [
      t(0, 'Name:', 'Scripted', 'setup'),
      t(1, 'Nave', 'look'),
      t(1, 'Saved.', 'quit', 'quit'),
    ];
    const r = runVerifiers(h);
    expect(r.ignoredInputs).toHaveLength(1);
    expect(r.parser.turns).toHaveLength(1);
  });
});
