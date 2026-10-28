/**
 * markov-blanket.test.js - phase 1 of plans/compiled-standard-sampler.md
 *
 * The standard sampler now evaluates each parameter's full conditional over
 * its Markov blanket only, against a persistent per-chain ChainState. These
 * tests check that this is exactly the full joint up to a constant, that the
 * persistent state never goes stale, and (deterministically, via work
 * counters) that a sweep no longer costs O(P · N).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MODEL_ZOO, buildZooGraph } from './fixtures/model-zoo.js';
import { installSeededRandom, mulberry32 } from './helpers/seeded-random.js';
import { ChainState } from '../src/samplers/chain-state.js';
import { initializeChains } from '../src/samplers/initialize.js';
import { updateParameterState } from '../src/samplers/gibbs.js';

afterEach(() => vi.restoreAllMocks());

const zooEntry = (name) => MODEL_ZOO.find(e => e.name === name);
const names = (nodes) => nodes.map(n => n.name);

/** Initial values with a finite log posterior (retrying overdispersed draws). */
function finiteStart(graph, logFn) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const init = initializeChains(graph, 1)[0];
    if (isFinite(logFn(init))) return init;
  }
  throw new Error('could not find a finite starting point');
}

/**
 * Assert logConditional differences equal full-joint differences for every
 * parameter, over pairs of values drawn from the (overdispersed) prior plus
 * out-of-support probes.
 */
function checkEquivalence(graph, { priorOnly, probes = [-3, 1e5] }) {
  const logFull = (pv) => (priorOnly ? graph.logPriorOnly(pv) : graph.logPosterior(pv));
  const base = finiteStart(graph, logFull);
  const state = new ChainState(graph, base, { priorOnly });

  for (const p of graph.parameters) {
    const pool = [];
    for (let k = 0; k < 20; k++) pool.push(initializeChains(graph, 1)[0][p]);
    pool.push(...probes);

    const results = pool.map((v) => {
      state.set(p, v);
      return { cond: state.logConditional(p), full: logFull({ ...base, [p]: v }) };
    });
    state.set(p, base[p]);

    for (const r of results) {
      // Other terms are finite at `base`, so the two sides must agree on -Infinity.
      if (!isFinite(r.full)) expect(r.cond, `${p}: cond should be -Infinity`).toBe(-Infinity);
      else expect(isFinite(r.cond), `${p}: cond should be finite`).toBe(true);
    }
    for (let k = 0; k + 1 < results.length; k++) {
      const a = results[k];
      const b = results[k + 1];
      if (!isFinite(a.full) || !isFinite(b.full)) continue;
      const dFull = a.full - b.full;
      const dCond = a.cond - b.cond;
      const scale = Math.max(1, Math.abs(a.full), Math.abs(b.full));
      expect(Math.abs(dFull - dCond) / scale, `${p}: ${dCond} vs ${dFull}`).toBeLessThan(1e-9);
    }
  }
}

// ── 1. Blanket structure ────────────────────────────────────────────────────

