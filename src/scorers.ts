// scorers.ts — probability judges: a number per criterion, alongside the LLM jury.
//
// The jury (panel.ts) reads a transcript and writes verdicts with evidence. A
// SCORER answers the same criteria as probabilities and writes nothing else. Why
// both: on 2026-10-02, against 14 cases with a known answer, single LLM judges got
// 6 of 8 on an observable criterion ("the world changes without the player") while
// a decision model got 8 of 8 with wide margins (true >= 0.92, false <= 0.18). It
// has no evidence to offer, though, so it sits beside the jury as a second,
// calibrated opinion: where the two disagree, a person should look.
//
// A scorer is an interface so further kinds can be added without touching the
// runner. `jev` (TypeSafe's decision model on OpenRouter) is the first.

import type { Criterion } from './config.js';
import type { TurnRecord } from './player.js';
import { renderTranscript, type RunOutcome } from './critic.js';
import { estimateTokens } from './ollama.js';
import type { DecisionsClient, DecisionQuestion } from './decisions.js';

export type ScorerKind = 'jev';

export type ScorerConfig = {
  /** Short id, used in the report column. Defaults to the kind. */
  id: string;
  kind: ScorerKind;
  model: string;
  /** Largest state a request may carry. Jev's window is 32K tokens, questions included. */
  maxStateTokens: number;
  /** P(met) inside [low, high] is reported as uncertain rather than as a verdict. */
  band: [number, number];
};

export const SCORER_DEFAULTS: Record<ScorerKind, Omit<ScorerConfig, 'id' | 'kind'>> = {
  jev: { model: 'typesafe/jev-1.13', maxStateTokens: 26_000, band: [0.35, 0.65] },
};

export type CriterionScore = {
  id: string;
  /** Probability the criterion holds, or null when this criterion was not scored. */
  p: number | null;
};

export type ScorerResult = {
  scorer: string;
  kind: ScorerKind;
  model: string;
  band: [number, number];
  scores: CriterionScore[];
  /** USD reported by the provider. */
  cost?: number;
  /** Characters of transcript sent, and whether the middle was cut to fit the window. */
  stateChars: number;
  clipped: boolean;
  error?: string;
};

export type ScoreInput = { evidence: TurnRecord[]; criteria: Criterion[]; outcome: RunOutcome };

export interface Scorer {
  readonly id: string;
  readonly kind: ScorerKind;
  /** Score a live run's evidence (the runner's path). */
  score(input: ScoreInput): Promise<ScorerResult>;
  /** Score already-rendered state, e.g. a saved transcript.txt (the `score` command's path). */
  scoreState(state: string, clipped: boolean, criteria: Criterion[]): Promise<ScorerResult>;
}

/** Fit plain text (a saved transcript) to the window by keeping its head and tail. */
export function fitText(text: string, maxTokens: number): { state: string; clipped: boolean } {
  if (estimateTokens(text) <= maxTokens) return { state: text, clipped: false };
  let chars = text.length;
  let out = text;
  while (chars > 2_000 && estimateTokens(out) > maxTokens) {
    chars = Math.floor(chars * 0.85);
    const head = text.slice(0, Math.floor(chars * 0.4));
    const tail = text.slice(-Math.floor(chars * 0.6));
    out = `${head}\n\n[... ${text.length - head.length - tail.length} characters trimmed ...]\n\n${tail}`;
  }
  return { state: out, clipped: true };
}

export type ScorerDeps = { decisions?: DecisionsClient };

/**
 * Render the transcript as large as the window allows. renderTranscript keeps the
 * head and the tail and trims the middle, so shrinking the character budget keeps
 * the start and the end of the session, which is where endings and stalls show.
 */
export function stateForWindow(evidence: TurnRecord[], outcome: RunOutcome, maxTokens: number): { state: string; clipped: boolean } {
  const footer = `\n\n[session ended by ${outcome.endedBy} after ${outcome.turnsPlayed} player turns${outcome.error ? `; error: ${outcome.error}` : ''}]`;
  const full = renderTranscript(evidence, Number.MAX_SAFE_INTEGER);
  if (estimateTokens(full + footer) <= maxTokens) return { state: full + footer, clipped: false };
  let chars = full.length;
  let text = full;
  while (chars > 2_000) {
    chars = Math.floor(chars * 0.85);
    text = renderTranscript(evidence, chars);
    if (estimateTokens(text + footer) <= maxTokens) break;
  }
  return { state: text + footer, clipped: true };
}

/** One noul question per criterion; ids are the criterion ids, so answers map straight back. */
export function criterionQuestions(criteria: Criterion[]): Record<string, DecisionQuestion> {
  const q: Record<string, DecisionQuestion> = {};
  for (const c of criteria) {
    q[c.id] = {
      type: 'noul',
      instructions: `Judge this game playtest transcript against one criterion, strictly from what the transcript shows. Criterion: ${c.check}`,
      criteria: {
        true: 'The transcript shows the criterion holding.',
        false: 'The transcript does not show the criterion holding.',
      },
    };
  }
  return q;
}

function jevScorer(cfg: ScorerConfig, deps: ScorerDeps): Scorer {
  const self: Scorer = {
    id: cfg.id,
    kind: 'jev',
    async score({ evidence, criteria, outcome }) {
      const { state, clipped } = stateForWindow(evidence, outcome, cfg.maxStateTokens);
      return self.scoreState(state, clipped, criteria);
    },
    async scoreState(state, clipped, criteria) {
      const base = { scorer: cfg.id, kind: 'jev' as const, model: cfg.model, band: cfg.band, stateChars: state.length, clipped };
      if (!deps.decisions) {
        return { ...base, scores: criteria.map((c) => ({ id: c.id, p: null })), error: 'no decisions client (OPENROUTER_API_KEY unset?)' };
      }
      try {
        // All criteria in one request: the transcript is the expensive part and is sent once.
        const res = await deps.decisions({ model: cfg.model, state, questions: criterionQuestions(criteria) });
        return {
          ...base,
          model: res.model,
          scores: criteria.map((c) => {
            const a = res.answers[c.id];
            return { id: c.id, p: a && a.type === 'noul' ? a.noul : null };
          }),
          ...(res.cost !== undefined ? { cost: res.cost } : {}),
        };
      } catch (err) {
        return { ...base, scores: criteria.map((c) => ({ id: c.id, p: null })), error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
  return self;
}

export function createScorer(cfg: ScorerConfig, deps: ScorerDeps): Scorer {
  switch (cfg.kind) {
    case 'jev': return jevScorer(cfg, deps);
  }
}

/** How a probability reads against its band: a yes, a no, or too close to call. */
export function readProbability(p: number | null, band: [number, number]): 'met' | 'not met' | 'uncertain' | 'unscored' {
  if (p === null) return 'unscored';
  if (p > band[1]) return 'met';
  if (p < band[0]) return 'not met';
  return 'uncertain';
}

/**
 * Where a scorer and the jury disagree. Only a confident probability on the other
 * side of the jury's verdict counts; an uncertain probability is not a dispute.
 */
export function disagreement(p: number | null, band: [number, number], juryMet: boolean | null | undefined): boolean {
  if (juryMet === null || juryMet === undefined) return false;
  const read = readProbability(p, band);
  return (juryMet && read === 'not met') || (!juryMet && read === 'met');
}
