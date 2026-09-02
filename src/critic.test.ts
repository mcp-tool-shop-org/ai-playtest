import { describe, it, expect } from 'vitest';
import { parseCritique, renderTranscript, critique, CritiqueError } from './critic.js';
import type { ChatClient } from './openrouter.js';

const CRITERIA = [
  { id: 'ambush', check: 'an ambush headline appeared on a zone entry' },
  { id: 'pressure', check: 'the street raised a pressure after the second kill' },
];

describe('parseCritique', () => {
  it('extracts the JSON object even when wrapped in prose, and fills missing criteria as unmet', () => {
    const raw = 'Here is my review:\n{"alive": true, "summary": "It moved.", "criteria": [{"id":"ambush","met":true,"evidence":"patrol at t3","turn":3}], "highlights": ["t3 patrol"], "deadSpots": [], "confusions": ["t5 menu"], "wouldPlayAgain": true}\nThanks.';
    const c = parseCritique(raw, CRITERIA);
    expect(c.alive).toBe(true);
    expect(c.criteria).toHaveLength(2);
    expect(c.criteria[0]).toEqual({ id: 'ambush', met: true, evidence: 'patrol at t3', turn: 3 });
    expect(c.criteria[1].met).toBe(false);
    expect(c.criteria[1].evidence).toBe('not addressed by the critic');
    expect(c.confusions).toEqual(['t5 menu']);
  });
  it('throws a coded error without a JSON object', () => {
    expect(() => parseCritique('no json here', CRITERIA)).toThrow(CritiqueError);
  });
});

describe('renderTranscript', () => {
  it('keeps head and tail when over budget', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ turn: i + 1, screen: `S${i + 1} ` + 'x'.repeat(200), input: `in${i + 1}`, reason: 'prompt', ms: 1 }));
    const t = renderTranscript(history, 2000);
    expect(t.length).toBeLessThan(2300);
    expect(t).toContain('=== turn 1 ===');
    expect(t).toContain('> in40');
    expect(t).toMatch(/characters trimmed/);
  });
});

describe('critique', () => {
  it('retries once when the first answer is not JSON', async () => {
    let calls = 0;
    const client: ChatClient = async () => {
      calls++;
      return calls === 1 ? 'I cannot answer in JSON.' : '{"alive": false, "summary": "flat", "criteria": [], "highlights": [], "deadSpots": ["t2 nothing happened"], "confusions": [], "wouldPlayAgain": false}';
    };
    const c = await critique(client, 'fake/model', CRITERIA, [{ turn: 1, screen: 's', input: 'look', reason: 'prompt', ms: 1 }]);
    expect(calls).toBe(2);
    expect(c.alive).toBe(false);
    expect(c.deadSpots).toEqual(['t2 nothing happened']);
  });
});
