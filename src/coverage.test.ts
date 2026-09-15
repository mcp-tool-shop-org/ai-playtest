import { describe, it, expect } from 'vitest';
import { computeCoverage, normalizeScreen, playerTurns, hashTurn } from './coverage.js';
import type { TurnRecord } from './player.js';

const t = (turn: number, screen: string, input: string, reason = 'prompt'): TurnRecord =>
  ({ turn, screen, input, reason, ms: 10 });

describe('normalizeScreen', () => {
  it('treats the same room with different volatile numbers as one state', () => {
    // Without this, an HP counter or a turn number makes every screen "novel"
    // and the novelty curve becomes meaningless.
    expect(normalizeScreen('Chapel Nave\nHP 40/100\nTurn 3'))
      .toBe(normalizeScreen('Chapel  Nave\nHP 10/100\nTurn 27'));
  });

  it('still separates genuinely different rooms', () => {
    expect(normalizeScreen('Chapel Nave\nHP 40')).not.toBe(normalizeScreen('Bell Tower\nHP 40'));
  });

  it('keeps numbered locations distinct, because the title line is not collapsed', () => {
    // Collapsing every digit would make "Room 1" and "Room 2" one state, which
    // is the opposite of the mistake the HP case guards against.
    expect(normalizeScreen('Room 1\nHP 40/100')).not.toBe(normalizeScreen('Room 2\nHP 40/100'));
  });
});

describe('playerTurns', () => {
  it('excludes scripted setup and the runner\'s quit inputs', () => {
    const h = [
      t(0, 'Name:', 'Scripted', 'setup'),
      t(1, 'a', 'look'),
      t(1, 'b', 'quit', 'quit'),
      t(1, 'c', '', 'exit'),
    ];
    expect(playerTurns(h).map((x) => x.input)).toEqual(['look']);
  });

  it('excludes illegal-action harness events', () => {
    const h = [
      t(1, 'Choose.', 'nope', 'illegal-action'),
      t(1, 'Choose.', 'look'),
    ];
    expect(playerTurns(h).map((x) => x.input)).toEqual(['look']);
  });
});

describe('hashTurn', () => {
  it('prefers structured state over screen prose when state is an object', () => {
    const a = { ...t(1, 'HP 40/100', 'look'), state: { room: 'Nave', hp: 40 } };
    const b = { ...t(2, 'HP 10/100', 'wait'), state: { room: 'Nave', hp: 40 } };
    expect(hashTurn(a)).toBe(hashTurn(b));
    expect(hashTurn(t(1, 'HP 40/100', 'look'))).not.toBe(hashTurn(t(2, 'HP 10/100', 'wait')));
  });
});

describe('computeCoverage', () => {
  it('flags a session that stopped finding anything new halfway through', () => {
    const h: TurnRecord[] = [];
    for (let i = 1; i <= 10; i++) h.push(t(i, `Room ${i}`, `go ${i}`));
    for (let i = 11; i <= 24; i++) h.push(t(i, 'Room 10', 'wait'));
    const c = computeCoverage(h);
    expect(c.turns).toBe(24);
    expect(c.turnOfLastNovelState).toBeLessThan(12);
    expect(c.notes.join(' ')).toMatch(/stopped finding new screens/);
    expect(c.confidence).toBe('thin');
  });

  it('calls a rut a rut', () => {
    const h = Array.from({ length: 20 }, (_, i) => t(i + 1, 'Chapel Nave', 'look'));
    const c = computeCoverage(h);
    expect(c.repeatRate).toBeCloseTo(1, 1);
    expect(c.selfLoopRate).toBeCloseTo(1, 1);
    expect(c.distinctActions).toBe(1);
    expect(c.actionEntropy).toBe(0);
    expect(c.confidence).toBe('thin');
  });

  it('detects a two-action ping-pong loop', () => {
    const h = Array.from({ length: 20 }, (_, i) =>
      t(i + 1, i % 2 ? 'Nave' : 'Alcove', i % 2 ? 'go alcove' : 'go nave'));
    const c = computeCoverage(h);
    expect(c.repeatRate).toBe(0);      // never the SAME action twice running
    expect(c.loopRate).toBeGreaterThan(0.5); // but plainly cycling
    expect(c.confidence).toBe('thin');
  });

  it('calls a varied, still-exploring session broad', () => {
    const h = Array.from({ length: 24 }, (_, i) => t(i + 1, `Room ${i}`, `action ${i}`));
    const c = computeCoverage(h);
    expect(c.novelStates).toBe(24);
    expect(c.repeatRate).toBe(0);
    expect(c.confidence).toBe('broad');
    expect(c.actionEntropy).toBeGreaterThan(4);
  });

  it('treats a very short session as thin regardless of variety', () => {
    const h = Array.from({ length: 5 }, (_, i) => t(i + 1, `Room ${i}`, `action ${i}`));
    const c = computeCoverage(h);
    expect(c.confidence).toBe('thin');
    expect(c.notes.join(' ')).toMatch(/too few/);
  });

  it('handles a session with no player turns', () => {
    const c = computeCoverage([t(0, 'Name:', 'Scripted', 'setup')]);
    expect(c.turns).toBe(0);
    expect(c.confidence).toBe('thin');
  });
});
