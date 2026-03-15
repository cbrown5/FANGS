/**
 * diagnostics.js - MCMC diagnostic statistics for FANGS
 *
 * Implements Gelman-Rubin R-hat (split-chain), effective sample size (ESS)
 * via the Geyer (1992) initial monotone sequence estimator, posterior
 * summaries, and convergence checking.
 *
 * All chain arguments follow the convention:
 *   chains: number[][]  — outer index = chain, inner index = sample
 */

import { mean, variance, quantile } from './math.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the sample autocorrelation at a given lag for a zero-mean series.
 * Uses the biased (1/n) denominator so that the estimator is consistent and
 * the autocorrelation function is guaranteed positive-semidefinite.
 *
 * @param {number[]} centered - Array of (x - mean(x)) values
 * @param {number} lag - Non-negative integer lag
 * @returns {number} Autocorrelation in [-1, 1]
 */
function autocorr(centered, lag) {
  const n = centered.length;
  if (lag >= n) return 0;
  let num = 0;
  let denom = 0;
  for (let i = 0; i < n; i++) {
    denom += centered[i] * centered[i];
  }
  if (denom === 0) return 1; // constant chain
  for (let i = 0; i < n - lag; i++) {
    num += centered[i] * centered[i + lag];
  }
  // Divide both by n to get biased estimates; the n cancels in the ratio.
  return num / denom;
}

/**
 * Compute all autocorrelations up to a given maximum lag.
 *
 * @param {number[]} chain
 * @param {number} maxLag
 * @returns {number[]} Array of length (maxLag + 1), rho[k] = autocorr at lag k
 */