describe('Markov blanket structure', () => {
  it('b[j] in the mixed model sees exactly the rows of group j and their mu', () => {
    const entry = zooEntry('mixed');
    const graph = buildZooGraph(entry);
    const { group } = entry.data().columns;
    for (let j = 1; j <= 5; j++) {
      const rows = group.map((g, i) => (g === j ? i + 1 : null)).filter(i => i !== null);
      const blanket = graph.getBlanket(`b[${j}]`);
      expect(names(blanket.children).sort()).toEqual(rows.map(i => `y[${i}]`).sort());
      expect(names(blanket.detPath).sort()).toEqual(rows.map(i => `mu[${i}]`).sort());
      expect(blanket.priorChildren).toHaveLength(0);
    }
  });

  it('sigma sees every observation and no deterministic nodes', () => {
    const graph = buildZooGraph(zooEntry('mixed'));
    const blanket = graph.getBlanket('sigma');
    expect(blanket.children).toHaveLength(40);
    expect(blanket.children.every(n => n.observed)).toBe(true);
    expect(blanket.detPath).toHaveLength(0);
  });

  it('sigma.b sees exactly b[1..J]', () => {
    const graph = buildZooGraph(zooEntry('mixed'));
    const blanket = graph.getBlanket('sigma.b');
    expect(names(blanket.children).sort()).toEqual(['b[1]', 'b[2]', 'b[3]', 'b[4]', 'b[5]']);
    expect(names(blanket.priorChildren).sort()).toEqual(['b[1]', 'b[2]', 'b[3]', 'b[4]', 'b[5]']);
    expect(blanket.detPath).toHaveLength(0);
  });

  it('nested deterministic nodes are all in detPath, in topological order', () => {
    const graph = buildZooGraph(zooEntry('nested-deterministic'));
    const detPath = names(graph.getBlanket('alpha').detPath);
    expect(detPath).toHaveLength(60);
    for (let i = 1; i <= 30; i++) {
      expect(detPath.indexOf(`eta[${i}]`)).toBeGreaterThanOrEqual(0);
      expect(detPath.indexOf(`eta[${i}]`)).toBeLessThan(detPath.indexOf(`mu[${i}]`));
    }
  });

  it('a hyper-hyperparameter sees only the hyperparameter it bounds', () => {
    const graph = buildZooGraph(zooEntry('hyperprior-on-hyperprior'));
    expect(names(graph.getBlanket('A').children)).toEqual(['sigma.b']);
  });

  it('an index that depends on a parameter falls back to the whole model', () => {
    const graph = buildZooGraph({
      model: `model {
        for (i in 1:N) { y[i] ~ dnorm(b[round(k)], 1) }
        for (j in 1:2) { b[j] ~ dnorm(0, 5) }
        k ~ dunif(0.6, 2.4)
      }`,
      data: () => ({ columns: { y: [0.1, 0.5, -0.2, 0.9] }, N: 4 }),
    });
    expect(graph._unresolvedIndex).toBe(true);
    // The parser cannot see that y depends on b[1], b[2] or k; the fallback
    // blanket must still contain every observation.
    for (const p of ['b[1]', 'b[2]', 'k']) {
      expect(graph.getBlanket(p).children.filter(n => n.observed)).toHaveLength(4);
    }
    installSeededRandom(99);
    // No out-of-support probes: b[round(-3)] is an invalid index, which throws.
    checkEquivalence(graph, { priorOnly: false, probes: [] });
  });
});

// ── 2. Equivalence with the full joint, and expected parameters ────────────

describe.each(MODEL_ZOO.map(e => [e.name, e]))('model zoo: %s', (_name, entry) => {
  it('builds the expected parameter list', () => {
    const graph = buildZooGraph(entry);
    expect([...graph.parameters].sort()).toEqual([...entry.params].sort());
  });

  it('logConditional matches logPosterior up to a constant', () => {
    installSeededRandom(1234);
    checkEquivalence(buildZooGraph(entry), { priorOnly: false });
  });

  it('prior-only logConditional matches logPriorOnly up to a constant', () => {
    installSeededRandom(4321);
    checkEquivalence(buildZooGraph(entry), { priorOnly: true });
  });

  // ── 3. State consistency (property test) ──
  it('stays consistent with a fresh merge under random accepted/rejected sets', () => {
    installSeededRandom(777);
    const graph = buildZooGraph(entry);
    const state = new ChainState(graph, finiteStart(graph, pv => graph.logPosterior(pv)));
    const rng = mulberry32(31337);
    const params = graph.parameters;

    for (let step = 1; step <= 2000; step++) {
      const p = params[Math.floor(rng() * params.length)];
      const old = state.values[p];
      const proposal = old + (rng() - 0.5);
      state.set(p, proposal);
      if (rng() < 0.5) {
        // Rejected slice proposal: evaluate, then restore.
        state.logConditional(p);
        state.set(p, old);
      }
      if (step % 500 === 0) {
        const check = state.checkConsistency(1e-12);
        expect(check.mismatches, `step ${step}`).toEqual([]);
      }
    }
  });
});

