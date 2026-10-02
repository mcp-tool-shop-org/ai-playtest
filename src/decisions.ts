// decisions.ts — OpenRouter's Decisions API: typed questions in, typed answers out.
//
// A decision model (TypeSafe Jev is the first) does not write text. It takes a
// state and named questions of three kinds and returns, per question, a number
// the caller can branch on:
//
//   noul    "does this hold?"            -> probability it holds
//   choice  "which one of these?"        -> chosen key, per-option probabilities, confidence
//   score   "where on this ordered scale" -> position, per-level probabilities, confidence
//
// This module is only the transport and the types, so every feature built on a
// decision model (scoring criteria today; gating actions, picking a transcript's
// worst turn, rubric scores later) shares one client, one retry policy and one
// cost record. Endpoint: POST /api/alpha/decisions. It is ALPHA on OpenRouter, so
// answers are validated rather than trusted to keep their shape.

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
  /** What "true" and "false" mean for this question. Optional; sharpening it helps. */
  criteria?: { true: string; false: string };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  /** Option key -> what that option means. */
  criteria: Record<string, string>;
};

export type ScoreQuestion = {
  type: 'score';
  instructions: string;
  /** Ordered scale, lowest first; answers index into it. */
  criteria: string[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> };
export type ScoreAnswer = { type: 'score'; score: number; confidence?: number; legend?: Record<string, string>; probabilities?: Record<string, number> };
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type DecisionRequest = {
  model: string;
  /** What the questions are about. A string is sent as-is. */
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, DecisionQuestion>;
};

export type DecisionResult = {
  model: string;
  answers: Record<string, DecisionAnswer>;
  /** USD, as reported by OpenRouter in usage.cost. */
  cost?: number;
  inputTokens?: number;
};

export type DecisionsClient = (req: DecisionRequest) => Promise<DecisionResult>;

export class DecisionsError extends Error {
  readonly code = 'E_DECISIONS';
  constructor(message: string, readonly hint: string, readonly status?: number) {
    super(message);
    this.name = 'DecisionsError';
  }
}

type FetchInit = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
type FetchLike = (url: string, init: FetchInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type DecisionsOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  attemptTimeoutMs?: number;
};

const DEFAULT_BASE = 'https://openrouter.ai/api/alpha';

const isProb = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;

/** Check one answer against the question it answers. A malformed answer is an error, never a guess. */
export function validateAnswer(q: DecisionQuestion, a: unknown, id: string): DecisionAnswer {
  const bad = (why: string) => new DecisionsError(`answer "${id}" ${why}`, 'the decision model returned an unexpected shape; the Decisions API is alpha');
  if (!a || typeof a !== 'object') throw bad('is missing');
  const r = a as Record<string, unknown>;
  if (q.type === 'noul') {
    if (!isProb(r.noul)) throw bad(`has no probability in "noul" (got ${JSON.stringify(r.noul)})`);
    return { type: 'noul', noul: r.noul };
  }
  if (q.type === 'choice') {
    if (typeof r.choice !== 'string' || !(r.choice in q.criteria)) throw bad(`chose ${JSON.stringify(r.choice)}, not one of ${Object.keys(q.criteria).join(', ')}`);
    return {
      type: 'choice',
      choice: r.choice,
      ...(isProb(r.confidence) ? { confidence: r.confidence } : {}),
      ...(r.probabilities && typeof r.probabilities === 'object' ? { probabilities: r.probabilities as Record<string, number> } : {}),
    };
  }
  if (typeof r.score !== 'number' || !Number.isFinite(r.score)) throw bad(`has no numeric "score" (got ${JSON.stringify(r.score)})`);
  return {
    type: 'score',
    score: r.score,
    ...(isProb(r.confidence) ? { confidence: r.confidence } : {}),
    ...(r.legend && typeof r.legend === 'object' ? { legend: r.legend as Record<string, string> } : {}),
    ...(r.probabilities && typeof r.probabilities === 'object' ? { probabilities: r.probabilities as Record<string, number> } : {}),
  };
}

export function createDecisionsClient(opts: DecisionsOptions): DecisionsClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const retries = opts.retries ?? 3;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 60_000;

  return async (req) => {
    if (Object.keys(req.questions).length === 0) throw new DecisionsError('no questions to ask', 'pass at least one question');
    const body = JSON.stringify({ model: req.model, state: req.state, questions: req.questions });
    let lastErr: DecisionsError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(1_000 * 2 ** (attempt - 1));
      let status = 0;
      let text = '';
      try {
        const res = await fetchImpl(`${base}/decisions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'content-type': 'application/json',
            'HTTP-Referer': 'https://github.com/mcp-tool-shop-org/ai-playtest',
            'X-Title': 'ai-playtest',
          },
          body,
          signal: AbortSignal.timeout(attemptTimeoutMs),
        });
        status = res.status;
        text = await res.text();
        if (!res.ok) {
          lastErr = new DecisionsError(
            `HTTP ${res.status} from the Decisions API for ${req.model}: ${text.slice(0, 300)}`,
            res.status === 401 ? 'OPENROUTER_API_KEY is missing or invalid'
              : res.status === 402 ? 'OpenRouter credits exhausted'
              : res.status === 413 ? 'state too large for the model; shorten the transcript'
              : res.status === 429 || res.status >= 500 ? 'transient; retried' : 'not retried',
            res.status,
          );
          if (res.status !== 429 && res.status < 500) throw lastErr;
          continue;
        }
      } catch (err) {
        if (err instanceof DecisionsError) throw err;
        lastErr = new DecisionsError(`cannot reach the Decisions API: ${(err as Error).message}`, 'check connectivity; retried', status || undefined);
        continue;
      }
      let parsed: { model?: string; answers?: Record<string, unknown>; usage?: { cost?: number; input_tokens?: number } };
      try {
        parsed = JSON.parse(text);
      } catch {
        lastErr = new DecisionsError('non-JSON body from the Decisions API', 'transient; retried', status);
        continue;
      }
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, q] of Object.entries(req.questions)) answers[id] = validateAnswer(q, parsed.answers?.[id], id);
      return {
        model: parsed.model ?? req.model,
        answers,
        ...(typeof parsed.usage?.cost === 'number' ? { cost: parsed.usage.cost } : {}),
        ...(typeof parsed.usage?.input_tokens === 'number' ? { inputTokens: parsed.usage.input_tokens } : {}),
      };
    }
    throw lastErr ?? new DecisionsError('exhausted retries', 'see the previous errors');
  };
}
