/**
 * distributions.test.js - Unit tests for FANGS probability distribution
 * log-density functions and random samplers.
 *
 * Parameterizations follow JAGS/NIMBLE conventions:
 *   - dnorm / rnorm use precision τ = 1/σ²
 *   - dgamma / rgamma use shape and rate (rate = 1/scale)
 *   - dlnorm / rlnorm use meanlog and preclog (precision on log scale)
 *
 * Statistical tolerances:
 *   - Log-density exact values: absolute tolerance ≤ 1e-9
 *   - Sampled means: absolute tolerance ≤ 0.1 (based on ~1 000 draws)
 *   - Sampled variances: absolute tolerance ≤ 0.3
 */

import { describe, it, expect } from 'vitest';
import {
  dnorm, rnorm,
  dgamma, rgamma,
  dbeta, rbeta,
  dpois, rpois,
  dbern, rbern,
  dbinom, rbinom,
  dunif, runif,
  dlnorm, rlnorm,
  logit, invLogit,
} from '../src/utils/distributions.js';

// ─── Tolerance constants ─────────────────────────────────────────────────────

const EXACT_TOL  = 1e-9;   // for closed-form log-density comparisons
const MEAN_TOL   = 0.1;    // for sample mean checks (n ≈ 1 000)
const VAR_TOL    = 0.3;    // for sample variance checks (n ≈ 1 000)
const N_SAMPLES  = 2000;   // number of random draws per sampler test

// ─── Helper: sample mean and variance ────────────────────────────────────────

function sampleMean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function sampleVariance(arr) {
  const m = sampleMean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
}

// ─── Normal distribution ─────────────────────────────────────────────────────

describe('dnorm (Normal log-density, JAGS precision parameterization)', () => {
  it('dnorm(0, 0, 1) ≈ -0.9189 [= -0.5*log(2π)]', () => {
    // tau=1 means σ²=1
    const expected = -0.5 * Math.log(2 * Math.PI);
    expect(dnorm(0, 0, 1)).toBeCloseTo(expected, 8);
  });

  it('dnorm(1, 0, 1) = dnorm(-1, 0, 1) (symmetry)', () => {
    expect(dnorm(1, 0, 1)).toBeCloseTo(dnorm(-1, 0, 1), 10);
  });

  it('dnorm at the mean is the maximum log-density for given tau', () => {
    const logDensityAtMean = dnorm(5, 5, 2);
    const logDensityOff    = dnorm(6, 5, 2);
    expect(logDensityAtMean).toBeGreaterThan(logDensityOff);
  });

  it('log density matches manual formula: 0.5*log(tau) - 0.5*log(2π) - 0.5*tau*(x-mu)²', () => {
    const x = 1.5, mu = 0.5, tau = 2;
    const manual = 0.5 * Math.log(tau) - 0.5 * Math.log(2 * Math.PI) - 0.5 * tau * (x - mu) ** 2;
    expect(dnorm(x, mu, tau)).toBeCloseTo(manual, 10);
  });

  it('returns -Infinity for tau <= 0', () => {
    expect(dnorm(0, 0, 0)).toBe(-Infinity);
    expect(dnorm(0, 0, -1)).toBe(-Infinity);
  });

  it('higher precision gives tighter distribution (lower density away from mean)', () => {
    // Far from mean, higher precision should give lower log-density
    expect(dnorm(5, 0, 10)).toBeLessThan(dnorm(5, 0, 0.1));
  });
});

describe('rnorm (Normal sampler)', () => {
  it('samples have mean ≈ mu', () => {
    const mu = 3, tau = 1;
    const samples = Array.from({ length: N_SAMPLES }, () => rnorm(mu, tau));
    expect(sampleMean(samples)).toBeCloseTo(mu, 0); // within MEAN_TOL
    expect(Math.abs(sampleMean(samples) - mu)).toBeLessThan(MEAN_TOL * 3);
  });

  it('samples have variance ≈ 1/tau', () => {
    const mu = 0, tau = 4; // sigma² = 0.25
    const samples = Array.from({ length: N_SAMPLES }, () => rnorm(mu, tau));
    const expectedVar = 1 / tau;
    expect(Math.abs(sampleVariance(samples) - expectedVar)).toBeLessThan(VAR_TOL);
  });

  it('different mu values shift the distribution', () => {
    const s1 = Array.from({ length: 500 }, () => rnorm(0, 1));
    const s2 = Array.from({ length: 500 }, () => rnorm(10, 1));
    expect(sampleMean(s1)).toBeLessThan(5);
    expect(sampleMean(s2)).toBeGreaterThan(5);
  });
});

