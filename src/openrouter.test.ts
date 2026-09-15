import { describe, it, expect } from 'vitest';
import { createOpenRouterClient, OpenRouterError } from './openrouter.js';
import type { ChatRequest } from './openrouter.js';

const ok = (content: string, finish_reason = 'stop') => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ finish_reason, message: { content } }] }),
});

const req: ChatRequest = { model: 'm', messages: [], maxTokens: 100, temperature: 0 };

const KEY = 'sk-or-v1-DISTINCTIVE-SECRET-0123456789';

function client(fetchImpl: any, retries = 6) {
  return createOpenRouterClient({ apiKey: KEY, retries, sleep: async () => {}, fetchImpl });
}

describe('finish_reason', () => {
  // A completion cut off at max_tokens used to be returned as success. With
  // response_format json_object that always becomes a downstream parse failure,
  // reported as "the model cannot produce JSON" instead of "the budget was too
  // small" -- which is the exact confusion the critic budget commit chased.
  it('fails loudly when the response was truncated at max_tokens', async () => {
    const c = client(async () => ok('{"alive": tr', 'length'));
    await expect(c({ ...req, json: true })).rejects.toMatchObject({ code: 'E_OPENROUTER' });
    await expect(c({ ...req, json: true })).rejects.toThrow(/truncated at max_tokens=100/);
  });

  it('names maxTokens in the hint so the fix is obvious', async () => {
    const c = client(async () => ok('partial', 'length'));
    await c(req).catch((e: OpenRouterError) => expect(e.hint).toMatch(/raise maxTokens/));
  });

  it('does not retry a truncation, since the same budget reproduces it', async () => {
    let calls = 0;
    const c = client(async () => { calls++; return ok('partial', 'length'); });
    await c(req).catch(() => {});
    expect(calls).toBe(1);
  });

  it('accepts a normal completion', async () => {
    expect(await client(async () => ok('look'))(req)).toBe('look');
  });
});

describe('retry loop', () => {
  // Reading the body sat outside the try/catch, so a socket reset partway
  // through the response -- the commonest transient fault there is -- escaped
  // the retry loop entirely: one attempt instead of seven, raw TypeError.
  it('retries a body-read failure like any other transient fault', async () => {
    let calls = 0;
    const c = client(async () => {
      calls++;
      if (calls < 3) return { ok: true, status: 200, text: async () => { throw new TypeError('terminated'); } };
      return ok('recovered');
    });
    expect(await c(req)).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('surfaces a coded error, not a raw TypeError, when body reads keep failing', async () => {
    const c = client(async () => ({ ok: true, status: 200, text: async () => { throw new TypeError('terminated'); } }), 1);
    await expect(c(req)).rejects.toMatchObject({ code: 'E_OPENROUTER' });
  });

  it('retries a 503 and gives up on 401 / 404 / 400 immediately', async () => {
    let n = 0;
    const transient = client(async () => {
      n++;
      return n < 3 ? { ok: false, status: 503, text: async () => 'busy' } : ok('look');
    });
    expect(await transient(req)).toBe('look');
    expect(n).toBe(3);

    for (const status of [401, 404, 400]) {
      let calls = 0;
      const c = client(async () => { calls++; return { ok: false, status, text: async () => 'no' }; });
      await expect(c(req)).rejects.toMatchObject({ code: 'E_OPENROUTER', status });
      expect(calls, `status ${status} must not be retried`).toBe(1);
    }
  });

  it('never puts the api key in an error message', async () => {
    const c = client(async () => ({ ok: false, status: 500, text: async () => 'boom' }), 0);
    const err = await c(req).catch((e: Error) => e);
    const serialized = `${(err as Error).message} ${(err as Error).stack ?? ''} ${JSON.stringify(err)}`;
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('DISTINCTIVE-SECRET');
  });
});
