// stats.ts -- small-n reporting for multi-run playtests.
//
// n=3 can never reach p<0.05: an exact two-sided sign-flip permutation over n
// paired runs has a minimum achievable p of 2/2^n (n=3 -> 0.25; n=6 -> 0.031,
// the first that clears alpha=0.05). Bootstrap coverage of a nominal 95%
// interval collapses to 81-83% at n=5 (Walker 2020); do not bootstrap.
//
// Posterior: Beta(s+1, n-s+1), mean (s+1)/(n+2), which shrinks 3/3 away from a
// fake 100% (Hariri et al., arXiv:2510.04265). Labels that need no statistics:
// STABLE_PASS (s=n) / STABLE_FAIL (s=0) / UNSTABLE (0<s<n).
//
// Jury n_eff = k / (1+(k-1)*meanPhi). Warn when n_eff/k < 0.5 (Kohli 2026).

export type Stability = 'STABLE_PASS' | 'STABLE_FAIL' | 'UNSTABLE';

export type CriterionPosterior = {
  id: string;
  successes: number;
  n: number;
  mean: number;
  ciLow: number;
  ciHigh: number;
  stability: Stability;
};

export type RunStats = {
  n: number;
  minP: number;
  descriptiveOnly: boolean;
  firstInferentialN: number;
  posteriors: CriterionPosterior[];
  warning: string;
};

export const FIRST_INFERENTIAL_N = 6;

/** Exact two-sided sign-flip permutation floor: 2/2^n. */
export function minSignFlipP(n: number): number {
  if (n <= 0) return 1;
  return 2 / 2 ** n;
}

export function stability(s: number, n: number): Stability {
  if (n <= 0) return 'UNSTABLE';
  if (s === n) return 'STABLE_PASS';
  if (s === 0) return 'STABLE_FAIL';
  return 'UNSTABLE';
}

export function betaMean(s: number, n: number): number {
  return (s + 1) / (n + 2);
}

// Lanczos approximation for ln Gamma, g=7, valid for Re(z)>0.
function logGamma(z: number): number {
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) x += p[i] / (z + i);
  const t = z + p.length - 1.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Continued fraction for the incomplete beta, Lentz's method. */
function betacf(a: number, b: number, x: number): number {
  const maxIt = 200;
  const eps = 1e-10;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIt; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

/** Regularized incomplete beta Ix(a,b) = B_x(a,b)/B(a,b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBt = a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b);
  const bt = Math.exp(lnBt);
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Inverse regularized incomplete beta by bisection. */
export function invBetaCdf(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function betaCi(s: number, n: number, alpha = 0.05): { low: number; high: number } {
  const a = s + 1;
  const b = n - s + 1;
  return {
    low: invBetaCdf(alpha / 2, a, b),
    high: invBetaCdf(1 - alpha / 2, a, b),
  };
}

export function posteriorFor(id: string, successes: number, n: number): CriterionPosterior {
  const ci = betaCi(successes, n);
  return {
    id,
    successes,
    n,
    mean: betaMean(successes, n),
    ciLow: ci.low,
    ciHigh: ci.high,
    stability: stability(successes, n),
  };
}

export function summarizeRuns(
  perCriterion: Array<{ id: string; successes: number }>,
  n: number,
): RunStats {
  const minP = minSignFlipP(n);
  const descriptiveOnly = n < FIRST_INFERENTIAL_N;
  const inferentialTail = `Still report Beta(s+1,n-s+1) mean (s+1)/(n+2) -- ${n}/${n} shrinks to ${(n + 1) / (n + 2)}, not 100%. Do not decide pass/fail from p alone.`;
  const warning = descriptiveOnly
    ? `n=${n} is DESCRIPTIVE, not a significance test. Exact two-sided sign-flip permutation p cannot fall below 2/2^n = ${minP}. n=${n} can never reach p<0.05 (first n that can is ${FIRST_INFERENTIAL_N}, where 2/2^${FIRST_INFERENTIAL_N}=${minSignFlipP(FIRST_INFERENTIAL_N)}). Do not bootstrap this n. ${n}/${n} is not 100%: Beta(s+1,n-s+1) mean (s+1)/(n+2). No p-value.`
    : n === FIRST_INFERENTIAL_N
      ? `n=${n} is the first n where a two-sided sign-flip permutation can reach p<0.05 (floor 2/2^n=${minP}). ${inferentialTail}`
      : `n=${n} can reach p<0.05 (floor 2/2^n=${minP}). ${inferentialTail}`;
  return {
    n,
    minP,
    descriptiveOnly,
    firstInferentialN: FIRST_INFERENTIAL_N,
    posteriors: perCriterion.map((c) => posteriorFor(c.id, c.successes, n)),
    warning,
  };
}

/**
 * Phi coefficient over two binary vectors of equal length. 0 when a margin
 * is empty (undefined correlation).
 */
export function phiCoeff(a: boolean[], b: boolean[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let n11 = 0, n10 = 0, n01 = 0, n00 = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) n11++;
    else if (a[i] && !b[i]) n10++;
    else if (!a[i] && b[i]) n01++;
    else n00++;
  }
  const den = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  if (den === 0) return 0;
  return (n11 * n00 - n10 * n01) / den;
}

/** Kish effective sample size n_eff = k / (1+(k-1)*meanPhi). */
export function juryNEff(meanPhi: number, k: number): number {
  if (k <= 1) return k;
  const phi = Math.max(0, Math.min(1, meanPhi));
  return k / (1 + (k - 1) * phi);
}

export function meanPairwisePhi(vectors: boolean[][]): number {
  if (vectors.length < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sum += Math.abs(phiCoeff(vectors[i], vectors[j]));
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}
