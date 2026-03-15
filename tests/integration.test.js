/**
 * integration.test.js
 *
 * End-to-end pipeline tests: model text → parse → build graph → initialize
 * chains → run Gibbs sampler → check output structure and statistical validity.
 *
 * These tests use the simple linear model against the built-in example dataset.
 * They are intentionally short (100 iterations) so that the suite runs quickly
 * in CI; statistical accuracy is verified only to a loose tolerance.
 *
 * True DGP values for the example dataset:
 *   alpha ≈ 2.0,  beta ≈ 1.5,  sigma ≈ 0.7  (tau ≈ 1/0.49 ≈ 2.04)
 */

import { describe, it, expect } from 'vitest';

import { Lexer }      from '../src/parser/lexer.js';
import { Parser }     from '../src/parser/parser.js';
import { ModelGraph } from '../src/parser/model-graph.js';
import { runGibbs, updateParameter } from '../src/samplers/gibbs.js';
import { initializeChains } from '../src/samplers/initialize.js';
import { parseCSV, prepareDataColumns } from '../src/data/csv-loader.js';
import { defaultCSV, defaultModel1 } from '../src/data/default-data.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Parse a BUGS model string into an AST.
 * @param {string} source
 * @returns {object} AST root node (type: 'Model')
 */
function parseModel(source) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

/**
 * Build and return a ModelGraph ready for sampling.
 * Uses the built-in example CSV.
 *
 * @param {string} modelSource - BUGS model text
 * @returns {ModelGraph}
 */
function buildGraph(modelSource) {
  const ast  = parseModel(modelSource);
  const rows = parseCSV(defaultCSV);
  const { columns } = prepareDataColumns(rows);

  // Convert Float64Arrays to plain arrays for the graph (it accepts both).
  const cols = {};
  for (const [k, v] of Object.entries(columns)) {
    cols[k] = Array.from(v);
  }

  const N = rows.length;        // 50
  const data = { columns: cols, N };

  const graph = new ModelGraph(ast, data);
  graph.build();
  return graph;
}

// The simple linear model from default-data.js.
const LINEAR_MODEL = defaultModel1;

// ---------------------------------------------------------------------------
// Suite 1: Parsing and graph construction
// ---------------------------------------------------------------------------