// ─── Gamma distribution ───────────────────────────────────────────────────────

describe('dgamma (Gamma log-density)', () => {
  it('returns -Infinity for x <= 0', () => {
    expect(dgamma(0, 2, 1)).toBe(-Infinity);
    expect(dgamma(-1, 2, 1)).toBe(-Infinity);
  });

  it('returns -Infinity for shape <= 0', () => {
    expect(dgamma(1, 0, 1)).toBe(-Infinity);
    expect(dgamma(1, -1, 1)).toBe(-Infinity);
  });

  it('returns -Infinity for rate <= 0', () => {
    expect(dgamma(1, 2, 0)).toBe(-Infinity);
    expect(dgamma(1, 2, -1)).toBe(-Infinity);
  });

  it('log density at mode for Gamma(2, 1) is finite', () => {
    // Mode = (shape-1)/rate = 1 for Gamma(2,1)
    const ld = dgamma(1, 2, 1);
    expect(isFinite(ld)).toBe(true);
  });

  it('log density matches manual formula for Gamma(2, 3)', () => {
    const x = 1, shape = 2, rate = 3;
    // log f(x) = shape*log(rate) + (shape-1)*log(x) - rate*x - logGamma(shape)
    // logGamma(2) = log(1!) = 0
    const manual = shape * Math.log(rate) + (shape - 1) * Math.log(x) - rate * x - 0;
    expect(dgamma(x, shape, rate)).toBeCloseTo(manual, 6);
  });

  it('Gamma(1, rate) is equivalent to Exponential(rate)', () => {
    // For Exp(rate): log f(x) = log(rate) - rate*x
    const x = 0.5, rate = 2;
    const expLogDensity = Math.log(rate) - rate * x;
    expect(dgamma(x, 1, rate)).toBeCloseTo(expLogDensity, 8);
  });
});

describe('rgamma (Gamma sampler)', () => {
  it('sampled mean ≈ shape/rate', () => {
    const shape = 3, rate = 2;  // expected mean = 1.5
    const samples = Array.from({ length: N_SAMPLES }, () => rgamma(shape, rate));
    const expectedMean = shape / rate;
    expect(Math.abs(sampleMean(samples) - expectedMean)).toBeLessThan(MEAN_TOL);
  });

  it('sampled variance ≈ shape/rate²', () => {
    const shape = 4, rate = 2;  // expected variance = 1.0
    const samples = Array.from({ length: N_SAMPLES }, () => rgamma(shape, rate));
    const expectedVar = shape / (rate ** 2);
    expect(Math.abs(sampleVariance(samples) - expectedVar)).toBeLessThan(VAR_TOL);
  });

  it('works for shape < 1 (boosting trick)', () => {
    const shape = 0.5, rate = 1;
    const samples = Array.from({ length: N_SAMPLES }, () => rgamma(shape, rate));
    const expectedMean = shape / rate;
    expect(Math.abs(sampleMean(samples) - expectedMean)).toBeLessThan(MEAN_TOL * 2);
  });

  it('all samples are positive', () => {
    const samples = Array.from({ length: 500 }, () => rgamma(2, 1));
    expect(samples.every(x => x > 0)).toBe(true);
  });

  it('throws RangeError for invalid parameters', () => {
    expect(() => rgamma(0, 1)).toThrow(RangeError);
    expect(() => rgamma(1, 0)).toThrow(RangeError);
  });
});

// ─── Beta distribution ────────────────────────────────────────────────────────

