/**
 * gibbs.js - Component-wise Gibbs sampler for FANGS
 *
 * Orchestrates the main MCMC loop. Each iteration updates every unobserved
 * parameter in a randomly shuffled order. Parameters with recognized conjugate
 * structures receive exact conjugate updates; all others fall back to the
 * univariate slice sampler.
 *
 * References:
 *   Gelfand & Smith (1990) "Sampling-Based Approaches to Calculating Marginal
 *     Densities", JASA 85(410).
 *   Neal (2003) "Slice Sampling", Annals of Statistics 31(3).
 */

import { initializeChains } from './initialize.js';
import { sliceSample }      from './slice.js';
import * as dist            from '../utils/distributions.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a component-wise Gibbs sampler across multiple independent chains.
 *
 * The sampler yields control back to the event loop every ~100 iterations
 * (via `setTimeout(resolve, 0)`) so that live-updating UIs remain responsive.
 *
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} settings
 * @param {number}   settings.nChains  - Number of parallel chains.
 * @param {number}   settings.nSamples - Number of post-burn-in samples to save per chain.
 * @param {number}   settings.burnin   - Number of burn-in iterations (discarded).
 * @param {number}   settings.thin     - Thinning interval (save every `thin`-th post-burnin draw).
 * @param {Function} [settings.onSample]   - Callback(chainIdx, sampleIdx, paramValues) invoked
 *   for every saved sample. `paramValues` is a shallow copy — safe to store.
 * @param {Function} [settings.onProgress] - Callback({ iter, total, chainIdx }) for
 *   progress reporting; called roughly every 100 iterations.
 * @param {Object}   [settings.stopSignal] - If provided, sampling halts when
 *   `stopSignal.stop === true`.
 * @returns {Promise<Object>} Resolves to `{ paramName: number[][] }` where the
 *   outer array is indexed by chain and the inner array holds saved samples.
 */
export async function runGibbs(graph, settings) {
  const {
    nChains  = 1,
    nSamples = 1000,
    burnin   = 500,
    thin     = 1,
    priorOnly  = false,
    onSample    = null,
    onProgress  = null,
    shouldStop  = null,
  } = settings;

  const params = graph.parameters;

  // Allocate result containers: samples[paramName][chainIdx][sampleIdx]
  // We store as chains × samples so callers can slice per-chain easily.
  /** @type {Object.<string, number[][]>} */
  const samples = {};
  for (const p of params) {
    samples[p] = Array.from({ length: nChains }, () => []);
  }

  // Initialize all chains.
  const chains = initializeChains(graph, nChains);

  const totalIters = burnin + nSamples * thin;
  const UI_YIELD_INTERVAL = 100; // yield to event loop every N iterations

  for (let c = 0; c < nChains; c++) {
    const paramValues = chains[c];
    let savedCount = 0;

    for (let iter = 0; iter < totalIters; iter++) {
      // Yield to the event loop periodically to keep the UI responsive.
      if (iter % UI_YIELD_INTERVAL === 0) {
        await yieldToUI();
        if (onProgress) {
          onProgress(c, iter, totalIters, { ...paramValues });
        }
      }

      // Check for external stop request.
      if (shouldStop && shouldStop()) {
        return samples;
      }

      // One full Gibbs sweep in random parameter order.
      const order = shuffled(params);
      for (const paramName of order) {
        updateParameter(paramName, graph, paramValues, { priorOnly });
      }

      // Determine whether this iteration is a saved sample.
      const isBurnin = iter < burnin;
      const postBurninIter = iter - burnin; // negative during burn-in
      const isSaved = !isBurnin && (postBurninIter % thin === 0);

      if (isSaved) {
        for (const p of params) {
          samples[p][c].push(paramValues[p]);
        }
        if (onSample) {
          // Pass a shallow copy so the callback can safely store it.
          onSample(c, savedCount, { ...paramValues });
        }
        savedCount++;
      }
    }
  }

  return samples;
}

