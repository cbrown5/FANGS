/**
 * numeric.js
 * Tolerance helpers for checking student answers in course challenges.
 */

/**
 * True if `value` is within `tol` (absolute) of `target`.
 * @param {number} value
 * @param {number} target
 * @param {number} tol - absolute tolerance (>= 0)
 */
export function withinAbs(value, target, tol) {
  return Number.isFinite(value) && Math.abs(value - target) <= tol + 1e-12;
}

/**
 * True if `value` is within a relative tolerance of `target`.
 * Falls back to absolute tolerance near zero.
 * @param {number} value
 * @param {number} target
 * @param {number} rtol - relative tolerance (e.g. 0.05 for 5%)
 * @param {number} [atol] - absolute floor
 */
export function withinRel(value, target, rtol, atol = 1e-9) {
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - target) <= Math.max(rtol * Math.abs(target), atol) + 1e-12;
}

/**
 * Parse a user-entered number, tolerating commas and stray whitespace.
 * @param {string} str
 * @returns {number} NaN if unparseable
 */
export function parseNum(str) {
  if (typeof str === 'number') return str;
  if (str == null) return NaN;
  const cleaned = String(str).trim().replace(/,/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}
