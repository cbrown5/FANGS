# Predictions Tab — Implementation Plan

## Context

The FANGS UI spec (CLAUDE.md) lists a **Predictions** tab — "x-y plot with observed
data and posterior mean and 95% CIs regression line" — but it does not exist yet
(no `src/ui/predictions-plot.js`; no tab in `index.html`). We want the user to plot
model predictions against a chosen covariate, working across GLM link functions,
continuous and categorical predictors, multiple covariates, interactions, and
mixed-effects models.

**Key design decision (confirmed with user):** predictions are computed
**on demand on the main thread**, *not* during fitting. Rationale: the user picks
the focal covariate and "hold others at" values interactively after fitting, so a
grid can't be precomputed; and fitting already runs a bounded prediction pass
(`_generatePredictions`, sampler-worker.js:171) at observed rows — duplicating it
would only slow fitting without giving interactivity. The on-demand cost
(~100 grid points × ~200 thinned draws ≈ 20k deterministic evals per render) is the
same order as that existing pass and is fast enough on the main thread.

**MVP scope (confirmed):** recompute-on-change controls — a focal-covariate dropdown
plus "hold others at" fields; **continuous** focal covariate; **response scale**;
random effects set to **0 (conditional)**. Deferred to later: categorical focal
covariate (dot+CI), link↔response scale toggle, "colour by" second factor,
marginal/average-over-data mode, and the educational popup.

## Keystone technique

Reuse `ModelGraph.computeMarginalFittedMeans()` (model-graph.js:740) — which already
zeros every array-indexed latent node (random effects) and applies inverse links via
`_mergeValues` — but evaluate it over a **synthetic covariate grid** instead of the
observed rows:

1. Build a synthetic data object in **original (unscaled) units**: focal covariate
   swept over its observed min→max (~100 points); every other model-referenced
   column held at a representative value; a dummy response column so the response
   nodes classify as `observed` (`_isObserved` only needs a non-NaN value,
   model-graph.js:1194); grouping column filled with a valid index (1); `N`=grid
   length, `J`=max(dataJ,1).
2. Build the graph **once** per grid spec: `new ModelGraph(ast, {columns, N, J}).build()`.
3. For each of ~200 thinned posterior draws, assemble `paramValues` from the retained
   `posteriorSamples` and call `graph.computeMarginalFittedMeans(paramValues)` →
   response-scale mean at each grid point (inverse link + RE=0 applied automatically).
4. Per grid point: posterior **mean** + **2.5/97.5%** quantiles → mean line + 95%
   credible ribbon.

**Unit consistency (critical):** `posteriorSamples` are back-transformed to original
units after fitting (app.js:564-569), and the synthetic grid is built in original
units, so the arithmetic is self-consistent. Never use the scaled worker columns here.

**Why this handles the hard cases for free:** running the real model graph forward
means link functions, arbitrary deterministic `mu` expressions, and interactions
(`x1[i]*x2[i]`) all evaluate correctly without special-casing — they're just part of
the deterministic node evaluation.

## Files to change

### 1. New: `src/ui/predictions-plot.js` (`PredictionsPlot` class)
- **Imports** (pure ES modules, browser-safe, no bundler in use — app runs via
  `npx serve .`): `Lexer` (parser/lexer.js), `Parser` (parser/parser.js), `ModelGraph`
  (parser/model-graph.js). Copy the small canvas helpers (`_resizeCanvas`, `_fmtAxis`,
  `_silverman`) and the pink palette from `ppc-plot.js` (consistent with current
  codebase style — these are duplicated across plot modules already).
- **Public API** mirroring other plots: `update({samples, modelSource, columns,
  factorMaps, dataJ, responseVar})`, `clear()`, `render()` (redraw on tab show, like
  `density.render()`).
- **Controls** (built once in `_build()`, repopulated each `update()`), reusing the
  ScatterPlot dropdown pattern (scatter-plot.js:128-187):
  - *Focal covariate* `<select>`: continuous columns referenced in the model
    (detect via `\bNAME\s*\[` over `modelSource`), excluding `responseVar` and the
    grouping/index column. `change` → recompute → draw.
  - *Hold others at*: one editable `<input type=number>` per other continuous
    covariate (default = column mean) and a `<select>` of factor levels per
    categorical covariate (default = first level, code 1; levels from `factorMaps`,
    whose shape is `{levelLabel: code}`, csv-loader.js:300-314). The grouping/index
    column is handled silently (always a valid index), not shown as a control.
