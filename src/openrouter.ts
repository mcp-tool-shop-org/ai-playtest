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
    readonly priorBodies: readonly string[] = [],
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

type FetchInit = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
type FetchHeaders = { get(name: string): string | null };
type FetchLike = (url: string, init: FetchInit) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers?: FetchHeaders;
}>;

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
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 30_000;
const RETRY_AFTER_CAP_MS = 60_000;

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

/** 408/429 and 5xx are transient. Other 4xx (402 credits, 403, 413, 422, …) are terminal. */
function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function hintForHttp(status: number): string {
  switch (status) {
    case 400: return 'bad request (HTTP 400); not retried';
    case 401: return 'OPENROUTER_API_KEY is missing or invalid';
    case 402: return 'pay / check account: OpenRouter credits exhausted — this is not a hang';
    case 403: return 'forbidden (HTTP 403); this key or model is not allowed — not retried';
    case 404: return 'the model slug has no endpoints; check https://openrouter.ai/models';
    case 408: return 'request timeout (HTTP 408); retrying';
    case 413: return 'payload too large (HTTP 413); shrink the prompt — not retried';
    case 422: return 'unprocessable request (HTTP 422); not retried';
    case 429: return 'rate-limited (HTTP 429); retrying';
    default:
      if (status >= 500) return 'upstream outage; retrying';
      if (status >= 400) return `client error (HTTP ${status}); not retried`;
      return 'transient; retried';
  }
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const sec = Number(trimmed);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, RETRY_AFTER_CAP_MS);
  const when = Date.parse(trimmed);
  if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), RETRY_AFTER_CAP_MS);
  return undefined;
}

/** Equal jitter: half the exponential delay plus a random extra half, so parallel seats do not lockstep. */
function equalJitter(baseMs: number): number {
  const exp = Math.min(Math.max(0, baseMs), BACKOFF_CAP_MS);
  return exp / 2 + Math.random() * (exp / 2);
}

function flattenMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const p of content) {
    if (typeof p === 'string') parts.push(p);
    else if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
      parts.push((p as { text: string }).text);
    }
  }
  return parts.join('');
}

function finishReasonOf(choice: { finish_reason?: string } | undefined): string {
  return (choice?.finish_reason ?? '').toLowerCase().replace(/_/g, '-');
}

function noteBody(priorBodies: string[], status: number | undefined, body: string): void {
  const snippet = `${status ?? 'net'} ${body.slice(0, 240)}`;
  if (!priorBodies.includes(snippet)) priorBodies.push(snippet);
}

export function createOpenRouterClient(opts: OpenRouterOptions): ChatClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Upstream providers rate-limit in bursts. Six retries with equal-jitter
  // doubling (honouring Retry-After when present) wait about two minutes
  // before a seat gives up. Terminal 4xx do not enter that budget.
  const retries = opts.retries ?? 6;
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  return async (req) => {
    let lastErr: OpenRouterError | undefined;
    let retryAfterMs: number | undefined;
    const priorBodies: string[] = [];
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
          priorBodies,
        );
      }
      if (attempt > 0) {
        const remaining = budgetMs - (Date.now() - started);
        const exp = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        const ra = retryAfterMs;
        retryAfterMs = undefined;
        const raw = ra !== undefined
          ? Math.min(ra + Math.random() * 250, RETRY_AFTER_CAP_MS)
          : equalJitter(exp);
        const wait = Math.min(
          raw,
          Math.max(0, remaining - 1),
          ra !== undefined ? RETRY_AFTER_CAP_MS : BACKOFF_CAP_MS,
        );
        if (wait > 0) await sleep(wait);
        if (Date.now() - started >= budgetMs) {
          const elapsedMs = Date.now() - started;
          throw lastErr ?? new OpenRouterError(
            `exhausted retries (attempt ${n}/${totalAttempts}, ${elapsedMs}ms)`,
            'wall-clock budget exhausted; check connectivity',
            undefined,
            n,
            elapsedMs,
            priorBodies,
          );
        }
      }
      const stamp = (message: string, hint: string, status?: number): OpenRouterError => {
        const elapsedMs = Date.now() - started;
        const earlier = priorBodies.length > 0 ? `; earlier: ${priorBodies.join(' | ')}` : '';
        return new OpenRouterError(
          `${message} (attempt ${n}/${totalAttempts}, ${elapsedMs}ms)${earlier}`,
          hint,
          status,
          n,
          elapsedMs,
          [...priorBodies],
        );
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
        lastErr = stamp(
          `HTTP ${res.status} from OpenRouter for ${req.model}: ${text.slice(0, 300)}`,
          hintForHttp(res.status),
          res.status,
        );
        noteBody(priorBodies, res.status, text);
        if (!isRetryableHttp(res.status)) break;
        retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after') ?? res.headers?.get?.('Retry-After'));
        continue;
      }
      let parsed: {
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
        error?: { message?: string };
      };
      try {
        parsed = JSON.parse(text);
      } catch {
        lastErr = stamp('non-JSON body from OpenRouter', 'transient; retried');
        noteBody(priorBodies, res.status, 'non-JSON body');
        continue;
      }
      if (parsed.error) {
        lastErr = stamp(`OpenRouter error for ${req.model}: ${parsed.error.message ?? 'unknown'}`, 'transient; retried');
        noteBody(priorBodies, res.status, parsed.error.message ?? 'unknown');
        continue;
      }
      const choice = parsed.choices?.[0];
      const finish = finishReasonOf(choice);
      // A filtered turn used to look like the model chose to say nothing.
      // Non-retryable: the same prompt reproduces the moderation block.
      if (finish === 'content-filter') {
        const elapsedMs = Date.now() - started;
        throw new OpenRouterError(
          `response from ${req.model} was blocked by the provider content filter`,
          'moderation: the provider filtered this completion; this is not an empty reply — do not retry the same prompt',
          res.status,
          n,
          elapsedMs,
          priorBodies,
        );
      }
      // A completion cut off at max_tokens used to be returned as a success.
      // With response_format json_object that guarantees a parse failure
      // downstream, reported as "the model cannot produce JSON" rather than
      // "the budget was too small" — which is the failure the 1,800 -> 6,000
      // critic-budget commit was chasing. Non-retryable: the same budget
      // reproduces it.
      if (finish === 'length') {
        const elapsedMs = Date.now() - started;
        throw new OpenRouterError(
          `response from ${req.model} was truncated at max_tokens=${req.maxTokens}`,
          `raise maxTokens for this call; the model had more to say and the cut-off text is not valid ${req.json ? 'JSON' : 'output'}`,
          res.status,
          n,
          elapsedMs,
          priorBodies,
        );
      }
      const rawContent = choice?.message?.content;
      const content = flattenMessageContent(rawContent);
      if (content === undefined || (Array.isArray(rawContent) && content.length === 0)) {
        lastErr = stamp(`empty completion from ${req.model}`, 'empty reply; retried');
        continue;
      }
      return content;
    }
    throw lastErr ?? new OpenRouterError('exhausted retries', 'see the previous errors', undefined, undefined, undefined, priorBodies);
  };
}