/**
 * Update a single parameter in place using the best available sampler.
 *
 * Strategy (in order of preference):
 *   1. Conjugate normal-normal update (if `node.conjugateType === 'normal-normal'`)
 *   2. Conjugate gamma-on-precision update (if `node.conjugateType === 'gamma-precision'`)
 *   3. Conjugate beta-binom update (if `node.conjugateType === 'beta-binom'`)
 *   4. Conjugate gamma-Poisson update (if `node.conjugateType === 'gamma-poisson'`)
 *   5. Slice sampling fallback
 *
 * @param {string} paramName - Name of the parameter to update.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current parameter values (mutated in place).
 */
export function updateParameter(paramName, graph, paramValues, options = {}) {
  const node = graph.nodes.get(paramName);
  if (!node) return;

  // Ensure the parameter is present in paramValues (use 1 as safe default).
  if (!(paramName in paramValues)) {
    paramValues[paramName] = 1;
  }

  // Attempt conjugate updates first.
  switch (node.conjugateType) {
    case 'normal-normal':
      paramValues[paramName] = conjugateNormalNormal(node, graph, paramValues);
      return;

    case 'normal-normal-offset':
      paramValues[paramName] = conjugateNormalNormalOffset(node, graph, paramValues);
      return;

    case 'gamma-normal':
      paramValues[paramName] = conjugateGammaOnPrecision(node, graph, paramValues);
      return;

    case 'beta-binom':
      paramValues[paramName] = conjugateBetaBinom(node, graph, paramValues);
      return;

    case 'gamma-poisson':
      paramValues[paramName] = conjugateGammaPoisson(node, graph, paramValues);
      return;

    default:
      break;
  }

  // Fall back to slice sampling.
  // Determine support bounds for constrained parameters.
  const { lower, upper } = getParameterBounds(node);

  const currentValue = paramValues[paramName];

  // Build the log full-conditional.
  const logFn = options.priorOnly
    ? (pv) => graph.logPriorOnly(pv)
    : (pv) => graph.logPosterior(pv);
  const logFC = (value) => {
    const testValues = { ...paramValues, [paramName]: value };
    return logFn(testValues);
  };

  paramValues[paramName] = sliceSample(paramName, currentValue, logFC, {
    w: computeSliceWidth(node, paramValues, graph),
    maxSteps: 20,
    lower,
    upper,
  });
}

// ---------------------------------------------------------------------------
// Conjugate samplers
// ---------------------------------------------------------------------------

/**
 * Conjugate normal-normal posterior update.
 *
 * Assumes:
 *   Prior:      theta ~ Normal(mu0, tau0)      [tau0 = precision]
 *   Likelihood: y_i  ~ Normal(theta, tau_lik)  for each child observation
 *
 * Posterior:
 *   tau_n = tau0 + n * tau_lik
 *   mu_n  = (tau0 * mu0 + tau_lik * sum(y_i)) / tau_n
 *   theta | data ~ Normal(mu_n, tau_n)
 *
 * In the mixed-effects case `theta` may enter as a linear offset inside mu_i
 * rather than directly as the mean. This implementation handles the simple
 * case where the node is the direct mean parameter. The graph's conjugateType
 * annotation is expected to flag only the straightforward cases.
 *
 * @param {Object} node - Stochastic node for the parameter.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current values.
 * @returns {number} Posterior draw.
 */
export function conjugateNormalNormal(node, graph, paramValues) {
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExpr(e, paramValues)
  );
  const mu0  = priorArgs[0];
  const tau0 = Math.max(priorArgs[1], 1e-10);

  // Collect child observations and their precision.
  const { sumY, n, tauLik } = collectNormalChildren(node, graph, paramValues);

  const tauN = tau0 + n * tauLik;
  const muN  = (tau0 * mu0 + tauLik * sumY) / tauN;

  return dist.rnorm(muN, tauN);
}

