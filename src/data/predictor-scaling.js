/**
 * predictor-scaling.js
 *
 * Automatic z-score standardisation of continuous predictor columns before
 * MCMC sampling, with exact back-transformation of posterior samples to
 * original data units.
 *
 * Why this is needed
 * ------------------
 * Component-wise Gibbs sampling mixes poorly when continuous predictors are
 * not centred:
 *   1. Uncentred x causes strong posterior correlation between the intercept
 *      (alpha) and slope (beta) → slow "zigzag" mixing.
 *   2. Large x values make Σ c[i]² huge in the conjugate normal-normal update,
 *      collapsing the posterior of beta to a very tight region that ignores the
 *      prior entirely when combined with the correlation issue.
 *
 * The fix is to standardise each continuous predictor to mean 0, SD 1 before
 * passing data to the sampler, then back-transform the posterior samples so
 * that all displayed results remain in the user's original data units.
 *
 * All functions are pure (no DOM/Worker dependencies) and run in either the
 * main thread or a Web Worker.
 */

// ---------------------------------------------------------------------------
// detectScalableColumns
// ---------------------------------------------------------------------------

/**
 * Identify continuous numeric columns that benefit from z-score scaling.
 *
 * A column is scaled when ALL of the following hold:
 *  - It is not a factor column (not in factorMaps).
 *  - It is not a grouping-index column (all integer values, few unique levels
 *    relative to row count — heuristic: max − min < 0.5 * n).
 *  - It is not the model response variable (detected by scanning modelSource
 *    for `colName[i] ~` patterns on the left-hand side of stochastic nodes).
 *  - Its standard deviation exceeds SD_THRESHOLD (columns already on a unit
 *    scale do not need rescaling).
 *
 * @param {Object.<string, Float64Array>} columns     - Numeric data columns.
 * @param {Object.<string, Object>}       factorMaps  - Factor-encoded columns.
 * @param {string}                        modelSource - Raw BUGS model text.
 * @returns {Object.<string, {mean: number, sd: number}>} scalingParams
 *   Keyed by column name; only columns that pass all criteria are included.
 */
export function detectScalableColumns(columns, factorMaps, modelSource) {
  const SD_THRESHOLD = 2; // columns with sd ≤ this are already well-scaled

  // Detect response variable names: LHS of stochastic assignments `name[i] ~`
  const responseNames = _findResponseColumns(modelSource);

  // Detect column names involved in interactions / polynomials — skip scaling
  // these because back-transformation is not straightforward.
  const interactionCols = _findInteractionColumns(modelSource, columns);

  const scalingParams = {};

  for (const [name, col] of Object.entries(columns)) {
    // Skip factor columns
    if (factorMaps && name in factorMaps) continue;

    // Skip response variables
    if (responseNames.has(name)) continue;

    // Skip interaction / polynomial columns
    if (interactionCols.has(name)) continue;

    // Skip integer-like grouping-index columns
    if (_isGroupingIndex(col)) continue;

    // Compute mean and SD
    const { mean, sd } = _meanSd(col);

    // Skip columns that are already on a manageable scale
    if (!isFinite(sd) || sd <= SD_THRESHOLD) continue;

    scalingParams[name] = { mean, sd };
  }

  return scalingParams;
}

// ---------------------------------------------------------------------------
// applyColumnScaling
// ---------------------------------------------------------------------------

/**
 * Return a shallow copy of `columns` with the specified columns z-score scaled.
 *
 * @param {Object.<string, Float64Array>} columns       - Original data columns.
 * @param {Object.<string, {mean: number, sd: number}>} scalingParams
 * @returns {Object.<string, Float64Array>} Columns with scaled predictors.
 */
