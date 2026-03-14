/**
 * initialize.js - MCMC chain initialization for FANGS
 *
 * Initializes chains by drawing overdispersed samples from prior distributions.
 * Overdispersion (inflated variance) helps chains start in dispersed regions of
 * parameter space, which is important for diagnosing non-convergence via Rhat.
 */

import { rnorm, rgamma, rbeta, runif, rlnorm } from '../utils/distributions.js';

/**
 * Initialize MCMC chains by drawing from overdispersed priors.
 *
 * For each chain a fresh parameter object is drawn independently. Parameters
 * are sampled in graph order so that hyperparameter values are available when
 * evaluating the arguments of lower-level priors.
 *
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {number} nChains - Number of chains to initialize
 * @returns {Object[]} Array of length nChains; each element is a plain object
 *   mapping every unobserved parameter name to its initial value.
 */
export function initializeChains(graph, nChains) {
  const chains = [];
  for (let c = 0; c < nChains; c++) {
    const paramValues = {};
    const params = graph.getParameters();

    // Iteratively attempt to resolve parameters.  Some parameters' prior
    // arguments depend on other parameters (e.g. hierarchical models where a
    // hyperprior feeds into a lower-level prior). We make multiple passes so
    // that hyperparameters are initialized before they are needed.
    const remaining = new Set(params);
    const maxPasses = params.length + 1;
    let pass = 0;

    while (remaining.size > 0 && pass < maxPasses) {
      pass++;
      for (const name of [...remaining]) {
        const node = graph.nodes.get(name);
        if (!node) {
          // No node found — assign a safe default and remove.
          paramValues[name] = 1;
          remaining.delete(name);
          continue;
        }
        try {
          const value = drawFromPrior(node, paramValues, graph);
          paramValues[name] = value;
          remaining.delete(name);
        } catch (_) {
          // Prior arguments couldn't be evaluated yet; retry next pass.
        }
      }
    }

    // Anything still unresolved gets a safe fallback.
    for (const name of remaining) {
      paramValues[name] = 1;
    }

    chains.push(paramValues);
  }
  return chains;
}

/**
 * Draw a single overdispersed initial value for a parameter from its prior.
 *
 * Overdispersion strategy by distribution:
 *   - dnorm  : use half the precision (wider spread)
 *   - dgamma : use half the shape (flatter / heavier-tailed)
 *   - dbeta  : use half of both shape parameters (flatter)
 *   - dunif  : draw uniformly over the full support
 *   - dlnorm : use half the precision on the log scale
 *
 * @param {Object} node - A node from graph.nodes (must be stochastic with a distribution)
 * @param {Object} paramValues - Current values for evaluating prior parameters
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @returns {number} Initial value drawn from the overdispersed prior
 * @throws {Error} If prior parameters cannot be evaluated (caller should retry)
 */
export function drawFromPrior(node, paramValues, graph) {
  if (!node.distribution) {
    // Deterministic node — should not be called, but fall back gracefully.
    return 0;
  }

  const { name: distName, paramExprs } = node.distribution;

  // Evaluate each parameter expression using the current paramValues.
  const args = paramExprs.map((expr) => graph.evaluateExpr(expr, paramValues));

  switch (distName) {
    case 'dnorm': {
      // dnorm(mu, tau) — overdisperse by halving precision.
      const [mu, tau] = args;
      const tauOD = Math.max(tau / 2, 1e-6);
      return rnorm(mu, tauOD);
    }

    case 'dgamma': {
      // dgamma(shape, rate) — overdisperse by halving shape (flatter).
      const [shape, rate] = args;
      const shapeOD = Math.max(shape / 2, 1e-3);
      const rateOD  = Math.max(rate,  1e-6);
      return rgamma(shapeOD, rateOD);
    }

    case 'dbeta': {
      // dbeta(a, b) — overdisperse by halving both shapes.
      const [a, b] = args;
      const aOD = Math.max(a / 2, 0.5);
      const bOD = Math.max(b / 2, 0.5);
      return rbeta(aOD, bOD);
    }

    case 'dunif': {
      // dunif(lower, upper) — draw uniformly over the full range.
      const [lower, upper] = args;
      return runif(lower, upper);
    }

    case 'dlnorm': {
      // dlnorm(meanlog, preclog) — overdisperse by halving precision on log scale.
      const [meanlog, preclog] = args;
      const precOD = Math.max(preclog / 2, 1e-6);
      return rlnorm(meanlog, precOD);
    }

    case 'dbern':
    case 'dbinom': {
      // Use prior mean probability for initialization; a Beta(1,1) = Uniform draw
      // is used as overdispersion (random probability).
      return rbeta(1, 1);
    }

    case 'dpois': {
      // Poisson — initialize at a random draw from a flatter Gamma.
      const [lambda] = args;
      // Treat lambda as Gamma(shape=1, rate=1/lambda) and flatten by halving shape.
      const rate = 1 / Math.max(lambda, 1e-6);
      return rgamma(0.5, rate);
    }

    default: {
      // Unknown distribution — fall back to a wide normal centered at 0.
      return rnorm(0, 0.01);
    }
  }
}
