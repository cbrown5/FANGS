# Predictions Tab — Implementation Plan

## Status: DONE ✓

All MVP items are implemented and merged (PR #39).

## What was built

### `src/ui/predictions-plot.js` (new)
`PredictionsPlot` class with:
- `update()` / `clear()` / `render()` public API mirroring other plot modules
- Detects continuous covariates referenced as `NAME[` in the model source, excluding the response variable and group column
- Focal-covariate dropdown; "Hold others at" inputs (continuous → numeric input at column mean, categorical → select from `factorMaps` levels)
- `_recompute()`: builds a 100-point synthetic grid, constructs a `ModelGraph` with dummy observed response (zeros), loops over ~200 thinned posterior draws calling `computeMarginalFittedMeans`, reduces to posterior mean + 2.5/97.5 quantiles per grid point
- `_draw()`: dark-pink themed canvas — shaded credible ribbon, mean line, observed scatter, axis labels, inline legend

### `index.html`
- Predictions tab button (after PPC) and pane with `#predictions-container`

### `src/app.js`
- Imports and instantiates `PredictionsPlot`
- Captures `factorMaps` from CSV parsing
- Calls `predictions.update()` in the DONE handler, `predictions.clear()` on Run reset, `predictions.render()` on tab switch

## Design decisions (recorded for reference)

**Key design decision:** predictions computed **on demand on the main thread**, not during fitting. The user picks focal covariate and "hold others at" values interactively after fitting, so a grid can't be precomputed. On-demand cost (~100 grid points × ~200 thinned draws ≈ 20k deterministic evals per render) is fast enough on the main thread.

**Keystone technique:** reuse `ModelGraph.computeMarginalFittedMeans()` (model-graph.js:740) over a synthetic covariate grid — handles link functions, arbitrary deterministic expressions, interactions, and random effects (zeroed) for free.

**Unit consistency:** `posteriorSamples` are back-transformed to original units after fitting; synthetic grid is also built in original units.

## Deferred (not in MVP)
- Categorical focal covariate (dot + CI)
- Response ↔ link scale toggle
- Colour-by second factor
- Marginal/average-over-observed-data mode
- `predictions-tab.qmd` educational popup (conditional-vs-marginal & RE=0)
- Automated Vitest test for grid-compute helper