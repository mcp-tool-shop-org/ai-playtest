// ollama.ts — local seats through a local Ollama daemon's native chat endpoint.
//
// Why the native /api/chat and not Ollama's OpenAI-compatible /v1: the OpenAI
// shape cannot set num_ctx per request, and Ollama's default context is small.
// A critic reading a forty-turn transcript would have its prompt truncated with
// no error and judge whatever tail survived. Here every request sizes num_ctx
// from its own prompt, and a prompt that cannot fit fails loudly instead.

import type { ChatClient, ChatRequest } from './openrouter.js';

export class OllamaError extends Error {
  readonly code = 'E_OLLAMA';
  constructor(
    message: string,
    readonly hint: string,
    readonly status?: number,
    readonly attempt?: number,
    /** What went wrong, for the provider's own recovery: a reply cut at its budget, or a prompt that filled the window. */
    readonly kind?: 'length' | 'window',
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

type FetchInit = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
type FetchLike = (url: string, init: FetchInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type OllamaOptions = {
  /** Daemon address. Defaults to $OLLAMA_HOST, then http://127.0.0.1:11434. */
  host?: string;
  fetchImpl?: FetchLike;
  /** Largest num_ctx a request may ask for. A prompt that needs more fails rather than truncating. */
  maxContextTokens?: number;
  /** Network retries. A local daemon is either up or not, so this stays small. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt deadline. Generous: a cold 30B model can take a minute to load before it answers. */
  attemptTimeoutMs?: number;
};

/**
 * The largest window a request may ask for. 64K covers a judge reading a 40-turn
 * transcript of box-drawn screens; current local models (llama3.3, qwen3, gpt-oss)
 * support 128K. AI_PLAYTEST_OLLAMA_MAX_CTX overrides it for smaller cards.
 */
const DEFAULT_MAX_CONTEXT = Number(process.env.AI_PLAYTEST_OLLAMA_MAX_CTX) > 0
  ? Number(process.env.AI_PLAYTEST_OLLAMA_MAX_CTX)
  : 65_536;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 600_000;
const MIN_CONTEXT = 4_096;
const CONTEXT_STEP = 2_048;
/**
 * ASCII is counted at 3 characters a token (deliberately pessimistic: English runs
 * near 4) and every other character at about one token. A TUI screen drawn in box
 * characters (│ ─ █) tokenises at roughly a token per glyph: an Escape the Valley
 * camp screen measured about 4,600 tokens against a characters/3 estimate that
 * sized it at 4,096.
 */
const ASCII_PER_TOKEN = 3;
const TOKENS_PER_OTHER = 1.1;
/** Room for a reasoning model's thinking, on top of the reply budget, once one is detected. */
const REASONING_BUDGET = 4_096;

/** `think` as Ollama takes it: off, on, or a level (gpt-oss cannot be switched off, only lowered). */
export type Think = false | true | 'low';

/** The setting that moves a model's reasoning off the reply: gpt-oss takes a level, others a boolean. */
export function thinkValueFor(model: string): Think {
  return /^gpt-oss/i.test(model) ? 'low' : true;
}

/** Cloud-routed tags run on ollama.com and bill an account; this provider exists for local, free seats. */
export function isCloudTag(model: string): boolean {
  const tag = model.includes(':') ? model.slice(model.lastIndexOf(':') + 1) : '';
  return tag === 'cloud' || tag.endsWith('-cloud');
}

export function resolveOllamaHost(host?: string): string {
  let h = (host ?? process.env.OLLAMA_HOST ?? '').trim() || 'http://127.0.0.1:11434';
  if (!/^https?:\/\//.test(h)) h = `http://${h}`;
  // OLLAMA_HOST=0.0.0.0 is a bind address for the server, not one a client can dial.
  return h.replace('://0.0.0.0', '://127.0.0.1').replace(/\/+$/, '');
}

/** num_ctx for one request: prompt estimate plus the reply budget, rounded up, or undefined if it cannot fit. */
/** Pessimistic token estimate for text (see ASCII_PER_TOKEN). Shared by every provider with a hard window. */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) (ch.charCodeAt(0) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / ASCII_PER_TOKEN + other * TOKENS_PER_OTHER);
}

export function contextFor(req: ChatRequest, maxContext: number, extraReply = 0): { numCtx: number; promptTokens: number } | undefined {
  const promptTokens = req.messages.reduce((n, m) => n + estimateTokens(m.content), 0) + 16 * req.messages.length;
  const need = promptTokens + req.maxTokens + extraReply + 256;
  const numCtx = Math.max(MIN_CONTEXT, Math.ceil(need / CONTEXT_STEP) * CONTEXT_STEP);
  return numCtx > maxContext ? undefined : { numCtx, promptTokens };
}

export function createOllamaClient(opts: OllamaOptions = {}): ChatClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const host = resolveOllamaHost(opts.host);
  const maxContext = opts.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  const retries = opts.retries ?? 2;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;

  // Models seen to reason whether or not they are asked to, and the `think` value
  // that moves the reasoning off the reply. Learned per client, once per model.
  const reasoners = new Map<string, Think>();

  return async (req) => {
    if (isCloudTag(req.model)) {
      throw new OllamaError(
        `${req.model} is a cloud-routed Ollama tag`,
        'the ollama provider runs local models only; pull a local tag, or seat this model through OpenRouter',
      );
    }
    let think: Think = reasoners.get(req.model) ?? false;
    let grown = false;
    for (;;) {
      const extra = think === false ? 0 : REASONING_BUDGET;
      const ctx = contextFor(req, maxContext, extra);
      if (!ctx) {
        throw new OllamaError(
          `prompt for ${req.model} needs more than ${maxContext} tokens of context`,
          'Ollama would silently drop the start of the prompt; shorten the transcript (screenChars) or raise maxContextTokens',
        );
      }
      const numCtx = grown ? Math.min(maxContext, ctx.numCtx * 2) : ctx.numCtx;
      try {
        return await send(req, { think, numPredict: req.maxTokens + extra, numCtx });
      } catch (err) {
        if (!(err instanceof OllamaError)) throw err;
        // The prompt tokenised larger than estimated (box-drawing art does). Once, with twice the window.
        if (err.kind === 'window' && !grown && ctx.numCtx * 2 <= maxContext) { grown = true; continue; }
        // A short reply cut off at its budget: some models reason even with think:false, inline
        // (qwen3-next) or in the thinking channel (gpt-oss). Once, with the reasoning moved to its
        // own channel and room for it; remembered for the rest of the run.
        if (err.kind === 'length' && think === false) {
          think = thinkValueFor(req.model);
          reasoners.set(req.model, think);
          continue;
        }
        // A model that cannot think at all refuses the retry. Report the original truncation.
        if (think !== false && err.status === 400 && /think/i.test(err.message)) {
          reasoners.delete(req.model);
          throw new OllamaError(
            `response from ${req.model} was truncated at max_tokens=${req.maxTokens}`,
            `raise maxTokens for this call; the cut-off text is not valid ${req.json ? 'JSON' : 'output'}`,
          );
        }
        throw err;
      }
    }
  };

  async function send(req: ChatRequest, o: { think: Think; numPredict: number; numCtx: number }): Promise<string> {
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      stream: false,
      think: o.think,
      ...(req.json ? { format: 'json' } : {}),
      options: { temperature: req.temperature, num_predict: o.numPredict, num_ctx: o.numCtx },
    });
    const ctx = { numCtx: o.numCtx };
    let lastErr: OllamaError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const n = attempt + 1;
      if (attempt > 0) await sleep(2_000 * 2 ** (attempt - 1));
      let status = 0;
      let text: string;
      try {
        const signal = AbortSignal.timeout(attemptTimeoutMs);
        const res = await fetchImpl(`${host}/api/chat`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body, signal,
        });
        status = res.status;
        text = await res.text();
        if (!res.ok) {
          const detail = text.slice(0, 300);
          if (res.status === 404) {
            throw new OllamaError(`model ${req.model} is not available on ${host}: ${detail}`, `run \`ollama pull ${req.model}\``, 404, n);
          }
          lastErr = new OllamaError(`HTTP ${res.status} from Ollama for ${req.model}: ${detail}`, 'the daemon refused the request; check `ollama ps` and free VRAM', res.status, n);
          if (res.status < 500) throw lastErr;
          continue;
        }
      } catch (err) {
        if (err instanceof OllamaError) throw err;
        const name = (err as { name?: string })?.name;
        const msg = name === 'TimeoutError' || name === 'AbortError' ? `no reply within ${attemptTimeoutMs}ms` : (err as Error).message;
        lastErr = new OllamaError(`cannot reach Ollama at ${host}: ${msg}`, 'start the daemon (`ollama serve`) or set OLLAMA_HOST', status || undefined, n);
        continue;
      }
      let parsed: {
        message?: { content?: string };
        done_reason?: string;
        error?: string;
        prompt_eval_count?: number;
        prompt_eval_cached_count?: number;
      };
      try {
        parsed = JSON.parse(text);
      } catch {
        lastErr = new OllamaError(`non-JSON body from Ollama for ${req.model}`, 'transient; retried', status, n);
        continue;
      }
      if (parsed.error) throw new OllamaError(`Ollama error for ${req.model}: ${parsed.error}`, 'see the daemon log', status, n);
      if (parsed.done_reason === 'length') {
        throw new OllamaError(
          `response from ${req.model} was truncated at max_tokens=${req.maxTokens}`,
          `raise maxTokens for this call; the cut-off text is not valid ${req.json ? 'JSON' : 'output'}`,
          status,
          n,
          'length',
        );
      }
      // The estimate errs large, so a prompt that used up the window means
      // Ollama cut it to fit. Judging a truncated transcript is worse than failing.
      const seen = (parsed.prompt_eval_count ?? 0) + (parsed.prompt_eval_cached_count ?? 0);
      if (seen > 0 && seen >= ctx.numCtx - o.numPredict) {
        throw new OllamaError(
          `prompt for ${req.model} filled the ${ctx.numCtx}-token window (${seen} tokens seen); Ollama truncated it`,
          'shorten the transcript (screenChars) or raise maxContextTokens',
          status,
          n,
          'window',
        );
      }
      const content = parsed.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        lastErr = new OllamaError(`empty completion from ${req.model}`, 'empty reply; retried', status, n);
        continue;
      }
      return content;
    }
    throw lastErr ?? new OllamaError('exhausted retries', 'see the previous errors');
  }
}