- **`recompute()`**: cache the parsed AST; build synthetic columns (all model-referenced
  data columns, focal swept, others held, dummy response = 0, group = 1); build graph;
  loop thinned draws calling `computeMarginalFittedMeans`; reduce to mean + 2.5/97.5%
  per grid point. Rebuild the graph on each control change (cheap; AST is cached) since
  `_dataColumns`/`_baseValues` are fixed at construction.
- **`_draw()`**: shaded 95% ribbon, mean line, observed scatter (`columns[focal]` vs
  `columns[responseVar]`), axes labelled focal / response, same dark-pink theme.
- **Edge states**: not-run → empty-state message; no continuous covariate in model
  (e.g. intercept-only) → explanatory message.

### 2. `index.html` — add tab button + pane
Mirror the Posteriors tab pattern (index.html:904-912). Add a `data-tab="predictions"`
button in `<nav id="tabs">` (after `ppc`) and a `<div class="tab-pane"
id="pane-predictions">` containing `<div id="predictions-container">` with an
empty-state. **Omit `data-popup`** for now (the `predictions-tab` popup is deferred).

### 3. `src/app.js` — instantiate + wire
- Import and instantiate: `const predictions = new PredictionsPlot(
  document.getElementById('predictions-container'));` (alongside app.js:32-41).
- Capture `factorMaps` into the run closure (currently it's destructured at app.js:386
  but not retained): add `capturedFactorMaps = factorMaps`.
- In `handleSummaryMessage` DONE branch (after `scatter.setSamplesMap`, app.js:504),
  call `predictions.update({ samples: posteriorSamples, modelSource: capturedModelCode,
  columns: capturedOriginalDataColumns, factorMaps: capturedFactorMaps,
  dataJ: capturedDataJ, responseVar })` — `responseVar` already derived at app.js:493.
- Tab-switch hook (app.js:280-299): `if (btn.dataset.tab === 'predictions')
  predictions.render();`.
- On Run reset (near app.js:354): `predictions.clear();`.

## Performance & correctness notes
- Graph built once per grid spec; thin to ~200 draws to keep control changes snappy.
- Random effects: `computeMarginalFittedMeans` zeros all `name.includes('[')` latent
  nodes, so the synthetic group index only needs to be in `1..J` (use 1).
- Response scale per family is handled by `DIST_MEAN` (model-graph.js:96) — dnorm→μ,
  dpois→λ, dbinom→p·n, dbern→p — no per-family code in the tab.

## Verification (end-to-end)
1. `npx serve .`, open the app, keep the default dataset, click **Run**, open the new
   **Predictions** tab.
2. **Linear model 1** (`mu <- alpha + beta*x`): straight mean line + ribbon vs `x`,
   observed points overlaid.
3. **Mixed model 2** (`+ b[group[i]]`): line should be `alpha + beta*x` (RE zeroed) —
   compare against the marginal line the PPC tab already produces for the same model.
4. **Poisson** (`poisson-example.csv`, log link): curved exp() mean line on the response
   (count) scale, strictly positive.
5. **Bernoulli/Binomial** (`bernoulli-example.csv`, logit link): S-shaped curve bounded
   in (0,1).
6. Change a "hold others at" value and confirm the line updates; with an interaction
   term, confirm the slope changes with the held value.
7. **Automated**: add a test in `tests/` (Vitest) for the pure grid-compute helper —
   build the synthetic grid at the *observed* covariate values and assert the result
   matches `computeMarginalFittedMeans` on the real data graph (same numbers), guarding
   the keystone. Run `npx vitest`.

## Deferred (not in this MVP)
Categorical focal covariate (dot + CI), response↔link scale toggle, colour-by second
factor, marginal/average-over-observed-data mode, and a `predictions-tab.qmd`
educational popup (conditional-vs-marginal & RE=0).