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
  constructor(message: string, readonly hint: string, readonly status?: number, readonly attempt?: number) {
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

const DEFAULT_MAX_CONTEXT = 32_768;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 600_000;
const MIN_CONTEXT = 4_096;
const CONTEXT_STEP = 2_048;
/** Deliberately pessimistic (English runs nearer 4 characters a token), so the estimate errs large. */
const CHARS_PER_TOKEN = 3;

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
export function contextFor(req: ChatRequest, maxContext: number): { numCtx: number; promptTokens: number } | undefined {
  const chars = req.messages.reduce((n, m) => n + m.content.length, 0);
  const promptTokens = Math.ceil(chars / CHARS_PER_TOKEN) + 16 * req.messages.length;
  const need = promptTokens + req.maxTokens + 256;
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

  return async (req) => {
    if (isCloudTag(req.model)) {
      throw new OllamaError(
        `${req.model} is a cloud-routed Ollama tag`,
        'the ollama provider runs local models only; pull a local tag, or seat this model through OpenRouter',
      );
    }
    const ctx = contextFor(req, maxContext);
    if (!ctx) {
      throw new OllamaError(
        `prompt for ${req.model} needs more than ${maxContext} tokens of context`,
        'Ollama would silently drop the start of the prompt; shorten the transcript (screenChars) or raise maxContextTokens',
      );
    }
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      stream: false,
      // Reasoning models would otherwise spend the reply budget thinking and return an empty answer.
      think: false,
      ...(req.json ? { format: 'json' } : {}),
      options: { temperature: req.temperature, num_predict: req.maxTokens, num_ctx: ctx.numCtx },
    });
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
        );
      }
      // The estimate errs large, so a prompt that used up the window means
      // Ollama cut it to fit. Judging a truncated transcript is worse than failing.
      const seen = (parsed.prompt_eval_count ?? 0) + (parsed.prompt_eval_cached_count ?? 0);
      if (seen > 0 && seen >= ctx.numCtx - req.maxTokens) {
        throw new OllamaError(
          `prompt for ${req.model} filled the ${ctx.numCtx}-token window (${seen} tokens seen); Ollama truncated it`,
          'shorten the transcript (screenChars) or raise maxContextTokens',
          status,
          n,
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
  };
}