/**
 * Conjugate normal-normal update for a node that enters the mean of Normal
 * observations linearly through a deterministic node.
 *
 * Handles both pure additive offsets (random effects: b[j]) and slope
 * parameters (beta with coefficient x[i]), using numerical differentiation
 * to determine the per-observation coefficient c[i] = ∂mu[i]/∂θ.
 *
 * Full conditional for θ ~ dnorm(mu0, tau0):
 *   c[i]    = ∂mu[i]/∂θ  (computed by numerical perturbation)
 *   sumWtResid = Σ c[i] * (y[i] - mu_without[i])
 *   sumWtSq    = Σ c[i]^2
 *   tau_n   = tau0 + tau * sumWtSq
 *   mu_n    = (tau0 * mu0 + tau * sumWtResid) / tau_n
 *
 * @param {Object} node - Stochastic node for θ.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current values.
 * @returns {number} Posterior draw.
 */
export function conjugateNormalNormalOffset(node, graph, paramValues) {
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExpr(e, paramValues)
  );
  const mu0  = priorArgs[0];
  const tau0 = Math.max(priorArgs[1], 1e-10);

  const theta   = paramValues[node.name];
  const eps     = Math.max(Math.abs(theta) * 1e-5, 1e-7);

  let sumWtResid = 0;
  let sumWtSq    = 0;
  let tauLik     = tau0; // fallback — overwritten by first matching child

  // Find all observed dnorm children that depend on this node.
  for (const [, child] of graph.nodes) {
    if (!child.observed) continue;
    if (child.distribution?.name !== 'dnorm') continue;

    const meanExpr = child.distribution.paramExprs[0];
    if (!meanExprDependsOn(meanExpr, node.name, graph, paramValues)) continue;

    const y = resolveObservedValue(child, paramValues);
    if (y === null) continue;

    tauLik = Math.max(
      graph.evaluateExpr(child.distribution.paramExprs[1], paramValues),
      1e-10
    );

    // Coefficient c[i] = ∂mu[i]/∂θ via central differences.
    const pvPlus  = { ...paramValues, [node.name]: theta + eps };
    const pvMinus = { ...paramValues, [node.name]: theta - eps };
    const muPlus  = graph.evaluateExpr(meanExpr, pvPlus);
    const muMinus = graph.evaluateExpr(meanExpr, pvMinus);
    const ci      = (muPlus - muMinus) / (2 * eps);

    if (!isFinite(ci) || Math.abs(ci) < 1e-14) continue;

    // Partial mean (excluding θ's contribution): mu_without = mu - c[i]*θ
    const muFull    = graph.evaluateExpr(meanExpr, paramValues);
    const muWithout = muFull - ci * theta;

    sumWtResid += ci * (y - muWithout);
    sumWtSq    += ci * ci;
  }

  const tauN = tau0 + tauLik * sumWtSq;
  const muN  = (tau0 * mu0 + tauLik * sumWtResid) / tauN;

  return dist.rnorm(muN, tauN);
}

/**
 * Check whether a mean expression (possibly an Identifier referencing a
 * deterministic node like mu[i]) ultimately depends on a given parameter name.
 *
 * Uses the graph's pre-computed parents list for deterministic nodes, which
 * correctly handles indirect index expressions like b[group[i]].
 *
 * @param {object} meanExpr - AST expression for the mean.
 * @param {string} paramName - The parameter to check for.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {object} paramValues
 * @returns {boolean}
 */
function meanExprDependsOn(meanExpr, paramName, graph, paramValues) {
  // Fast path: the expression directly references paramName (scalar case).
  if (exprReferencesVar(meanExpr, paramName)) return true;

  // If meanExpr is a single node reference (Identifier or IndexExpr), check
  // if that deterministic node's parents list includes our paramName.
  // Using parents list (not AST traversal) correctly handles indexed expressions
  // like b[group[i]] where the resolved parent is b[1], b[2], etc.
  const refName = extractSingleNodeRef(meanExpr);
  if (refName) {
    const refNode = graph.nodes.get(refName);
    if (refNode && refNode.type === 'deterministic') {
      return refNode.parents.includes(paramName);
    }
  }

  return false;
}