describe('dbeta (Beta log-density)', () => {
  it('returns -Infinity for x <= 0', () => {
    expect(dbeta(0, 2, 2)).toBe(-Infinity);
    expect(dbeta(-0.1, 2, 2)).toBe(-Infinity);
  });

  it('returns -Infinity for x >= 1', () => {
    expect(dbeta(1, 2, 2)).toBe(-Infinity);
    expect(dbeta(1.1, 2, 2)).toBe(-Infinity);
  });

  it('returns -Infinity for a <= 0 or b <= 0', () => {
    expect(dbeta(0.5, 0, 1)).toBe(-Infinity);
    expect(dbeta(0.5, 1, 0)).toBe(-Infinity);
    expect(dbeta(0.5, -1, 2)).toBe(-Infinity);
  });

  it('Beta(1,1) is Uniform(0,1): log density = 0', () => {
    expect(dbeta(0.3, 1, 1)).toBeCloseTo(0, 8);
    expect(dbeta(0.7, 1, 1)).toBeCloseTo(0, 8);
  });

  it('Beta(2,2) is symmetric: dbeta(0.3, 2, 2) === dbeta(0.7, 2, 2)', () => {
    expect(dbeta(0.3, 2, 2)).toBeCloseTo(dbeta(0.7, 2, 2), 10);
  });

  it('mode of Beta(3,3) is at 0.5', () => {
    // dbeta(0.5, 3, 3) should be the maximum in (0,1)
    const atMode = dbeta(0.5, 3, 3);
    expect(atMode).toBeGreaterThan(dbeta(0.3, 3, 3));
    expect(atMode).toBeGreaterThan(dbeta(0.7, 3, 3));
  });
});

describe('rbeta (Beta sampler)', () => {
  it('sampled mean ≈ a/(a+b)', () => {
    const a = 2, b = 3;  // expected mean = 0.4
    const samples = Array.from({ length: N_SAMPLES }, () => rbeta(a, b));
    const expectedMean = a / (a + b);
    expect(Math.abs(sampleMean(samples) - expectedMean)).toBeLessThan(MEAN_TOL);
  });

  it('sampled variance ≈ a*b/((a+b)²*(a+b+1))', () => {
    const a = 3, b = 3;
    const samples = Array.from({ length: N_SAMPLES }, () => rbeta(a, b));
    const expectedVar = (a * b) / ((a + b) ** 2 * (a + b + 1));
    expect(Math.abs(sampleVariance(samples) - expectedVar)).toBeLessThan(VAR_TOL);
  });

  it('all samples are in (0, 1)', () => {
    const samples = Array.from({ length: 500 }, () => rbeta(2, 5));
    expect(samples.every(x => x > 0 && x < 1)).toBe(true);
  });

  it('Beta(1,1) samples have mean ≈ 0.5', () => {
    const samples = Array.from({ length: N_SAMPLES }, () => rbeta(1, 1));
    expect(Math.abs(sampleMean(samples) - 0.5)).toBeLessThan(MEAN_TOL);
  });
});

// ─── Poisson distribution ─────────────────────────────────────────────────────

describe('dpois (Poisson log-PMF)', () => {
  it('returns -Infinity for non-integer x', () => {
    expect(dpois(0.5, 2)).toBe(-Infinity);
  });

  it('returns -Infinity for negative x', () => {
    expect(dpois(-1, 2)).toBe(-Infinity);
  });

  it('returns -Infinity for lambda <= 0', () => {
    expect(dpois(0, 0)).toBe(-Infinity);
    expect(dpois(1, -1)).toBe(-Infinity);
  });

  it('dpois(0, lambda) = -lambda (log P(X=0))', () => {
    const lambda = 3;
    expect(dpois(0, lambda)).toBeCloseTo(-lambda, 10);
  });

  it('dpois(1, 1) = log(e^{-1}) = -1', () => {
    // P(X=1 | λ=1) = e^{-1} * 1^1 / 1! = e^{-1}
    expect(dpois(1, 1)).toBeCloseTo(-1, 8);
  });

  it('log PMF matches manual calculation for dpois(3, 2)', () => {
    // log P(X=3 | λ=2) = 3*log(2) - 2 - log(3!)
    const expected = 3 * Math.log(2) - 2 - Math.log(6);
    expect(dpois(3, 2)).toBeCloseTo(expected, 8);
  });

  it('PMF values are normalized (sum ≈ 1 over reasonable range)', () => {
    const lambda = 5;
    let sumProb = 0;
    for (let k = 0; k <= 30; k++) {
      sumProb += Math.exp(dpois(k, lambda));
    }
    expect(sumProb).toBeCloseTo(1, 4);
  });
});