export function applyColumnScaling(columns, scalingParams) {
  if (!scalingParams || Object.keys(scalingParams).length === 0) {
    return columns; // nothing to do — return original reference
  }

  const result = { ...columns };

  for (const [name, { mean, sd }] of Object.entries(scalingParams)) {
    const orig = columns[name];
    const scaled = new Float64Array(orig.length);
    for (let i = 0; i < orig.length; i++) {
      scaled[i] = (orig[i] - mean) / sd;
    }
    result[name] = scaled;
  }

  return result;
}

// ---------------------------------------------------------------------------
// parseBetaColumnMap
// ---------------------------------------------------------------------------

/**
 * Scan the BUGS model source and build a map from parameter names to the
 * predictor column they multiply.
 *
 * Handles patterns of the form:
 *   `paramName * colName[i]`   (scalar slope)
 *   `colName[i] * paramName`   (commuted form)
 *
 * Array-indexed random slopes `b[group[i]] * colName[i]` are detected and
 * recorded under the base name `b` with `isArray: true`.
 *
 * Interactions between two data columns (`x1[i] * x2[i]`) are intentionally
 * excluded — those are handled by `detectScalableColumns` via
 * `_findInteractionColumns`.
 *
 * @param {string}   modelSource  - Raw BUGS model text.
 * @param {Set<string>} scaledCols - Column names that were actually scaled.
 * @returns {Array<{paramBase: string, colName: string, isArray: boolean}>}
 */
