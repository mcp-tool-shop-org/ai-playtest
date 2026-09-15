// verifiers.ts -- deterministic transcript checks. Precise and partial.
//
// AgentRewardBench (arXiv:2504.08942): rule-based success eval is 83.8
// precision / 55.9 recall; small judges invert that. These checks carry the
// precision floor so the jury spends its budget on what only judgement can
// settle. They operate on TurnRecord[] and reuse normalizeScreen().
//
// Two things they will not claim, because the literature says they cannot:
//   1. Unwinnability / "softlock". A linear trace is one path, not a graph.
//      Softlock-freedom is AG(EF(goal)) over an enumerable state graph
//      (Mawhorter & Smith, FDG 2021). An absorbing SCC in the *observed*
//      digraph is reported as a possible sink in the sampled graph -- kind=review,
//      never fail, never "softlock".
//   2. Contradiction. UNION correlates at Pearson 0.37; off-the-shelf NLI on
//      dialogue scores below the majority baseline. Contradiction stays with
//      the jury. The entity-appearance grid is packaged as leads, not a verdict.

import { createHash } from 'node:crypto';
import { normalizeScreen, playerTurns } from './coverage.js';
import type { TurnRecord } from './player.js';

export type VerifierConfig = {
  /** Occupancy inside an absorbing SCC before we mention it. Default 4. */
  absorbingMinTurns: number;
  /** Consecutive zero-novelty turns that make a no-progress window. Default 5. */
  noProgressWindow: number;
  /** Verb tokens treated as expected no-ops (examine, look, ...). */
  noOpVerbs: string[];
  /** Regex sources: the game said it did not parse the input. Empty = unused. */
  unparsed: string[];
  /** Regex sources: the game refused a parsed input. Empty = unused. */
  refused: string[];
  /** Regex sources: a victory / win screen. Empty = unused. */
  victory: string[];
  /** Regex sources: a death / game-over screen. Empty = unused. */
  death: string[];
};

export const DEFAULT_VERIFIERS: VerifierConfig = {
  absorbingMinTurns: 4,
  noProgressWindow: 5,
  noOpVerbs: [],
  unparsed: [],
  refused: [],
  victory: [],
  death: [],
};

export type AbsorbingHit = {
  hashes: string[];
  turnSpan: number;
  firstTurn: number;
  lastTurn: number;
  distinctEntryInputs: string[];
  /** Always 'review'. A transcript cannot prove a trap. */
  kind: 'review';
  /** The two false-positive modes, printed beside every hit. */
  falsePositiveModes: string[];
};

export type IgnoredInput = {
  turn: number;
  input: string;
  kind: 'no-output' | 'identical-screen' | 'changed';
};

export type ParserClass = 'unparsed' | 'refused' | 'accepted' | 'unknown';

export type ParserTurn = {
  turn: number;
  input: string;
  classification: ParserClass;
};

export type TerminalHit = {
  kind: 'victory' | 'death' | 'none';
  turn: number | null;
  inAbsorbingComponent: boolean;
};

export type NoProgressWindow = {
  startTurn: number;
  endTurn: number;
  jaccard: number;
};

export type EntityLead = {
  token: string;
  pattern: string;
  turns: number[];
  note: string;
};

export type VerifierReport = {
  absorbing: AbsorbingHit | null;
  ignoredInputs: IgnoredInput[];
  parser: { turns: ParserTurn[]; unknownRate: number; listsEmpty: boolean };
  terminal: TerminalHit;
  noProgress: NoProgressWindow[];
  entityLeads: EntityLead[];
};

const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

function compile(sources: string[]): RegExp[] {
  return sources.map((s) => new RegExp(s, 'im'));
}

function anyMatch(regexes: RegExp[], text: string): boolean {
  return regexes.some((r) => r.test(text));
}

/**
 * Tarjan strongly-connected components over a directed graph.
 * Nodes are identified by string; missing nodes in `edges` are ignored.
 */
export function tarjanScc(nodes: string[], edges: Array<[string, string]>): string[][] {
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let index = 0;
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
    if (!adj.has(b)) adj.set(b, []);
  }

  const strongconnect = (v: string): void => {
    indexOf.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!indexOf.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indexOf.get(w)!));
      }
    }
    if (low.get(v) === indexOf.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };

  for (const v of adj.keys()) if (!indexOf.has(v)) strongconnect(v);
  return out;
}