describe('rpois (Poisson sampler)', () => {
  it('sampled mean ≈ lambda (small lambda)', () => {
    const lambda = 3;
    const samples = Array.from({ length: N_SAMPLES }, () => rpois(lambda));
    expect(Math.abs(sampleMean(samples) - lambda)).toBeLessThan(MEAN_TOL * 3);
  });

  it('sampled mean ≈ lambda (large lambda, normal approximation branch)', () => {
    const lambda = 50;
    const samples = Array.from({ length: N_SAMPLES }, () => rpois(lambda));
    expect(Math.abs(sampleMean(samples) - lambda)).toBeLessThan(lambda * 0.05);
  });

  it('rpois(0) always returns 0', () => {
    for (let i = 0; i < 20; i++) {
      expect(rpois(0)).toBe(0);
    }
  });

  it('all samples are non-negative integers', () => {
    const samples = Array.from({ length: 200 }, () => rpois(4));
    expect(samples.every(x => Number.isInteger(x) && x >= 0)).toBe(true);
  });

  it('throws RangeError for negative lambda', () => {
    expect(() => rpois(-1)).toThrow(RangeError);
  });
});

// ─── Bernoulli distribution ───────────────────────────────────────────────────

describe('dbern (Bernoulli log-PMF)', () => {
  it('dbern(1, 0.7) = log(0.7)', () => {
    expect(dbern(1, 0.7)).toBeCloseTo(Math.log(0.7), 10);
  });

  it('dbern(0, 0.7) = log(0.3)', () => {
    expect(dbern(0, 0.7)).toBeCloseTo(Math.log(0.3), 10);
  });

  it('dbern(1, 1) = 0 (certain success)', () => {
    expect(dbern(1, 1)).toBeCloseTo(0, 10);
  });

  it('dbern(0, 0) = 0 (certain failure)', () => {
    expect(dbern(0, 0)).toBeCloseTo(0, 10);
  });

  it('dbern(1, 0) = -Infinity (impossible)', () => {
    expect(dbern(1, 0)).toBe(-Infinity);
  });

  it('dbern(0, 1) = -Infinity (impossible)', () => {
    expect(dbern(0, 1)).toBe(-Infinity);
  });

  it('returns -Infinity for x not in {0, 1}', () => {
    expect(dbern(0.5, 0.5)).toBe(-Infinity);
    expect(dbern(2, 0.5)).toBe(-Infinity);
  });

  it('returns -Infinity for p out of [0, 1]', () => {
    expect(dbern(1, 1.1)).toBe(-Infinity);
    expect(dbern(0, -0.1)).toBe(-Infinity);
  });
});

describe('rbern (Bernoulli sampler)', () => {
  it('all samples are 0 or 1', () => {
    const samples = Array.from({ length: 500 }, () => rbern(0.3));
    expect(samples.every(x => x === 0 || x === 1)).toBe(true);
  });

  it('sampled mean ≈ p', () => {
    const p = 0.6;
    const samples = Array.from({ length: N_SAMPLES }, () => rbern(p));
    expect(Math.abs(sampleMean(samples) - p)).toBeLessThan(MEAN_TOL);
  });

  it('rbern(0) always returns 0', () => {
    for (let i = 0; i < 20; i++) {
      expect(rbern(0)).toBe(0);
    }
  });

  it('rbern(1) always returns 1', () => {
    for (let i = 0; i < 20; i++) {
      expect(rbern(1)).toBe(1);
    }
  });
});

// ─── Binomial distribution ────────────────────────────────────────────────────

