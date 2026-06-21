import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { computePredictionGrid } from '../src/ui/predictions-plot.js';

function parseModel(src) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

function makeDraws(nDraws, fn) {
  const arr = new Float64Array(nDraws);
  for (let i = 0; i < nDraws; i++) arr[i] = fn(i);
  return arr;
}

describe('computePredictionGrid', () => {
  const LINEAR_MODEL = `model {
    for (i in 1:N) {
      y[i] ~ dnorm(mu[i], sigma)
      mu[i] <- alpha + beta * x[i]
    }
    alpha ~ dnorm(0, 5)
    beta  ~ dnorm(0, 5)
    sigma ~ dunif(0, 100)
  }`;

  it('returns N grid points for a simple linear model', () => {
    const ast    = parseModel(LINEAR_MODEL);
    const N_data = 20;
    const x = new Float64Array(N_data).map((_, i) => i / (N_data - 1));
    const y = new Float64Array(N_data).map((_, i) => 1 + 2 * x[i]);
    const nD = 80;
    const samples = {
      alpha: makeDraws(nD, () => 1 + (Math.random() - 0.5) * 0.05),
      beta:  makeDraws(nD, () => 2 + (Math.random() - 0.5) * 0.05),
      sigma: makeDraws(nD, () => 0.5),
    };

    const { xs, means, lo, hi } = computePredictionGrid({
      ast, samples, columns: { x, y }, responseVar: 'y', focalName: 'x', N: 10, nThin: 80,
    });

    expect(xs.length).toBe(10);
    expect(means.length).toBe(10);
    expect(lo.length).toBe(10);
    expect(hi.length).toBe(10);

    for (let i = 0; i < 10; i++) {
      expect(isFinite(means[i])).toBe(true);
      expect(lo[i]).toBeLessThanOrEqual(means[i] + 1e-9);
      expect(hi[i]).toBeGreaterThanOrEqual(means[i] - 1e-9);
    }

    // Predictions approximately alpha + beta * x
    expect(means[0]).toBeCloseTo(1, 0);
    expect(means[9]).toBeCloseTo(3, 0);
  });

  it('grid spans the focal covariate range', () => {
    const ast  = parseModel(LINEAR_MODEL);
    const x    = new Float64Array([0, 1, 2, 3, 4]);
    const y    = new Float64Array(5).fill(0);
    const nD   = 20;
    const samples = {
      alpha: makeDraws(nD, () => 0),
      beta:  makeDraws(nD, () => 1),
      sigma: makeDraws(nD, () => 1),
    };

    const { xs } = computePredictionGrid({
      ast, samples, columns: { x, y }, responseVar: 'y', focalName: 'x', N: 5, nThin: 20,
    });

    expect(xs[0]).toBeCloseTo(0, 5);
    expect(xs[4]).toBeCloseTo(4, 5);
  });

  it('applies log link transform when linkFn=log', () => {
    const POISSON_MODEL = `model {
      for (i in 1:N) {
        y[i] ~ dpois(mu[i])
        log(mu[i]) <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta  ~ dnorm(0, 5)
    }`;
    const ast  = parseModel(POISSON_MODEL);
    const N_d  = 10;
    const x    = new Float64Array(N_d).map((_, i) => i / (N_d - 1));
    const y    = new Float64Array(N_d).fill(5);
    const nD   = 40;
    const samples = {
      alpha: makeDraws(nD, () => 0),   // log(mu) = 0 + 1*x → mu = exp(x)
      beta:  makeDraws(nD, () => 1),
    };

    const { means: resp } = computePredictionGrid({
      ast, samples, columns: { x, y }, responseVar: 'y', focalName: 'x', N: 5, nThin: 40,
    });
    const { means: link } = computePredictionGrid({
      ast, samples, columns: { x, y }, responseVar: 'y', focalName: 'x', N: 5, nThin: 40, linkFn: 'log',
    });

    // Response scale at x=0: mu = exp(0) = 1
    expect(resp[0]).toBeCloseTo(1, 1);
    // Link scale should be log of response scale
    for (let i = 0; i < 5; i++) {
      expect(link[i]).toBeCloseTo(Math.log(resp[i]), 1);
    }
  });

  it('marginal mode produces similar means to conditional when covariate has zero mean', () => {
    const MODEL = `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + beta * x[i] + gamma * z[i]
      }
      alpha ~ dnorm(0, 5)
      beta  ~ dnorm(0, 5)
      gamma ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
    }`;
    const ast  = parseModel(MODEL);
    const N_d  = 20;
    const x    = new Float64Array(N_d).map((_, i) => i / (N_d - 1));
    // z has exact zero mean
    const z    = new Float64Array(N_d).map((_, i) => (i % 2 === 0 ? 1 : -1));
    const y    = new Float64Array(N_d).fill(0);
    const nD   = 40;
    const samples = {
      alpha: makeDraws(nD, () => 0),
      beta:  makeDraws(nD, () => 1),
      gamma: makeDraws(nD, () => 2),
      sigma: makeDraws(nD, () => 1),
    };

    const { means: cond } = computePredictionGrid({
      ast, samples, columns: { x, y, z }, responseVar: 'y', focalName: 'x',
      heldVals: { z: 0 }, N: 5, nThin: 40,
    });
    const { means: marg } = computePredictionGrid({
      ast, samples, columns: { x, y, z }, responseVar: 'y', focalName: 'x',
      N: 5, nThin: 40, marginal: true,
    });

    // Both should give similar predictions (z has zero mean so averaging ≈ holding at 0)
    for (let i = 0; i < 5; i++) {
      expect(Math.abs(cond[i] - marg[i])).toBeLessThan(0.3);
    }
  });
});
