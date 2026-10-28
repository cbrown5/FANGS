/**
 * model-zoo.js - shared model fixtures for sampler equivalence tests
 *
 * Every equivalence and property test iterates over this list, so a new
 * parser or sampler feature gets tested on every evaluation path by adding
 * one entry. Each entry has:
 *
 *   name   - short identifier
 *   model  - BUGS model text
 *   data() - deterministic data object for ModelGraph ({ columns, N, ... })
 *   params - the expected unobserved parameter names
 *
 * See plans/compiled-standard-sampler.md ("Shared test infrastructure").
 */

import { Lexer } from '../../src/parser/lexer.js';
import { Parser } from '../../src/parser/parser.js';
import { ModelGraph } from '../../src/parser/model-graph.js';
import { mulberry32 } from '../helpers/seeded-random.js';

// ── Small deterministic data helpers ────────────────────────────────────────

function normalDraw(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function poissonDraw(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

function binomialDraw(rng, n, p) {
  let y = 0;
  for (let t = 0; t < n; t++) if (rng() < p) y++;
  return y;
}

const ilogit = (x) => 1 / (1 + Math.exp(-x));

/**
 * Generate predictor and grouping columns.
 * @param {number} seed
 * @param {number} N
 * @param {number} [J=5] - number of groups
 */
function baseColumns(seed, N, J = 5) {
  const rng = mulberry32(seed);
  const x = [];
  const group = [];
  for (let i = 0; i < N; i++) {
    x.push(normalDraw(rng));
    group.push((i % J) + 1);
  }
  return { rng, x, group };
}

const range = (name, n) => Array.from({ length: n }, (_, k) => `${name}[${k + 1}]`);

// ── The zoo ─────────────────────────────────────────────────────────────────

export const MODEL_ZOO = [
  {
    name: 'linear',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 50)
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
    }`,
    data() {
      const { rng, x } = baseColumns(1, 30);
      const y = x.map(xi => 1 + 0.5 * xi + 0.8 * normalDraw(rng));
      return { columns: { y, x }, N: 30 };
    },
    params: ['alpha', 'beta', 'sigma'],
  },

  {
    name: 'mixed',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + beta * x[i] + b[group[i]]
      }
      for (j in 1:J) {
        b[j] ~ dnorm(0, sigma.b)
      }
      alpha ~ dnorm(0, 50)
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
      sigma.b ~ dunif(0, 100)
    }`,
    data() {
      const { rng, x, group } = baseColumns(2, 40, 5);
      const b = [0.5, -0.3, 0.1, 0.8, -0.6];
      const y = x.map((xi, i) => 1 + 0.5 * xi + b[group[i] - 1] + 0.5 * normalDraw(rng));
      return { columns: { y, x, group }, N: 40, J: 5 };
    },
    params: ['alpha', 'beta', 'sigma', 'sigma.b', ...range('b', 5)],
  },

  {
    name: 'poisson-log',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dpois(lambda[i])
        log(lambda[i]) <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
    }`,
    data() {
      const { rng, x } = baseColumns(3, 30);
      const y = x.map(xi => poissonDraw(rng, Math.exp(0.5 + 0.4 * xi)));
      return { columns: { y, x }, N: 30 };
    },
    params: ['alpha', 'beta'],
  },

  {
    name: 'bernoulli-logit',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dbern(p[i])
        logit(p[i]) <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
    }`,
    data() {
      const { rng, x } = baseColumns(4, 30);
      const y = x.map(xi => (rng() < ilogit(0.2 + 1.0 * xi) ? 1 : 0));
      return { columns: { y, x }, N: 30 };
    },
    params: ['alpha', 'beta'],
  },

  {
    name: 'binomial-trials',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dbin(p[i], n[i])
        logit(p[i]) <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
    }`,
    data() {
      const { rng, x } = baseColumns(5, 25);
      const n = x.map((_, i) => 3 + (i % 6));
      const y = x.map((xi, i) => binomialDraw(rng, n[i], ilogit(-0.3 + 0.7 * xi)));
      return { columns: { y, x, n }, N: 25 };
    },
    params: ['alpha', 'beta'],
  },

  {
    name: 'beta-binomial',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dbin(p, n[i])
      }
      p ~ dbeta(2, 2)
    }`,
    data() {
      const rng = mulberry32(6);
      const n = Array.from({ length: 15 }, (_, i) => 5 + (i % 4));
      const y = n.map(ni => binomialDraw(rng, ni, 0.35));
      return { columns: { y, n }, N: 15 };
    },
    params: ['p'],
  },

  {
    name: 'gamma-poisson',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dpois(lambda)
      }
      lambda ~ dgamma(2, 1)
    }`,
    data() {
      const rng = mulberry32(7);
      const y = Array.from({ length: 20 }, () => poissonDraw(rng, 3));
      return { columns: { y }, N: 20 };
    },
    params: ['lambda'],
  },

  {
    name: 'lognormal-response',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dlnorm(mu[i], tau)
        mu[i] <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
      tau ~ dgamma(2, 1)
    }`,
    data() {
      const { rng, x } = baseColumns(8, 30);
      const y = x.map(xi => Math.exp(0.3 + 0.4 * xi + 0.5 * normalDraw(rng)));
      return { columns: { y, x }, N: 30 };
    },
    params: ['alpha', 'beta', 'tau'],
  },

  {
    name: 'nested-deterministic',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- 2 * eta[i]
        eta[i] <- alpha + beta * x[i]
      }
      alpha ~ dnorm(0, 5)
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 50)
    }`,
    data() {
      const { rng, x } = baseColumns(9, 30);
      const y = x.map(xi => 2 * (0.5 + 0.3 * xi) + 0.6 * normalDraw(rng));
      return { columns: { y, x }, N: 30 };
    },
    params: ['alpha', 'beta', 'sigma'],
  },

  {
    name: 'matrix-index',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(alpha + b[row[i], col[i]], sigma)
      }
      for (r in 1:R) {
        for (c in 1:C) {
          b[r, c] ~ dnorm(0, sigma.b)
        }
      }
      alpha ~ dnorm(0, 5)
      sigma ~ dunif(0, 20)
      sigma.b ~ dunif(0, 20)
    }`,
    data() {
      const rng = mulberry32(10);
      const N = 36;
      const row = Array.from({ length: N }, (_, i) => (i % 3) + 1);
      const col = Array.from({ length: N }, (_, i) => (Math.floor(i / 3) % 2) + 1);
      const y = row.map((r, i) => 1 + 0.4 * r - 0.3 * col[i] + 0.5 * normalDraw(rng));
      return { columns: { y, row, col }, N, R: 3, C: 2 };
    },
    params: ['alpha', 'sigma', 'sigma.b', 'b[1,1]', 'b[1,2]', 'b[2,1]', 'b[2,2]', 'b[3,1]', 'b[3,2]'],
  },

  {
    name: 'crossed-random-effects',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + b[group[i]] + c[site[i]]
      }
      for (j in 1:J) {
        b[j] ~ dnorm(0, sigma.b)
      }
      for (k in 1:K) {
        c[k] ~ dnorm(0, sigma.c)
      }
      alpha ~ dnorm(0, 10)
      sigma ~ dunif(0, 20)
      sigma.b ~ dunif(0, 20)
      sigma.c ~ dunif(0, 20)
    }`,
    data() {
      const { rng, group } = baseColumns(11, 36, 4);
      const site = group.map((_, i) => (Math.floor(i / 4) % 3) + 1);
      const y = group.map((g, i) => 1 + 0.3 * g - 0.2 * site[i] + 0.5 * normalDraw(rng));
      return { columns: { y, group, site }, N: 36, J: 4, K: 3 };
    },
    params: ['alpha', 'sigma', 'sigma.b', 'sigma.c', ...range('b', 4), ...range('c', 3)],
  },

  {
    name: 'random-slope',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + (beta + u[group[i]]) * x[i]
      }
      for (j in 1:J) {
        u[j] ~ dnorm(0, sigma.u)
      }
      alpha ~ dnorm(0, 10)
      beta ~ dnorm(0, 5)
      sigma ~ dunif(0, 20)
      sigma.u ~ dunif(0, 20)
    }`,
    data() {
      const { rng, x, group } = baseColumns(12, 40, 4);
      const u = [0.3, -0.2, 0.1, -0.4];
      const y = x.map((xi, i) => 1 + (0.6 + u[group[i] - 1]) * xi + 0.4 * normalDraw(rng));
      return { columns: { y, x, group }, N: 40, J: 4 };
    },
    params: ['alpha', 'beta', 'sigma', 'sigma.u', ...range('u', 4)],
  },

  {
    name: 'parameter-dependent-bounds',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(theta, 1)
      }
      theta ~ dunif(lo, lo + 5)
      lo ~ dnorm(0, 2)
    }`,
    data() {
      const rng = mulberry32(13);
      const y = Array.from({ length: 15 }, () => 1.5 + normalDraw(rng));
      return { columns: { y }, N: 15 };
    },
    params: ['theta', 'lo'],
  },

  {
    name: 'math-functions',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- a + pow(abs(b), 1.5) * x[i] + exp(c) * 0.1 + log(d) + sqrt(d) * 0.2 + inverse(d) * 0.1
      }
      a ~ dnorm(0, 5)
      b ~ dnorm(0, 2)
      c ~ dnorm(0, 1)
      d ~ dgamma(2, 2)
      sigma ~ dunif(0, 20)
    }`,
    data() {
      const { rng, x } = baseColumns(14, 30);
      const y = x.map(xi => 0.5 + 0.7 * xi + 0.5 * normalDraw(rng));
      return { columns: { y, x }, N: 30 };
    },
    params: ['a', 'b', 'c', 'd', 'sigma'],
  },

  {
    name: 'hyperprior-on-hyperprior',
    model: `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu[i], sigma)
        mu[i] <- alpha + b[group[i]]
      }
      for (j in 1:J) {
        b[j] ~ dnorm(0, sigma.b)
      }
      alpha ~ dnorm(0, 10)
      sigma ~ dunif(0, 20)
      sigma.b ~ dunif(0, A)
      A ~ dgamma(2, 0.5)
    }`,
    data() {
      const { rng, group } = baseColumns(15, 30, 5);
      const y = group.map(g => 0.5 + 0.2 * g + 0.5 * normalDraw(rng));
      return { columns: { y, group }, N: 30, J: 5 };
    },
    params: ['alpha', 'sigma', 'sigma.b', 'A', ...range('b', 5)],
  },
];

/**
 * Parse a zoo entry (or any model text + data) and return a built graph.
 * @param {{ model: string, data: () => object }} entry
 * @returns {ModelGraph}
 */
export function buildZooGraph(entry) {
  const tokens = new Lexer(entry.model).tokenize();
  const ast = new Parser(tokens).parse();
  return new ModelGraph(ast, entry.data()).build();
}
