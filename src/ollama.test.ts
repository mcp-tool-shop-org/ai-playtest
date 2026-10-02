import { describe, it, expect } from 'vitest';
import { createOllamaClient, contextFor, isCloudTag, resolveOllamaHost, OllamaError } from './ollama.js';
import { createRoutedClient, providersInUse } from './providers.js';
import { validateConfig, ConfigError } from './config.js';
import type { ChatRequest } from './openrouter.js';
import type { Seat } from './config.js';

const req: ChatRequest = { model: 'mistral-small:24b', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, temperature: 0 };

const reply = (body: Record<string, unknown>, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
});

function client(fetchImpl: any, extra: Record<string, unknown> = {}) {
  return createOllamaClient({ host: 'http://127.0.0.1:11434', sleep: async () => {}, fetchImpl, ...extra });
}

describe('ollama request shape', () => {
  it('posts to the native /api/chat with num_ctx sized from the prompt, not the OpenAI endpoint', async () => {
    let url = '';
    let sent: any;
    const c = client(async (u: string, init: { body: string }) => {
      url = u; sent = JSON.parse(init.body);
      return reply({ message: { content: 'look' }, done_reason: 'stop', prompt_eval_count: 10 });
    });
    expect(await c({ ...req, json: true })).toBe('look');
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(sent.stream).toBe(false);
    expect(sent.think).toBe(false);
    expect(sent.format).toBe('json');
    expect(sent.options).toMatchObject({ temperature: 0, num_predict: 100 });
    expect(sent.options.num_ctx).toBeGreaterThanOrEqual(4096);
  });

  it('grows num_ctx with a long prompt so a forty-turn transcript is not silently cut', () => {
    const long = { ...req, messages: [{ role: 'user' as const, content: 'x'.repeat(60_000) }], maxTokens: 6000 };
    const ctx = contextFor(long, 32_768)!;
    expect(ctx.numCtx).toBeGreaterThanOrEqual(20_000 + 6000);
    expect(ctx.numCtx % 2048).toBe(0);
  });

  it('actually sends the grown num_ctx on the wire', async () => {
    let numCtx = 0;
    const c = client(async (_u: string, init: { body: string }) => {
      numCtx = JSON.parse(init.body).options.num_ctx;
      return reply({ message: { content: '{}' }, done_reason: 'stop', prompt_eval_count: 15_000 });
    });
    await c({ ...req, messages: [{ role: 'user', content: 'x'.repeat(60_000) }], maxTokens: 6000 });
    expect(numCtx).toBeGreaterThanOrEqual(26_000);
  });

  it('refuses a prompt that cannot fit rather than letting Ollama truncate it', async () => {
    let calls = 0;
    const c = client(async () => { calls++; return reply({}); }, { maxContextTokens: 8192 });
    const big = { ...req, messages: [{ role: 'user' as const, content: 'x'.repeat(60_000) }] };
    await expect(c(big)).rejects.toThrow(/needs more than 8192 tokens/);
    expect(calls).toBe(0);
  });

  it('fails when the daemon reports it used up the whole window anyway', async () => {
    const c = client(async (_u: string, init: { body: string }) => {
      const n = JSON.parse(init.body).options.num_ctx;
      return reply({ message: { content: '{}' }, done_reason: 'stop', prompt_eval_count: n });
    });
    await expect(c(req)).rejects.toThrow(/truncated it/);
  });
});

