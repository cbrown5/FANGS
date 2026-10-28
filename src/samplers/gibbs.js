/**
 * gibbs.js - Component-wise Gibbs sampler for FANGS
 *
 * Orchestrates the main MCMC loop. Each iteration updates every unobserved
 * parameter in a randomly shuffled order. Parameters with recognized conjugate
 * structures receive exact conjugate updates; all others fall back to the
 * univariate slice sampler.
 *
 * Each chain keeps a persistent ChainState (chain-state.js): updating a
 * parameter re-evaluates only its Markov blanket, not the whole model.
 *
 * References:
 *   Gelfand & Smith (1990) "Sampling-Based Approaches to Calculating Marginal
 *     Densities", JASA 85(410).
 *   Neal (2003) "Slice Sampling", Annals of Statistics 31(3).
 */

import { initializeChains } from './initialize.js';
import { sliceSample }      from './slice.js';
import { ChainState }       from './chain-state.js';
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
 *   for every saved sample. `paramValues` is a fresh copy — safe to store.
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
    const state = new ChainState(graph, chains[c], { priorOnly });
    let savedCount = 0;

    // Pre-allocate the sweep order array once per chain (shuffled in-place each iter).
    const order = params.slice();

    for (let iter = 0; iter < totalIters; iter++) {
      // Yield to the event loop periodically to keep the UI responsive.
      if (iter % UI_YIELD_INTERVAL === 0) {
        await yieldToUI();
        if (onProgress) {
          onProgress(c, iter, totalIters, state.snapshot());
        }
      }

      // Check for external stop request.
      if (shouldStop && shouldStop()) {
        return samples;
      }

      // One full Gibbs sweep in random parameter order.
      shuffleInPlace(order);
      for (const paramName of order) {
        updateParameterState(paramName, state);
      }

      // Determine whether this iteration is a saved sample.
      const isBurnin = iter < burnin;
      const postBurninIter = iter - burnin; // negative during burn-in
      const isSaved = !isBurnin && (postBurninIter % thin === 0);

      if (isSaved) {
        const values = state.values;
        for (const p of params) {
          samples[p][c].push(values[p]);
        }
        if (onSample) {
          // Pass a fresh copy so the callback can safely store it.
          onSample(c, savedCount, state.snapshot());
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
 * Convenience wrapper around updateParameterState() for callers that hold a
 * plain `{ paramName: value }` object. It builds a fresh ChainState (one full
 * merge), so it is not meant for hot loops; runGibbs keeps one state per chain.
 *
 * @param {string} paramName - Name of the parameter to update.
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 * @param {Object} paramValues - Current parameter values (mutated in place).
 * @param {Object} [options]
 * @param {boolean} [options.priorOnly=false]
 */
export function updateParameter(paramName, graph, paramValues, options = {}) {
  if (!graph.nodes.get(paramName)) return;
  const state = new ChainState(graph, paramValues, { priorOnly: !!options.priorOnly });
  updateParameterState(paramName, state);
  paramValues[paramName] = state.values[paramName];
}

/**
 * Update a single parameter of a ChainState using the best available sampler.
 *
 * Strategy (in order of preference):
 *   1. Conjugate normal-normal update (if `node.conjugateType === 'normal-normal'`)
 *   2. Conjugate normal-normal-offset update (random effects and slopes)
 *   3. Conjugate beta-binom update (if `node.conjugateType === 'beta-binom'`)
 *   4. Conjugate gamma-Poisson update (if `node.conjugateType === 'gamma-poisson'`)
 *   5. Slice sampling fallback (includes SD parameters of normals, which have
 *      no conjugate update under FANGS's SD parameterisation)
 *
 * The slice sampler's log full conditional is state.logConditional(), which
 * sums only the parameter's Markov blanket.
 *
 * @param {string} paramName
 * @param {ChainState} state - mutated: the parameter and its detPath are updated
 */
export function updateParameterState(paramName, state) {
  const graph = state.graph;
  const node = graph.nodes.get(paramName);
  if (!node) return;

  // Ensure the parameter has a value (use 1 as safe default).
  if (state.values[paramName] === undefined) {
    state.set(paramName, 1);
  }

  // Attempt conjugate updates first.
  //
  // IMPORTANT: every conjugate update below combines the prior with the
  // *likelihood* contributions of observed children. In prior-only mode
  // (prior predictive check) the likelihood must be dropped entirely, so the
  // conjugate branch is skipped and the parameter is updated from its prior
  // alone via the generic path below. Without this guard a prior check for an
  // intercept such as `alpha ~ dnorm(0, 10)` returns draws centred near the
  // data mean instead of near 0.
  switch (state.priorOnly ? null : node.conjugateType) {
    case 'normal-normal':
      state.set(paramName, conjugateNormalNormal(node, state));
      return;

    case 'normal-normal-offset':
      state.set(paramName, conjugateNormalNormalOffset(node, state));
      return;

    case 'beta-binom':
      state.set(paramName, conjugateBetaBinom(node, state));
      return;

    case 'gamma-poisson':
      state.set(paramName, conjugateGammaPoisson(node, state));
      return;

    default:
      break;
  }

  // Fall back to slice sampling.
  // Prior arguments are evaluated against the already-merged state values,
  // so bounds and width cost O(1) rather than a full merge.
  const evalGraph = mergedEvaluator(graph);
  const values = state.values;
  const { lower, upper } = getParameterBounds(node, evalGraph, values);

  const logFC = (value) => {
    state.set(paramName, value);
    return state.logConditional(paramName);
  };

  const next = sliceSample(paramName, values[paramName], logFC, {
    w: computeSliceWidth(node, values, evalGraph),
    maxSteps: 20,
    lower,
    upper,
  });
  // The last logFC call may have been a rejected proposal: always finish by
  // setting the accepted value so the deterministic nodes are consistent.
  state.set(paramName, next);
}

/**
 * A graph-like object whose evaluateExpr() reads an already-merged value map,
 * for getParameterBounds() / computeSliceWidth().
 * @param {import('../parser/model-graph.js').ModelGraph} graph
 */
function mergedEvaluator(graph) {
  return { evaluateExpr: (e, v) => graph.evaluateExprMerged(e, v) };
}

// ---------------------------------------------------------------------------
// Conjugate samplers
// ---------------------------------------------------------------------------

/**
 * Conjugate normal-normal posterior update.
 *
 * Assumes:
 *   Prior:      theta ~ Normal(mu0, sigma0)     [sigma0 = SD; tau0 = 1/sigma0²]
 *   Likelihood: y_i  ~ Normal(theta, sigma_lik) for each child observation
 *
 * The conjugate arithmetic is carried out in precision space, so both the
 * prior SD and the likelihood SD are converted to precision first
 * (tau = 1/sigma²). Posterior:
 *   tau_n = tau0 + n * tau_lik
 *   mu_n  = (tau0 * mu0 + tau_lik * sum(y_i)) / tau_n
 *   theta | data ~ Normal(mu_n, tau_n)  →  drawn as rnorm(mu_n, 1/sqrt(tau_n))
 *
 * In the mixed-effects case `theta` may enter as a linear offset inside mu_i
 * rather than directly as the mean. This implementation handles the simple
 * case where the node is the direct mean parameter. The graph's conjugateType
 * annotation is expected to flag only the straightforward cases.
 *
 * @param {Object} node - Stochastic node for the parameter.
 * @param {ChainState} state - Current chain state.
 * @returns {number} Posterior draw.
 */
export function conjugateNormalNormal(node, state) {
  const graph = state.graph;
  const allValues = state.values;

  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExprMerged(e, allValues)
  );
  const mu0    = priorArgs[0];
  const sigma0 = Math.max(priorArgs[1], 1e-10);
  const tau0   = 1 / (sigma0 * sigma0); // prior precision

  // Collect child observations and their likelihood precision (converted from SD).
  const { sumY, n, tauLik } = collectNormalChildren(node, graph, allValues);

  const tauN = tau0 + n * tauLik;
  const muN  = (tau0 * mu0 + tauLik * sumY) / tauN;

  // rnorm now takes SD, so convert posterior precision → SD for the draw.
  return dist.rnorm(muN, 1 / Math.sqrt(tauN));
}

/**
 * Conjugate normal-normal update for a node that enters the mean of Normal
 * observations linearly through a deterministic node.
 *
 * Handles both pure additive offsets (random effects: b[j]) and slope
 * parameters (beta with coefficient x[i]), using numerical differentiation
 * to determine the per-observation coefficient c[i] = ∂mu[i]/∂θ.
 *
 * Full conditional for θ ~ dnorm(mu0, sigma0)  [sigma0 = SD; tau0 = 1/sigma0²]:
 *   c[i]    = ∂mu[i]/∂θ  (computed by numerical perturbation)
 *   tau[i]  = 1/sigma_lik[i]², the likelihood precision of child i
 *   sumWtResid = Σ tau[i] * c[i] * (y[i] - mu_without[i])
 *   sumWtSq    = Σ tau[i] * c[i]^2
 *   tau_n   = tau0 + sumWtSq
 *   mu_n    = (tau0 * mu0 + sumWtResid) / tau_n
 *
 * Only the Normal observed children in θ's Markov blanket are visited.
 *
 * @param {Object} node - Stochastic node for θ.
 * @param {ChainState} state - Current chain state.
 * @returns {number} Posterior draw.
 */
export function conjugateNormalNormalOffset(node, state) {
  const graph = state.graph;
  const values = state.values;
  const theta = values[node.name];
  const eps   = Math.max(Math.abs(theta) * 1e-5, 1e-7);

  // Only the parameter's Markov-blanket children can depend on θ.
  const children = graph.getBlanket(node.name).children.filter(
    (c) => c.observed && c.distribution?.name === 'dnorm'
  );
  const n = children.length;
  const muPlus  = new Float64Array(n);
  const muMinus = new Float64Array(n);

  // Perturb θ in the state (refreshing only its detPath) to read each child's
  // mean at θ ± eps, then restore.
  state.set(node.name, theta + eps);
  for (let k = 0; k < n; k++) {
    muPlus[k] = graph.evaluateExprMerged(children[k].distribution.paramExprs[0], values);
  }
  state.set(node.name, theta - eps);
  for (let k = 0; k < n; k++) {
    muMinus[k] = graph.evaluateExprMerged(children[k].distribution.paramExprs[0], values);
  }
  state.set(node.name, theta);

  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExprMerged(e, values)
  );
  const mu0    = priorArgs[0];
  const sigma0 = Math.max(priorArgs[1], 1e-10);
  const tau0   = 1 / (sigma0 * sigma0);

  // Each child contributes with its own likelihood precision τ_i, so
  // heteroscedastic children (sigma[group[i]]) are handled correctly.
  let sumWtResid = 0;
  let sumWtSq    = 0;

  for (let k = 0; k < n; k++) {
    const child = children[k];
    const y = resolveObservedValue(child, values);
    if (y === null) continue;

    // Coefficient c[i] = ∂mu[i]/∂θ. Children whose mean does not involve θ
    // (θ enters elsewhere, e.g. a sibling's SD) give c[i] = 0 and are skipped.
    const ci = (muPlus[k] - muMinus[k]) / (2 * eps);
    if (!isFinite(ci) || Math.abs(ci) < 1e-14) continue;

    // Child's second dnorm arg is the SD.
    const sigmaLik = Math.max(
      graph.evaluateExprMerged(child.distribution.paramExprs[1], values),
      1e-10
    );
    const tauLik = 1 / (sigmaLik * sigmaLik);

    const muFull    = graph.evaluateExprMerged(child.distribution.paramExprs[0], values);
    const muWithout = muFull - ci * theta;

    sumWtResid += tauLik * ci * (y - muWithout);
    sumWtSq    += tauLik * ci * ci;
  }

  const tauN = tau0 + sumWtSq;
  const muN  = (tau0 * mu0 + sumWtResid) / tauN;

  return dist.rnorm(muN, 1 / Math.sqrt(tauN));
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
 * @param {ChainState} state - Current chain state.
 * @returns {number} Posterior draw.
 */
export function conjugateBetaBinom(node, state) {
  const graph = state.graph;
  const paramValues = state.values;
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExprMerged(e, paramValues)
  );
  const a = Math.max(priorArgs[0], 1e-10);
  const b = Math.max(priorArgs[1], 1e-10);

  let sumSuccesses = 0;
  let sumFailures  = 0;

  // Use precomputed children list (O(children)) rather than scanning all nodes.
  for (const childName of node.children) {
    const child = graph.nodes.get(childName);
    if (!child || !child.observed) continue;
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
      const nTrials = graph.evaluateExprMerged(child.distribution.paramExprs[1], paramValues);
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
 * @param {ChainState} state - Current chain state.
 * @returns {number} Posterior draw.
 */
export function conjugateGammaPoisson(node, state) {
  const graph = state.graph;
  const paramValues = state.values;
  const priorArgs = node.distribution.paramExprs.map((e) =>
    graph.evaluateExprMerged(e, paramValues)
  );
  const a = Math.max(priorArgs[0], 1e-10);
  const b = Math.max(priorArgs[1], 1e-10);

  let sumY = 0;
  let n    = 0;

  // Use precomputed children list (O(children)) rather than scanning all nodes.
  for (const childName of node.children) {
    const child = graph.nodes.get(childName);
    if (!child || !child.observed) continue;
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
function collectNormalChildren(node, graph, allValues) {
  let sumY   = 0;
  let n      = 0;
  let tauLik = 1; // default; overwritten by first child found

  // Use precomputed children list (O(children)) rather than scanning all nodes.
  for (const childName of node.children) {
    const child = graph.nodes.get(childName);
    if (!child || !child.observed) continue;
    if (child.distribution?.name !== 'dnorm') continue;

    // Check that the first parameter (mean) evaluates to or references our node.
    if (!distributionUsesParam(child, node.name, 0)) continue;

    const y = allValues[child.name] ?? child.value;
    if (y === null || y === undefined) continue;

    // The second dnorm argument is the SD; use pre-merged allValues.
    const sigmaLik = Math.max(
      graph.evaluateExprMerged(child.distribution.paramExprs[1], allValues),
      1e-10
    );
    tauLik = 1 / (sigmaLik * sigmaLik);
    sumY += y;
    n++;
  }

  return { sumY, n, tauLik };
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
 * @param {import('../parser/model-graph.js').ModelGraph} [graph]
 * @param {Object} [paramValues] - current values, used to evaluate dunif bounds
 * @returns {{ lower: number, upper: number }}
 */
export function getParameterBounds(node, graph, paramValues) {
  if (!node.distribution) return { lower: -Infinity, upper: Infinity };

  switch (node.distribution.name) {
    case 'dgamma':
    case 'dlnorm':
    case 'dexp':
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
      // Evaluate the uniform bounds so the slice sampler stays in support
      // (important for sigma ~ dunif(0, 100): keeps the SD strictly positive).
      if (graph && paramValues) {
        try {
          const lo = graph.evaluateExpr(node.distribution.paramExprs[0], paramValues);
          const hi = graph.evaluateExpr(node.distribution.paramExprs[1], paramValues);
          if (isFinite(lo) && isFinite(hi) && lo < hi) {
            return { lower: lo, upper: hi };
          }
        } catch (_) { /* fall through to loose defaults */ }
      }
      // The log density itself returns -Infinity outside [lower, upper].
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
export function computeSliceWidth(node, paramValues, graph) {
  if (!node.distribution) return 1.0;

  try {
    const args = node.distribution.paramExprs.map((e) =>
      graph.evaluateExpr(e, paramValues)
    );

    switch (node.distribution.name) {
      case 'dnorm': {
        // Second arg is the SD directly.
        const sigma = Math.max(args[1], 1e-10);
        return Math.min(Math.max(sigma, 0.01), 100);
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
      case 'dexp': {
        // Prior mean = 1/rate; use that as the initial slice width.
        const [rate] = args;
        return Math.min(Math.max(1 / Math.max(rate, 1e-6), 0.01), 100);
      }
      default:
        return 1.0;
    }
  } catch (_) {
    return 1.0;
  }
}

/**
 * Fisher-Yates shuffle of `arr` in place.
 * Avoids the per-iteration array allocation of the previous `shuffled()` helper.
 *
 * @param {string[]} arr
 */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
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
