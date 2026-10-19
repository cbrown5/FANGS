/**
 * prior-check.test.js
 *
 * Regression tests for Prior Check mode (`priorOnly: true`).
 *
 * In prior-only mode the likelihood must be dropped entirely, so draws for
 * every unobserved parameter should reproduce its declared prior — including
 * for parameters the model graph flags as having a conjugate full conditional.
 *
 * Regression guard: `updateParameter` previously honoured `priorOnly` only in
 * the slice-sampling fallback. Conjugate nodes (normal-normal,
 * normal-normal-offset, beta-binom, gamma-poisson) still received *posterior*
 * draws, so a prior check for an intercept such as `alpha ~ dnorm(0, 10)`
 * returned samples centred near the data mean and barely moved when the
 * declared prior mean was changed.
 */

import { describe, it, expect } from 'vitest';

import { Lexer }      from '../src/parser/lexer.js';
import { Parser }     from '../src/parser/parser.js';
import { ModelGraph } from '../src/parser/model-graph.js';
import { runGibbs }   from '../src/samplers/gibbs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a graph and run a prior-only sampler.
 *
 * @param {string} source      BUGS model text.
 * @param {Object} columns     Data columns (only used for model structure).
 * @param {Object} [opts]      { N, J, nSamples, burnin }
 * @returns {Promise<Object>}  { paramName: number[] } flattened across chains.
 */
async function priorSample(source, columns, opts = {}) {
  const {
    N = columns.y.length,
    J = 0,
    nSamples = 3000,
    burnin = 500,
  } = opts;

  const ast   = new Parser(new Lexer(source).tokenize()).parse();
  const graph = new ModelGraph(ast, { columns, N, J });
  graph.build();

  const samples = await runGibbs(graph, {
    nChains: 1,
    nSamples,
    burnin,
    thin: 1,
    priorOnly: true,
  });

  const flat = {};
  for (const [name, chains] of Object.entries(samples)) {
    flat[name] = chains.flat();
  }
  return flat;
}

/** @param {number[]} a */
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** @param {number[]} a */
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

// ---------------------------------------------------------------------------
// Fixture: a strong-signal two-group dataset, modelled on course/data/clownfish-oa.csv.
// Group means are ~19 and ~84, so any leakage of the likelihood into a prior
// check pulls the intercept towards ~19 and the treatment effect towards ~65.
// ---------------------------------------------------------------------------
const N_PER_GROUP = 20;

const clownfish = (() => {
  const y = [];
  const treatment = [];
  for (let i = 0; i < N_PER_GROUP; i++) {
    y.push(19 + (i - N_PER_GROUP / 2) * 0.4);
    treatment.push(1);
  }
  for (let i = 0; i < N_PER_GROUP; i++) {
    y.push(84 + (i - N_PER_GROUP / 2) * 0.9);
    treatment.push(2);
  }
  return { y, treatment };
})();

/**
 * Single-factor linear model with a configurable prior mean on alpha.
 * @param {number} priorMean
 */