/**
 * If an expression is a simple node reference (Identifier or IndexExpr with
 * numeric indices), return the canonical node name string. Otherwise null.
 *
 * @param {object} expr
 * @returns {string|null}
 */
function extractSingleNodeRef(expr) {
  if (!expr) return null;
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'IndexExpr') {
    // Indices should already be NumberLiterals (loop vars substituted)
    const base = expr.object?.name ?? expr.name;
    const indices = expr.indices.map(i => i.type === 'NumberLiteral' ? i.value : null);
    if (indices.every(v => v !== null)) {
      return `${base}[${indices.join(',')}]`;
    }
  }
  return null;
}

/**
 * Conjugate Gamma update for a precision (tau) parameter.
 *
 * Assumes:
 *   Prior:      tau ~ Gamma(a0, b0)             [shape, rate]
 *   Likelihood: y_i ~ Normal(mu_i, tau)  for n observations
 *
 * Posterior:
 *   tau | data ~ Gamma(a0 + n/2, b0 + sum((y_i - mu_i)^2) / 2)
 *
 * @param {Object} node - Stochastic node for tau.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current values.
 * @returns {number} Posterior draw.
 */
export function conjugateGammaOnPrecision(node, graph, paramValues) {
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExpr(e, paramValues)
  );
  const a0 = Math.max(priorArgs[0], 1e-10);
  const b0 = Math.max(priorArgs[1], 1e-10);

  const { sumSqResid, n } = collectNormalChildResiduals(node, graph, paramValues);

  const aN = a0 + n / 2;
  const bN = b0 + sumSqResid / 2;

  return dist.rgamma(aN, Math.max(bN, 1e-10));
}

/**
 * Conjugate Beta update for a probability parameter.
 *
 * Assumes:
 *   Prior:      p ~ Beta(a, b)
 *   Likelihood: y_i ~ Bernoulli(p)  OR  y_i ~ Binomial(n_i, p)
 *
 * Posterior:
 *   p | data ~ Beta(a + sum_successes, b + sum_failures)
 *
 * @param {Object} node - Stochastic node for p.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current values.
 * @returns {number} Posterior draw.
 */
export function conjugateBetaBinom(node, graph, paramValues) {
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExpr(e, paramValues)
  );
  const a = Math.max(priorArgs[0], 1e-10);
  const b = Math.max(priorArgs[1], 1e-10);

  let sumSuccesses = 0;
  let sumFailures  = 0;

  for (const [, child] of graph.nodes) {
    if (!child.observed) continue;
    const childDist = child.distribution?.name;
    if (childDist !== 'dbern' && childDist !== 'dbin' && childDist !== 'dbinom') continue;

    // Check that this node's probability parameter refers to our node.
    if (!distributionUsesParam(child, node.name, 0)) continue;

    const y = resolveObservedValue(child, paramValues);
    if (y === null) continue;

    if (childDist === 'dbern') {
      sumSuccesses += y;
      sumFailures  += 1 - y;
    } else {
      // dbin / dbinom(prob, size) — JAGS convention: dbin(p, n)
      const nTrials = graph.evaluateExpr(child.distribution.paramExprs[1], paramValues);
      sumSuccesses += y;
      sumFailures  += nTrials - y;
    }
  }

  return dist.rbeta(a + sumSuccesses, b + sumFailures);
}

/**
 * Conjugate Gamma update for a Poisson rate parameter.
 *
 * Assumes:
 *   Prior:      lambda ~ Gamma(a, b)   [shape, rate]
 *   Likelihood: y_i ~ Poisson(lambda)
 *
 * Posterior:
 *   lambda | data ~ Gamma(a + sum(y_i), b + n)
 *
 * @param {Object} node - Stochastic node for lambda.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current values.
 * @returns {number} Posterior draw.
 */