export function parseBetaColumnMap(modelSource, scaledCols) {
  const entries = [];
  if (!scaledCols || scaledCols.size === 0) return entries;

  // Strip comments (lines starting with #)
  const src = modelSource.replace(/#[^\n]*/g, '');

  for (const col of scaledCols) {
    // Regex: `paramName * col[...]` or `col[...] * paramName`
    // paramName may be a plain identifier or an array like `b[group[i]]`
    const colPat = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape

    // Pattern 1: scalar_param * col[idx]
    const re1 = new RegExp(
      `\\b([A-Za-z][A-Za-z0-9_.]*(?:\\.[A-Za-z0-9_]+)?)\\s*\\*\\s*${colPat}\\s*\\[`,
      'g'
    );
    // Pattern 2: col[idx] * scalar_param
    const re2 = new RegExp(
      `${colPat}\\s*\\[[^\\]]*\\]\\s*\\*\\s*([A-Za-z][A-Za-z0-9_.]*(?:\\.[A-Za-z0-9_]+)?)`,
      'g'
    );
    // Pattern 3: array_param[...] * col[idx]  e.g. b[group[i]] * x[i]
    const re3 = new RegExp(
      `\\b([A-Za-z][A-Za-z0-9_]*)\\s*\\[[^\\]]*\\[[^\\]]*\\]\\s*\\]\\s*\\*\\s*${colPat}\\s*\\[`,
      'g'
    );
    // Pattern 4: col[idx] * array_param[...]
    const re4 = new RegExp(
      `${colPat}\\s*\\[[^\\]]*\\]\\s*\\*\\s*([A-Za-z][A-Za-z0-9_]*)\\s*\\[[^\\]]*\\[`,
      'g'
    );

    for (const [re, isArray] of [[re1, false], [re2, false], [re3, true], [re4, true]]) {
      let m;
      while ((m = re.exec(src)) !== null) {
        const paramBase = m[1];
        // Guard: don't record the column name itself as a parameter
        if (paramBase === col) continue;
        // Guard: don't duplicate
        if (entries.some(e => e.paramBase === paramBase && e.colName === col)) continue;
        entries.push({ paramBase, colName: col, isArray });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// backTransformSamples
// ---------------------------------------------------------------------------

/**
 * Convert posterior samples from the scaled space back to original data units.
 *
 * Given model `y ~ dnorm(alpha_s + beta_s * x_scaled, tau)` where
 * `x_scaled = (x − mean_x) / sd_x`, the back-transform is:
 *
 *   beta_orig  = beta_s / sd_x
 *   alpha_orig = alpha_s − beta_s * mean_x / sd_x
 *              = alpha_s − beta_orig * mean_x
 *
 * For multiple predictors the alpha correction accumulates:
 *   alpha_orig = alpha_s − Σ_k (beta_k_s * mean_xk / sd_xk)
 *
 * For array slope parameters (e.g. random slopes `c[1]`, `c[2]`, …) each
 * element is divided by sd_x independently.
 *
 * tau is precision on y and does not change.
 * Random-effect intercepts (b[j]) are y-space offsets and do not change.
 *
 * @param {Object.<string, number[]>} samples      - Raw (scaled-space) samples.
 * @param {Object.<string, {mean: number, sd: number}>} scalingParams
 * @param {string} modelSource - Raw BUGS model text (used to build betaColMap).
 * @returns {Object.<string, number[]>} Back-transformed samples (new arrays).
 */
export function backTransformSamples(samples, scalingParams, modelSource) {
  if (!scalingParams || Object.keys(scalingParams).length === 0) {
    return samples;
  }

  const scaledCols = new Set(Object.keys(scalingParams));
  const betaMap = parseBetaColumnMap(modelSource, scaledCols);

  if (betaMap.length === 0) {
    // No recognised slope-column pairs — return as-is
    return samples;
  }

  // Work on shallow copies of each array that needs transformation.
  const result = { ...samples };

  // Collect: which intercept-like parameters accumulate corrections?
  // We detect intercept names as parameters that are NOT beta/slope names and
  // appear in the same deterministic expression that contains a slope.
  const interceptNames = _findInterceptNames(modelSource, betaMap, scaledCols);

  // --- Apply slope back-transforms ---
  for (const { paramBase, colName, isArray } of betaMap) {
    const { mean: mean_x, sd: sd_x } = scalingParams[colName];

    if (!isArray) {
      // Scalar slope
      if (!(paramBase in samples)) continue;
      const raw = samples[paramBase];
      result[paramBase] = raw.map(v => v / sd_x);
    } else {
      // Array slope: transform all `paramBase[k]` entries found in samples
      for (const key of Object.keys(samples)) {
        if (!_isArrayEntry(key, paramBase)) continue;
        result[key] = samples[key].map(v => v / sd_x);
      }
    }
  }

  // --- Apply intercept corrections ---
  // alpha_orig[i] = alpha_s[i] − Σ_k (beta_k_s[i] * mean_xk / sd_xk)
  for (const interceptName of interceptNames) {
    if (!(interceptName in samples)) continue;
    const rawAlpha = samples[interceptName];
    const n = rawAlpha.length;

    // Accumulate correction for every slope associated with this intercept
    const correction = new Float64Array(n);
    for (const { paramBase, colName } of betaMap) {
      if (!(paramBase in samples)) continue;
      const { mean: mean_x, sd: sd_x } = scalingParams[colName];
      const betaRaw = samples[paramBase];
      for (let i = 0; i < n; i++) {
        correction[i] += betaRaw[i] * mean_x / sd_x;
      }
    }

    result[interceptName] = rawAlpha.map((v, i) => v - correction[i]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Compute mean and standard deviation of a Float64Array.
 */
function _meanSd(col) {
  const n = col.length;
  if (n === 0) return { mean: 0, sd: 0 };

  let sum = 0;
  for (let i = 0; i < n; i++) sum += col[i];
  const mean = sum / n;

  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = col[i] - mean;
    ss += d * d;
  }
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  return { mean, sd };
}

/**
 * Detect response variable column names from the model source.
 * Looks for `colName[...] ~` on the left-hand side of stochastic assignments.
 */
function _findResponseColumns(modelSource) {
  const names = new Set();
  // Pattern: word characters followed by [anything] then whitespace then ~
  const re = /\b([A-Za-z][A-Za-z0-9_]*)\s*\[[^\]]*\]\s*~/g;
  let m;
  while ((m = re.exec(modelSource)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Detect column names involved in column × column interactions or powers.
 * E.g. `x1[i] * x2[i]` or `pow(x[i], 2)`.
 * These columns should not be scaled because the back-transform is non-trivial.
 */
function _findInteractionColumns(modelSource, columns) {
  const interacting = new Set();
  const colNames = Object.keys(columns);

  const src = modelSource.replace(/#[^\n]*/g, '');

  // Look for col1[...] * col2[...] where both are data columns
  for (const c1 of colNames) {
    for (const c2 of colNames) {
      if (c1 === c2) continue;
      const pat = new RegExp(
        `\\b${_esc(c1)}\\s*\\[[^\\]]*\\]\\s*\\*\\s*${_esc(c2)}\\s*\\[`
      );
      if (pat.test(src)) {
        interacting.add(c1);
        interacting.add(c2);
      }
    }
  }

  // Look for pow(col[...], ...) — polynomial
  for (const c of colNames) {
    const pat = new RegExp(`\\bpow\\s*\\(\\s*${_esc(c)}\\s*\\[`);
    if (pat.test(src)) interacting.add(c);
  }

  return interacting;
}

/**
 * Return true if the column looks like an integer grouping index.
 * Heuristic: all values are whole numbers AND unique-value count is small
 * relative to row count (max − min < 0.5 * n).
 */
function _isGroupingIndex(col) {
  if (col.length === 0) return false;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (!Number.isInteger(v) && Math.abs(v - Math.round(v)) > 1e-9) return false;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return (max - min) < 0.5 * col.length;
}

/**
 * Find intercept parameter names: scalar parameters that appear additively in
 * the same deterministic expression as a scaled slope, but are NOT themselves
 * slope parameters.
 *
 * We scan only the RHS of `<-` assignments (after the arrow) that also
 * contain a reference to a scaled predictor column.  This avoids picking up
 * parameters that happen to share a line in a for-loop body (e.g. `tau` in
 * `y[i] ~ dnorm(mu[i], tau)` on the same line as `mu[i] <- alpha + beta*x[i]`).
 */
function _findInterceptNames(modelSource, betaMap, scaledCols) {
  const src = modelSource.replace(/#[^\n]*/g, '');
  const slopeNames = new Set(betaMap.filter(e => !e.isArray).map(e => e.paramBase));
  const interceptNames = new Set();

  // Split source into individual statements on `;`, `{`, `}`, or `\n`
  // so that each deterministic assignment is examined in isolation.
  const stmts = src.split(/[;\n{}]/);

  for (const col of scaledCols) {
    const colPat = _esc(col);

    for (const stmt of stmts) {
      // Only consider deterministic assignments (`<-`) whose RHS references col
      const arrowIdx = stmt.indexOf('<-');
      if (arrowIdx === -1) continue;

      const rhs = stmt.slice(arrowIdx + 2);

      // Check that the RHS contains col[...]
      if (!new RegExp(`${colPat}\\s*\\[`).test(rhs)) continue;

      // Collect all plain identifiers (not followed by `[`) in the RHS that
      // are not data columns, not slope names, and not reserved keywords.
      const idRe = /\b([A-Za-z][A-Za-z0-9_.]*)(?!\s*[\[(])/g;
      let im;
      while ((im = idRe.exec(rhs)) !== null) {
        const id = im[1];
        if (id === col) continue;
        if (scaledCols.has(id)) continue;
        if (slopeNames.has(id)) continue;
        if (/^[a-z]$/.test(id)) continue; // loop index like i, j
        if (/^(for|in|model|dnorm|dgamma|dunif|dpois|dbern|dbin|dbeta|dlnorm|log|exp|sqrt|pow|abs|logit|phi|step|equals|max|min|sum|prod|sd|mean|inprod|inverse)$/.test(id)) continue;
        interceptNames.add(id);
      }
    }
  }

  return interceptNames;
}

/** Check whether `key` like `"b[3]"` belongs to array base name `base`. */
function _isArrayEntry(key, base) {
  return key === base || key.startsWith(base + '[');
}

/** Regex-escape a string for use in RegExp. */
function _esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