describe('reasoning models and dense screens', () => {
  it('moves reasoning off the reply once a short reply is cut off, and remembers it for the model', async () => {
    // qwen3-next ignores think:false and reasons in the reply; 60 tokens never reached an answer.
    const sent: any[] = [];
    const c = client(async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body); sent.push(b);
      return b.think === false
        ? reply({ message: { content: "Okay, let's see. The user is at camp" }, done_reason: 'length', prompt_eval_count: 30 })
        : reply({ message: { content: 'Rest', thinking: 'long reasoning' }, done_reason: 'stop', prompt_eval_count: 30 });
    });
    const short = { ...req, model: 'qwen3-next:80b', maxTokens: 60 };
    expect(await c(short)).toBe('Rest');
    expect(sent.map((b) => b.think)).toEqual([false, true]);
    expect(sent[1].options.num_predict).toBeGreaterThan(2000);
    expect(await c(short)).toBe('Rest');
    expect(sent.length).toBe(3); // learned: the second call goes straight to think:true
    expect(sent[2].think).toBe(true);
  });

  it('asks gpt-oss for a low reasoning level, since it cannot be switched off', async () => {
    const thinks: unknown[] = [];
    const c = client(async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body); thinks.push(b.think);
      return b.think === false
        ? reply({ message: { content: '', thinking: 'reasoning' }, done_reason: 'length', prompt_eval_count: 30 })
        : reply({ message: { content: 'Rest' }, done_reason: 'stop', prompt_eval_count: 30 });
    });
    expect(await c({ ...req, model: 'gpt-oss:120b', maxTokens: 60 })).toBe('Rest');
    expect(thinks).toEqual([false, 'low']);
  });

  it('reports the original truncation when the model cannot think at all', async () => {
    const c = client(async (_u: string, init: { body: string }) => JSON.parse(init.body).think === false
      ? reply({ message: { content: 'rambling' }, done_reason: 'length' })
      : reply({ error: '"llama3.3:70b" does not support thinking' }, 400));
    await expect(c({ ...req, model: 'llama3.3:70b' })).rejects.toThrow(/truncated at max_tokens/);
  });

  it('sizes the window from UTF-8 bytes, so a box-drawn screen is not undersized', () => {
    const box = { ...req, messages: [{ role: 'user' as const, content: '│─█'.repeat(1600) }] };
    const prose = { ...req, messages: [{ role: 'user' as const, content: 'abc'.repeat(1600) }] };
    expect(contextFor(box, 32_768)!.promptTokens).toBeGreaterThan(contextFor(prose, 32_768)!.promptTokens * 2);
  });

  it('retries once with twice the window when the prompt still filled it', async () => {
    const ctxs: number[] = [];
    const c = client(async (_u: string, init: { body: string }) => {
      const n = JSON.parse(init.body).options.num_ctx; ctxs.push(n);
      return reply({ message: { content: 'north' }, done_reason: 'stop', prompt_eval_count: ctxs.length === 1 ? n : 100 });
    });
    expect(await c(req)).toBe('north');
    expect(ctxs[1]).toBe(ctxs[0] * 2);
  });
});

describe('ollama failure modes', () => {
  it('treats done_reason length as truncation: one retry with reasoning moved aside, then reported', async () => {
    let calls = 0;
    const c = client(async () => { calls++; return reply({ message: { content: '{"alive": tr' }, done_reason: 'length' }); });
    await expect(c(req)).rejects.toThrow(/truncated at max_tokens=100/);
    expect(calls).toBe(2);
  });

  it('names `ollama pull` when the model is missing', async () => {
    const c = client(async () => reply({ error: 'model not found' }, 404));
    await c(req).catch((e: OllamaError) => {
      expect(e.code).toBe('E_OLLAMA');
      expect(e.hint).toMatch(/ollama pull mistral-small:24b/);
    });
  });

  it('retries a dead daemon a bounded number of times, then names the fix', async () => {
    let calls = 0;
    const c = client(async () => { calls++; throw new TypeError('fetch failed'); }, { retries: 2 });
    await c(req).catch((e: OllamaError) => expect(e.hint).toMatch(/ollama serve|OLLAMA_HOST/));
    expect(calls).toBe(3);
  });

  it('retries an empty completion instead of returning nothing as a move', async () => {
    let calls = 0;
    const c = client(async () => {
      calls++;
      return reply({ message: { content: calls === 1 ? '  ' : 'north' }, done_reason: 'stop', prompt_eval_count: 5 });
    });
    expect(await c(req)).toBe('north');
    expect(calls).toBe(2);
  });

  it('refuses a cloud tag at call time, before any request', async () => {
    let calls = 0;
    const c = client(async () => { calls++; return reply({}); });
    await expect(c({ ...req, model: 'gpt-oss:120b-cloud' })).rejects.toThrow(/cloud-routed/);
    expect(calls).toBe(0);
  });
});

describe('cloud tags and hosts', () => {
  it('spots :cloud and -cloud tags but not models that merely contain the word', () => {
    expect(isCloudTag('gpt-oss:120b-cloud')).toBe(true);
    expect(isCloudTag('kimi-k3:cloud')).toBe(true);
    expect(isCloudTag('cloudy-llama:8b')).toBe(false);
    expect(isCloudTag('mistral-small:24b')).toBe(false);
  });

  it('turns a server bind address into one a client can dial', () => {
    expect(resolveOllamaHost('0.0.0.0:11434')).toBe('http://127.0.0.1:11434');
    expect(resolveOllamaHost('http://box:11434/')).toBe('http://box:11434');
  });
});

