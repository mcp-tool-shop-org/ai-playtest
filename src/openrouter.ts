// openrouter.ts — the one HTTP seam: OpenRouter's OpenAI-compatible chat endpoint.
// Injectable fetch so every other module is testable without the network.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  /** Ask the provider for a JSON object (best effort; callers still parse defensively). */
  json?: boolean;
};

export type ChatClient = (req: ChatRequest) => Promise<string>;

export class OpenRouterError extends Error {
  readonly code = 'E_OPENROUTER';
  constructor(
    message: string,
    readonly hint: string,
    readonly status?: number,
    readonly attempt?: number,
    readonly elapsedMs?: number,
  ) {
    super(message);
  }
}

type FetchInit = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
type FetchLike = (url: string, init: FetchInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type OpenRouterOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  retries?: number;
  /** Sleep between retries; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt fetch deadline. Hung TCP/body reads abort and retry. */
  attemptTimeoutMs?: number;
  /** Wall-clock cap across the whole retry budget. */
  budgetMs?: number;
};

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_ATTEMPT_TIMEOUT_MS = 45_000;
const DEFAULT_BUDGET_MS = 180_000;

function isAbortError(err: unknown): boolean {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

function abortedError(): Error {
  const err = new Error('request timed out');
  err.name = 'TimeoutError';
  return err;
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function createOpenRouterClient(opts: OpenRouterOptions): ChatClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Upstream providers rate-limit in bursts (a 429 with "temporarily
  // rate-limited upstream"); six retries at 2s doubling wait about two
  // minutes in total before a seat gives up.
  const retries = opts.retries ?? 6;
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  return async (req) => {
    let lastErr: OpenRouterError | undefined;
    const started = Date.now();
    const totalAttempts = retries + 1;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const n = attempt + 1;
      const elapsed = Date.now() - started;
      if (elapsed >= budgetMs) {
        throw lastErr ?? new OpenRouterError(
          `exhausted retries (attempt ${n}/${totalAttempts}, ${elapsed}ms)`,
          'wall-clock budget exhausted; check connectivity',
          undefined,
          n,
          elapsed,
        );
      }
      if (attempt > 0) {
        const wait = Math.min(2000 * 2 ** (attempt - 1), budgetMs - (Date.now() - started));
        if (wait > 0) await sleep(wait);
        if (Date.now() - started >= budgetMs) {
          const elapsedMs = Date.now() - started;
          throw lastErr ?? new OpenRouterError(
            `exhausted retries (attempt ${n}/${totalAttempts}, ${elapsedMs}ms)`,
            'wall-clock budget exhausted; check connectivity',
            undefined,
            n,
            elapsedMs,
          );
        }
      }
      const stamp = (message: string, hint: string, status?: number): OpenRouterError => {
        const elapsedMs = Date.now() - started;
        return new OpenRouterError(`${message} (attempt ${n}/${totalAttempts}, ${elapsedMs}ms)`, hint, status, n, elapsedMs);
      };
      const body = JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      });
      let res: Awaited<ReturnType<FetchLike>>;
      let text: string;
      const remaining = Math.max(1, budgetMs - (Date.now() - started));
      const signal = AbortSignal.timeout(Math.min(attemptTimeoutMs, remaining));
      try {
        res = await raceAbort(fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'content-type': 'application/json',
            'HTTP-Referer': 'https://github.com/mcp-tool-shop-org/ai-playtest',
            'X-Title': 'ai-playtest',
          },
          body,
          signal,
        }), signal);
        // Reading the body has to sit inside this try. A socket reset partway
        // through the response is the commonest transient fault there is, and
        // outside the guard it escaped the retry loop entirely: one attempt
        // instead of the seven the configuration promises, surfacing as a raw
        // TypeError with no code or hint.
        text = await raceAbort(res.text(), signal);
      } catch (err) {
        const msg = isAbortError(err) ? 'request timed out' : (err as Error).message;
        lastErr = stamp(`network error: ${msg}`, 'check connectivity; the runner retries with backoff');
        continue;
      }
      if (!res.ok) {
        lastErr = stamp(`HTTP ${res.status} from OpenRouter for ${req.model}: ${text.slice(0, 300)}`, res.status === 401 ? 'OPENROUTER_API_KEY is missing or invalid' : res.status === 404 ? 'the model slug has no endpoints; check https://openrouter.ai/models' : 'transient; retried', res.status);
        if (res.status === 401 || res.status === 404 || res.status === 400) break;
        continue;
      }
      let parsed: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>; error?: { message?: string } };
      try {
        parsed = JSON.parse(text);
      } catch {
        lastErr = stamp('non-JSON body from OpenRouter', 'transient; retried');
        continue;
      }
      if (parsed.error) {
        lastErr = stamp(`OpenRouter error for ${req.model}: ${parsed.error.message ?? 'unknown'}`, 'transient; retried');
        continue;
      }
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        lastErr = stamp(`empty completion from ${req.model}`, 'transient; retried');
        continue;
      }
      // A completion cut off at max_tokens used to be returned as a success.
      // With response_format json_object that guarantees a parse failure
      // downstream, reported as "the model cannot produce JSON" rather than
      // "the budget was too small" — which is the failure the 1,800 -> 6,000
      // critic-budget commit was chasing. Non-retryable: the same budget
      // reproduces it.
      if (parsed.choices?.[0]?.finish_reason === 'length') {
        throw new OpenRouterError(
          `response from ${req.model} was truncated at max_tokens=${req.maxTokens}`,
          `raise maxTokens for this call; the model had more to say and the cut-off text is not valid ${req.json ? 'JSON' : 'output'}`,
        );
      }
      return content;
    }
    throw lastErr ?? new OpenRouterError('exhausted retries', 'see the previous errors');
  };
}