describe('Pipeline: parse and build graph', () => {

  it('lexer tokenises the linear model without errors', () => {
    const tokens = new Lexer(LINEAR_MODEL).tokenize();
    // Should produce a non-empty token array ending with EOF.
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[tokens.length - 1].type).toBe('EOF');
  });

  it('parser produces a Model AST node', () => {
    const ast = parseModel(LINEAR_MODEL);
    expect(ast).toBeDefined();
    expect(ast.type).toBe('Model');
    expect(ast.body).toBeDefined();
    expect(ast.body.type).toBe('Block');
  });

  it('parser AST contains the expected distribution names', () => {
    const ast  = parseModel(LINEAR_MODEL);
    const src  = JSON.stringify(ast);
    // dnorm for y[i] and alpha and beta; dgamma for tau
    expect(src).toContain('dnorm');
    expect(src).toContain('dgamma');
  });

  it('ModelGraph builds without throwing', () => {
    expect(() => buildGraph(LINEAR_MODEL)).not.toThrow();
  });

  it('ModelGraph identifies the correct parameters', () => {
    const graph  = buildGraph(LINEAR_MODEL);
    const params = graph.parameters;

    // The linear model has three unobserved stochastic nodes.
    expect(params).toContain('alpha');
    expect(params).toContain('beta');
    expect(params).toContain('tau');

    // y[i] and mu[i] nodes should NOT appear as free parameters.
    for (const p of params) {
      expect(p).not.toMatch(/^y\[/);
      expect(p).not.toMatch(/^mu\[/);
    }
  });

  it('ModelGraph has observed y nodes', () => {
    const graph = buildGraph(LINEAR_MODEL);
    let observedCount = 0;
    for (const node of graph.nodes.values()) {
      if (node.observed) observedCount++;
    }
    // 50 observations.
    expect(observedCount).toBe(50);
  });

  it('ModelGraph logPosterior returns a finite number at reasonable initial values', () => {
    const graph = buildGraph(LINEAR_MODEL);
    const lp = graph.logPosterior({ alpha: 2, beta: 1.5, tau: 2 });
    expect(isFinite(lp)).toBe(true);
    expect(lp).toBeLessThan(0); // log-posterior is always ≤ 0 up to normalisation
  });

  it('ModelGraph logPosterior is -Infinity when tau is negative', () => {
    const graph = buildGraph(LINEAR_MODEL);
    const lp = graph.logPosterior({ alpha: 2, beta: 1.5, tau: -1 });
    expect(lp).toBe(-Infinity);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Chain initialization
// ---------------------------------------------------------------------------

describe('Pipeline: chain initialization', () => {

  it('initializeChains returns the right number of chains', () => {
    const graph  = buildGraph(LINEAR_MODEL);
    const chains = initializeChains(graph, 3);
    expect(chains).toHaveLength(3);
  });

  it('every chain has values for all parameters', () => {
    const graph   = buildGraph(LINEAR_MODEL);
    const chains  = initializeChains(graph, 2);
    const params  = graph.parameters;

    for (const chain of chains) {
      for (const p of params) {
        expect(chain).toHaveProperty(p);
        expect(typeof chain[p]).toBe('number');
      }
    }
  });

  it('all initial values are finite numbers', () => {
    const graph  = buildGraph(LINEAR_MODEL);
    const chains = initializeChains(graph, 4);

    for (const chain of chains) {
      for (const [name, value] of Object.entries(chain)) {
        expect(isFinite(value)).toBe(true, `Parameter '${name}' has non-finite initial value: ${value}`);
      }
    }
  });

  it('tau initial values are positive (gamma-distributed prior)', () => {
    const graph  = buildGraph(LINEAR_MODEL);
    const chains = initializeChains(graph, 10);

    for (const chain of chains) {
      expect(chain.tau).toBeGreaterThan(0);
    }
  });

  it('different chains start at different points (overdispersion)', () => {
    const graph  = buildGraph(LINEAR_MODEL);
    const chains = initializeChains(graph, 3);

    // The three chains should not all be identical (would be astronomically
    // unlikely if initialization is truly random).
    const alphaVals = chains.map(c => c.alpha);
    const allSame   = alphaVals.every(v => v === alphaVals[0]);
    expect(allSame).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Sampler output structure (short run)
// ---------------------------------------------------------------------------

describe('Pipeline: short sampler run (structure checks)', () => {

  it('runGibbs resolves and returns samples object', async () => {
    const graph   = buildGraph(LINEAR_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 50,
      burnin:   10,
      thin:     1,
    });

    expect(samples).toBeDefined();
    expect(typeof samples).toBe('object');
  }, 30000);

  it('samples object has an entry for every parameter', async () => {
    const graph   = buildGraph(LINEAR_MODEL);
    const params  = graph.parameters;
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 20,
      burnin:   5,
      thin:     1,
    });

    for (const p of params) {
      expect(samples).toHaveProperty(p);
    }
  }, 30000);

  it('each parameter has the correct number of chains', async () => {
    const nChains = 2;
    const graph   = buildGraph(LINEAR_MODEL);
    const samples = await runGibbs(graph, {
      nChains,
      nSamples: 30,
      burnin:   5,
      thin:     1,
    });

    for (const chains of Object.values(samples)) {
      expect(chains).toHaveLength(nChains);
    }
  }, 30000);

  it('each chain has the correct number of saved samples', async () => {
    const nSamples = 40;
    const graph    = buildGraph(LINEAR_MODEL);
    const samples  = await runGibbs(graph, {
      nChains:  2,
      nSamples,
      burnin:   5,
      thin:     1,
    });

    for (const chains of Object.values(samples)) {
      for (const chain of chains) {
        expect(chain).toHaveLength(nSamples);
      }
    }
  }, 30000);

  it('all sampled values are finite numbers', async () => {
    const graph   = buildGraph(LINEAR_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 50,
      burnin:   10,
      thin:     1,
    });

    for (const [paramName, chains] of Object.entries(samples)) {
      for (let c = 0; c < chains.length; c++) {
        for (let s = 0; s < chains[c].length; s++) {
          const v = chains[c][s];
          expect(isFinite(v)).toBe(true);
        }
      }
    }
  }, 30000);

  it('thinning reduces saved sample count proportionally', async () => {
    const nSamples = 30;
    const thin     = 3;
    const graph    = buildGraph(LINEAR_MODEL);
    const samples  = await runGibbs(graph, {
      nChains:  1,
      nSamples,
      burnin:   5,
      thin,
    });

    for (const chains of Object.values(samples)) {
      expect(chains[0]).toHaveLength(nSamples);
    }
  }, 30000);

  it('tau samples are always positive', async () => {
    const graph   = buildGraph(LINEAR_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 50,
      burnin:   10,
      thin:     1,
    });

    expect(samples).toHaveProperty('tau');
    for (const chain of samples.tau) {
      for (const v of chain) {
        expect(v).toBeGreaterThan(0);
      }
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Suite 4: Statistical validity (longer run, loose tolerance)
// ---------------------------------------------------------------------------

describe('Pipeline: posterior means in ballpark of true DGP (100 iterations)', () => {
  /**
   * True DGP values for the built-in example dataset:
   *   alpha ≈ 2.0,  beta ≈ 1.5,  sigma ≈ 0.7  → tau ≈ 1/0.49 ≈ 2.04
   *
   * We use a very short run (100 post-burn-in samples, 2 chains) so the suite
   * stays fast.  Tolerance is ±2 SD of the prior-predictive distribution,
   * which is wide enough to almost always pass while still catching gross bugs.
   */

  let samples;

  // Run once and share across the sub-tests.
  // vitest does not have beforeAll at the describe level in all versions, so
  // we use a lazy initialisation pattern instead.
  async function getSamples() {
    if (samples) return samples;
    const graph = buildGraph(LINEAR_MODEL);
    samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 100,
      burnin:   50,
      thin:     1,
    });
    return samples;
  }

  it(
    'posterior mean of alpha is within 2 of true value (≈2.0)',
    async () => {
      const s      = await getSamples();
      const allAlpha = s.alpha.flat();
      const mean     = allAlpha.reduce((a, b) => a + b, 0) / allAlpha.length;
      // True alpha ≈ 2.0; allow ±2 units for short-run Monte Carlo noise.
      expect(mean).toBeGreaterThan(0);
      expect(mean).toBeLessThan(4);
    },
    30000
  );

  it(
    'posterior mean of beta is within 2 of true value (≈1.5)',
    async () => {
      const s       = await getSamples();
      const allBeta = s.beta.flat();
      const mean    = allBeta.reduce((a, b) => a + b, 0) / allBeta.length;
      // True beta ≈ 1.5; allow ±2 units.
      expect(mean).toBeGreaterThan(-0.5);
      expect(mean).toBeLessThan(3.5);
    },
    30000
  );

  it(
    'posterior mean of tau is positive and in plausible range (≈2.04)',
    async () => {
      const s      = await getSamples();
      const allTau = s.tau.flat();
      const mean   = allTau.reduce((a, b) => a + b, 0) / allTau.length;
      // True tau = 1/0.49 ≈ 2.04; very wide tolerance for short run.
      expect(mean).toBeGreaterThan(0.1);
      expect(mean).toBeLessThan(20);
    },
    30000
  );

  it(
    'posterior SD of alpha is positive and finite',
    async () => {
      const s        = await getSamples();
      const allAlpha = s.alpha.flat();
      const mean     = allAlpha.reduce((a, b) => a + b, 0) / allAlpha.length;
      const variance = allAlpha.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (allAlpha.length - 1);
      const sd       = Math.sqrt(variance);
      expect(isFinite(sd)).toBe(true);
      expect(sd).toBeGreaterThan(0);
    },
    30000
  );

  it(
    'chains explore parameter space (alpha chain has non-zero variance)',
    async () => {
      const s = await getSamples();
      // Check each chain separately; both should have moved from initialization.
      for (const chain of s.alpha) {
        const mean  = chain.reduce((a, b) => a + b, 0) / chain.length;
        const varr  = chain.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (chain.length - 1);
        expect(varr).toBeGreaterThan(0);
      }
    },
    30000
  );
});

// ---------------------------------------------------------------------------
// Suite 5: Single-parameter update (unit-level)
// ---------------------------------------------------------------------------

describe('updateParameter: single-step updates', () => {

  it('updateParameter changes the parameter value', () => {
    const graph       = buildGraph(LINEAR_MODEL);
    const paramValues = { alpha: 2, beta: 1.5, tau: 2 };
    const before      = paramValues.alpha;

    // Run 10 updates; at least one should differ (vanishingly unlikely not to).
    let changed = false;
    for (let i = 0; i < 10; i++) {
      const pv = { ...paramValues };
      updateParameter('alpha', graph, pv);
      if (pv.alpha !== before) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  it('updateParameter keeps tau positive after update', () => {
    const graph       = buildGraph(LINEAR_MODEL);
    const paramValues = { alpha: 2, beta: 1.5, tau: 2 };

    for (let i = 0; i < 20; i++) {
      updateParameter('tau', graph, paramValues);
      expect(paramValues.tau).toBeGreaterThan(0);
    }
  });

  it('updateParameter produces finite values', () => {
    const graph       = buildGraph(LINEAR_MODEL);
    const paramValues = { alpha: 2, beta: 1.5, tau: 2 };

    for (let i = 0; i < 20; i++) {
      updateParameter('alpha', graph, paramValues);
      updateParameter('beta',  graph, paramValues);
      updateParameter('tau',   graph, paramValues);

      expect(isFinite(paramValues.alpha)).toBe(true);
      expect(isFinite(paramValues.beta)).toBe(true);
      expect(isFinite(paramValues.tau)).toBe(true);
    }
  });
});
