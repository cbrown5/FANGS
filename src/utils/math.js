/**
 * math.js - Statistical math helpers for FANGS
 *
 * Utility functions for numerical computation used throughout the sampler,
 * diagnostics, and plotting subsystems.
 */

/**
 * Numerically stable log-sum-exp.
 * Computes log(sum(exp(arr))) without overflow/underflow.
 *
 * @param {number[]} arr - Array of log-space values
 * @returns {number} log(sum(exp(arr)))
 */
export function logSumExp(arr) {
  if (arr.length === 0) return -Infinity;
  const max = Math.max(...arr);
  if (!isFinite(max)) return max;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += Math.exp(arr[i] - max);
  }
  return max + Math.log(sum);
}

/**
 * Dot product of two numeric arrays of equal length.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function dot(a, b) {
  if (a.length !== b.length) {
    throw new RangeError(`dot: arrays must have equal length (got ${a.length} and ${b.length})`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Arithmetic mean of an array.
 *
 * @param {number[]} arr
 * @returns {number}
 */
export function mean(arr) {
  if (arr.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}

/**
 * Sample variance (divides by n-1, Bessel's correction).
 *
 * @param {number[]} arr
 * @returns {number}
 */
export function variance(arr) {
  if (arr.length < 2) return NaN;
  const m = mean(arr);
  let ss = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    ss += d * d;
  }
  return ss / (arr.length - 1);
}

/**
 * Sample standard deviation (square root of sample variance).
 *
 * @param {number[]} arr
 * @returns {number}
 */
export function std(arr) {
  return Math.sqrt(variance(arr));
}

/**
 * p-th quantile using linear interpolation (type 7, R default).
 * Sorts the array internally; does not mutate the input.
 *
 * @param {number[]} arr - Sample values
 * @param {number} p - Probability in [0, 1]
 * @returns {number}
 */
export function quantile(arr, p) {
  if (arr.length === 0) return NaN;
  if (p < 0 || p > 1) throw new RangeError(`quantile: p must be in [0, 1], got ${p}`);
  const sorted = arr.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];

  // R type-7 formula: h = (n-1)*p + 1, interpolate between floor and ceil
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  const frac = h - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Clamp a value to the inclusive interval [lo, hi].
 *
 * @param {number} x
 * @param {number} lo - Lower bound
 * @param {number} hi - Upper bound
 * @returns {number}
 */
export function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

/**
 * Generate an integer range array [0, 1, ..., n-1].
 *
 * @param {number} n - Length of the range
 * @returns {number[]}
 */
export function range(n) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    arr[i] = i;
  }
  return arr;
}

/**
 * Array of n zeros.
 *
 * @param {number} n
 * @returns {number[]}
 */
export function zeros(n) {
  return new Array(n).fill(0);
}

/**
 * Array of n ones.
 *
 * @param {number} n
 * @returns {number[]}
 */
export function ones(n) {
  return new Array(n).fill(1);
}

/**
 * Evenly spaced values from start to stop (inclusive), with n points.
 * Mirrors numpy/R linspace behaviour.
 *
 * @param {number} start
 * @param {number} stop
 * @param {number} n - Number of points (must be >= 1)
 * @returns {number[]}
 */
export function linspace(start, stop, n) {
  if (n < 1) throw new RangeError(`linspace: n must be >= 1, got ${n}`);
  if (n === 1) return [start];
  const arr = new Array(n);
  const step = (stop - start) / (n - 1);
  for (let i = 0; i < n; i++) {
    arr[i] = start + i * step;
  }
  // Guarantee the last element is exactly stop (avoids floating-point drift)
  arr[n - 1] = stop;
  return arr;
}

/**
 * Transpose a 2-D array (array of row arrays).
 * All rows must have the same length.
 *
 * @param {number[][]} matrix - Input matrix in row-major order
 * @returns {number[][]} Transposed matrix
 */
export function transpose(matrix) {
  if (matrix.length === 0) return [];
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = new Array(cols);
  for (let j = 0; j < cols; j++) {
    result[j] = new Array(rows);
    for (let i = 0; i < rows; i++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}
