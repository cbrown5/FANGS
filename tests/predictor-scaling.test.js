/**
 * Tests for src/data/predictor-scaling.js
 *
 * Covers:
 *  - detectScalableColumns: identifies large-scale numeric columns; ignores
 *    factors, response variables, grouping indices, already-unit-scale cols.
 *  - applyColumnScaling: zero-mean, unit-variance output.
 *  - parseBetaColumnMap: finds scalar and array slope-column pairings.
 *  - backTransformSamples: exact inverse of the scaling transform.
 */

import { describe, it, expect } from 'vitest';
import {
  detectScalableColumns,
  applyColumnScaling,
  parseBetaColumnMap,
  backTransformSamples,
} from '../src/data/predictor-scaling.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCol(values) {
  return new Float64Array(values);
}

function almostEqual(a, b, tol = 1e-9) {
  return Math.abs(a - b) < tol;
}

// ---------------------------------------------------------------------------
// detectScalableColumns
// ---------------------------------------------------------------------------

describe('detectScalableColumns', () => {
  const modelSource = `
    model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], tau)
        mu[i] <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 0.001)
      beta  ~ dnorm(0, 0.001)
      tau   ~ dgamma(0.001, 0.001)
    }
  `;

  it('detects a large-scale continuous predictor', () => {
    const columns = {
      y: makeCol([1, 2, 3, 4, 5]),
      x: makeCol([100, 200, 300, 400, 500]),
    };
    const factorMaps = {};
    const params = detectScalableColumns(columns, factorMaps, modelSource);
    expect(params).toHaveProperty('x');
    expect(params.x).toHaveProperty('mean');
    expect(params.x).toHaveProperty('sd');
  });

  it('does not scale the response variable y', () => {
    const columns = {
      y: makeCol([10, 20, 30, 40, 50]),
      x: makeCol([100, 200, 300, 400, 500]),
    };
    const params = detectScalableColumns(columns, {}, modelSource);
    expect(params).not.toHaveProperty('y');
  });

  it('does not scale factor columns', () => {
    const columns = {
      y: makeCol([1, 2, 3, 4, 5]),
      x: makeCol([100, 200, 300, 400, 500]),
      treatment: makeCol([1, 2, 1, 2, 1]),
    };
    const factorMaps = { treatment: { A: 1, B: 2 } };
    const params = detectScalableColumns(columns, factorMaps, modelSource);
    expect(params).not.toHaveProperty('treatment');
  });

  it('does not scale integer grouping-index columns', () => {
    const columns = {
      y: makeCol([1, 2, 3, 4, 5]),
      x: makeCol([100, 200, 300, 400, 500]),
      group: makeCol([1, 1, 2, 2, 3]),
    };
    const params = detectScalableColumns(columns, {}, modelSource);
    expect(params).not.toHaveProperty('group');
  });

  it('does not scale columns already on a small scale (sd <= 2)', () => {
    const columns = {
      y: makeCol([1, 2, 3, 4, 5]),
      x: makeCol([-1, -0.5, 0, 0.5, 1]),
    };
    const params = detectScalableColumns(columns, {}, modelSource);
    expect(params).not.toHaveProperty('x');
  });

  it('computes correct mean and sd', () => {
    const x = [100, 200, 300, 400, 500];
    const n = x.length;
    const mean = x.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(x.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));

    const columns = { y: makeCol([1, 2, 3, 4, 5]), x: makeCol(x) };
    const params = detectScalableColumns(columns, {}, modelSource);

    expect(almostEqual(params.x.mean, mean)).toBe(true);
    expect(almostEqual(params.x.sd, sd)).toBe(true);
  });

  it('does not scale interaction columns', () => {
    const interactionModel = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x1[i] * x2[i]
        }
        alpha ~ dnorm(0, 0.001)
        beta  ~ dnorm(0, 0.001)
        tau   ~ dgamma(0.001, 0.001)
      }
    `;
    const columns = {
      y: makeCol([1, 2, 3, 4, 5]),
      x1: makeCol([100, 200, 300, 400, 500]),
      x2: makeCol([10, 20, 30, 40, 50]),
    };
    const params = detectScalableColumns(columns, {}, interactionModel);
    expect(params).not.toHaveProperty('x1');
    expect(params).not.toHaveProperty('x2');
  });
});

// ---------------------------------------------------------------------------
// applyColumnScaling
// ---------------------------------------------------------------------------

describe('applyColumnScaling', () => {
  it('returns original columns reference when scalingParams is empty', () => {
    const columns = { x: makeCol([1, 2, 3]) };
    const result = applyColumnScaling(columns, {});
    expect(result).toBe(columns);
  });

  it('produces zero-mean, unit-variance output for the scaled column', () => {
    const xVals = [100, 200, 300, 400, 500];
    const columns = {
      y: makeCol([1, 2, 3, 4, 5]),
      x: makeCol(xVals),
    };
    const mean = 300, sd = Math.sqrt(25000); // known for arithmetic sequence
    const scalingParams = { x: { mean, sd } };
    const scaled = applyColumnScaling(columns, scalingParams);

    const xs = scaled.x;
    const xsMean = Array.from(xs).reduce((a, b) => a + b, 0) / xs.length;
    const xsSd = Math.sqrt(
      Array.from(xs).reduce((a, v) => a + (v - xsMean) ** 2, 0) / (xs.length - 1)
    );

    expect(Math.abs(xsMean)).toBeLessThan(1e-9);
    expect(Math.abs(xsSd - 1)).toBeLessThan(1e-9);
  });

  it('does not modify unscaled columns', () => {
    const columns = {
      y: makeCol([10, 20, 30]),
      x: makeCol([100, 200, 300]),
    };
    const scalingParams = { x: { mean: 200, sd: 100 } };
    const scaled = applyColumnScaling(columns, scalingParams);

    // y is unchanged
    expect(Array.from(scaled.y)).toEqual(Array.from(columns.y));
    // x is a new array
    expect(scaled.x).not.toBe(columns.x);
  });
});

// ---------------------------------------------------------------------------
// parseBetaColumnMap
// ---------------------------------------------------------------------------

describe('parseBetaColumnMap', () => {
  it('finds a scalar slope in a simple linear model', () => {
    const src = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i]
        }
      }
    `;
    const map = parseBetaColumnMap(src, new Set(['x']));
    expect(map.some(e => e.paramBase === 'beta' && e.colName === 'x')).toBe(true);
  });

  it('handles commuted form col[i] * param', () => {
    const src = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + x[i] * beta
        }
      }
    `;
    const map = parseBetaColumnMap(src, new Set(['x']));
    expect(map.some(e => e.paramBase === 'beta' && e.colName === 'x')).toBe(true);
  });

  it('returns isArray true for random slopes b[group[i]] * x[i]', () => {
    const src = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i] + b[group[i]] * x[i]
        }
      }
    `;
    const map = parseBetaColumnMap(src, new Set(['x']));
    const arrayEntry = map.find(e => e.paramBase === 'b' && e.colName === 'x');
    expect(arrayEntry).toBeDefined();
    expect(arrayEntry.isArray).toBe(true);
  });

  it('returns empty array when no scaled columns', () => {
    const src = `model { for (i in 1:N) { y[i] ~ dnorm(mu[i], tau) } }`;
    expect(parseBetaColumnMap(src, new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// backTransformSamples
// ---------------------------------------------------------------------------

describe('backTransformSamples', () => {
  // Known DGP: y = 2 + 0.05 * x  with x ~ Uniform(0, 1000)
  // mean_x = 300, sd_x = 158.11...
  // Scaled model: y = alpha_s + beta_s * x_scaled
  // Where x_scaled = (x - 300) / sd_x
  // beta_s = 0.05 * sd_x  ≈ 7.906
  // alpha_s = 2 + 0.05 * 300 = 17  (intercept at mean x = 300)

  const mean_x = 300;
  const sd_x = 100; // simplified for clean arithmetic

  // In scaled space: beta_s = 0.05 * 100 = 5,  alpha_s = 2 + 0.05 * 300 = 17
  const beta_s_vals = [5.0, 5.1, 4.9, 5.05];
  const alpha_s_vals = [17.0, 17.2, 16.8, 17.1];

  const samples = {
    alpha: alpha_s_vals,
    beta: beta_s_vals,
    tau: [0.1, 0.11, 0.09, 0.105],
  };

  const scalingParams = { x: { mean: mean_x, sd: sd_x } };

  const modelSource = `
    model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], tau)
        mu[i] <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 0.001)
      beta  ~ dnorm(0, 0.001)
      tau   ~ dgamma(0.001, 0.001)
    }
  `;

  it('back-transforms beta correctly: beta_orig = beta_s / sd_x', () => {
    const bt = backTransformSamples(samples, scalingParams, modelSource);
    for (let i = 0; i < beta_s_vals.length; i++) {
      expect(almostEqual(bt.beta[i], beta_s_vals[i] / sd_x, 1e-9)).toBe(true);
    }
  });

  it('back-transforms alpha correctly: alpha_orig = alpha_s - beta_s * mean_x / sd_x', () => {
    const bt = backTransformSamples(samples, scalingParams, modelSource);
    for (let i = 0; i < alpha_s_vals.length; i++) {
      const expected = alpha_s_vals[i] - beta_s_vals[i] * mean_x / sd_x;
      expect(almostEqual(bt.alpha[i], expected, 1e-9)).toBe(true);
    }
  });

  it('leaves tau unchanged', () => {
    const bt = backTransformSamples(samples, scalingParams, modelSource);
    for (let i = 0; i < samples.tau.length; i++) {
      expect(bt.tau[i]).toBe(samples.tau[i]);
    }
  });

  it('returns original samples when scalingParams is empty', () => {
    const bt = backTransformSamples(samples, {}, modelSource);
    expect(bt).toBe(samples);
  });

  it('recovered original-scale samples match known DGP parameters', () => {
    const bt = backTransformSamples(samples, scalingParams, modelSource);
    // beta mean ≈ 0.05
    const betaMean = bt.beta.reduce((a, b) => a + b, 0) / bt.beta.length;
    expect(Math.abs(betaMean - 0.05)).toBeLessThan(0.01);
    // alpha mean ≈ 2
    const alphaMean = bt.alpha.reduce((a, b) => a + b, 0) / bt.alpha.length;
    expect(Math.abs(alphaMean - 2)).toBeLessThan(0.1);
  });

  it('back-transforms multiple predictors correctly', () => {
    const multiModel = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta1 * x1[i] + beta2 * x2[i]
        }
        alpha  ~ dnorm(0, 0.001)
        beta1  ~ dnorm(0, 0.001)
        beta2  ~ dnorm(0, 0.001)
        tau    ~ dgamma(0.001, 0.001)
      }
    `;
    const multiParams = {
      x1: { mean: 100, sd: 50 },
      x2: { mean: 500, sd: 200 },
    };
    const multiSamples = {
      alpha:  [10.0],  // alpha_s
      beta1:  [2.5],   // beta1_s; orig = 2.5 / 50 = 0.05
      beta2:  [6.0],   // beta2_s; orig = 6.0 / 200 = 0.03
      tau:    [0.1],
    };
    // alpha correction: 2.5 * 100 / 50 + 6.0 * 500 / 200 = 5 + 15 = 20
    // alpha_orig = 10 - 20 = -10

    const bt = backTransformSamples(multiSamples, multiParams, multiModel);
    expect(almostEqual(bt.beta1[0], 0.05)).toBe(true);
    expect(almostEqual(bt.beta2[0], 0.03)).toBe(true);
    expect(almostEqual(bt.alpha[0], -10)).toBe(true);
  });

  it('handles missing parameters gracefully (no throw)', () => {
    const sparseSamples = { tau: [0.1] }; // no alpha or beta
    expect(() =>
      backTransformSamples(sparseSamples, scalingParams, modelSource)
    ).not.toThrow();
  });
});