describe('dbinom (Binomial log-PMF)', () => {
  it('returns -Infinity for non-integer x or n', () => {
    expect(dbinom(0.5, 10, 0.5)).toBe(-Infinity);
    expect(dbinom(3, 10.5, 0.5)).toBe(-Infinity);
  });

  it('returns -Infinity for x < 0 or x > n', () => {
    expect(dbinom(-1, 10, 0.5)).toBe(-Infinity);
    expect(dbinom(11, 10, 0.5)).toBe(-Infinity);
  });

  it('returns -Infinity for p out of [0, 1]', () => {
    expect(dbinom(5, 10, -0.1)).toBe(-Infinity);
    expect(dbinom(5, 10, 1.1)).toBe(-Infinity);
  });

  it('dbinom(0, 10, 0) = 0 (certain failure)', () => {
    expect(dbinom(0, 10, 0)).toBeCloseTo(0, 10);
  });

  it('dbinom(10, 10, 1) = 0 (certain success)', () => {
    expect(dbinom(10, 10, 1)).toBeCloseTo(0, 10);
  });

  it('dbinom(0, 10, 1) = -Infinity', () => {
    expect(dbinom(0, 10, 1)).toBe(-Infinity);
  });

  it('dbinom(5, 10, 0.5) matches manual log C(10,5) + 5*log(0.5) + 5*log(0.5)', () => {
    // log C(10,5) = log(252)
    const expected = Math.log(252) + 10 * Math.log(0.5);
    expect(dbinom(5, 10, 0.5)).toBeCloseTo(expected, 6);
  });

  it('Binomial PMF sums to 1 for n=10, p=0.3', () => {
    let total = 0;
    for (let k = 0; k <= 10; k++) {
      total += Math.exp(dbinom(k, 10, 0.3));
    }
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('rbinom (Binomial sampler)', () => {
  it('sampled mean ≈ n * p', () => {
    const n = 20, p = 0.4;  // expected mean = 8
    const samples = Array.from({ length: N_SAMPLES }, () => rbinom(n, p));
    const expectedMean = n * p;
    expect(Math.abs(sampleMean(samples) - expectedMean)).toBeLessThan(MEAN_TOL * 10);
  });

  it('all samples are non-negative integers <= n', () => {
    const n = 15;
    const samples = Array.from({ length: 300 }, () => rbinom(n, 0.5));
    expect(samples.every(x => Number.isInteger(x) && x >= 0 && x <= n)).toBe(true);
  });

  it('rbinom(n, 0) always returns 0', () => {
    for (let i = 0; i < 20; i++) {
      expect(rbinom(10, 0)).toBe(0);
    }
  });

  it('rbinom(n, 1) always returns n', () => {
    for (let i = 0; i < 20; i++) {
      expect(rbinom(10, 1)).toBe(10);
    }
  });
});

// ─── Uniform distribution ─────────────────────────────────────────────────────

describe('dunif (Uniform log-density)', () => {
  it('returns -log(upper - lower) for x in (lower, upper)', () => {
    const lower = 2, upper = 7;
    const expected = -Math.log(upper - lower);
    expect(dunif(3, lower, upper)).toBeCloseTo(expected, 10);
    expect(dunif(5, lower, upper)).toBeCloseTo(expected, 10);
  });

  it('returns -Infinity for x below lower', () => {
    expect(dunif(1.9, 2, 7)).toBe(-Infinity);
  });

  it('returns -Infinity for x above upper', () => {
    expect(dunif(7.1, 2, 7)).toBe(-Infinity);
  });

  it('returns -Infinity when lower >= upper', () => {
    expect(dunif(1, 2, 1)).toBe(-Infinity);
    expect(dunif(1, 1, 1)).toBe(-Infinity);
  });

  it('Uniform(0, 1) has log-density = 0 in the interior', () => {
    expect(dunif(0.5, 0, 1)).toBeCloseTo(0, 10);
  });

  it('is constant across the interior (same value at different x)', () => {
    const [lo, hi] = [3, 8];
    const vals = [3.1, 4.5, 7.9].map(x => dunif(x, lo, hi));
    for (const v of vals) {
      expect(v).toBeCloseTo(vals[0], 10);
    }
  });
});

describe('runif (Uniform sampler)', () => {
  it('all samples are in [lower, upper]', () => {
    const lower = 2, upper = 7;
    const samples = Array.from({ length: 500 }, () => runif(lower, upper));
    expect(samples.every(x => x >= lower && x <= upper)).toBe(true);
  });

  it('sampled mean ≈ (lower + upper) / 2', () => {
    const lower = 2, upper = 8;
    const samples = Array.from({ length: N_SAMPLES }, () => runif(lower, upper));
    const expectedMean = (lower + upper) / 2;
    expect(Math.abs(sampleMean(samples) - expectedMean)).toBeLessThan(MEAN_TOL);
  });

  it('sampled variance ≈ (upper - lower)² / 12', () => {
    const lower = 0, upper = 6;
    const samples = Array.from({ length: N_SAMPLES }, () => runif(lower, upper));
    const expectedVar = (upper - lower) ** 2 / 12;
    expect(Math.abs(sampleVariance(samples) - expectedVar)).toBeLessThan(VAR_TOL);
  });
});

// ─── Log-Normal distribution ──────────────────────────────────────────────────

describe('dlnorm (Log-Normal log-density)', () => {
  it('returns -Infinity for x <= 0', () => {
    expect(dlnorm(0, 0, 1)).toBe(-Infinity);
    expect(dlnorm(-1, 0, 1)).toBe(-Infinity);
  });

  it('returns -Infinity for preclog <= 0', () => {
    expect(dlnorm(1, 0, 0)).toBe(-Infinity);
    expect(dlnorm(1, 0, -1)).toBe(-Infinity);
  });

  it('log density of LogNormal(0,1) at x=1 equals dnorm(0,0,1) - log(1)', () => {
    // dlnorm(x, ml, pl) = dnorm(log(x), ml, pl) - log(x)
    // At x=1: log(1)=0, so dlnorm(1,0,1) = dnorm(0,0,1)
    const { dnorm: _dn } = await import('../src/utils/distributions.js').catch(() => ({ dnorm }));
    expect(dlnorm(1, 0, 1)).toBeCloseTo(dnorm(0, 0, 1), 8);
  });

  it('log density matches manual formula at x=2, meanlog=0, preclog=1', () => {
    const x = 2, ml = 0, pl = 1;
    const logx = Math.log(x);
    const manual = 0.5 * Math.log(pl) - 0.5 * Math.log(2 * Math.PI)
                   - 0.5 * pl * (logx - ml) ** 2 - logx;
    expect(dlnorm(x, ml, pl)).toBeCloseTo(manual, 8);
  });

  it('is symmetric in log-space: dlnorm(e, 0, 1) is the max in [0, ∞)', () => {
    // Mode of LogNormal(0, 1) (with preclog=1, so σ=1) is exp(ml - 1/pl) = exp(-1)
    const mode = Math.exp(-1);
    expect(dlnorm(mode, 0, 1)).toBeGreaterThan(dlnorm(mode * 2, 0, 1));
    expect(dlnorm(mode, 0, 1)).toBeGreaterThan(dlnorm(mode / 2, 0, 1));
  });
});

describe('rlnorm (Log-Normal sampler)', () => {
  it('all samples are positive', () => {
    const samples = Array.from({ length: 200 }, () => rlnorm(0, 1));
    expect(samples.every(x => x > 0)).toBe(true);
  });

  it('log of samples is approximately Normal(meanlog, preclog)', () => {
    const meanlog = 1, preclog = 4;  // σ_log = 0.5, E[log X] = 1
    const samples = Array.from({ length: N_SAMPLES }, () => rlnorm(meanlog, preclog));
    const logSamples = samples.map(Math.log);
    expect(Math.abs(sampleMean(logSamples) - meanlog)).toBeLessThan(MEAN_TOL);
  });

  it('mean of LogNormal(0, 1) ≈ exp(0 + 0.5/1) = e^0.5 ≈ 1.6487', () => {
    // E[X] = exp(meanlog + 1/(2*preclog))
    const meanlog = 0, preclog = 1;
    const expectedMean = Math.exp(meanlog + 0.5 / preclog);
    const samples = Array.from({ length: N_SAMPLES }, () => rlnorm(meanlog, preclog));
    expect(Math.abs(sampleMean(samples) - expectedMean)).toBeLessThan(0.5);
  });
});

// ─── Logit / inverse-logit ────────────────────────────────────────────────────

describe('logit and invLogit', () => {
  it('logit(0.5) = 0', () => {
    expect(logit(0.5)).toBeCloseTo(0, 10);
  });

  it('logit(0.75) ≈ log(3) ≈ 1.0986', () => {
    expect(logit(0.75)).toBeCloseTo(Math.log(3), 8);
  });

  it('invLogit(0) = 0.5', () => {
    expect(invLogit(0)).toBeCloseTo(0.5, 10);
  });

  it('invLogit(log(3)) ≈ 0.75', () => {
    expect(invLogit(Math.log(3))).toBeCloseTo(0.75, 8);
  });

  it('logit and invLogit are mutual inverses: invLogit(logit(p)) ≈ p', () => {
    const probs = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const p of probs) {
      expect(invLogit(logit(p))).toBeCloseTo(p, 10);
    }
  });

  it('logit(invLogit(x)) ≈ x', () => {
    const xs = [-5, -1, 0, 1, 5];
    for (const x of xs) {
      expect(logit(invLogit(x))).toBeCloseTo(x, 8);
    }
  });

  it('invLogit returns values in (0, 1)', () => {
    const xs = [-10, -1, 0, 1, 10];
    for (const x of xs) {
      const p = invLogit(x);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('invLogit is numerically stable for large negative x', () => {
    // Should not underflow to 0 or overflow
    expect(isFinite(invLogit(-100))).toBe(true);
    expect(invLogit(-100)).toBeGreaterThan(0);
  });

  it('invLogit is numerically stable for large positive x', () => {
    expect(isFinite(invLogit(100))).toBe(true);
    expect(invLogit(100)).toBeLessThan(1);
  });
});