const base = {
  name: 'g',
  game: { command: 'node', args: ['g.mjs'], promptPatterns: ['> $'] },
  persona: 'a careful player who wants to see what the world does on its own',
  criteria: [{ id: 'c', check: 'something happens' }],
};

describe('seat provider config', () => {
  it('defaults to openrouter so existing configs are untouched', () => {
    const cfg = validateConfig({ ...base, seats: [{ id: 'a', family: 'alpha', model: 'alpha/m' }] }, '.');
    expect(cfg.seats[0].provider).toBe('openrouter');
  });

  it('accepts ollama seats and rejects an unknown provider', () => {
    const cfg = validateConfig({ ...base, seats: [{ id: 'a', family: 'alpha', model: 'mistral-small:24b', provider: 'ollama' }] }, '.');
    expect(cfg.seats[0].provider).toBe('ollama');
    expect(() => validateConfig({ ...base, seats: [{ id: 'a', family: 'alpha', model: 'm', provider: 'lmstudio' }] }, '.')).toThrow(ConfigError);
  });

  it('rejects a cloud tag on an ollama seat at config time', () => {
    expect(() => validateConfig({ ...base, seats: [{ id: 'a', family: 'alpha', model: 'kimi-k3:cloud', provider: 'ollama' }] }, '.'))
      .toThrow(/cloud-routed/);
  });

  it('rejects one model id seated on two providers, because calls route by model id', () => {
    expect(() => validateConfig({
      ...base,
      seats: [
        { id: 'a', family: 'alpha', model: 'same', provider: 'ollama' },
        { id: 'b', family: 'beta', model: 'same' },
      ],
    }, '.')).toThrow(/two providers/);
  });
});

describe('pty named keys config', () => {
  const pty = (keys: unknown) => validateConfig({ ...base, driver: { kind: 'pty', keys }, seats: [{ id: 'a', family: 'alpha', model: 'm' }] }, '.');

  it('keeps a name-to-bytes map', () => {
    expect(pty({ enter: '\r', down: 'j' }).driver).toMatchObject({ kind: 'pty', keys: { enter: '\r', down: 'j' } });
  });

  it('refuses names a player could not answer with, and empty bytes', () => {
    expect(() => pty({ Enter: '\r' })).toThrow(ConfigError);
    expect(() => pty({ enter: '' })).toThrow(/non-empty string of bytes/);
    expect(() => pty({})).toThrow(/non-empty object/);
    expect(() => pty(['enter'])).toThrow(/non-empty object/);
  });
});

describe('routing', () => {
  const seats: Seat[] = [
    { id: 'm', family: 'mistral', model: 'mistral-small:24b', provider: 'ollama' },
    { id: 'g', family: 'google', model: 'google/gemini-2.5-flash', provider: 'openrouter' },
  ];

  it('sends each model to its own provider', async () => {
    const seen: string[] = [];
    const c = createRoutedClient(seats, {
      ollama: async (r) => { seen.push(`ollama:${r.model}`); return 'x'; },
      openrouter: async (r) => { seen.push(`openrouter:${r.model}`); return 'y'; },
    });
    await c({ ...req, model: 'mistral-small:24b' });
    await c({ ...req, model: 'google/gemini-2.5-flash' });
    expect(seen).toEqual(['ollama:mistral-small:24b', 'openrouter:google/gemini-2.5-flash']);
  });

  it('counts the jurors a player will draw, so an all-local run needs no OpenRouter key', () => {
    const local: Seat[] = [
      { id: 'm', family: 'mistral', model: 'mistral-small:24b', provider: 'ollama' },
      { id: 'q', family: 'qwen', model: 'qwen3:14b', provider: 'ollama' },
    ];
    expect([...providersInUse(local, undefined, 1)]).toEqual(['ollama']);
    // A local player whose juror is an OpenRouter seat does need the key.
    expect(providersInUse(seats, ['m'], 1).has('openrouter')).toBe(true);
    expect(providersInUse(seats, ['m'], 0).has('openrouter')).toBe(false);
  });
});
