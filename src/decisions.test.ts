import { describe, it, expect } from 'vitest';
import { createDecisionsClient, validateAnswer, DecisionsError } from './decisions.js';
import type { DecisionQuestion } from './decisions.js';

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fail = (status: number, body = 'nope') => ({ ok: false, status, text: async () => body });

function client(fetchImpl: any, retries = 3) {
  return createDecisionsClient({ apiKey: 'sk-or-TEST', fetchImpl, retries, sleep: async () => {} });
}

const noul: Record<string, DecisionQuestion> = {
  moves: { type: 'noul', instructions: 'does the world move?', criteria: { true: 'yes', false: 'no' } },
};

describe('decisions client', () => {
  it('posts the model, state and named questions to /api/alpha/decisions and returns typed answers with cost', async () => {
    let url = '';
    let sent: any;
    const c = client(async (u: string, init: { body: string; headers: Record<string, string> }) => {
      url = u; sent = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe('Bearer sk-or-TEST');
      return ok({ model: 'typesafe/jev-1.13', answers: { moves: { type: 'noul', noul: 0.94 } }, usage: { cost: 0.0001, input_tokens: 1200 } });
    });
    const r = await c({ model: 'typesafe/jev-1.13', state: 'transcript', questions: noul });
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(sent).toMatchObject({ model: 'typesafe/jev-1.13', state: 'transcript', questions: { moves: { type: 'noul' } } });
    expect(r.answers.moves).toEqual({ type: 'noul', noul: 0.94 });
    expect(r.cost).toBe(0.0001);
    expect(r.inputTokens).toBe(1200);
  });

  it('retries 429 and 5xx, but not other 4xx', async () => {
    let calls = 0;
    const flaky = client(async () => (++calls < 3 ? fail(503) : ok({ answers: { moves: { type: 'noul', noul: 0.1 } } })));
    expect((await flaky({ model: 'm', state: 's', questions: noul })).answers.moves).toEqual({ type: 'noul', noul: 0.1 });
    expect(calls).toBe(3);

    let bad = 0;
    const terminal = client(async () => { bad++; return fail(401); });
    await expect(terminal({ model: 'm', state: 's', questions: noul })).rejects.toMatchObject({ code: 'E_DECISIONS', status: 401 });
    expect(bad).toBe(1);
  });

  it('refuses a request with no questions before calling', async () => {
    let calls = 0;
    const c = client(async () => { calls++; return ok({}); });
    await expect(c({ model: 'm', state: 's', questions: {} })).rejects.toThrow(/no questions/);
    expect(calls).toBe(0);
  });

  it('rejects a malformed answer instead of guessing (the API is alpha)', async () => {
    const c = client(async () => ok({ answers: { moves: { type: 'noul', noul: 1.7 } } }));
    await expect(c({ model: 'm', state: 's', questions: noul })).rejects.toBeInstanceOf(DecisionsError);
  });
});

describe('answer validation by question type', () => {
  it('accepts a choice from the listed options with its probabilities, and refuses one that is not listed', () => {
    const q: DecisionQuestion = { type: 'choice', instructions: 'which?', criteria: { a: 'A', b: 'B' } };
    expect(validateAnswer(q, { type: 'choice', choice: 'b', confidence: 0.7, probabilities: { a: 0.3, b: 0.7 } }, 'x'))
      .toEqual({ type: 'choice', choice: 'b', confidence: 0.7, probabilities: { a: 0.3, b: 0.7 } });
    expect(() => validateAnswer(q, { type: 'choice', choice: 'c' }, 'x')).toThrow(/not one of a, b/);
  });

  it('accepts a numeric score with its legend, and refuses a missing one', () => {
    const q: DecisionQuestion = { type: 'score', instructions: 'how much?', criteria: ['low', 'mid', 'high'] };
    expect(validateAnswer(q, { type: 'score', score: 1.8, confidence: 0.9, legend: { 0: 'low' } }, 'x'))
      .toMatchObject({ type: 'score', score: 1.8, confidence: 0.9 });
    expect(() => validateAnswer(q, { type: 'score' }, 'x')).toThrow(/numeric "score"/);
  });
});
