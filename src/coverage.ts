// coverage.ts — how much of the game did this session actually see?
//
// A model player that does not explore produces a confident report about a game
// it barely looked at, and nothing in the transcript makes that obvious to a
// reader. These metrics make it obvious. They are computed from the turn
// records alone: no instrumentation of the game, no extra model calls.
//
// The problem is measured, not hypothetical. Task-oriented LLM agents have been
// found repeating their previous action 63.4% of the time with a 16.0% loop
// rate, against 24.9% / 7.7% for agents TRAINED for exploration (Ye et al. 2026,
// arXiv:2605.16143). Read that band as "what agent repetition looks like in the
// wild", not as something a persona string buys: the contrast there is an RL
// training regime, and the measured effect of merely PROMPTING an agent to
// explore is far smaller — +2.57 average pass@1 (Englander et al. 2026,
// arXiv:2604.17609).
//
// The same paper supplies the more unsettling number: agents *discover* things
// they never use — an injected solution was seen in 79-81% of runs but
// interacted with in only 37-50%. And low action entropy tracks LOW success,
// not efficiency (arXiv:2606.05872), so a tidy-looking transcript with few
// distinct inputs is a warning sign rather than a good one.
//
// Sampling matters too: 23 repeated runs of ONE fixed agent configuration
// scored 57.9-76.8%, an 18.9-point spread (arXiv:2607.02577). A single run is a
// lead, not a measurement, and `confidence` says so.

import { createHash } from 'node:crypto';
import type { TurnRecord } from './player.js';

export type Coverage = {
  /** Player turns considered (setup and quit inputs excluded). */
  turns: number;
  /** Distinct screens seen, after normalising volatile numbers and whitespace. */
  novelStates: number;
  /** The turn at which the last previously-unseen screen appeared. */
  turnOfLastNovelState: number;
  /**
   * Turns taken to see half of all the distinct screens this session ever saw.
   * A low value with a high turn count means the session stopped finding
   * anything new early and kept going.
   */
  noveltyHalfLife: number;
  /** Fraction of turns whose input equalled the previous input. */
  repeatRate: number;
  /** Fraction of turns sitting inside a repeated 2-gram action cycle. */
  loopRate: number;
  /** Fraction of turns after which the screen did not change at all. */
  selfLoopRate: number;
  /** Shannon entropy over the input distribution, in bits. */
  actionEntropy: number;
  /** Distinct inputs used. */
  distinctActions: number;
  /** A plain-language read on whether this session saw enough to judge the game. */
  confidence: 'thin' | 'moderate' | 'broad';
  /** Why `confidence` came out that way, for a human reading the report. */
  notes: string[];
};

const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

/**
 * Normalise a screen so "the same room" hashes the same across visits.
 *
 * The tension: collapsing every number makes `HP 40/100` and `HP 10/100` one
 * state, which is what we want — otherwise a hit-point counter makes every
 * screen novel and the curve says nothing. But it also makes `Room 1` and
 * `Room 2` one state, which is badly wrong for a game with numbered locations.
 *
 * The compromise is to keep the first non-empty line — a scene or room title,
 * which rarely holds a volatile counter — and collapse numbers only in the
 * body, where the status lines live. It is a heuristic and it can be fooled
 * (a title bar carrying a turn counter would defeat it), so `novelStates` is
 * reported as a signal to read alongside the transcript, never as a fact about
 * the game's true state count.
 */
export function normalizeScreen(screen: string): string {
  const lines = screen.split('\n');
  const titleIdx = lines.findIndex((l) => l.trim().length > 0);
  const title = titleIdx >= 0 ? lines[titleIdx].replace(/\s+/g, ' ').trim().toLowerCase() : '';
  const body = (titleIdx >= 0 ? lines.slice(titleIdx + 1) : lines)
    .join(' ')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // Collision-resistant separator as a runtime NUL; encoded as an escape so
  // this file stays UTF-8 text (a raw 0x00 byte makes the module look binary).
  return `${title}\u0000${body}`;
}