export function conjugateGammaPoisson(node, graph, paramValues) {
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExpr(e, paramValues)
  );
  const a = Math.max(priorArgs[0], 1e-10);
  const b = Math.max(priorArgs[1], 1e-10);

  let sumY = 0;
  let n    = 0;

  for (const [, child] of graph.nodes) {
    if (!child.observed) continue;
    if (child.distribution?.name !== 'dpois') continue;
    if (!distributionUsesParam(child, node.name, 0)) continue;

    const y = resolveObservedValue(child, paramValues);
    if (y === null) continue;

    sumY += y;
    n++;
  }

  return dist.rgamma(a + sumY, b + n);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect summary statistics from Normal-likelihood children of a node
 * that is used as the mean parameter.
 *
 * @param {Object} node
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues
 * @returns {{ sumY: number, n: number, tauLik: number }}
 */
function collectNormalChildren(node, graph, paramValues) {
  let sumY   = 0;
  let n      = 0;
  let tauLik = 1; // default; overwritten by first child found

  for (const [, child] of graph.nodes) {
    if (!child.observed) continue;
    if (child.distribution?.name !== 'dnorm') continue;

    // Check that the first parameter (mean) evaluates to or references our node.
    if (!distributionUsesParam(child, node.name, 0)) continue;

    const y = resolveObservedValue(child, paramValues);
    if (y === null) continue;

    // Precision is the second argument.
    tauLik = Math.max(
      graph.evaluateExpr(child.distribution.paramExprs[1], paramValues),
      1e-10
    );
    sumY += y;
    n++;
  }

  return { sumY, n, tauLik };
}

/**
 * Collect sum of squared residuals from Normal-likelihood children of a
 * precision (tau) node.
 *
 * @param {Object} node
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues
 * @returns {{ sumSqResid: number, n: number }}
 */
function collectNormalChildResiduals(node, graph, paramValues) {
  let sumSqResid = 0;
  let n          = 0;

  for (const [, child] of graph.nodes) {
    // Include both observed nodes (e.g. y[i] ~ dnorm(mu[i], tau)) AND
    // unobserved stochastic nodes (e.g. b[j] ~ dnorm(0, tau.b)).
    if (child.type !== 'observed' && child.type !== 'stochastic') continue;
    if (child.distribution?.name !== 'dnorm') continue;

    // Tau (precision) is the second argument — check it references our node.
    if (!distributionUsesParam(child, node.name, 1)) continue;

    // Get the current value: observed nodes have a fixed value; latent
    // stochastic nodes have their current sampled value in paramValues.
    let y;
    if (child.observed) {
      y = resolveObservedValue(child, paramValues);
    } else {
      y = paramValues[child.name];
      if (y === undefined || y === null) continue;
    }
    if (y === null || y === undefined) continue;

    // Mean is the first argument.
    const mu = graph.evaluateExpr(child.distribution.paramExprs[0], paramValues);
    sumSqResid += (y - mu) ** 2;
    n++;
  }

  return { sumSqResid, n };
}

/**
 * Recursively check whether an expression AST node references a given variable name.
 *
 * @param {Object} expr - AST expression node.
 * @param {string} varName - Variable name to look for.
 * @returns {boolean}
 */
function exprReferencesVar(expr, varName) {
  if (!expr) return false;
  switch (expr.type) {
    case 'NumberLiteral': return false;
    case 'Identifier':    return expr.name === varName;
    case 'BinaryOp':      return exprReferencesVar(expr.left, varName) || exprReferencesVar(expr.right, varName);
    case 'UnaryOp':       return exprReferencesVar(expr.operand, varName);
    case 'FunctionCall':  return expr.args.some(a => exprReferencesVar(a, varName));
    case 'IndexExpr':     return exprReferencesVar(expr.object, varName) || expr.indices.some(i => exprReferencesVar(i, varName));
    default:              return false;
  }
}