function jaccard(a: string, b: string): number {
  const tok = (s: string) => new Set(s.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const FP_HUB = 'hub-camp FP: a legitimate hub the player stayed in; no new screens were required';
const FP_BUDGET = 'budget FP: the run ended because turns ran out; unobserved exits may exist';

export function detectAbsorbing(
  turns: TurnRecord[],
  minTurns: number,
): AbsorbingHit | null {
  if (turns.length === 0) return null;
  const hashes = turns.map((t) => hash(normalizeScreen(t.screen)));
  const nodes = Array.from(new Set(hashes));
  const edges: Array<[string, string]> = [];
  for (let i = 1; i < hashes.length; i++) edges.push([hashes[i - 1], hashes[i]]);
  const sccs = tarjanScc(nodes, edges);
  const outgoing = new Map<string, Set<string>>();
  const owner = new Map<string, number>();
  sccs.forEach((comp, i) => { for (const n of comp) owner.set(n, i); });
  for (const [a, b] of edges) {
    const ia = owner.get(a);
    const ib = owner.get(b);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    if (!outgoing.has(String(ia))) outgoing.set(String(ia), new Set());
    outgoing.get(String(ia))!.add(String(ib));
  }
  const last = hashes[hashes.length - 1];
  for (let i = 0; i < sccs.length; i++) {
    const comp = sccs[i];
    if (!comp.includes(last)) continue;
    if ((outgoing.get(String(i)) ?? new Set()).size > 0) continue;
    const indices = hashes.map((h, t) => (comp.includes(h) ? t : -1)).filter((t) => t >= 0);
    if (indices.length < minTurns) continue;
    const inputs = Array.from(new Set(indices.map((t) => turns[t].input.trim().toLowerCase()).filter(Boolean)));
    if (inputs.length < 2) continue;
    const firstTurn = turns[indices[0]].turn;
    const lastTurn = turns[indices[indices.length - 1]].turn;
    return {
      hashes: comp,
      turnSpan: indices.length,
      firstTurn,
      lastTurn,
      distinctEntryInputs: inputs,
      kind: 'review',
      falsePositiveModes: [FP_HUB, FP_BUDGET],
    };
  }
  return null;
}

export function classifyIgnored(turns: TurnRecord[]): IgnoredInput[] {
  return turns.map((t, i) => {
    if (i === 0) {
      return { turn: t.turn, input: t.input, kind: 'changed' as const };
    }
    const prev = turns[i - 1];
    const same = hash(normalizeScreen(t.screen)) === hash(normalizeScreen(prev.screen));
    const empty = t.screen.trim().length === 0;
    const kind: IgnoredInput['kind'] = empty ? 'no-output' : same ? 'identical-screen' : 'changed';
    return { turn: t.turn, input: t.input, kind };
  });
}

export function classifyParser(turns: TurnRecord[], cfg: VerifierConfig): VerifierReport['parser'] {
  const unparsed = compile(cfg.unparsed);
  const refused = compile(cfg.refused);
  const listsEmpty = cfg.unparsed.length === 0 && cfg.refused.length === 0;
  const rows: ParserTurn[] = turns.map((t) => {
    let classification: ParserClass = 'unknown';
    if (!listsEmpty) {
      if (anyMatch(unparsed, t.screen)) classification = 'unparsed';
      else if (anyMatch(refused, t.screen)) classification = 'refused';
      else classification = 'accepted';
    }
    return { turn: t.turn, input: t.input, classification };
  });
  const unknown = rows.filter((r) => r.classification === 'unknown').length;
  return { turns: rows, unknownRate: rows.length === 0 ? 0 : unknown / rows.length, listsEmpty };
}

export function detectTerminal(turns: TurnRecord[], cfg: VerifierConfig, absorbing: AbsorbingHit | null): TerminalHit {
  const victory = compile(cfg.victory);
  const death = compile(cfg.death);
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (anyMatch(victory, t.screen)) {
      return { kind: 'victory', turn: t.turn, inAbsorbingComponent: absorbing !== null };
    }
    if (anyMatch(death, t.screen)) {
      return { kind: 'death', turn: t.turn, inAbsorbingComponent: absorbing !== null };
    }
  }
  return { kind: 'none', turn: null, inAbsorbingComponent: absorbing !== null };
}

export function detectNoProgress(turns: TurnRecord[], window: number, noOpVerbs: string[]): NoProgressWindow[] {
  if (turns.length < window || window < 2) return [];
  const hashes = turns.map((t) => hash(normalizeScreen(t.screen)));
  const verbs = new Set(noOpVerbs.map((v) => v.toLowerCase()));
  const out: NoProgressWindow[] = [];
  for (let i = 0; i + window <= turns.length; i++) {
    const slice = hashes.slice(i, i + window);
    // Zero novelty: no hash in the window that was not already seen at the
    // window's first turn. A new screen anywhere in the window is progress.
    const grew = slice.some((h, k) => k > 0 && !slice.slice(0, k).includes(h));
    if (grew) continue;
    const js = [];
    for (let k = 1; k < window; k++) js.push(jaccard(normalizeScreen(turns[i + k - 1].screen), normalizeScreen(turns[i + k].screen)));
    const meanJ = js.reduce((a, b) => a + b, 0) / js.length;
    if (meanJ < 0.7) continue;
    const allNoOp = noOpVerbs.length > 0 && turns.slice(i, i + window).every((t) => {
      const first = t.input.trim().toLowerCase().split(/\s+/)[0] ?? '';
      return verbs.has(first);
    });
    if (allNoOp) continue;
    out.push({
      startTurn: turns[i].turn,
      endTurn: turns[i + window - 1].turn,
      jaccard: meanJ,
    });
  }
  // collapse overlapping windows into the longest
  const collapsed: NoProgressWindow[] = [];
  for (const w of out) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && w.startTurn <= prev.endTurn + 1) {
      prev.endTurn = Math.max(prev.endTurn, w.endTurn);
      prev.jaccard = Math.max(prev.jaccard, w.jaccard);
    } else collapsed.push({ ...w });
  }
  return collapsed;
}