function entropy(items: string[]): number {
  if (items.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / items.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Player-chosen inputs only: scripted setup, the quit sequence, and empty consequence rows are the runner's. */
export function playerTurns(history: TurnRecord[]): TurnRecord[] {
  return history.filter((t) => t.input.length > 0 && t.reason !== 'setup' && t.reason !== 'quit' && t.reason !== 'retry');
}

/**
 * The empty-input row runSeat records after the last player command — the
 * screen that command produced. playerTurns omits it (no chosen input) so
 * turnsPlayed stays honest; novelty, self-loops, absorbing SCC and terminals
 * still need that final state.
 */
export function lastConsequence(history: TurnRecord[]): TurnRecord | undefined {
  let lastPlayer = -1;
  for (let i = 0; i < history.length; i++) {
    const t = history[i];
    if (t.input.length > 0 && t.reason !== 'setup' && t.reason !== 'quit' && t.reason !== 'retry') lastPlayer = i;
  }
  if (lastPlayer < 0) return undefined;
  for (let i = lastPlayer + 1; i < history.length; i++) {
    const t = history[i];
    if (t.reason === 'setup' || t.reason === 'quit' || t.reason === 'retry') continue;
    if (t.input.length === 0) return t;
  }
  return undefined;
}

/** Player turns plus the trailing empty-input consequence, when there is one. */
export function analysisTurns(history: TurnRecord[]): TurnRecord[] {
  const turns = playerTurns(history);
  const cons = lastConsequence(history);
  return cons ? [...turns, cons] : turns;
}

export function computeCoverage(history: TurnRecord[]): Coverage {
  const turns = playerTurns(history);
  const n = turns.length;
  if (n === 0) {
    return {
      turns: 0, novelStates: 0, turnOfLastNovelState: 0, noveltyHalfLife: 0,
      repeatRate: 0, loopRate: 0, selfLoopRate: 0, actionEntropy: 0, distinctActions: 0,
      confidence: 'thin', notes: ['no player turns were taken'],
    };
  }

  // Hash the pre-action screens AND the last command's result screen. Action
  // metrics (repeat/loop/entropy) stay over chosen inputs only.
  const states = analysisTurns(history);
  const hashes = states.map((t) => hash(normalizeScreen(t.screen)));
  const seen = new Set<string>();
  let turnOfLastNovelState = 0;
  const novelByTurn: number[] = [];
  hashes.forEach((h, i) => {
    if (!seen.has(h)) {
      seen.add(h);
      turnOfLastNovelState = i < n ? i + 1 : n;
    }
    novelByTurn.push(seen.size);
  });
  const half = seen.size / 2;
  const noveltyHalfLife = novelByTurn.findIndex((c) => c >= half) + 1;

  const inputs = turns.map((t) => t.input.trim().toLowerCase());
  let repeats = 0;
  for (let i = 1; i < n; i++) if (inputs[i] === inputs[i - 1]) repeats++;
  let loops = 0;
  for (let i = 3; i < n; i++) {
    if (inputs[i] === inputs[i - 2] && inputs[i - 1] === inputs[i - 3]) loops++;
  }
  // The screen did not change after this input: the game ignored it, or the
  // action was a no-op. Distinct from repeating an action. The extra hash is
  // the last command's result, so the final action is not invisible.
  let selfLoops = 0;
  for (let i = 1; i < hashes.length; i++) if (hashes[i] === hashes[i - 1]) selfLoops++;

  const repeatRate = repeats / Math.max(1, n - 1);
  const loopRate = loops / n;
  const selfLoopRate = selfLoops / Math.max(1, hashes.length - 1);
  const actionEntropy = entropy(inputs);
  const distinctActions = new Set(inputs).size;

  const notes: string[] = [];
  if (n < 10) notes.push(`only ${n} player turns — too few to characterise a game`);
  if (turnOfLastNovelState < n * 0.5 && n >= 10) {
    notes.push(`nothing new after turn ${turnOfLastNovelState} of ${n} — the session stopped finding new screens halfway through`);
  }
  if (repeatRate > 0.4) notes.push(`${Math.round(repeatRate * 100)}% of turns repeated the previous input`);
  if (loopRate > 0.15) notes.push(`${Math.round(loopRate * 100)}% of turns sat inside a repeated action cycle`);
  if (selfLoopRate > 0.3) notes.push(`${Math.round(selfLoopRate * 100)}% of inputs left the screen unchanged — the game may be ignoring them`);
  if (distinctActions <= 3 && n >= 10) notes.push(`only ${distinctActions} distinct inputs across ${n} turns`);

  // Deliberately conservative: a session is only "broad" when it played a
  // reasonable number of turns, kept finding new screens late, and did not
  // spend itself in a rut.
  let confidence: Coverage['confidence'] = 'moderate';
  if (notes.length === 0 && n >= 20 && seen.size >= n * 0.5) confidence = 'broad';
  if (n < 10 || repeatRate > 0.5 || loopRate > 0.25 || seen.size <= 3) confidence = 'thin';
  if (confidence !== 'thin' && notes.length === 0) notes.push('no exploration warning signs');

  return {
    turns: n,
    novelStates: seen.size,
    turnOfLastNovelState,
    noveltyHalfLife,
    repeatRate,
    loopRate,
    selfLoopRate,
    actionEntropy,
    distinctActions,
    confidence,
    notes,
  };
}

/** One-line summary for the report table. */
export function renderCoverageLine(c: Coverage): string {
  return `${c.turns} turns · ${c.novelStates} distinct screens · repeat ${Math.round(c.repeatRate * 100)}% · loop ${Math.round(c.loopRate * 100)}% · H(a) ${c.actionEntropy.toFixed(2)} · **${c.confidence}**`;
}