/**
 * Determine whether a given argument position of `child`'s distribution
 * expression directly references the named parameter.
 *
 * Uses AST traversal rather than numerical perturbation to avoid false
 * negatives (flat expressions) and false positives (floating-point noise).
 *
 * @param {Object} child - A graph node.
 * @param {string} paramName - Parameter name to check.
 * @param {number} argIdx - Which distribution argument to probe.
 * @returns {boolean}
 */
function distributionUsesParam(child, paramName, argIdx) {
  if (!child.distribution?.paramExprs?.[argIdx]) return false;
  return exprReferencesVar(child.distribution.paramExprs[argIdx], paramName);
}

/**
 * Resolve the observed value of a node.
 * Returns the scalar value, or null if it cannot be determined.
 *
 * @param {Object} node
 * @param {Object} paramValues
 * @returns {number|null}
 */
function resolveObservedValue(node, paramValues) {
  if (node.value !== undefined && node.value !== null) {
    return typeof node.value === 'number' ? node.value : null;
  }
  if (node.name && paramValues[node.name] !== undefined) {
    return paramValues[node.name];
  }
  return null;
}

/**
 * Determine hard support bounds for a parameter based on its distribution.
 *
 * @param {Object} node
 * @returns {{ lower: number, upper: number }}
 */
function getParameterBounds(node) {
  if (!node.distribution) return { lower: -Infinity, upper: Infinity };

  switch (node.distribution.name) {
    case 'dgamma':
    case 'dlnorm':
      return { lower: 1e-10, upper: Infinity };

    case 'dbeta':
      return { lower: 1e-10, upper: 1 - 1e-10 };

    case 'dbern':
    case 'dbin':
    case 'dbinom':
      return { lower: 0, upper: 1 };

    case 'dpois':
      return { lower: 1e-10, upper: Infinity };

    case 'dunif': {
      // We don't have paramValues here to evaluate; use loose defaults.
      // The log density itself will return -Infinity outside [lower,upper].
      return { lower: -Infinity, upper: Infinity };
    }

    default:
      return { lower: -Infinity, upper: Infinity };
  }
}

/**
 * Heuristically compute an initial slice width for a parameter.
 *
 * For normal priors the standard deviation gives a good initial width.
 * For gamma priors sqrt(shape)/rate is the prior SD.
 * For beta priors a width of 0.3 is reasonable.
 * Fall back to 1.0 for unknown distributions.
 *
 * @param {Object} node
 * @param {Object} paramValues
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @returns {number}
 */
function computeSliceWidth(node, paramValues, graph) {
  if (!node.distribution) return 1.0;

  try {
    const args = node.distribution.paramExprs.map((e) =>
      graph.evaluateExpr(e, paramValues)
    );

    switch (node.distribution.name) {
      case 'dnorm': {
        // SD = 1 / sqrt(tau)
        const tau = Math.max(args[1], 1e-10);
        return Math.min(Math.max(1 / Math.sqrt(tau), 0.01), 100);
      }
      case 'dgamma': {
        // Prior SD = sqrt(shape) / rate
        const [shape, rate] = args;
        return Math.min(Math.max(Math.sqrt(Math.max(shape, 1e-3)) / Math.max(rate, 1e-6), 0.01), 100);
      }
      case 'dbeta':
        return 0.3;
      case 'dunif': {
        const [lo, hi] = args;
        return Math.max((hi - lo) / 4, 0.01);
      }
      default:
        return 1.0;
    }
  } catch (_) {
    return 1.0;
  }
}

/**
 * Return a new array containing the elements of `arr` in a uniformly random
 * order (Fisher-Yates shuffle). Does not mutate the input.
 *
 * @param {string[]} arr
 * @returns {string[]}
 */
function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Yield control to the browser event loop.
 * This allows UI updates and keeps the tab responsive during long sampling runs.
 *
 * @returns {Promise<void>}
 */
function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
