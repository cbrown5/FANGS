/**
 * blocked-sampler.test.js
 *
 * Tests for the blocked GLMM sampler (src/samplers/blocked/):
 *   1. Model compilation: which parameters become fixed coefficients,
 *      parallel families and hyperparameters, and which models are rejected.
 *   2. Update math: the Gaussian block update is an exact conditional draw,
 *      and the Newton–MH update targets the exact posterior.
 *   3. End-to-end posteriors (CPU backend) against the NIMBLE reference
 *      fixtures and against posteriors computed by numerical integration.
 *
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';

import { Lexer }      from '../src/parser/lexer.js';
import { Parser }     from '../src/parser/parser.js';
import { ModelGraph } from '../src/parser/model-graph.js';
import { parseCSV, prepareDataColumns } from '../src/data/csv-loader.js';
import {
  defaultCSV, defaultModel1, defaultModel2, defaultModel3, defaultModel4, defaultModel5,
} from '../src/data/default-data.js';
import {
  compileBlockedModel, analyzeBlockedModel, UnsupportedModelError,
} from '../src/samplers/blocked/compile-model.js';
import { CpuBlockedBackend } from '../src/samplers/blocked/cpu-backend.js';
import { runBlocked, BlockedChainState, describePlan } from '../src/samplers/blocked/blocked-sampler.js';
import { initializeChains } from '../src/samplers/initialize.js';
import { dnorm } from '../src/utils/distributions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rows = parseCSV(defaultCSV);
const { columns } = prepareDataColumns(rows);
const N = rows.length;
const J = new Set(Array.from(columns.group)).size;

function buildGraph(source) {
  const ast = new Parser(new Lexer(source).tokenize()).parse();
  const graph = new ModelGraph(ast, { columns, N, J });
  graph.build();
  return graph;
}

function mean(v) {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function sd(v) {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

function quantile(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  const i = p * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/**
 * Posterior mean and SD of (alpha, beta) by brute-force numerical
 * integration over a grid — an independent reference for 2-parameter GLMs.
 */
function gridPosterior(logPost, [a0, a1], [b0, b1], n = 241) {
  const lp = [];
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = a0 + ((a1 - a0) * i) / (n - 1);
      const b = b0 + ((b1 - b0) * j) / (n - 1);
      const v = logPost(a, b);
      lp.push([a, b, v]);
      if (v > max) max = v;
    }
  }
  let z = 0, ma = 0, mb = 0, sa = 0, sb = 0;
  for (const [a, b, v] of lp) {
    const w = Math.exp(v - max);
    z += w; ma += w * a; mb += w * b; sa += w * a * a; sb += w * b * b;
  }
  ma /= z; mb /= z;
  return {
    alpha: { mean: ma, sd: Math.sqrt(sa / z - ma * ma) },
    beta:  { mean: mb, sd: Math.sqrt(sb / z - mb * mb) },
  };
}

const POISSON_GLMM = `model {
  for (i in 1:N) {
    y_count[i] ~ dpois(lambda[i])
    log(lambda[i]) <- alpha + beta * x[i] + b[group[i]]
  }
  for (j in 1:J) { b[j] ~ dnorm(0, sigma.b) }
  alpha ~ dnorm(0, 5)
  beta ~ dnorm(0, 5)
  sigma.b ~ dunif(0, 10)
}`;

// ---------------------------------------------------------------------------
// 1. Compilation
// ---------------------------------------------------------------------------

