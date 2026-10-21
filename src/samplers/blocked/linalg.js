/**
 * linalg.js - Small dense linear algebra for the blocked sampler (CPU side)
 *
 * Matrices are row-major Float64Arrays of size n×n. Only what the fixed-effects
 * block update needs: Cholesky factorisation and triangular solves.
 */

/**
 * In-place Cholesky factorisation A = L Lᵀ. On return the lower triangle of
 * `a` holds L (the strict upper triangle is zeroed).
 *
 * @param {Float64Array} a - symmetric positive-definite n×n matrix (row-major)
 * @param {number} n
 * @returns {boolean} false if a non-positive pivot was met (A not PD)
 */
export function choleskyInPlace(a, n) {
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j];
    for (let k = 0; k < j; k++) d -= a[j * n + k] * a[j * n + k];
    if (!(d > 0)) return false;
    const ljj = Math.sqrt(d);
    a[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = s / ljj;
    }
    for (let k = j + 1; k < n; k++) a[j * n + k] = 0;
  }
  return true;
}

/** Solve L x = b in place (L lower-triangular, from choleskyInPlace). */
export function forwardSolve(l, n, b) {
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * b[k];
    b[i] = s / l[i * n + i];
  }
  return b;
}

/** Solve Lᵀ x = b in place (L lower-triangular, from choleskyInPlace). */
export function backSolveTranspose(l, n, b) {
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * b[k];
    b[i] = s / l[i * n + i];
  }
  return b;
}

/** log|A| from its Cholesky factor L. */
export function logDetFromCholesky(l, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.log(l[i * n + i]);
  return 2 * s;
}

/** ‖Lᵀ v‖² — the quadratic form vᵀ A v for A = L Lᵀ. */
export function quadFormFromCholesky(l, n, v) {
  let total = 0;
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = j; i < n; i++) s += l[i * n + j] * v[i];
    total += s * s;
  }
  return total;
}