// ── 4. Work counting ────────────────────────────────────────────────────────

describe('work per sweep', () => {
  it('a sweep of a Poisson mixed model at N=500, J=20 touches O(N) nodes per slice step', () => {
    const N = 500;
    const J = 20;
    const rng = mulberry32(2024);
    const x = [];
    const group = [];
    const y = [];
    for (let i = 0; i < N; i++) {
      x.push(rng() * 2 - 1);
      group.push((i % J) + 1);
      const lambda = Math.exp(0.5 + 0.3 * x[i] + 0.4 * Math.sin(group[i]));
      let k = 0;
      let prod = rng();
      while (prod > Math.exp(-lambda)) { k++; prod *= rng(); }
      y.push(k);
    }
    const graph = buildZooGraph({
      model: `model {
        for (i in 1:N) {
          y[i] ~ dpois(lambda[i])
          log(lambda[i]) <- alpha + beta * x[i] + b[group[i]]
        }
        for (j in 1:J) { b[j] ~ dnorm(0, sigma.b) }
        alpha ~ dnorm(0, 5)
        beta ~ dnorm(0, 5)
        sigma.b ~ dunif(0, 10)
      }`,
      data: () => ({ columns: { y, x, group }, N, J }),
    });
    const P = graph.parameters.length;
    expect(P).toBe(J + 3);

    installSeededRandom(5);
    const state = new ChainState(graph, finiteStart(graph, pv => graph.logPosterior(pv)));
    for (let s = 0; s < 3; s++) {
      for (const p of graph.parameters) updateParameterState(p, state);
    }

    let condEvals = 0;
    const original = state.logConditional.bind(state);
    state.logConditional = (p) => { condEvals++; return original(p); };
    graph._densityEvalCount = 0;
    graph._detEvalCount = 0;

    for (const p of graph.parameters) updateParameterState(p, state);

    const work = graph._densityEvalCount + graph._detEvalCount;
    const stepsPerUpdate = condEvals / P;
    // Full-joint evaluation costs ≈ P · (2N + P) work per slice step; blanket
    // evaluation costs ≈ 2 · (Σ blanket sizes) / P ≈ 2 · 3N / P. Allow 8·N.
    expect(work).toBeLessThan(8 * N * stepsPerUpdate);
    // And far below what one full-joint evaluation per slice step would cost.
    expect(work).toBeLessThan(0.25 * condEvals * (2 * N + P));
  });
});

// ── Conjugate offset update with heteroscedastic children ──────────────────

describe('normal-normal-offset update', () => {
  it('matches the exact posterior when observations have different SDs', () => {
    const y = [1.2, 0.4, 2.1, 1.7, 0.9, 1.4];
    const x = [0.1, -0.3, 0.5, 0.2, -0.1, 0.0];
    const s = [0.5, 1.0, 2.0, 0.3, 0.8, 1.5];
    const graph = buildZooGraph({
      model: `model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], s[i])
          mu[i] <- theta + x[i]
        }
        theta ~ dnorm(0, 10)
      }`,
      data: () => ({ columns: { y, x, s }, N: y.length }),
    });
    expect(graph.nodes.get('theta').conjugateType).toBe('normal-normal-offset');

    let prec = 1 / 100;
    let num = 0;
    for (let i = 0; i < y.length; i++) {
      prec += 1 / (s[i] * s[i]);
      num += (y[i] - x[i]) / (s[i] * s[i]);
    }
    const postMean = num / prec;
    const postSd = 1 / Math.sqrt(prec);

    installSeededRandom(8);
    const state = new ChainState(graph, { theta: 0 });
    const draws = [];
    for (let t = 0; t < 4000; t++) {
      updateParameterState('theta', state);
      draws.push(state.values.theta);
    }
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / (draws.length - 1));
    expect(Math.abs(mean - postMean)).toBeLessThan(4 * postSd / Math.sqrt(draws.length));
    expect(Math.abs(sd / postSd - 1)).toBeLessThan(0.05);
  });
});
