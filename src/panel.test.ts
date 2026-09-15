import { describe, it, expect } from 'vitest';
import { pickJurors, aggregatePanel } from './panel.js';
import type { Seat, Criterion } from './config.js';
import type { Critique } from './critic.js';

const seats: Seat[] = [
  { id: 'a', family: 'alpha', model: 'alpha/m' },
  { id: 'b', family: 'beta', model: 'beta/m' },
  { id: 'c', family: 'gamma', model: 'gamma/m' },
  { id: 'd', family: 'delta', model: 'delta/m' },
];
const CRITERIA: Criterion[] = [
  { id: 'reacts', check: 'the world changed in response' },
  { id: 'alive', check: 'something happened unprompted' },
];

const crit = (alive: boolean, met: Record<string, boolean>, who = 'x'): Critique => ({
  alive,
  summary: 's',
  wouldPlayAgain: alive,
  highlights: [], deadSpots: [], confusions: [],
  criteria: Object.entries(met).map(([id, m]) => ({ id, met: m, evidence: `${who} saw ${id}=${m}`, turn: 2 })),
});

describe('pickJurors', () => {
  it('never seats the author on its own jury', () => {
    for (const author of seats) {
      const jury = pickJurors(seats, author);
      expect(jury.map((j) => j.family)).not.toContain(author.family);
    }
  });

  it('returns an empty jury rather than falling back to the author', () => {
    // A one-family roster has no valid juror. Handing the transcript back to
    // its own author would be the exact configuration this module exists to
    // prevent, so the caller is told there is no jury instead.
    expect(pickJurors([seats[0]], seats[0])).toEqual([]);
  });

  it('caps the panel at the requested size', () => {
    expect(pickJurors(seats, seats[0], 2)).toHaveLength(2);
    expect(pickJurors(seats, seats[0], 3)).toHaveLength(3);
  });
});

describe('aggregatePanel', () => {
  const jurors = pickJurors(seats, seats[0]);

  it('takes the majority and records the split', () => {
    const panel = aggregatePanel(jurors, [
      { seat: jurors[0], critique: crit(true, { reacts: true, alive: true }, 'j0') },
      { seat: jurors[1], critique: crit(true, { reacts: true, alive: false }, 'j1') },
      { seat: jurors[2], critique: crit(false, { reacts: true, alive: false }, 'j2') },
    ], CRITERIA);

    expect(panel.alive).toBe(true);        // 2 of 3
    expect(panel.aliveCount).toBe(2);
    const reacts = panel.criteria.find((c) => c.id === 'reacts')!;
    expect(reacts.met).toBe(true);
    expect(reacts.split).toBe(false);       // unanimous
    const alive = panel.criteria.find((c) => c.id === 'alive')!;
    expect(alive.met).toBe(false);          // 1 of 3
    expect(alive.split).toBe(true);
    expect(alive.metCount).toBe(1);
    expect(alive.answeredCount).toBe(3);
    expect(panel.dispersion).toBeCloseTo(0.5);
  });

  it('cites a juror who actually reached the majority answer', () => {
    // An evidence line that contradicts the verdict beside it is worse than no
    // evidence line at all.
    const panel = aggregatePanel(jurors, [
      { seat: jurors[0], critique: crit(true, { reacts: false, alive: true }, 'dissenter') },
      { seat: jurors[1], critique: crit(true, { reacts: true, alive: true }, 'majorityA') },
      { seat: jurors[2], critique: crit(true, { reacts: true, alive: true }, 'majorityB') },
    ], CRITERIA);
    const reacts = panel.criteria.find((c) => c.id === 'reacts')!;
    expect(reacts.met).toBe(true);
    expect(reacts.evidence).not.toContain('dissenter');
    expect(reacts.evidence).toMatch(/majority/);
  });

  it('resolves a tie to not-met rather than rounding a verdict up', () => {
    const panel = aggregatePanel(jurors.slice(0, 2), [
      { seat: jurors[0], critique: crit(true, { reacts: true, alive: true }) },
      { seat: jurors[1], critique: crit(false, { reacts: false, alive: false }) },
    ], CRITERIA);
    expect(panel.alive).toBe(false);
    expect(panel.criteria.find((c) => c.id === 'reacts')!.met).toBe(false);
  });

  it('survives a juror that failed entirely', () => {
    const panel = aggregatePanel(jurors, [
      { seat: jurors[0], critique: crit(true, { reacts: true, alive: true }) },
      { seat: jurors[1], critique: null, error: 'E_OPENROUTER: 429' },
      { seat: jurors[2], critique: crit(true, { reacts: true, alive: true }) },
    ], CRITERIA);
    expect(panel.alive).toBe(true);
    expect(panel.criteria.find((c) => c.id === 'reacts')!.answeredCount).toBe(2);
    expect(panel.critiques.filter((c) => !c.critique)).toHaveLength(1);
  });

  it('says so when no juror addressed a criterion', () => {
    const panel = aggregatePanel(jurors.slice(0, 1), [
      { seat: jurors[0], critique: crit(true, { reacts: true }) },
    ], CRITERIA);
    const alive = panel.criteria.find((c) => c.id === 'alive')!;
    expect(alive.answeredCount).toBe(0);
    expect(alive.met).toBe(false);
    expect(alive.evidence).toMatch(/no juror addressed/);
  });
});