function autocorrSequence(chain, maxLag) {
  const m = mean(chain);
  const centered = chain.map(x => x - m);
  const rho = new Array(maxLag + 1);
  for (let k = 0; k <= maxLag; k++) {
    rho[k] = autocorr(centered, k);
  }
  return rho;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the Gelman-Rubin R-hat statistic using the split-chain correction.
 *
 * Each chain is split in half to double the number of chains, which makes
 * the estimator sensitive to within-chain non-stationarity as well as
 * between-chain divergence.
 *
 * Formula (Gelman et al., BDA3):
 *   W   = mean within-chain variance across split chains
 *   B/n = variance of split-chain means
 *   var_hat = (n-1)/n * W + B/n
 *   Rhat = sqrt(var_hat / W)
 *
 * @param {number[][]} chains - Array of chains; each chain is an array of samples
 * @returns {number} R-hat statistic (< 1.1 indicates convergence)
 */
export function rhat(chains) {
  if (!chains || chains.length === 0) return NaN;

  // Split each chain in half to form the set of split chains.
  const splitChains = [];
  for (const chain of chains) {
    if (chain.length < 4) {
      // Not enough samples to split meaningfully; return NaN.
      return NaN;
    }
    const half = Math.floor(chain.length / 2);
    splitChains.push(chain.slice(0, half));
    splitChains.push(chain.slice(half, 2 * half)); // equal-length halves
  }

  const m = splitChains.length; // number of split chains
  const n = splitChains[0].length; // samples per split chain

  if (m < 2) return NaN;

  // Chain means and within-chain variances (using Bessel-corrected variance).
  const chainMeans = splitChains.map(c => mean(c));
  const chainVars = splitChains.map(c => variance(c)); // s_j^2

  // Within-chain variance W = mean of per-chain sample variances.
  const W = mean(chainVars);

  if (W === 0) {
    // All chains are constant — could be degenerate; return 1 (or NaN).
    return NaN;
  }

  // Between-chain variance B (unscaled, multiplied by n):
  //   B = n / (m-1) * sum((chain_mean_j - grand_mean)^2)
  const grandMean = mean(chainMeans);
  let Bover_n = 0;
  for (const cm of chainMeans) {
    const d = cm - grandMean;
    Bover_n += d * d;
  }
  Bover_n /= (m - 1); // B/n

  // Marginal posterior variance estimate.
  const varHat = ((n - 1) / n) * W + Bover_n;

  return Math.sqrt(varHat / W);
}

/**
 * Compute the Effective Sample Size for a single chain using the Geyer (1992)
 * initial monotone sequence estimator.
 *
 * Algorithm:
 *   1. Compute autocorrelations rho_k for k = 0, 1, 2, …
 *   2. Form consecutive pair sums: Gamma_k = rho_{2k} + rho_{2k+1}
 *   3. Truncate at the first k where Gamma_k <= 0  (initial positive sequence)
 *   4. Apply the monotone constraint: Gamma_k = min(Gamma_k, Gamma_{k-1})
 *   5. ESS = n / (−1 + 2 * sum(Gamma_k))
 *      where the −1 comes from the lag-0 term being rho_0 = 1 already counted
 *      in the denominator as 1 + 2*sum_{k>=1}(rho_k).
 *
 * @param {number[]} chain - Array of samples
 * @returns {number} ESS estimate (capped at chain length)
 */
export function ess(chain) {
  const n = chain.length;
  if (n < 4) return n;

  const maxLag = Math.min(n - 1, Math.floor(n / 2)); // safe upper bound
  const rho = autocorrSequence(chain, maxLag);

  // Build Gamma_k = rho[2k] + rho[2k+1] pairs.
  // Start accumulating the sum of positive Gamma_k values.
  let sum = 0;
  let prevGamma = Infinity;

  for (let k = 0; 2 * k + 1 <= maxLag; k++) {
    let gamma = rho[2 * k] + rho[2 * k + 1];

    // Initial positive sequence: stop when Gamma_k becomes non-positive.
    if (gamma <= 0) break;

    // Monotone constraint: Gamma_k cannot exceed the previous pair.
    if (gamma > prevGamma) {
      gamma = prevGamma;
    }
    prevGamma = gamma;
    sum += gamma;
  }

  // The denominator is 1 + 2*(sum of rho_k, k>=1).
  // In pair notation: rho[0]=1, so sum of pairs starting at k=0 already
  // includes rho[0]. Denominator = -1 + 2*sum (the -1 corrects for rho[0]=1
  // being counted once in the pair sum but only contributing 1, not 2).
  const denom = -1 + 2 * sum;
  if (denom <= 0) return n; // autocorrelation structure implies ESS >= n

  return Math.min(n / denom, n);
}

/**
 * Compute pooled ESS across multiple chains.
 *
 * Pools all chains into a single flat array and computes ESS on that, then
 * scales by the number of chains to account for independent chain information.
 * This matches the Stan/posterior package approach of computing ESS on the
 * combined set of chains.
 *
 * @param {number[][]} chains - Array of chains
 * @returns {number} Pooled ESS estimate
 */
export function essMultiChain(chains) {
  if (!chains || chains.length === 0) return 0;
  if (chains.length === 1) return ess(chains[0]);

  // Compute per-chain ESS and sum them; this approximation is valid when
  // chains are independent (which they should be after convergence).
  // For a more accurate estimate, compute ESS on the interleaved sequence.
  const pooled = [];
  for (const chain of chains) {
    for (const s of chain) {
      pooled.push(s);
    }
  }

  // ESS on the pooled sequence (accounts for autocorrelation within chains).
  const pooledEss = ess(pooled);

  // The pooled sequence has inflated autocorrelation due to chain-switching
  // patterns; per-chain sum gives a better estimate when chains have mixed.
  const perChainSum = chains.reduce((acc, c) => acc + ess(c), 0);

  // Return the smaller of the two estimates (conservative).
  return Math.min(pooledEss, perChainSum);
}

/**
 * Compute posterior summary statistics for a parameter across multiple chains.
 *
 * @param {number[][]} chains - Chains after burn-in removal
 * @returns {{ mean: number, sd: number, q2_5: number, q50: number, q97_5: number, rhat: number, ess: number }}
 */
export function summarize(chains) {
  if (!chains || chains.length === 0) {
    return { mean: NaN, sd: NaN, q2_5: NaN, q50: NaN, q97_5: NaN, rhat: NaN, ess: 0 };
  }

  // Flatten all chains into a single sample array for quantile/mean/sd.
  const all = [];
  for (const chain of chains) {
    for (const s of chain) {
      all.push(s);
    }
  }

  if (all.length === 0) {
    return { mean: NaN, sd: NaN, q2_5: NaN, q50: NaN, q97_5: NaN, rhat: NaN, ess: 0 };
  }

  const m = mean(all);
  const v = variance(all);
  const sd = Math.sqrt(v);

  return {
    mean: m,
    sd,
    q2_5: quantile(all, 0.025),
    q50: quantile(all, 0.5),
    q97_5: quantile(all, 0.975),
    rhat: rhat(chains),
    ess: essMultiChain(chains),
  };
}

/**
 * Compute summaries for all parameters.
 *
 * @param {Object} samples - { paramName: number[][] } mapping parameter names
 *   to arrays of chains, where each chain is an array of post-burn-in samples
 * @returns {Object} { paramName: summary } where each summary matches the
 *   shape returned by {@link summarize}
 */
export function summarizeAll(samples) {
  const result = {};
  for (const [paramName, chains] of Object.entries(samples)) {
    result[paramName] = summarize(chains);
  }
  return result;
}

/**
 * Check whether all parameters have converged based on R-hat thresholds.
 *
 * @param {Object} samples - { paramName: number[][] }
 * @param {number} [threshold=1.1] - R-hat threshold; values above this indicate
 *   non-convergence
 * @returns {{ converged: boolean, warnings: string[] }}
 */
export function checkConvergence(samples, threshold = 1.1) {
  const warnings = [];

  for (const [paramName, chains] of Object.entries(samples)) {
    const r = rhat(chains);
    if (!isFinite(r)) {
      warnings.push(
        `${paramName}: R-hat could not be computed (too few samples or constant chain).`
      );
    } else if (r >= threshold) {
      warnings.push(
        `${paramName}: R-hat = ${r.toFixed(3)} >= ${threshold} — chain has not converged.`
      );
    }
  }

  return {
    converged: warnings.length === 0,
    warnings,
  };
}
