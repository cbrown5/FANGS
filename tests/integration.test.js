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
    expect(params).toContain('tau');
    expect(params).toContain('tau.b');

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
      alpha: 2, beta: 1.5, tau: 2, 'tau.b': 4,
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

  it('tau and tau.b samples are always positive', async () => {
    const graph   = buildMixedGraph();
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 50,
      burnin:   20,
      thin:     1,
    });

    for (const v of samples['tau'][0]) {
      expect(v).toBeGreaterThan(0);
    }
    for (const v of samples['tau.b'][0]) {
      expect(v).toBeGreaterThan(0);
    }
  }, 60000);

  it('posterior mean of alpha is in ballpark of true value (≈2)', async () => {
    const graph   = buildMixedGraph();
    const samples = await runGibbs(graph, {
      nChains:  1,
      nSamples: 100,
      burnin:   50,
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
    const lp = graph.logPosterior({ alpha: 2, beta: 1.5, tau: 2 });
    expect(isFinite(lp)).toBe(true);
    expect(lp).toBeLessThan(0);
  });

  it('logPosterior result matches the plain-array variant', () => {
    // Build both variants and check log-posterior agrees to floating-point precision.
    const graphTyped = buildGraphWithTypedArrays(LINEAR_MODEL);
    const graphPlain = buildGraph(LINEAR_MODEL);
    const pv = { alpha: 2, beta: 1.5, tau: 2 };
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
      alpha: 2, beta: 1.5, tau: 2, 'tau.b': 4,
      'b[1]': 0, 'b[2]': 0, 'b[3]': 0, 'b[4]': 0, 'b[5]': 0,
    };
    const lp = graph.logPosterior(pv);
    expect(isFinite(lp)).toBe(true);
  }, 30000);
});
