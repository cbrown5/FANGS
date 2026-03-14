/**
 * distributions.js - Probability distribution log-densities and random samplers
 *
 * Parameterizations follow JAGS/NIMBLE conventions:
 *   - dnorm / rnorm  use precision τ = 1/σ²  (not variance, not SD)
 *   - dgamma / rgamma use shape and rate  (rate = 1/scale)
 *   - dlnorm / rlnorm use meanlog and preclog (precision on log scale)
 *
 * All log-density functions return -Infinity for out-of-support inputs rather
 * than throwing, matching standard statistical software behaviour.
 */

// ---------------------------------------------------------------------------
// Internal constants & helpers
// ---------------------------------------------------------------------------

const LOG_2PI = Math.log(2 * Math.PI);
const LOG_PI  = Math.log(Math.PI);

/**
 * Log of the gamma function via Lanczos approximation (Spouge variant).
 * Accurate to ~15 significant figures for x > 0.
 *
 * @param {number} x
 * @returns {number}
 */
function logGamma(x) {
  if (x <= 0) return Infinity;
  // Lanczos coefficients (g=7, n=9) from Paul Godfrey
  const g = 7;
  const c = [
     0.99999999999980993,
   676.5203681218851,
 -1259.1392167224028,
   771.32342877765313,
  -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
     9.9843695780195716e-6,
     1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1-x) = π/sin(πx)
    return LOG_PI - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }
  return 0.5 * LOG_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Log of the binomial coefficient C(n, k).
 *
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// ---------------------------------------------------------------------------
// Logit / inverse-logit helpers
// ---------------------------------------------------------------------------

/**
 * Logit function: log(p / (1-p)).
 *
 * @param {number} p - Probability in (0, 1)
 * @returns {number}
 */
export function logit(p) {
  return Math.log(p / (1 - p));
}

/**
 * Inverse logit (logistic sigmoid): 1 / (1 + exp(-x)).
 *
 * @param {number} x
 * @returns {number}
 */
export function invLogit(x) {
  // Numerically stable form
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }
  const ex = Math.exp(x);
  return ex / (1 + ex);
}

// ---------------------------------------------------------------------------
// Normal distribution  (JAGS parameterization: mean, precision)
// ---------------------------------------------------------------------------

/**
 * Log density of Normal(mean, precision).
 * JAGS/NIMBLE use precision τ = 1/σ², so σ² = 1/τ.
 *
 * @param {number} x
 * @param {number} mu - Mean
 * @param {number} tau - Precision (must be > 0)
 * @returns {number} Log density
 */
export function dnorm(x, mu, tau) {
  if (tau <= 0) return -Infinity;
  // log density = 0.5*log(tau) - 0.5*log(2π) - 0.5*tau*(x-mu)²
  return 0.5 * Math.log(tau) - 0.5 * LOG_2PI - 0.5 * tau * (x - mu) ** 2;
}

/**
 * Draw from Normal(mean, precision) using the Box-Muller transform.
 *
 * @param {number} mu - Mean
 * @param {number} tau - Precision (must be > 0)
 * @returns {number}
 */