/**
 * Capitalized-token appearance grid. Ships as evidence, not a verdict.
 * FP rate is high with the capitalized-token fallback -- frame as leads.
 */
export function entityAppearanceGrid(turns: TurnRecord[]): EntityLead[] {
  const tokenTurns = new Map<string, number[]>();
  const skip = new Set(['The', 'You', 'What', 'HP', 'Turn', 'Exits', 'Hostiles', 'Location', 'Saved', 'Character']);
  for (const t of turns) {
    const tokens = t.screen.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) ?? [];
    const seen = new Set<string>();
    for (const raw of tokens) {
      if (skip.has(raw.split(/\s+/)[0] ?? '')) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const arr = tokenTurns.get(raw) ?? [];
      arr.push(t.turn);
      tokenTurns.set(raw, arr);
    }
  }
  const leads: EntityLead[] = [];
  const maxTurn = turns[turns.length - 1]?.turn ?? 0;
  for (const [token, ts] of tokenTurns) {
    if (ts.length === 1 && maxTurn - ts[0] >= 4) {
      leads.push({
        token,
        pattern: 'singleton',
        turns: ts,
        note: `appeared once at t${ts[0]} and never again -- capitalized-token fallback, a lead for the jury, not a fact`,
      });
      continue;
    }
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] >= 6) {
        leads.push({
          token,
          pattern: 'X -> gap -> S',
          turns: ts,
          note: `${token} vanished for ${ts[i] - ts[i - 1]} turns (t${ts[i - 1]} to t${ts[i]}) -- role-transition lead for the jury, not a verdict`,
        });
        break;
      }
    }
  }
  return leads.slice(0, 12);
}

export function runVerifiers(history: TurnRecord[], cfg: VerifierConfig = DEFAULT_VERIFIERS): VerifierReport {
  const turns = playerTurns(history);
  const absorbing = detectAbsorbing(turns, cfg.absorbingMinTurns);
  return {
    absorbing,
    ignoredInputs: classifyIgnored(turns),
    parser: classifyParser(turns, cfg),
    terminal: detectTerminal(turns, cfg, absorbing),
    noProgress: detectNoProgress(turns, cfg.noProgressWindow, cfg.noOpVerbs),
    entityLeads: entityAppearanceGrid(turns),
  };
}

/** One-line, hedged, for REPORT.md. Must not say softlock / stuck / unwinnable. */
export function renderAbsorbingLine(hit: AbsorbingHit | null): string {
  if (!hit) return 'absorbing-SCC (observed graph): none. Observation about the sampled digraph -- not AG(EF(goal)), not a trap proof.';
  return (
    `absorbing-SCC (observed graph): Tarjan SCC contains the final screen, 0 outgoing edges *in this transcript graph*, ` +
    `span ${hit.turnSpan} turns (t${hit.firstTurn}--t${hit.lastTurn}), entered via ${hit.distinctEntryInputs.length} distinct inputs ` +
    `(${hit.distinctEntryInputs.slice(0, 6).join(', ')}). ` +
    `kind=review. Observation about the sampled digraph -- not AG(EF(goal)), not a trap proof. ` +
    `FP: ${hit.falsePositiveModes.join('; ')}.`
  );
}
