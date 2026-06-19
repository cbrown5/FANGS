/**
 * bayes-math.js
 * Pure helpers for the discrete-Bayes challenge (Module 1). Kept free of DOM so
 * the maths can be unit-tested directly.
 */

/** Numerator for each hypothesis: prior × likelihood. */
export function numerators(prior, likelihood) {
  return prior.map((p, i) => p * likelihood[i]);
}

/** Denominator: the sum of the numerators (total probability of the data). */
export function denominator(nums) {
  return nums.reduce((a, b) => a + b, 0);
}

/** Posterior for each hypothesis: numerator ÷ denominator. */
export function posterior(prior, likelihood) {
  const nums = numerators(prior, likelihood);
  const denom = denominator(nums);
  return nums.map(n => n / denom);
}
