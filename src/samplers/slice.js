/**
 * slice.js - Univariate slice sampler for FANGS
 *
 * Implements the "stepping out" and "shrinkage" slice sampling procedure
 * described in Neal (2003), "Slice Sampling", Annals of Statistics 31(3).
 *
 * This is used as a fallback for any full conditional that does not admit a
 * conjugate form. The sampler is self-tuning in the sense that the initial
 * interval width `w` is the only tuning parameter, and the stepping-out phase
 * automatically expands the interval to cover the slice.
 */

/**
 * Perform one slice sampling step for a single scalar parameter.
 *
 * Algorithm (Neal 2003, Figure 3 — stepping out + shrinkage, doubling=false):
 *   1. Evaluate log density at current value: log f(x0).
 *   2. Draw vertical level:  log y ~ Uniform(−∞, log f(x0)),
 *      equivalently log y = log f(x0) − Exponential(1).
 *   3. "Step out": expand interval [L, R] of width w around x0 until
 *      both ends are below the slice level (or bounds are hit).
 *   4. "Shrink": sample x1 ~ Uniform(L, R); if x1 is in the slice accept,
 *      otherwise shrink the interval toward x0 and repeat.
 *
 * @param {string} paramName - Name of the parameter being updated (used only
 *   for error messages; the sampler itself is parameter-agnostic).
 * @param {number} currentValue - Current parameter value x0.
 * @param {Function} logDensity - function(value: number) => number.
 *   Must return the log of the full conditional density (up to a constant).
 *   Should return -Infinity for out-of-support values.
 * @param {Object} [options={}]
 * @param {number} [options.w=1.0]        - Initial slice width for stepping out.
 * @param {number} [options.maxSteps=20]  - Maximum stepping-out expansions.
 * @param {number} [options.lower=-Infinity] - Hard lower bound on the parameter.
 * @param {number} [options.upper=Infinity]  - Hard upper bound on the parameter.
 * @returns {number} New parameter value (may equal currentValue if slice is
 *   very tight, which is statistically correct).
 */
export function sliceSample(paramName, currentValue, logDensity, options = {}) {
  const w        = options.w        ?? 1.0;
  const maxSteps = options.maxSteps ?? 20;
  const lower    = options.lower    ?? -Infinity;
  const upper    = options.upper    ?? Infinity;

  // Step 0: log density at current point.
  const logF0 = logDensity(currentValue);

  if (!isFinite(logF0)) {
    // Current point has zero density — this should not normally happen, but if
    // it does we attempt a recovery by returning the current value unchanged.
    // Callers should ensure the chain is initialized in-support.
    console.warn(`sliceSample: log density is ${logF0} at current value for "${paramName}". Returning current value.`);
    return currentValue;
  }

  // Step 1: Draw the vertical log-level defining the slice.
  // log y = log f(x0) - Exp(1), i.e. y ~ Uniform(0, f(x0)).
  const logY = logF0 - sampleExponential();

  // Step 2: "Stepping out" — find interval [L, R] containing the slice.
  // Place x0 at a random position within an initial interval of width w.
  let L = currentValue - w * Math.random();
  let R = L + w;

  // Clamp to hard bounds.
  L = Math.max(L, lower);
  R = Math.min(R, upper);

  // Expand L leftward while density is above the slice level.
  let stepsL = 0;
  while (stepsL < maxSteps && L > lower && logDensity(L) > logY) {
    L = Math.max(L - w, lower);
    stepsL++;
  }

  // Expand R rightward while density is above the slice level.
  let stepsR = 0;
  while (stepsR < maxSteps && R < upper && logDensity(R) > logY) {
    R = Math.min(R + w, upper);
    stepsR++;
  }

  // Step 3: "Shrinkage" — sample from [L, R] and shrink until we find a
  // proposal that lies within the slice.
  let x1;
  let shrinkCount = 0;
  const maxShrink = 200; // Safeguard against infinite loops.

  for (;;) {
    if (shrinkCount >= maxShrink) {
      // Extremely rare in practice; return current value to keep chain valid.
      console.warn(`sliceSample: shrinkage limit reached for "${paramName}". Returning current value.`);
      return currentValue;
    }

    if (R <= L) {
      // Interval collapsed (can happen at hard bounds); return current value.
      return currentValue;
    }

    // Uniform draw within the current interval.
    x1 = L + (R - L) * Math.random();

    const logFx1 = logDensity(x1);

    if (logFx1 >= logY) {
      // Proposal is inside the slice — accept.
      break;
    }

    // Proposal is outside the slice — shrink interval toward x0.
    if (x1 < currentValue) {
      L = x1;
    } else {
      R = x1;
    }

    shrinkCount++;
  }

  return x1;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Draw one sample from the standard Exponential(1) distribution.
 * Uses the inverse-CDF transform: E = -log(U), U ~ Uniform(0,1).
 *
 * @returns {number}
 */
function sampleExponential() {
  // Guard against Math.random() returning exactly 0.
  return -Math.log(Math.random() || Number.MIN_VALUE);
}