const factorModel = (priorMean) => `model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], sigma)
    mu[i] <- alpha + beta_trt * (treatment[i] - 1)
  }
  alpha    ~ dnorm(${priorMean}, 10)
  beta_trt ~ dnorm(0, 10)
  sigma    ~ dunif(0, 100)
}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prior check recovers the declared prior', () => {
  it('returns alpha ~ dnorm(0, 10) draws centred on 0, not on the data mean', async () => {
    const s = await priorSample(factorModel(0), clownfish);

    // Prior: mean 0, SD 10. MC SE of the mean with ~3000 (autocorrelated)
    // draws is well under 1, so a tolerance of 1.5 is generous but still far
    // from the buggy value (~21, i.e. the data mean of the control group).
    expect(Math.abs(mean(s.alpha))).toBeLessThan(1.5);
    expect(sd(s.alpha)).toBeGreaterThan(8.5);
    expect(sd(s.alpha)).toBeLessThan(11.5);

    // beta_trt ~ dnorm(0, 10) must not be pulled towards the true effect (~65).
    expect(Math.abs(mean(s.beta_trt))).toBeLessThan(1.5);
    expect(sd(s.beta_trt)).toBeGreaterThan(8.5);
    expect(sd(s.beta_trt)).toBeLessThan(11.5);
  });

  it('shifts alpha draws when the declared prior mean changes', async () => {
    const low  = await priorSample(factorModel(0),   clownfish);
    const high = await priorSample(factorModel(100), clownfish);

    expect(Math.abs(mean(low.alpha) - 0)).toBeLessThan(1.5);
    expect(Math.abs(mean(high.alpha) - 100)).toBeLessThan(1.5);

    // The shift must track the change in the declared prior mean (100),
    // not be damped by the likelihood.
    expect(mean(high.alpha) - mean(low.alpha)).toBeGreaterThan(95);
    expect(mean(high.alpha) - mean(low.alpha)).toBeLessThan(105);
  });

  it('recovers a dunif prior on the normal SD', async () => {
    const s = await priorSample(factorModel(0), clownfish);
    // Uniform(0, 100): mean 50, SD 100/sqrt(12) ≈ 28.9
    expect(mean(s.sigma)).toBeGreaterThan(45);
    expect(mean(s.sigma)).toBeLessThan(55);
    expect(sd(s.sigma)).toBeGreaterThan(25);
    expect(sd(s.sigma)).toBeLessThan(32);
  });

  it('recovers a beta prior under a Bernoulli likelihood (beta-binom conjugate)', async () => {
    // Data mean is 1/3, well away from the Beta(2, 8) prior mean of 0.2.
    const y = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const s = await priorSample(
      `model {
        for (i in 1:N) { y[i] ~ dbern(p) }
        p ~ dbeta(2, 8)
      }`,
      { y }
    );
    // Beta(2, 8): mean 0.2, SD = sqrt(2*8 / (10^2 * 11)) ≈ 0.121
    expect(mean(s.p)).toBeGreaterThan(0.16);
    expect(mean(s.p)).toBeLessThan(0.24);
    expect(sd(s.p)).toBeGreaterThan(0.09);
    expect(sd(s.p)).toBeLessThan(0.15);
  });

  it('recovers a gamma prior under a Poisson likelihood (gamma-Poisson conjugate)', async () => {
    // Data mean is ~10, well away from the Gamma(9, 3) prior mean of 3.
    const y = Array.from({ length: 30 }, (_, i) => 9 + (i % 3));
    const s = await priorSample(
      `model {
        for (i in 1:N) { y[i] ~ dpois(lambda) }
        lambda ~ dgamma(9, 3)
      }`,
      { y }
    );
    // Gamma(shape 9, rate 3): mean 3, SD sqrt(9)/3 = 1
    expect(mean(s.lambda)).toBeGreaterThan(2.7);
    expect(mean(s.lambda)).toBeLessThan(3.3);
    expect(sd(s.lambda)).toBeGreaterThan(0.8);
    expect(sd(s.lambda)).toBeLessThan(1.25);
  });

  it('recovers priors in a mixed-effects model (normal-normal-offset conjugate)', async () => {
    const group = Array.from({ length: 30 }, (_, i) => (i % 5) + 1);
    const y     = Array.from({ length: 30 }, (_, i) => 20 + (i % 5) * 4);
    const s = await priorSample(
      `model {
        for (i in 1:N) {
          y[i]  ~ dnorm(mu[i], sigma)
          mu[i] <- alpha + b[group[i]]
        }
        for (j in 1:J) { b[j] ~ dnorm(0, sigma.b) }
        alpha   ~ dnorm(7, 2)
        sigma   ~ dunif(0, 10)
        sigma.b ~ dunif(0, 10)
      }`,
      { y, group },
      { J: 5 }
    );

    // alpha must follow its prior, not drift towards the data mean (~28).
    expect(mean(s.alpha)).toBeGreaterThan(6.4);
    expect(mean(s.alpha)).toBeLessThan(7.6);
    expect(sd(s.alpha)).toBeGreaterThan(1.6);
    expect(sd(s.alpha)).toBeLessThan(2.5);

    // Random effects are centred on 0 a priori.
    expect(Math.abs(mean(s['b[1]']))).toBeLessThan(1.5);
    expect(Math.abs(mean(s['b[3]']))).toBeLessThan(1.5);
  });
});