describe('compileBlockedModel: model structure', () => {
  it('linear model → normal response, dense (alpha, beta), sigma as residual SD', () => {
    const plan = compileBlockedModel(buildGraph(defaultModel1));
    expect(plan.likelihood).toBe('normal');
    expect(plan.N).toBe(N);
    expect(plan.fixed.names).toEqual(['alpha', 'beta']);
    expect(plan.families).toHaveLength(0);
    expect(plan.hypers.map(h => h.name)).toEqual(['sigma']);
    expect(plan.hypers[0].obsSd).toBe(true);
    for (let i = 0; i < N; i++) {
      expect(plan.fixed.X[i * 2]).toBeCloseTo(1, 12);
      expect(plan.fixed.X[i * 2 + 1]).toBeCloseTo(columns.x[i], 12);
      expect(Math.abs(plan.offset[i])).toBeLessThan(1e-9);
    }
  });

  it('mixed model → b[1:J] is a parallel family with group indices from the data', () => {
    const plan = compileBlockedModel(buildGraph(defaultModel2));
    expect(plan.fixed.names).toEqual(['alpha', 'beta']);
    expect(plan.families).toHaveLength(1);
    const fam = plan.families[0];
    expect(fam.base).toBe('b');
    expect(fam.J).toBe(J);
    expect(fam.identicalPrior).toBe(true);
    for (let i = 0; i < N; i++) {
      expect(fam.gidx[i]).toBe(columns.group[i] - 1);
      expect(fam.coef[i]).toBeCloseTo(1, 12);
    }
    // CSR covers every observation exactly once.
    expect(fam.csrStart[J]).toBe(N);
    expect(new Set(fam.csrObs).size).toBe(N);

    const sigmaB = plan.hypers.find(h => h.name === 'sigma.b');
    expect(sigmaB.familyTerms).toEqual([0]);
    expect(sigmaB.obsSd).toBe(false);
    // alpha ↔ b translation move is available.
    expect(plan.translations.map(({ fixedIndex, family }) => ({ fixedIndex, family })))
      .toEqual([{ fixedIndex: 0, family: 0 }]);
    for (const w of plan.translations[0].weights) expect(w).toBeCloseTo(1, 12);
  });

  it('random slopes → c[j] is a family with coefficient x[i]; beta ↔ c translation', () => {
    const plan = compileBlockedModel(buildGraph(defaultModel5));
    expect(plan.families.map(f => f.base)).toEqual(['b', 'c']);
    const c = plan.families[1];
    for (let i = 0; i < N; i++) expect(c.coef[i]).toBeCloseTo(columns.x[i], 12);
    const pairs = plan.translations.map(({ fixedIndex, family }) => ({ fixedIndex, family }));
    expect(pairs).toContainEqual({ fixedIndex: 0, family: 0 });
    expect(pairs).toContainEqual({ fixedIndex: 1, family: 1 });
  });

  it('group-level covariate → beta ↔ b translation weighted by its group value', () => {
    // z is constant within each group (1 for odd groups, 0 for even), so
    // beta + c with b[j] − c·z_j leaves eta unchanged.
    const z = Float64Array.from(columns.group, g => g % 2);
    const ast = new Parser(new Lexer(`model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + beta * z[i] + b[group[i]]
      }
      for (j in 1:J) { b[j] ~ dnorm(0, sigma.b) }
      alpha ~ dnorm(0, 50)
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
      sigma.b ~ dunif(0, 100)
    }`).tokenize()).parse();
    const graph = new ModelGraph(ast, { columns: { ...columns, z }, N, J });
    graph.build();
    const plan = compileBlockedModel(graph);
    const t = plan.translations.find(tr => tr.fixedIndex === 1 && tr.family === 0);
    expect(t).toBeDefined();
    t.weights.forEach((w, j) => expect(w).toBeCloseTo((j + 1) % 2, 12));

    const chain = new BlockedChainState(graph, plan, initializeChains(graph, 1)[0]);
    const v = chain.vals;
    const names = plan.families[0].names;
    const etaAt = i => v.alpha + v.beta * z[i] + v[names[columns.group[i] - 1]];
    const before = Array.from({ length: N }, (_, i) => etaAt(i));
    chain.translate(chain.blockConfig());
    for (let i = 0; i < N; i++) expect(etaAt(i)).toBeCloseTo(before[i], 9);
  });

  it('Poisson GLM with log link and Bernoulli GLM with logit link', () => {
    const pois = compileBlockedModel(buildGraph(defaultModel3));
    expect(pois.likelihood).toBe('poisson');
    expect(pois.fixed.names).toEqual(['alpha', 'beta']);
    expect(Array.from(pois.y)).toEqual(Array.from(columns.y_count));

    const bern = compileBlockedModel(buildGraph(defaultModel4));
    expect(bern.likelihood).toBe('binomial');
    expect(Array.from(bern.nTrials).every(n => n === 1)).toBe(true);
  });

  it('constants in the linear predictor become an offset', () => {
    const plan = compileBlockedModel(buildGraph(`model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- 3 + beta * x[i]
      }
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
    }`));
    expect(plan.fixed.names).toEqual(['beta']);
    for (let i = 0; i < N; i++) expect(plan.offset[i]).toBeCloseTo(3, 9);
  });

  it('describePlan summarises the blocks', () => {
    const text = describePlan(compileBlockedModel(buildGraph(defaultModel2)));
    expect(text).toMatch(/normal response/);
    expect(text).toMatch(/b\[1:5\] updated in parallel/);
  });
});