export function rnorm(mu, tau) {
  const sigma = 1 / Math.sqrt(tau);
  // Box-Muller
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

// ---------------------------------------------------------------------------
// Gamma distribution  (shape, rate)  — rate = 1/scale
// ---------------------------------------------------------------------------

/**
 * Log density of Gamma(shape, rate).
 * JAGS/NIMBLE dgamma(x, shape, rate).
 *
 * @param {number} x - Must be > 0
 * @param {number} shape - Shape parameter (must be > 0)
 * @param {number} rate - Rate parameter (must be > 0); rate = 1/scale
 * @returns {number} Log density
 */
export function dgamma(x, shape, rate) {
  if (x <= 0 || shape <= 0 || rate <= 0) return -Infinity;
  return (
    shape * Math.log(rate) +
    (shape - 1) * Math.log(x) -
    rate * x -
    logGamma(shape)
  );
}

/**
 * Draw from Gamma(shape, rate) using the Marsaglia & Tsang (2000) method.
 * Reference: "A Simple Method for Generating Gamma Variables",
 *            ACM TOMS 26(3), 363-372.
 *
 * @param {number} shape - Shape (must be > 0)
 * @param {number} rate  - Rate = 1/scale (must be > 0)
 * @returns {number}
 */
export function rgamma(shape, rate) {
  if (shape <= 0 || rate <= 0) throw new RangeError('rgamma: shape and rate must be > 0');

  // Handle shape < 1 via the boosting trick: Gamma(a) = Gamma(a+1) * U^(1/a)
  if (shape < 1) {
    return rgamma(shape + 1, rate) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x, v;
    do {
      // Standard normal via Box-Muller
      x = Math.sqrt(-2 * Math.log(Math.random())) *
          Math.cos(2 * Math.PI * Math.random());
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v; // v = (1 + c*x)^3
    const u = Math.random();
    const x2 = x * x;

    // Quick acceptance check (saves a log evaluation most of the time)
    if (u < 1 - 0.0331 * (x2 * x2)) {
      return (d * v) / rate;
    }
    // Slower log-based check
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) {
      return (d * v) / rate;
    }
  }
}

// ---------------------------------------------------------------------------
// Beta distribution
// ---------------------------------------------------------------------------

/**
 * Log density of Beta(a, b).
 *
 * @param {number} x - Must be in (0, 1)
 * @param {number} a - Shape 1 (must be > 0)
 * @param {number} b - Shape 2 (must be > 0)
 * @returns {number} Log density
 */
export function dbeta(x, a, b) {
  if (x <= 0 || x >= 1 || a <= 0 || b <= 0) return -Infinity;
  return (
    (a - 1) * Math.log(x) +
    (b - 1) * Math.log(1 - x) +
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b)
  );
}

/**
 * Draw from Beta(a, b) via the Gamma ratio method:
 * if X ~ Gamma(a,1) and Y ~ Gamma(b,1) then X/(X+Y) ~ Beta(a,b).
 *
 * @param {number} a - Shape 1 (must be > 0)
 * @param {number} b - Shape 2 (must be > 0)
 * @returns {number}
 */
export function rbeta(a, b) {
  const x = rgamma(a, 1);
  const y = rgamma(b, 1);
  return x / (x + y);
}

// ---------------------------------------------------------------------------
// Poisson distribution
// ---------------------------------------------------------------------------

/**
 * Log PMF of Poisson(lambda).
 *
 * @param {number} x - Non-negative integer
 * @param {number} lambda - Rate (must be > 0)
 * @returns {number} Log PMF
 */
export function dpois(x, lambda) {
  if (!Number.isInteger(x) || x < 0 || lambda <= 0) return -Infinity;
  if (lambda === 0) return x === 0 ? 0 : -Infinity;
  return x * Math.log(lambda) - lambda - logGamma(x + 1);
}

/**
 * Draw from Poisson(lambda).
 * Uses Knuth's algorithm for lambda < 30, and a normal approximation
 * with continuity correction for large lambda.
 *
 * @param {number} lambda - Rate (must be >= 0)
 * @returns {number} Non-negative integer sample
 */
