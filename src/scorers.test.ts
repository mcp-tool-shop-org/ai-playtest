import { describe, it, expect } from 'vitest';
import { createScorer, criterionQuestions, disagreement, readProbability, stateForWindow, SCORER_DEFAULTS } from './scorers.js';
import { validateConfig, ConfigError, lintCriteria } from './config.js';
import type { DecisionsClient } from './decisions.js';
import type { TurnRecord } from './player.js';

const criteria = [
  { id: 'world-moves', check: 'Something changes without the player causing it.' },
  { id: 'person-refuses', check: 'A door refuses the player in a character\'s own words.' },
];
const turn = (n: number, screen: string, input = 'look'): TurnRecord => ({ turn: n, screen, input, reason: 'prompt', ms: 1 } as TurnRecord);
const outcome = { endedBy: 'turns', turnsPlayed: 2 };
const jev = { id: 'jev', kind: 'jev' as const, ...SCORER_DEFAULTS.jev };

describe('jev scorer', () => {
  it('asks every criterion in ONE request, as noul questions keyed by criterion id, and maps P(met) back', async () => {
    const calls: any[] = [];
    const decisions: DecisionsClient = async (req) => {
      calls.push(req);
      return { model: req.model, answers: { 'world-moves': { type: 'noul', noul: 0.93 }, 'person-refuses': { type: 'noul', noul: 0.12 } }, cost: 0.0002 };
    };
    const r = await createScorer(jev, { decisions }).score({ evidence: [turn(1, 'The quay turns.'), turn(2, 'Halle: no.')], criteria, outcome });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].questions)).toEqual(['world-moves', 'person-refuses']);
    expect(calls[0].questions['world-moves']).toMatchObject({ type: 'noul' });
    expect(calls[0].questions['world-moves'].instructions).toContain('Something changes without the player');
    expect(calls[0].state).toContain('The quay turns.');
    expect(calls[0].state).toContain('session ended by turns after 2 player turns');
    expect(r.scores).toEqual([{ id: 'world-moves', p: 0.93 }, { id: 'person-refuses', p: 0.12 }]);
    expect(r.cost).toBe(0.0002);
    expect(r.error).toBeUndefined();
  });

  it('records a failure as unscored criteria with the error, never a throw', async () => {
    const decisions: DecisionsClient = async () => { throw new Error('HTTP 503'); };
    const r = await createScorer(jev, { decisions }).score({ evidence: [turn(1, 'x')], criteria, outcome });
    expect(r.scores.every((s) => s.p === null)).toBe(true);
    expect(r.error).toMatch(/503/);
  });

  it('reports unscored, with a reason, when there is no decisions client', async () => {
    const r = await createScorer(jev, {}).score({ evidence: [turn(1, 'x')], criteria, outcome });
    expect(r.error).toMatch(/no decisions client/);
  });
});

describe('fitting the transcript to the window', () => {
  it('sends the whole transcript when it fits, and trims the middle (keeping both ends) when it does not', () => {
    const small = stateForWindow([turn(1, 'short')], outcome, 26_000);
    expect(small.clipped).toBe(false);
    const evidence = Array.from({ length: 200 }, (_, i) => turn(i + 1, `${i === 0 ? 'OPENING-SCENE ' : ''}${i === 199 ? 'FINAL-SCENE ' : ''}${'│ ─ █ '.repeat(60)}`));
    const big = stateForWindow(evidence, outcome, 8_000);
    expect(big.clipped).toBe(true);
    expect(big.state).toContain('OPENING-SCENE');
    expect(big.state).toContain('FINAL-SCENE');
    expect(big.state).toContain('characters trimmed');
  });
});

describe('compound-criterion lint', () => {
  it('flags the Ghost criterion every judge got wrong, and leaves single claims alone', () => {
    const lint = lintCriteria([
      { id: 'choices-cost', check: 'Shooting and holding have different consequences, so there is a reason not to simply shoot everything that appears.' },
      { id: 'world-moves', check: 'Something in the harbour changes without the player causing it directly.' },
      { id: 'two', check: 'The player sees the map. The map updates after every move.' },
      { id: 'semi', check: 'A door refuses the player; the refusal names its reason.' },
      { id: 'rows', check: 'The table shows rows and columns.' },
    ]);
    expect(lint.map((l) => l.id)).toEqual(['choices-cost', 'two', 'semi']);
    expect(lint[0].why).toContain('"so"');
  });
});

describe('reading a probability against the band', () => {
  it('calls it met, not met or uncertain, and flags only a confident disagreement with the jury', () => {
    const band: [number, number] = [0.35, 0.65];
    expect(readProbability(0.9, band)).toBe('met');
    expect(readProbability(0.1, band)).toBe('not met');
    expect(readProbability(0.5, band)).toBe('uncertain');
    expect(readProbability(null, band)).toBe('unscored');
    expect(disagreement(0.1, band, true)).toBe(true);   // jury yes, judge confident no
    expect(disagreement(0.9, band, false)).toBe(true);  // jury no, judge confident yes
    expect(disagreement(0.5, band, true)).toBe(false);  // uncertain is not a dispute
    expect(disagreement(0.9, band, true)).toBe(false);
    expect(disagreement(0.1, band, undefined)).toBe(false);
  });
});

describe('scorers config', () => {
  const base = {
    name: 'g', game: { command: 'node', args: ['g.mjs'], promptPatterns: ['> $'] },
    persona: 'a careful player who wants to see what the world does on its own',
    criteria, seats: [{ id: 'a', family: 'alpha', model: 'alpha/m' }],
  };

  it('is empty by default, and fills jev defaults from one line', () => {
    expect(validateConfig(base, '.').scorers).toEqual([]);
    expect(validateConfig({ ...base, scorers: [{ kind: 'jev' }] }, '.').scorers)
      .toEqual([{ id: 'jev', kind: 'jev', model: 'typesafe/jev-1.13', maxStateTokens: 26_000, band: [0.35, 0.65] }]);
  });

  it('refuses an unknown kind, a bad band, an unknown key and a duplicate id', () => {
    expect(() => validateConfig({ ...base, scorers: [{ kind: 'oracle' }] }, '.')).toThrow(ConfigError);
    expect(() => validateConfig({ ...base, scorers: [{ kind: 'jev', band: [0.8, 0.2] }] }, '.')).toThrow(/band/);
    expect(() => validateConfig({ ...base, scorers: [{ kind: 'jev', temperature: 0 }] }, '.')).toThrow(ConfigError);
    expect(() => validateConfig({ ...base, scorers: [{ kind: 'jev' }, { kind: 'jev' }] }, '.')).toThrow(/used twice/);
  });

  it('builds one noul question per criterion', () => {
    expect(Object.keys(criterionQuestions(criteria))).toEqual(['world-moves', 'person-refuses']);
  });
});
