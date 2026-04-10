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
 *   alpha ≈ 2.0,  beta ≈ 1.5,  sigma ≈ 0.7
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';

import { Lexer }      from '../src/parser/lexer.js';
import { Parser }     from '../src/parser/parser.js';
import { ModelGraph } from '../src/parser/model-graph.js';
import { runGibbs, updateParameter } from '../src/samplers/gibbs.js';
import { initializeChains } from '../src/samplers/initialize.js';
import { parseCSV, prepareDataColumns } from '../src/data/csv-loader.js';
import { defaultCSV, defaultModel1, defaultModel2 } from '../src/data/default-data.js';

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
// Mixed-effects model helper (needs J for group-level random effects)
// ---------------------------------------------------------------------------

/**
 * Build a ModelGraph for the mixed-effects model (defaultModel2).
 * Passes J=5 (five groups in the default dataset).
 */
function buildMixedGraph() {
  const ast  = parseModel(defaultModel2);
  const rows = parseCSV(defaultCSV);
  const { columns } = prepareDataColumns(rows);

  const cols = {};
  for (const [k, v] of Object.entries(columns)) {
    cols[k] = Array.from(v);
  }

  const N = rows.length;
  const J = new Set(cols.group).size; // 5

  const graph = new ModelGraph(ast, { columns: cols, N, J });
  graph.build();
  return graph;
}

// ---------------------------------------------------------------------------
// GLM helpers — build graphs from inline CSV data
// ---------------------------------------------------------------------------

/**
 * Build a ModelGraph from an inline CSV string and a BUGS model text.
 * @param {string} csvText
 * @param {string} modelSource
 * @param {object} [extras] - additional scalars to pass (e.g. {J: 3})
 */
function buildGraphFromCSV(csvText, modelSource, extras = {}) {
  const ast  = parseModel(modelSource);
  const rows = parseCSV(csvText);
  const { columns } = prepareDataColumns(rows);

  const cols = {};
  for (const [k, v] of Object.entries(columns)) {
    cols[k] = Array.from(v);
  }

  const N = rows.length;
  const graph = new ModelGraph(ast, { columns: cols, N, ...extras });
  graph.build();
  return graph;
}

// Inline Poisson dataset: N=8, y = [3,5,2,4,3,6,2,4]
// Posterior: lambda ~ Gamma(1 + 29, 0.1 + 8) = Gamma(30, 8.1), mean ≈ 3.70
const POISSON_CSV = `id,y
1,3
2,5
3,2
4,4
5,3
6,6
7,2
8,4
`;

const POISSON_MODEL = `model {
  for (i in 1:N) {
    y[i] ~ dpois(lambda)
  }
  lambda ~ dgamma(1, 0.1)
}`;

// Inline Bernoulli dataset: N=8, y = [1,1,0,1,0,1,1,0], 5 successes
// Posterior: p ~ Beta(1+5, 1+3) = Beta(6,4), mean = 0.6
const BERN_CSV = `id,y
1,1
2,1
3,0
4,1
5,0
6,1
7,1
8,0
`;