export function rpois(lambda) {
  if (lambda < 0) throw new RangeError('rpois: lambda must be >= 0');
  if (lambda === 0) return 0;

  if (lambda < 30) {
    // Knuth algorithm: count exponential inter-arrivals
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  // Normal approximation for large lambda: round N(lambda, lambda) to int
  // Uses Box-Muller for the normal draw
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

// ---------------------------------------------------------------------------
// Bernoulli distribution
// ---------------------------------------------------------------------------

/**
 * Log PMF of Bernoulli(p).
 *
 * @param {number} x - 0 or 1
 * @param {number} p - Success probability in [0, 1]
 * @returns {number} Log PMF
 */
export function dbern(x, p) {
  if (p < 0 || p > 1) return -Infinity;
  if (x === 1) return p === 0 ? -Infinity : Math.log(p);
  if (x === 0) return p === 1 ? -Infinity : Math.log(1 - p);
  return -Infinity;
}

/**
 * Draw from Bernoulli(p).
 *
 * @param {number} p - Success probability in [0, 1]
 * @returns {0|1}
 */
export function rbern(p) {
  return Math.random() < p ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Binomial distribution
// ---------------------------------------------------------------------------

/**
 * Log PMF of Binomial(n, p).
 *
 * @param {number} x - Number of successes (non-negative integer, <= n)
 * @param {number} n - Number of trials (positive integer)
 * @param {number} p - Success probability in [0, 1]
 * @returns {number} Log PMF
 */
export function dbinom(x, n, p) {
  if (!Number.isInteger(x) || !Number.isInteger(n) || x < 0 || x > n || n < 0) return -Infinity;
  if (p < 0 || p > 1) return -Infinity;
  if (p === 0) return x === 0 ? 0 : -Infinity;
  if (p === 1) return x === n ? 0 : -Infinity;
  return logChoose(n, x) + x * Math.log(p) + (n - x) * Math.log(1 - p);
}

/**
 * Draw from Binomial(n, p) by summing n Bernoulli trials.
 * Efficient for moderate n; for very large n a normal approximation
 * would be faster but is not needed for typical teaching datasets.
 *
 * @param {number} n - Number of trials (non-negative integer)
 * @param {number} p - Success probability in [0, 1]
 * @returns {number}
 */
export function rbinom(n, p) {
  let successes = 0;
  for (let i = 0; i < n; i++) {
    if (Math.random() < p) successes++;
  }
  return successes;
}

// ---------------------------------------------------------------------------
// Uniform distribution
// ---------------------------------------------------------------------------

/**
 * Log density of Uniform(lower, upper).
 *
 * @param {number} x
 * @param {number} lower
 * @param {number} upper
 * @returns {number} Log density
 */
export function dunif(x, lower, upper) {
  if (lower >= upper) return -Infinity;
  if (x < lower || x > upper) return -Infinity;
  return -Math.log(upper - lower);
}

/**
 * Draw from Uniform(lower, upper).
 *
 * @param {number} lower
 * @param {number} upper
 * @returns {number}
 */
export function runif(lower, upper) {
  return lower + (upper - lower) * Math.random();
}

// ---------------------------------------------------------------------------
// Log-Normal distribution  (JAGS parameterization: meanlog, preclog)
// ---------------------------------------------------------------------------

/**
 * Log density of LogNormal(meanlog, preclog).
 * JAGS dlnorm(x, meanlog, preclog) where preclog is the precision on the
 * log scale (τ = 1/σ²_log).
 *
 * @param {number} x - Must be > 0
 * @param {number} meanlog - Mean of log(x)
 * @param {number} preclog - Precision of log(x) (must be > 0)
 * @returns {number} Log density
 */
export function dlnorm(x, meanlog, preclog) {
  if (x <= 0 || preclog <= 0) return -Infinity;
  const logx = Math.log(x);
  // = dnorm(log(x), meanlog, preclog) - log(x)
  return (
    0.5 * Math.log(preclog) -
    0.5 * LOG_2PI -
    0.5 * preclog * (logx - meanlog) ** 2 -
    logx
  );
}

/**
 * Draw from LogNormal(meanlog, preclog).
 * Equivalent to exp(Normal(meanlog, preclog)).
 *
 * @param {number} meanlog - Mean of log(x)
 * @param {number} preclog - Precision of log(x) (must be > 0)
 * @returns {number}
 */
export function rlnorm(meanlog, preclog) {
  return Math.exp(rnorm(meanlog, preclog));
}
