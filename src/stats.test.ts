import { describe, it, expect } from 'vitest';
import {
  minSignFlipP, stability, betaMean, regularizedIncompleteBeta, invBetaCdf,
  betaCi, posteriorFor, summarizeRuns, phiCoeff, juryNEff, meanPairwisePhi,
  FIRST_INFERENTIAL_N,
} from './stats.js';

describe('sign-flip floor', () => {
  it('is 2/2^n and n=3 can never reach 0.05', () => {
    expect(minSignFlipP(3)).toBe(0.25);
    expect(minSignFlipP(5)).toBe(0.0625);
    expect(minSignFlipP(6)).toBe(0.03125);
    expect(minSignFlipP(3)).toBeGreaterThan(0.05);
    expect(minSignFlipP(FIRST_INFERENTIAL_N)).toBeLessThan(0.05);
  });
});

describe('Beta-Binomial posterior', () => {
  it('shrinks 3/3 away from a fake 100%', () => {
    expect(betaMean(3, 3)).toBeCloseTo(0.8);
    expect(stability(3, 3)).toBe('STABLE_PASS');
    expect(stability(0, 3)).toBe('STABLE_FAIL');
    expect(stability(2, 3)).toBe('UNSTABLE');
  });

  it('Ix(0.5; 1,1) is 0.5 (uniform)', () => {
    expect(regularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 5);
    expect(regularizedIncompleteBeta(0, 2, 2)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 2)).toBe(1);
  });

  it('inverts the CDF by bisection', () => {
    const x = invBetaCdf(0.5, 1, 1);
    expect(x).toBeCloseTo(0.5, 3);
    const ci = betaCi(3, 3);
    expect(ci.low).toBeGreaterThan(0);
    expect(ci.low).toBeLessThan(0.8);
    expect(ci.high).toBeGreaterThan(0.8);
    expect(ci.high).toBeLessThanOrEqual(1);
  });

  it('names the n=3 copy in the summary', () => {
    const s = summarizeRuns([{ id: 'alive', successes: 3 }], 3);
    expect(s.descriptiveOnly).toBe(true);
    expect(s.warning).toMatch(/2\/2\^n/);
    expect(s.warning).toMatch(/0\.25/);
    expect(s.warning).toMatch(/DESCRIPTIVE/);
    expect(s.warning).toMatch(/No p-value/);
    expect(s.warning).not.toMatch(/p<0.05 was achieved/);
    expect(s.posteriors[0].stability).toBe('STABLE_PASS');
    expect(s.posteriors[0].mean).toBeCloseTo(0.8);
  });
});

describe('jury n_eff', () => {
  it('at k=3 and phi=0.39 is about 1.68, and warns below 0.5 n_eff/k', () => {
    const nEff = juryNEff(0.39, 3);
    expect(nEff).toBeCloseTo(1.69, 1);
    expect(nEff / 3).toBeCloseTo(0.56, 1);
    expect(juryNEff(0.7, 3) / 3).toBeLessThan(0.5);
  });

  it('k=1 is 1 regardless of phi', () => {
    expect(juryNEff(0.9, 1)).toBe(1);
  });

  it('phi of identical vectors is 1', () => {
    const v = [true, false, true, true, false];
    expect(phiCoeff(v, v)).toBeCloseTo(1);
    expect(meanPairwisePhi([v, v, v])).toBeCloseTo(1);
  });
});
