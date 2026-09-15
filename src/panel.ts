// panel.ts — who judges a transcript, and how their disagreement is reported.
//
// The tool shipped with each seat critiquing its own transcript: `critique()`
// was called with `seat.model`, the same model that had just played. The README
// scored EXTERNAL_VERIFIER 3 and cited the self-preference literature while
// doing exactly the thing that literature warns about.
//
// The evidence is more nuanced than "self-judging is always inflated", and the
// nuance is what makes it matter HERE rather than generally:
//
//  - Self-preference is real but much of it is competence, not narcissism: only
//    ~10.4% of measured self-preference exceeds a capability-matched control
//    across 37,448 pairs (Roytburg et al. 2026, arXiv:2601.22548). BUT the
//    residual concentrates in SUBJECTIVE domains and vanishes in verifiable
//    ones — and "did the world feel alive" is as subjective as it gets.
//  - Self-verification actively destroys accuracy where an external verifier
//    adds it: Game-of-24 went 5% -> 3% under self-critique and -> 38% with a
//    sound external verifier (Stechly et al. 2024, arXiv:2402.08115).
//  - A panel of cheaper heterogeneous judges beats one strong judge and costs
//    7-8x less: kappa 0.763 vs 0.627 (Verga et al. 2024, arXiv:2404.18796).
//  - Evaluators applying one rubric to one artifact agree far less than
//    intuition suggests — only 20% of 93 problems were found by every
//    evaluator, 46% by a single one (Hertzum & Jacobsen 2003). Their stated
//    remedy is precisely "use multiple evaluators".
//
// So: a transcript is judged by families that did not produce it, disagreement
// is reported rather than averaged away, and the playing seat's own reading is
// kept as testimony rather than as a score.

import type { Criterion, Seat } from './config.js';
import type { Critique, CriterionVerdict } from './critic.js';
import { juryNEff, meanPairwisePhi } from './stats.js';

export type PanelVerdict = {
  /** Which seats judged this transcript. */
  jurors: Seat[];
  /** Each juror's critique, in juror order. */
  critiques: Array<{ seat: Seat; critique: Critique | null; error?: string }>;
  /** Majority verdict per criterion, with the split recorded. */
  criteria: Array<CriterionVerdict & { metCount: number; answeredCount: number; split: boolean }>;
  /**
   * Majority on the alive question. False is a score only when at least one
   * juror answered; when `degraded` is set and every critique is missing, this
   * is not a fail-closed verdict — read `degraded` and `answeredCount` first.
   */
  alive: boolean;
  aliveCount: number;
  wouldPlayAgainCount: number;
  /**
   * Fraction of criteria the jurors did NOT agree on. High dispersion is a
   * finding about the CRITERIA, not noise: it means the checks are
   * under-specified, which is the failure mode the evaluator-effect literature
   * predicts and which averaging would hide.
   */
  dispersion: number;
  /** Mean pairwise |phi| over per-criterion met vectors. */
  meanPhi: number;
  /** Kish n_eff = k / (1+(k-1)*meanPhi). Warn in the report when n_eff/k < 0.5. */
  nEff: number;
  /**
   * Set when the panel is incomplete: panelSize is 0, fewer jurors sat than
   * requested, or every seated juror failed. A degraded panel is not a
   * fail-closed majority over an empty set.
   */
  degraded?: string;
};

/**
 * Choose jurors for a seat's transcript: seats from other families, preferring
 * a panel of three.
 *
 * Returns an empty array when the roster offers no other family. The caller
 * decides what to do about that — this function will not quietly hand the
 * transcript back to its own author.
 */
export function pickJurors(seats: Seat[], author: Seat, size = 3): Seat[] {
  const others = seats.filter((s) => s.family !== author.family);
  return others.slice(0, size);
}

function majority(values: boolean[]): boolean {
  // Empty is not a vote. Callers must not treat this as a panel score.
  if (values.length === 0) {
    throw new Error('majority() over an empty set is not a score');
  }
  const yes = values.filter(Boolean).length;
  // A tie resolves to false: "the jury did not agree that it was met" is the
  // honest reading of a split, and a verdict should not round up.
  return yes * 2 > values.length;
}

function unansweredCriteria(criteria: Criterion[]): PanelVerdict['criteria'] {
  return criteria.map((c) => ({
    id: c.id,
    met: false,
    evidence: 'no juror addressed this criterion',
    turn: null,
    metCount: 0,
    answeredCount: 0,
    split: false,
  }));
}

function degradedReason(jurors: Seat[], goodCount: number, requested?: number): string | undefined {
  const parts: string[] = [];
  if (requested === 0) parts.push('panelSize is 0; no jurors were requested');
  else if (requested !== undefined && jurors.length < requested) {
    parts.push(`only ${jurors.length} of ${requested} requested cross-family jurors were available`);
  }
  if (goodCount === 0 && requested !== 0) {
    parts.push(jurors.length === 0
      ? 'no jurors sat; majority over an empty set is not a score'
      : 'every juror failed; majority over an empty set is not a score');
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export function aggregatePanel(
  jurors: Seat[],
  critiques: Array<{ seat: Seat; critique: Critique | null; error?: string }>,
  criteria: Criterion[],
  opts?: { requested?: number },
): PanelVerdict {
  const good = critiques.filter((c) => c.critique) as Array<{ seat: Seat; critique: Critique }>;
  const degraded = degradedReason(jurors, good.length, opts?.requested);

  if (good.length === 0) {
    return {
      jurors,
      critiques,
      criteria: unansweredCriteria(criteria),
      alive: false,
      aliveCount: 0,
      wouldPlayAgainCount: 0,
      dispersion: 0,
      meanPhi: 0,
      nEff: 0,
      degraded,
    };
  }

  const criteriaOut = criteria.map((c) => {
    const verdicts = good
      .map((g) => g.critique.criteria.find((x) => x.id === c.id))
      .filter((v): v is CriterionVerdict => Boolean(v));
    const metCount = verdicts.filter((v) => v.met).length;
    const answeredCount = verdicts.length;
    const votes = verdicts.map((v) => v.met);
    // Unanswered is not a majority; do not score an empty vote list.
    const met = votes.length === 0 ? false : majority(votes);
    // Cite a juror who actually reached the majority answer, so the evidence
    // line matches the verdict rather than contradicting it.
    const witness = votes.length === 0 ? undefined : verdicts.find((v) => v.met === met);
    return {
      id: c.id,
      met,
      evidence: witness?.evidence ?? (answeredCount === 0 ? 'no juror addressed this criterion' : ''),
      turn: witness?.turn ?? null,
      metCount,
      answeredCount,
      split: answeredCount > 1 && metCount > 0 && metCount < answeredCount,
    };
  });

  const splits = criteriaOut.filter((c) => c.split).length;
  const vectors = good.map((g) =>
    criteria.map((c) => g.critique.criteria.find((x) => x.id === c.id)?.met ?? false));
  const meanPhi = meanPairwisePhi(vectors);
  const nEff = juryNEff(meanPhi, good.length);
  return {
    jurors,
    critiques,
    criteria: criteriaOut,
    alive: majority(good.map((g) => g.critique.alive)),
    aliveCount: good.filter((g) => g.critique.alive).length,
    wouldPlayAgainCount: good.filter((g) => g.critique.wouldPlayAgain).length,
    dispersion: criteriaOut.length === 0 ? 0 : splits / criteriaOut.length,
    meanPhi,
    nEff,
    degraded,
  };
}