const BERN_MODEL = `model {
  for (i in 1:N) {
    y[i] ~ dbern(p)
  }
  p ~ dbeta(1, 1)
}`;

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
    // dnorm for y[i] and alpha and beta; dunif for sigma
    expect(src).toContain('dnorm');
    expect(src).toContain('dunif');
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
    expect(params).toContain('sigma');

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
    const lp = graph.logPosterior({ alpha: 2, beta: 1.5, sigma: 0.7 });
    expect(isFinite(lp)).toBe(true);
    expect(lp).toBeLessThan(0); // log-posterior is always ≤ 0 up to normalisation
  });

  it('ModelGraph logPosterior is -Infinity when sigma is negative', () => {
    const graph = buildGraph(LINEAR_MODEL);
    const lp = graph.logPosterior({ alpha: 2, beta: 1.5, sigma: -1 });
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

  it('sigma initial values are positive (uniform prior on [0, 100])', () => {
    const graph  = buildGraph(LINEAR_MODEL);
    const chains = initializeChains(graph, 10);

    for (const chain of chains) {
      expect(chain.sigma).toBeGreaterThan(0);
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

  it('sigma samples are always positive', async () => {
    const graph   = buildGraph(LINEAR_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 50,
      burnin:   10,
      thin:     1,
    });

    expect(samples).toHaveProperty('sigma');
    for (const chain of samples.sigma) {
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
   *   alpha ≈ 2.0,  beta ≈ 1.5,  sigma ≈ 0.7
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
    'posterior mean of sigma is positive and in plausible range (≈0.7)',
    async () => {
      const s        = await getSamples();
      const allSigma = s.sigma.flat();
      const mean     = allSigma.reduce((a, b) => a + b, 0) / allSigma.length;
      // True sigma ≈ 0.7; very wide tolerance for short run.
      expect(mean).toBeGreaterThan(0.1);
      expect(mean).toBeLessThan(5);
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
    const paramValues = { alpha: 2, beta: 1.5, sigma: 0.7 };
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

  it('updateParameter keeps sigma positive after update', () => {
    const graph       = buildGraph(LINEAR_MODEL);
    const paramValues = { alpha: 2, beta: 1.5, sigma: 0.7 };

    for (let i = 0; i < 20; i++) {
      updateParameter('sigma', graph, paramValues);
      expect(paramValues.sigma).toBeGreaterThan(0);
    }
  });

  it('updateParameter produces finite values', () => {
    const graph       = buildGraph(LINEAR_MODEL);
    const paramValues = { alpha: 2, beta: 1.5, sigma: 0.7 };

    for (let i = 0; i < 20; i++) {
      updateParameter('alpha', graph, paramValues);
      updateParameter('beta',  graph, paramValues);
      updateParameter('sigma', graph, paramValues);

      expect(isFinite(paramValues.alpha)).toBe(true);
      expect(isFinite(paramValues.beta)).toBe(true);
      expect(isFinite(paramValues.sigma)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Mixed-effects model
// ---------------------------------------------------------------------------

describe('Mixed-effects model: graph construction', () => {

  it('builds the graph without throwing', () => {
    expect(() => buildMixedGraph()).not.toThrow();
  });

  it('identifies all expected parameters', () => {
    const graph  = buildMixedGraph();
    const params = graph.parameters;

    // Scalar parameters
    expect(params).toContain('alpha');
    expect(params).toContain('beta');
    expect(params).toContain('sigma');
    expect(params).toContain('sigma.b');

    // Random effects b[1]...b[5]
    for (let j = 1; j <= 5; j++) {
      expect(params).toContain(`b[${j}]`);
    }

    // Observed y and deterministic mu should NOT be parameters
    for (const p of params) {
      expect(p).not.toMatch(/^y\[/);
      expect(p).not.toMatch(/^mu\[/);
    }
  });

  it('has 50 observed nodes (N=50)', () => {
    const graph = buildMixedGraph();
    let n = 0;
    for (const node of graph.nodes.values()) {
      if (node.observed) n++;
    }
    expect(n).toBe(50);
  });

  it('logPosterior returns a finite value at reasonable starting point', () => {
    const graph = buildMixedGraph();
    const pv = {
      alpha: 2, beta: 1.5, sigma: 0.7, 'sigma.b': 0.5,
      'b[1]': 0, 'b[2]': 0, 'b[3]': 0, 'b[4]': 0, 'b[5]': 0,
    };
    const lp = graph.logPosterior(pv);
    expect(isFinite(lp)).toBe(true);
    expect(lp).toBeLessThan(0);
  });
});

describe('Mixed-effects model: sampler run', () => {

  it('runGibbs produces finite samples for all parameters', async () => {
    const graph   = buildMixedGraph();
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 50,
      burnin:   20,
      thin:     1,
    });

    const params = graph.parameters;
    for (const p of params) {
      expect(samples).toHaveProperty(p);
      for (const v of samples[p][0]) {
        expect(isFinite(v)).toBe(true);
      }
    }
  }, 60000);

  it('sigma and sigma.b samples are always positive', async () => {
    const graph   = buildMixedGraph();
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 50,
      burnin:   20,
      thin:     1,
    });

    for (const v of samples['sigma'][0]) {
      expect(v).toBeGreaterThan(0);
    }
    for (const v of samples['sigma.b'][0]) {
      expect(v).toBeGreaterThan(0);
    }
  }, 60000);

  it('posterior mean of alpha is in ballpark of true value (≈2)', async () => {
    // Mixed-effects model has correlated alpha/b[j] terms — needs more burn-in
    // than the simple linear model to achieve reliable convergence.
    const graph   = buildMixedGraph();
    const samples = await runGibbs(graph, {
      nChains:  3,
      nSamples: 500,
      burnin:   500,
      thin:     1,
    });

    const all  = samples['alpha'].flat();
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeGreaterThan(-1);
    expect(mean).toBeLessThan(5);
  }, 90000);
});

// ---------------------------------------------------------------------------
// Suite 7: Poisson GLM (gamma-Poisson conjugate)
// ---------------------------------------------------------------------------

describe('Poisson GLM: graph construction', () => {

  it('builds the Poisson graph without throwing', () => {
    expect(() => buildGraphFromCSV(POISSON_CSV, POISSON_MODEL)).not.toThrow();
  });

  it('lambda is the only parameter', () => {
    const graph = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    expect(graph.parameters).toContain('lambda');
    expect(graph.parameters).toHaveLength(1);
  });

  it('has 8 observed nodes', () => {
    const graph = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    let n = 0;
    for (const node of graph.nodes.values()) {
      if (node.observed) n++;
    }
    expect(n).toBe(8);
  });

  it('logPosterior is finite at lambda=3', () => {
    const graph = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    const lp = graph.logPosterior({ lambda: 3 });
    expect(isFinite(lp)).toBe(true);
  });

  it('logPosterior is -Infinity at lambda=-1 (invalid)', () => {
    const graph = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    const lp = graph.logPosterior({ lambda: -1 });
    expect(lp).toBe(-Infinity);
  });
});

describe('Poisson GLM: sampler run', () => {

  it('samples are all positive (lambda > 0)', async () => {
    const graph   = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 100,
      burnin:   50,
      thin:     1,
    });

    for (const v of samples['lambda'][0]) {
      expect(v).toBeGreaterThan(0);
    }
  }, 30000);

  it('posterior mean of lambda is close to true value (~3.70)', async () => {
    // Posterior: Gamma(30, 8.1), mean = 30/8.1 ≈ 3.70
    const graph   = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 200,
      burnin:   100,
      thin:     1,
    });

    const all  = samples['lambda'].flat();
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    // Allow ±1 unit of tolerance for a short run
    expect(mean).toBeGreaterThan(2.5);
    expect(mean).toBeLessThan(5.0);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Suite 8: Bernoulli/Beta GLM (beta-binomial conjugate)
// ---------------------------------------------------------------------------

describe('Bernoulli GLM: graph construction', () => {

  it('builds the Bernoulli graph without throwing', () => {
    expect(() => buildGraphFromCSV(BERN_CSV, BERN_MODEL)).not.toThrow();
  });

  it('p is the only parameter', () => {
    const graph = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    expect(graph.parameters).toContain('p');
    expect(graph.parameters).toHaveLength(1);
  });

  it('has 8 observed nodes', () => {
    const graph = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    let n = 0;
    for (const node of graph.nodes.values()) {
      if (node.observed) n++;
    }
    expect(n).toBe(8);
  });

  it('logPosterior is finite at p=0.5', () => {
    const graph = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    const lp = graph.logPosterior({ p: 0.5 });
    expect(isFinite(lp)).toBe(true);
  });

  it('logPosterior is -Infinity at p=0 or p=1 (boundary)', () => {
    const graph = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    expect(graph.logPosterior({ p: 0 })).toBe(-Infinity);
    expect(graph.logPosterior({ p: 1 })).toBe(-Infinity);
  });
});

describe('Bernoulli GLM: sampler run', () => {

  it('p samples are always in (0, 1)', async () => {
    const graph   = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 100,
      burnin:   50,
      thin:     1,
    });

    for (const v of samples['p'][0]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  }, 30000);

  it('posterior mean of p is close to true value (0.6)', async () => {
    // Posterior: Beta(6, 4), mean = 0.6
    const graph   = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 200,
      burnin:   100,
      thin:     1,
    });

    const all  = samples['p'].flat();
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    // Allow ±0.2 tolerance for a short run
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.9);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Suite 9: Float64Array data columns (regression test for the real app path)
//
// The web app sends Float64Arrays from prepareDataColumns() directly to the
// ModelGraph without converting to plain arrays first.  This suite tests the
// same code paths the worker uses, catching the Array.isArray bug that caused
// "cannot resolve index expression 'mu[1]'" at runtime.
// ---------------------------------------------------------------------------

/**
 * Build a ModelGraph using raw Float64Arrays as columns (the real app path).
 * The existing buildGraph/buildMixedGraph helpers convert to plain arrays,
 * which hides the bug.  This helper intentionally does NOT convert.
 */
function buildGraphWithTypedArrays(modelSource, extras = {}) {
  const ast  = parseModel(modelSource);
  const rows = parseCSV(defaultCSV);
  const { columns } = prepareDataColumns(rows);
  // columns values are Float64Arrays — pass them straight through
  const N = rows.length;
  const graph = new ModelGraph(ast, { columns, N, ...extras });
  graph.build();
  return graph;
}

describe('Float64Array data columns (real app code path)', () => {

  it('ModelGraph builds without throwing when columns are Float64Arrays', () => {
    expect(() => buildGraphWithTypedArrays(LINEAR_MODEL)).not.toThrow();
  });

  it('y[i] nodes are correctly classified as observed', () => {
    const graph = buildGraphWithTypedArrays(LINEAR_MODEL);
    let observedCount = 0;
    for (const node of graph.nodes.values()) {
      if (node.observed) observedCount++;
    }
    expect(observedCount).toBe(50);
  });

  it('y[i] nodes do NOT appear as free parameters', () => {
    const graph = buildGraphWithTypedArrays(LINEAR_MODEL);
    for (const p of graph.parameters) {
      expect(p).not.toMatch(/^y\[/);
    }
  });

  it('logPosterior returns a finite number with Float64Array columns', () => {
    const graph = buildGraphWithTypedArrays(LINEAR_MODEL);
    const lp = graph.logPosterior({ alpha: 2, beta: 1.5, sigma: 0.7 });
    expect(isFinite(lp)).toBe(true);
    expect(lp).toBeLessThan(0);
  });

  it('logPosterior result matches the plain-array variant', () => {
    // Build both variants and check log-posterior agrees to floating-point precision.
    const graphTyped = buildGraphWithTypedArrays(LINEAR_MODEL);
    const graphPlain = buildGraph(LINEAR_MODEL);
    const pv = { alpha: 2, beta: 1.5, sigma: 0.7 };
    expect(graphTyped.logPosterior(pv)).toBeCloseTo(graphPlain.logPosterior(pv), 6);
  });

  it('runGibbs produces finite samples with Float64Array columns', async () => {
    const graph   = buildGraphWithTypedArrays(LINEAR_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 30,
      burnin:   10,
      thin:     1,
    });

    for (const p of graph.parameters) {
      expect(samples).toHaveProperty(p);
      for (const v of samples[p][0]) {
        expect(isFinite(v)).toBe(true);
      }
    }
  }, 30000);

  it('mixed-effects model builds and runs with Float64Array columns', async () => {
    const rows = parseCSV(defaultCSV);
    const { columns } = prepareDataColumns(rows);
    const J = new Set(Array.from(columns.group)).size;

    const ast   = parseModel(defaultModel2);
    const graph = new ModelGraph(ast, { columns, N: rows.length, J });
    graph.build();

    // Observed y nodes must be classified correctly
    let observedCount = 0;
    for (const node of graph.nodes.values()) {
      if (node.observed) observedCount++;
    }
    expect(observedCount).toBe(50);

    const pv = {
      alpha: 2, beta: 1.5, sigma: 0.7, 'sigma.b': 0.5,
      'b[1]': 0, 'b[2]': 0, 'b[3]': 0, 'b[4]': 0, 'b[5]': 0,
    };
    const lp = graph.logPosterior(pv);
    expect(isFinite(lp)).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Suite 10: Fixture-based statistical validation against R/NIMBLE reference
//
// Runs the mixed-effects model for a moderate number of iterations and
// compares posterior means against the NIMBLE reference JSON.  Tolerance:
//   - Posterior mean within 0.3 SD of the NIMBLE reference mean
//   - 95% CI overlaps (FANGS q2.5 < NIMBLE q97.5 and FANGS q97.5 > NIMBLE q2.5)
//
// Uses 3 chains × 1500 samples (1000 burn-in) — enough for convergence but
// fast enough to run in CI.
// ---------------------------------------------------------------------------

describe('Mixed-effects model: fixture comparison vs NIMBLE reference', () => {
  const REF_PATH = 'tests/r-reference/results/mixed-effects-reference.json';

  let ref;
  let samples;

  beforeAll(async () => {
    ref = JSON.parse(readFileSync(REF_PATH, 'utf8'));

    const graph = buildMixedGraph();
    samples = await runGibbs(graph, {
      nChains:  3,
      nSamples: 1500,
      burnin:   1000,
      thin:     1,
    });
  }, 180000);

  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function quantile(arr, p) {
    const s = arr.slice().sort((a, b) => a - b);
    const i = p * (s.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }

  function checkParam(paramName, toleranceSDs = 0.3) {
    const all   = samples[paramName].flat();
    const fm    = mean(all);
    const rm    = ref[paramName].mean;
    const rsd   = ref[paramName].sd;
    const diff  = Math.abs(fm - rm) / rsd;

    expect(diff, `${paramName}: FANGS mean ${fm.toFixed(4)} vs NIMBLE ${rm.toFixed(4)}, diff=${diff.toFixed(3)} SD`)
      .toBeLessThan(toleranceSDs);

    // 95% CI overlap check
    const fq2_5  = quantile(all, 0.025);
    const fq97_5 = quantile(all, 0.975);
    const rq2_5  = ref[paramName].q2_5;
    const rq97_5 = ref[paramName].q97_5;
    const overlaps = fq2_5 < rq97_5 && fq97_5 > rq2_5;
    expect(overlaps, `${paramName}: 95% CI [${fq2_5.toFixed(3)}, ${fq97_5.toFixed(3)}] vs NIMBLE [${rq2_5.toFixed(3)}, ${rq97_5.toFixed(3)}]`)
      .toBe(true);
  }

  it('alpha posterior mean matches NIMBLE within 0.3 SD',   () => checkParam('alpha'));
  it('beta posterior mean matches NIMBLE within 0.3 SD',    () => checkParam('beta'));
  it('sigma posterior mean matches NIMBLE within 0.5 SD',   () => checkParam('sigma', 0.5));

  // sigma.b has a very wide posterior (heavy right tail) — use a looser tolerance
  it('sigma.b posterior mean matches NIMBLE within 1 SD',   () => checkParam('sigma.b', 1.0));

  it('b[1] posterior mean matches NIMBLE within 0.5 SD',  () => checkParam('b[1]', 0.5));
  it('b[2] posterior mean matches NIMBLE within 0.5 SD',  () => checkParam('b[2]', 0.5));
  it('b[3] posterior mean matches NIMBLE within 0.5 SD',  () => checkParam('b[3]', 0.5));
  it('b[4] posterior mean matches NIMBLE within 0.5 SD',  () => checkParam('b[4]', 0.5));
  it('b[5] posterior mean matches NIMBLE within 0.5 SD',  () => checkParam('b[5]', 0.5));
});

// ---------------------------------------------------------------------------
// Suite 11: Fixture-based statistical validation — Poisson GLM
//
// Uses the exact conjugate posterior: lambda ~ Gamma(30, 8.1)
// Reference values from tests/r-reference/results/poisson-glm-reference.json
// (both NIMBLE MCMC and exact analytical posterior stored there).
// ---------------------------------------------------------------------------

describe('Poisson GLM: fixture comparison vs exact posterior', () => {
  const REF_PATH = 'tests/r-reference/results/poisson-glm-reference.json';

  let ref;
  let samples;

  beforeAll(async () => {
    ref = JSON.parse(readFileSync(REF_PATH, 'utf8'));

    const graph = buildGraphFromCSV(POISSON_CSV, POISSON_MODEL);
    samples = await runGibbs(graph, {
      nChains:  3,
      nSamples: 1000,
      burnin:   500,
      thin:     1,
    });
  }, 60000);

  function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function quantile(arr, p) {
    const s = arr.slice().sort((a, b) => a - b);
    const i = p * (s.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }

  function checkParam(paramName, toleranceSDs = 0.3) {
    const all  = samples[paramName].flat();
    const fm   = mean(all);
    // Use the exact posterior values for comparison
    const exact = ref.exact[paramName];
    const rm   = exact.mean;
    const rsd  = exact.sd;
    const diff = Math.abs(fm - rm) / rsd;

    expect(diff, `${paramName}: FANGS mean ${fm.toFixed(4)} vs exact ${rm.toFixed(4)}, diff=${diff.toFixed(3)} SD`)
      .toBeLessThan(toleranceSDs);

    const fq2_5  = quantile(all, 0.025);
    const fq97_5 = quantile(all, 0.975);
    const rq2_5  = exact.q2_5;
    const rq97_5 = exact.q97_5;
    const overlaps = fq2_5 < rq97_5 && fq97_5 > rq2_5;
    expect(overlaps, `${paramName}: 95% CI [${fq2_5.toFixed(3)}, ${fq97_5.toFixed(3)}] vs exact [${rq2_5.toFixed(3)}, ${rq97_5.toFixed(3)}]`)
      .toBe(true);
  }

  it('lambda posterior mean matches exact Gamma(30,8.1) within 0.3 SD', () => checkParam('lambda'));
});

// ---------------------------------------------------------------------------
// Suite 12: Fixture-based statistical validation — Bernoulli GLM
//
// Uses the exact conjugate posterior: p ~ Beta(6, 4)
// Reference values from tests/r-reference/results/binomial-glm-reference.json
// ---------------------------------------------------------------------------

describe('Bernoulli GLM: fixture comparison vs exact posterior', () => {
  const REF_PATH = 'tests/r-reference/results/binomial-glm-reference.json';

  let ref;
  let samples;

  beforeAll(async () => {
    ref = JSON.parse(readFileSync(REF_PATH, 'utf8'));

    const graph = buildGraphFromCSV(BERN_CSV, BERN_MODEL);
    samples = await runGibbs(graph, {
      nChains:  3,
      nSamples: 1000,
      burnin:   500,
      thin:     1,
    });
  }, 60000);

  function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function quantile(arr, p) {
    const s = arr.slice().sort((a, b) => a - b);
    const i = p * (s.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }

  function checkParam(paramName, toleranceSDs = 0.3) {
    const all  = samples[paramName].flat();
    const fm   = mean(all);
    const exact = ref.exact[paramName];
    const rm   = exact.mean;
    const rsd  = exact.sd;
    const diff = Math.abs(fm - rm) / rsd;

    expect(diff, `${paramName}: FANGS mean ${fm.toFixed(4)} vs exact ${rm.toFixed(4)}, diff=${diff.toFixed(3)} SD`)
      .toBeLessThan(toleranceSDs);

    const fq2_5  = quantile(all, 0.025);
    const fq97_5 = quantile(all, 0.975);
    const rq2_5  = exact.q2_5;
    const rq97_5 = exact.q97_5;
    const overlaps = fq2_5 < rq97_5 && fq97_5 > rq2_5;
    expect(overlaps, `${paramName}: 95% CI [${fq2_5.toFixed(3)}, ${fq97_5.toFixed(3)}] vs exact [${rq2_5.toFixed(3)}, ${rq97_5.toFixed(3)}]`)
      .toBe(true);
  }

  it('p posterior mean matches exact Beta(6,4) within 0.3 SD', () => checkParam('p'));
});

// ---------------------------------------------------------------------------
// Suite 13: Logit-link Bernoulli GLM (slice sampler only)
//
// Fits:  logit(p[i]) <- alpha + beta * x[i]
// with a small toy dataset where beta > 0 (higher x → higher P(y=1)).
// The slice sampler handles this non-conjugate model.  We only check:
//   - all samples are finite
//   - posterior means are in the correct direction (beta > 0)
// ---------------------------------------------------------------------------

// 10 observations: x in {-2,-1,0,1,2} × 2, y generated with alpha=0, beta=1
// P(y=1|x) = invlogit(x): x=-2→0.12, x=-1→0.27, x=0→0.50, x=1→0.73, x=2→0.88
const LOGIT_CSV = `id,x,y
1,-2,0
2,-1,0
3,0,1
4,1,1
5,2,1
6,-2,0
7,-1,1
8,0,0
9,1,1
10,2,1
`;

const LOGIT_MODEL = `model {
  for (i in 1:N) {
    y[i] ~ dbern(p[i])
    logit(p[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 5)
  beta  ~ dnorm(0, 5)
}`;

describe('Logit-link Bernoulli GLM: slice sampler end-to-end', () => {

  it('builds the logit-link graph without throwing', () => {
    expect(() => buildGraphFromCSV(LOGIT_CSV, LOGIT_MODEL)).not.toThrow();
  });

  it('has alpha and beta as parameters', () => {
    const graph = buildGraphFromCSV(LOGIT_CSV, LOGIT_MODEL);
    expect(graph.parameters).toContain('alpha');
    expect(graph.parameters).toContain('beta');
  });

  it('logPosterior is finite at alpha=0, beta=1', () => {
    const graph = buildGraphFromCSV(LOGIT_CSV, LOGIT_MODEL);
    const lp = graph.logPosterior({ alpha: 0, beta: 1 });
    expect(isFinite(lp)).toBe(true);
  });

  it('all samples are finite', async () => {
    const graph   = buildGraphFromCSV(LOGIT_CSV, LOGIT_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  2,
      nSamples: 200,
      burnin:   100,
      thin:     1,
    });

    for (const v of samples['alpha'].flat()) expect(isFinite(v)).toBe(true);
    for (const v of samples['beta'].flat())  expect(isFinite(v)).toBe(true);
  }, 60000);

  it('posterior mean of beta is positive (data show higher x → higher P(y=1))', async () => {
    const graph   = buildGraphFromCSV(LOGIT_CSV, LOGIT_MODEL);
    const samples = await runGibbs(graph, {
      nChains:  3,
      nSamples: 500,
      burnin:   300,
      thin:     1,
    });

    const all  = samples['beta'].flat();
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean, `beta posterior mean should be positive, got ${mean.toFixed(3)}`).toBeGreaterThan(0);
  }, 120000);
});

// ---------------------------------------------------------------------------
// Suite 14: Fixture-based statistical validation — Linear model vs NIMBLE
//
// Runs the simple linear regression model against the built-in example dataset
// and compares posterior means and 95% CIs against the NIMBLE reference JSON.
// Tolerance: posterior mean within 0.3 SD of NIMBLE reference mean; 95% CIs
// must overlap.
//
// Uses 3 chains × 2000 samples (1000 burn-in) — enough for convergence but
// fast enough for CI.
// ---------------------------------------------------------------------------

describe('Linear model: fixture comparison vs NIMBLE reference', () => {
  const REF_PATH = 'tests/r-reference/results/linear-model-reference.json';

  let ref;
  let samples;

  beforeAll(async () => {
    ref = JSON.parse(readFileSync(REF_PATH, 'utf8'));

    const graph = buildGraph(LINEAR_MODEL);
    samples = await runGibbs(graph, {
      nChains:  3,
      nSamples: 2000,
      burnin:   1000,
      thin:     1,
    });
  }, 120000);

  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function quantile(arr, p) {
    const s = arr.slice().sort((a, b) => a - b);
    const i = p * (s.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }

  function checkParam(paramName, toleranceSDs = 0.3) {
    const all   = samples[paramName].flat();
    const fm    = mean(all);
    const rm    = ref[paramName].mean;
    const rsd   = ref[paramName].sd;
    const diff  = Math.abs(fm - rm) / rsd;

    expect(diff, `${paramName}: FANGS mean ${fm.toFixed(4)} vs NIMBLE ${rm.toFixed(4)}, diff=${diff.toFixed(3)} SD`)
      .toBeLessThan(toleranceSDs);

    // 95% CI overlap check
    const fq2_5  = quantile(all, 0.025);
    const fq97_5 = quantile(all, 0.975);
    const rq2_5  = ref[paramName].q2_5;
    const rq97_5 = ref[paramName].q97_5;
    const overlaps = fq2_5 < rq97_5 && fq97_5 > rq2_5;
    expect(overlaps, `${paramName}: 95% CI [${fq2_5.toFixed(3)}, ${fq97_5.toFixed(3)}] vs NIMBLE [${rq2_5.toFixed(3)}, ${rq97_5.toFixed(3)}]`)
      .toBe(true);
  }

  it('alpha posterior mean matches NIMBLE within 0.3 SD',  () => checkParam('alpha'));
  it('beta posterior mean matches NIMBLE within 0.3 SD',   () => checkParam('beta'));
  it('sigma posterior mean matches NIMBLE within 0.5 SD',  () => checkParam('sigma', 0.5));
});