describe('compileBlockedModel: unsupported models fall back with a reason', () => {
  const cases = {
    'non-linear mean': [`model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha * exp(beta * x[i])
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
    }`, /linear/],
    'non-centred random effect (product of parameters)': [`model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + b[group[i]]
      }
      for (j in 1:J) {
        z[j] ~ dnorm(0, 1)
        b[j] <- sigma.b * z[j]
      }
      alpha ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
      sigma.b ~ dunif(0, 10)
    }`, /linear/],
    'non-normal prior on a coefficient': [`model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dunif(-10, 10)
      sigma ~ dunif(0, 100)
    }`, /dnorm/],
    'probit link (not the canonical logit)': [`model {
      for (i in 1:N) {
        y_bin[i] ~ dbern(p[i])
        probit(p[i]) <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
    }`, /linear/],
  };

  for (const [name, [source, pattern]] of Object.entries(cases)) {
    it(name, () => {
      const graph = buildGraph(source);
      expect(() => compileBlockedModel(graph)).toThrow(UnsupportedModelError);
      const result = analyzeBlockedModel(graph);
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(pattern);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Update math
// ---------------------------------------------------------------------------

describe('CPU backend: block updates', () => {
  it('normal response: the fixed-block update is an exact draw from the Gaussian conditional', async () => {
    const plan = compileBlockedModel(buildGraph(defaultModel1));
    const backend = new CpuBlockedBackend(plan);
    await backend.setState({ theta: [10, -10], b: [] });

    // Analytic conditional for (alpha, beta) with sigma = 0.7 and N(0, 5²) priors.
    const sigma = 0.7;
    const iv = 1 / sigma ** 2;
    const q = 1 / 25;
    let sxx = 0, sx = 0, sy = 0, sxy = 0;
    for (let i = 0; i < N; i++) {
      const x = columns.x[i], y = columns.y[i];
      sx += x; sxx += x * x; sy += y; sxy += x * y;
    }
    const A = [[N * iv + q, sx * iv], [sx * iv, sxx * iv + q]];
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const cov = [[A[1][1] / det, -A[0][1] / det], [-A[1][0] / det, A[0][0] / det]];
    const rhs = [sy * iv, sxy * iv];
    const m = [cov[0][0] * rhs[0] + cov[0][1] * rhs[1], cov[1][0] * rhs[0] + cov[1][1] * rhs[1]];

    const cfg = { invVar: iv, fixedMean: new Float64Array(2), fixedPrec: new Float64Array([q, q]), families: [] };
    const a = [], b = [];
    for (let s = 0; s < 4000; s++) {
      const r = await backend.sweep(cfg);
      a.push(r.theta[0]);
      b.push(r.theta[1]);
    }
    expect(Math.abs(mean(a) - m[0]) / Math.sqrt(cov[0][0])).toBeLessThan(0.1);
    expect(Math.abs(mean(b) - m[1]) / Math.sqrt(cov[1][1])).toBeLessThan(0.1);
    expect(sd(a) / Math.sqrt(cov[0][0])).toBeGreaterThan(0.9);
    expect(sd(a) / Math.sqrt(cov[0][0])).toBeLessThan(1.1);
    expect(sd(b) / Math.sqrt(cov[1][1])).toBeGreaterThan(0.9);
    expect(sd(b) / Math.sqrt(cov[1][1])).toBeLessThan(1.1);
    // The very first draw already ignores the (10, -10) start: exact Gibbs.
    expect(Math.abs(a[0] - m[0])).toBeLessThan(6 * Math.sqrt(cov[0][0]));
  });

  it('Poisson response: Newton–MH targets the exact posterior (1-D check by quadrature)', async () => {
    const graph = buildGraph(`model {
      for (i in 1:N) { y_count[i] ~ dpois(lambda) }
      log(lambda) <- alpha
      alpha ~ dnorm(0, 1)
    }`);
    const plan = compileBlockedModel(graph);
    expect(plan.fixed.names).toEqual(['alpha']);

    const sumY = Array.from(columns.y_count).reduce((s, y) => s + y, 0);
    const logPost = a => sumY * a - N * Math.exp(a) - 0.5 * a * a;
    let z = 0, m1 = 0, m2 = 0;
    for (let k = 0; k <= 4000; k++) {
      const a = 0 + (4 * k) / 4000;
      const w = Math.exp(logPost(a) - logPost(Math.log(sumY / N)));
      z += w; m1 += w * a; m2 += w * a * a;
    }
    const exactMean = m1 / z;
    const exactSd = Math.sqrt(m2 / z - exactMean ** 2);

    const samples = await runBlocked(graph, { nChains: 4, nSamples: 3000, burnin: 500, plan });
    const all = samples.alpha.flat();
    expect(Math.abs(mean(all) - exactMean) / exactSd).toBeLessThan(0.1);
    expect(sd(all) / exactSd).toBeGreaterThan(0.9);
    expect(sd(all) / exactSd).toBeLessThan(1.1);
  });
});

describe('BlockedChainState: hyperparameter conditionals and translation moves', () => {
  it('the family log-prior from Σb, Σb² matches the sum of dnorm densities', () => {
    const graph = buildGraph(defaultModel2);
    const plan = compileBlockedModel(graph);
    const init = initializeChains(graph, 1)[0];
    const chain = new BlockedChainState(graph, plan, init);
    const fam = plan.families[0];
    for (const s of [0.2, 1.3, 4]) {
      chain.vals['sigma.b'] = s;
      chain._famStats[0] = null;
      const viaStats = chain._familyLogPrior(0);
      const direct = fam.names.reduce((acc, n) => acc + dnorm(init[n], 0, s), 0);
      expect(viaStats).toBeCloseTo(direct, 8);
    }
  });

  it('translation preserves alpha + b[j] and draws the shift from its Gaussian conditional', () => {
    const graph = buildGraph(POISSON_GLMM);
    const plan = compileBlockedModel(graph);
    const chain = new BlockedChainState(graph, plan, initializeChains(graph, 1)[0]);
    const v = chain.vals;
    const names = plan.families[0].names;
    // A ridge state the component-wise updates escape only slowly.
    const setRidge = () => {
      v.alpha = 11;
      v['sigma.b'] = 7;
      names.forEach((n, j) => { v[n] = -10.4 + 0.1 * j; });
    };
    setRidge();
    const before = names.map(n => v.alpha + v[n]);

    // Conditional of the shift c: alpha ~ N(0, 5²), b[j] ~ N(0, 7²).
    const qa = 1 / 25;
    const qb = 1 / 49;
    const Q = qa + names.length * qb;
    const expectedMean = (qa * (0 - 11) + names.reduce((s, n) => s + qb * v[n], 0)) / Q;

    const shifts = [];
    for (let rep = 0; rep < 4000; rep++) {
      setRidge();
      chain.translate(chain.blockConfig());
      if (rep === 0) {
        names.forEach((n, j) => expect(v.alpha + v[n]).toBeCloseTo(before[j], 9));
      }
      shifts.push(v.alpha - 11);
    }
    expect(Math.abs(mean(shifts) - expectedMean) * Math.sqrt(Q)).toBeLessThan(0.1);
    expect(sd(shifts) * Math.sqrt(Q)).toBeGreaterThan(0.95);
    expect(sd(shifts) * Math.sqrt(Q)).toBeLessThan(1.05);
    // The draw pulls the ridge back: alpha moves from 11 to near 0.
    expect(11 + expectedMean).toBeLessThan(1.5);
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end posteriors (CPU backend)
// ---------------------------------------------------------------------------

function checkAgainstReference(samples, ref, param, toleranceSDs) {
  const all = samples[param].flat();
  const diff = Math.abs(mean(all) - ref[param].mean) / ref[param].sd;
  expect(diff, `${param}: blocked mean ${mean(all).toFixed(4)} vs NIMBLE ${ref[param].mean}`)
    .toBeLessThan(toleranceSDs);
  const lo = quantile(all, 0.025);
  const hi = quantile(all, 0.975);
  expect(lo < ref[param].q97_5 && hi > ref[param].q2_5, `${param}: 95% CIs overlap`).toBe(true);
}

describe('runBlocked: linear model vs NIMBLE reference', () => {
  const ref = JSON.parse(readFileSync('tests/r-reference/results/linear-model-reference.json', 'utf8'));
  let samples;
  beforeAll(async () => {
    samples = await runBlocked(buildGraph(defaultModel1), { nChains: 3, nSamples: 2000, burnin: 500 });
  }, 60000);

  it('returns samples[param][chain] of the requested length', () => {
    expect(samples.alpha).toHaveLength(3);
    expect(samples.alpha[0]).toHaveLength(2000);
  });
  it('alpha within 0.3 SD', () => checkAgainstReference(samples, ref, 'alpha', 0.3));
  it('beta within 0.3 SD', () => checkAgainstReference(samples, ref, 'beta', 0.3));
  // As in integration.test.js: NIMBLE used a gamma prior on the precision.
  it('sigma within 0.6 SD', () => checkAgainstReference(samples, ref, 'sigma', 0.6));
});

describe('runBlocked: mixed-effects model vs NIMBLE reference', () => {
  const ref = JSON.parse(readFileSync('tests/r-reference/results/mixed-effects-reference.json', 'utf8'));
  let samples;
  beforeAll(async () => {
    const graph = buildGraph(defaultModel2.replace('sigma.b ~ dexp(1)', 'sigma.b ~ dunif(0, 100)'));
    samples = await runBlocked(graph, { nChains: 3, nSamples: 2000, burnin: 500 });
  }, 60000);

  it('alpha within 0.3 SD', () => checkAgainstReference(samples, ref, 'alpha', 0.3));
  it('beta within 0.3 SD', () => checkAgainstReference(samples, ref, 'beta', 0.3));
  it('sigma within 0.6 SD', () => checkAgainstReference(samples, ref, 'sigma', 0.6));
  it('sigma.b within 1.5 SD', () => checkAgainstReference(samples, ref, 'sigma.b', 1.5));
  for (let j = 1; j <= 5; j++) {
    it(`b[${j}] within 0.5 SD`, () => checkAgainstReference(samples, ref, `b[${j}]`, 0.5));
  }
});

describe('runBlocked: GLMs vs posteriors by numerical integration', () => {
  const x = Array.from(columns.x);
  const logPrior = (a, b) => -(a * a + b * b) / (2 * 25);

  async function check(model, logLik, ranges) {
    const exact = gridPosterior((a, b) => logLik(a, b) + logPrior(a, b), ...ranges);
    const samples = await runBlocked(buildGraph(model), { nChains: 3, nSamples: 3000, burnin: 500 });
    for (const p of ['alpha', 'beta']) {
      const all = samples[p].flat();
      expect(Math.abs(mean(all) - exact[p].mean) / exact[p].sd, `${p} mean`).toBeLessThan(0.15);
      expect(sd(all) / exact[p].sd, `${p} sd`).toBeGreaterThan(0.85);
      expect(sd(all) / exact[p].sd, `${p} sd`).toBeLessThan(1.15);
    }
  }

  it('Poisson GLM (log link)', async () => {
    const y = Array.from(columns.y_count);
    await check(defaultModel3, (a, b) => {
      let s = 0;
      for (let i = 0; i < N; i++) { const e = a + b * x[i]; s += y[i] * e - Math.exp(e); }
      return s;
    }, [[0.3, 1.5], [0.0, 1.0]]);
  }, 60000);

  it('Bernoulli GLM (logit link)', async () => {
    const y = Array.from(columns.y_bin);
    await check(defaultModel4, (a, b) => {
      let s = 0;
      for (let i = 0; i < N; i++) {
        const e = a + b * x[i];
        s += y[i] * e - (e > 0 ? e + Math.log1p(Math.exp(-e)) : Math.log1p(Math.exp(e)));
      }
      return s;
    }, [[-2.5, 2], [-0.5, 4.5]]);
  }, 60000);
});

describe('runBlocked: callbacks and stopping', () => {
  it('calls onSample once per saved draw and honours shouldStop', async () => {
    const graph = buildGraph(defaultModel2);
    let calls = 0;
    const samples = await runBlocked(graph, {
      nChains: 1, nSamples: 200, burnin: 50,
      onSample: (c, k, values) => {
        calls++;
        expect(values).toHaveProperty('sigma.b');
      },
      shouldStop: () => calls >= 100,
    });
    expect(calls).toBe(100);
    expect(samples.alpha[0]).toHaveLength(100);
  });
});
