// critic.ts — after the seat has played, the SAME model reviews its own
// transcript against the game's stated criteria and returns a structured
// critique. Temperature 0; JSON extracted defensively; one retry on shape.

import type { ChatClient } from './openrouter.js';
import type { Criterion } from './config.js';
import type { TurnRecord } from './player.js';

export type CriterionVerdict = { id: string; met: boolean; evidence: string; turn: number | null };
export type Critique = {
  alive: boolean;
  summary: string;
  criteria: CriterionVerdict[];
  highlights: string[];
  deadSpots: string[];
  confusions: string[];
  wouldPlayAgain: boolean;
};

export class CritiqueError extends Error {
  readonly code = 'E_CRITIQUE';
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

export function renderTranscript(history: TurnRecord[], maxChars: number): string {
  const parts = history.map((t) => `=== turn ${t.turn} ===\n${t.screen.trim()}\n> ${t.input}`);
  const full = parts.join('\n\n');
  if (full.length <= maxChars) return full;
  // keep the head and the tail; the middle is where repetition lives
  const head = full.slice(0, Math.floor(maxChars * 0.4));
  const tail = full.slice(-Math.floor(maxChars * 0.6));
  return `${head}\n\n[... ${full.length - head.length - tail.length} characters trimmed ...]\n\n${tail}`;
}

export function buildCriticPrompt(criteria: Criterion[], transcript: string): string {
  const list = criteria.map((c) => `- "${c.id}": ${c.check}`).join('\n');
  return `You just played the game whose transcript follows (your inputs are the lines starting with ">"). Review it as a playtester: what did the WORLD do on its own, without you asking for it? Judge each criterion strictly from what the transcript shows, citing the turn number.

Criteria:
${list}

Answer with ONE JSON object and nothing else:
{
  "alive": boolean,            // did the world feel alive -- did it act on its own, react to you, and stay coherent?
  "summary": string,           // 2-4 sentences, plain
  "criteria": [ { "id": string, "met": boolean, "evidence": string, "turn": number | null } ],  // one per criterion id above
  "highlights": [string],      // moments that worked, with turn numbers
  "deadSpots": [string],       // moments the world felt scripted, empty, contradictory, or broken, with turn numbers
  "confusions": [string],      // anything you did not understand as a player, with turn numbers
  "wouldPlayAgain": boolean
}

Transcript:
${transcript}`;
}

/**
 * Read a verdict boolean without inverting it.
 *
 * `Boolean()` was used here, and `Boolean("false") === true`. A critic that
 * answered `"alive": "false"` — which smaller models do routinely, because JSON
 * mode nudges them to stringify scalars — was recorded as ALIVE with every
 * criterion MET. The verdict flipped silently, no retry fired, and the report
 * printed the opposite of what the critic said.
 *
 * Anything that is not recognisably a boolean throws, so the caller's retry can
 * see it. An unreadable verdict must never resolve to a pass.
 */
function strictBool(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === 'yes') return true;
    if (s === 'false' || s === 'no') return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  throw new CritiqueError(
    `critique field ${field} is not a boolean (got ${JSON.stringify(value)})`,
    'answer with JSON booleans: true or false, unquoted',
  );
}

export function parseCritique(raw: string, criteria: Criterion[]): Critique {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new CritiqueError('no JSON object in critique', 'the critic must answer with one JSON object');
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new CritiqueError(`critique JSON does not parse: ${(err as Error).message}`, 'the critic must answer with valid JSON');
  }
  // Any JSON object used to be accepted, so a wrapped answer ({"result":{...}})
  // or a apology object became a confident all-unmet verdict and the documented
  // retry could never fire for the likeliest failures.
  if (!Array.isArray(obj.criteria) || obj.alive === undefined) {
    throw new CritiqueError(
      'critique is missing the required "alive" and "criteria" fields',
      'answer with the exact JSON object requested, not wrapped in another key',
    );
  }
  const verdicts = obj.criteria as Array<Record<string, unknown>>;
  const criteriaOut: CriterionVerdict[] = criteria.map((c) => {
    const v = verdicts.find((x) => x.id === c.id);
    return {
      id: c.id,
      met: v ? strictBool(v.met, `criteria[${c.id}].met`) : false,
      evidence: v && typeof v.evidence === 'string' ? v.evidence : (v ? '' : 'not addressed by the critic'),
      turn: v && typeof v.turn === 'number' ? v.turn : null,
    };
  });
  const arr = (k: string): string[] => (Array.isArray(obj[k]) ? (obj[k] as unknown[]).map(String) : []);
  return {
    alive: strictBool(obj.alive, 'alive'),
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    criteria: criteriaOut,
    highlights: arr('highlights'),
    deadSpots: arr('deadSpots'),
    confusions: arr('confusions'),
    // Absent is a real answer here ("the critic did not say"), and defaulting it
    // to false is the safe direction for a would-play-again claim.
    wouldPlayAgain: obj.wouldPlayAgain === undefined ? false : strictBool(obj.wouldPlayAgain, 'wouldPlayAgain'),
  };
}

export async function critique(client: ChatClient, model: string, criteria: Criterion[], history: TurnRecord[], opts: { transcriptChars?: number } = {}): Promise<Critique> {
  const transcript = renderTranscript(history, opts.transcriptChars ?? 60_000);
  const prompt = buildCriticPrompt(criteria, transcript);
  let lastErr: CritiqueError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await client({
      model,
      messages: [
        { role: 'system', content: 'You are a careful, specific playtester. You answer only with the JSON object requested.' },
        { role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was not a valid JSON object (${lastErr?.message ?? 'parse error'}). Answer with the complete JSON object only, and keep every evidence string under 200 characters.` },
      ],
      // claude-rpg's fourth family playtest (2026-09-02): 19 criteria with
      // evidence strings no longer fit in 1,800 tokens -- one seat's critique was
      // cut mid-array and failed to parse twice. Sized for ~25 criteria.
      maxTokens: 6000,
      temperature: 0,
      json: true,
    });
    try {
      return parseCritique(raw, criteria);
    } catch (err) {
      lastErr = err as CritiqueError;
    }
  }
  throw lastErr ?? new CritiqueError('critique failed', 'see previous errors');
}
