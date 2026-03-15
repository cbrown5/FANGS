# FANGS Development Progress

## What Has Been Built

All core modules are in place. The project is fully scaffolded with working
implementations across parser, samplers, UI, and tests.

### Source files (`src/`)

| File | Status | Notes |
|------|--------|-------|
| `app.js` | Done | UI orchestration: editor, data upload, tab switching, run/stop/download. Sampler wiring is stubbed (see Next Steps). |
| `parser/lexer.js` | Done | Tokenises BUGS/JAGS syntax |
| `parser/parser.js` | Done | Builds AST from token stream |
| `parser/model-graph.js` | Done | DAG from AST; detects conjugate structure per node (`conjugateType`) |
| `samplers/gibbs.js` | Done | Component-wise Gibbs loop; conjugate updates for normal-normal, gamma-precision, beta-binom, gamma-Poisson; falls back to slice |
| `samplers/slice.js` | Done | Slice sampler fallback for non-conjugate nodes |
| `samplers/initialize.js` | Done | Overdispersed chain initialisation from priors |
| `samplers/sampler-worker.js` | Done | Web Worker wrapper: receives START/STOP messages, streams SAMPLES/PROGRESS/DONE/ERROR back to the main thread |
| `data/csv-loader.js` | Done | CSV parsing and column preparation |
| `data/default-data.js` | Done | Built-in example dataset and pre-filled model text |
| `ui/editor.js` | Done | Model text editor with error display |
| `ui/trace-plot.js` | Done | Live chain trace plots (canvas) |
| `ui/density-plot.js` | Done | Posterior density plots (canvas) |
| `ui/summary-table.js` | Done | Posterior summary table (mean, SD, quantiles, Rhat, ESS) |
| `ui/ppc-plot.js` | Done | Posterior predictive check plot |
| `ui/settings.js` | Done | Sampler settings panel (chains, samples, burn-in, thin) |
| `utils/distributions.js` | Done | Log-densities and samplers for dnorm, dgamma, dbeta, dpois, dbern, dbinom, dunif, dlnorm; logit/invLogit |
| `utils/math.js` | Done | Statistical math helpers |
| `utils/diagnostics.js` | Done | Rhat, ESS, convergence checks |

### Tests (`tests/`)

| File | Status | Notes |
|------|--------|-------|
| `parser.test.js` | Done | Parser and lexer unit tests |
| `distributions.test.js` | Done | Full unit tests for all log-density and sampler functions |
| `integration.test.js` | Done | End-to-end: parse → graph → init → Gibbs → check output structure and loose statistical validity |
| `r-reference/linear-model.R` | Done | R/nimble reference for linear model |
| `r-reference/mixed-effects.R` | Done | R/nimble reference for mixed-effects model |

---

## What Needs to Be Done Next

### 1. Wire the Web Worker into `app.js` (highest priority)
`app.js` currently shows `"Sampler not yet implemented"` when Run is clicked.
`sampler-worker.js` already exists and is complete. The work needed:

- In `btnRun` handler, replace the stub (lines 197–199) with:
  - Create `new Worker(new URL('./samplers/sampler-worker.js', import.meta.url), { type: 'module' })`
  - Parse the loaded CSV via `csv-loader.js` to extract `dataColumns`, `dataN`, `dataJ`
  - Post a `START` message with `{ modelSource, dataColumns, dataN, dataJ, settings }`
  - Handle incoming messages:
    - `PROGRESS` → call `setProgress()` and `trace.addSample()`
    - `SAMPLES`  → buffer samples into `posteriorSamples`
    - `DONE`     → call `density.render()`, `summary.render()`, `ppc.render()` with final samples/summary
    - `ERROR`    → display the error in the status bar and editor
- Wire `btnStop` to post `{ type: 'STOP' }` to the worker

### 2. Run and fix the test suite
```bash
npx vitest
```
Tests were written ahead of some implementations — expect failures that reveal
missing exports or API mismatches. Fix until the suite is green.

### 3. Statistical validation against R/nimble references
- Run `Rscript tests/r-reference/linear-model.R` and `mixed-effects.R` to generate
  JSON reference posteriors.
- Add fixture loading to `integration.test.js` and assert posterior means are
  within ~0.1 SD of nimble reference values and 95% CIs overlap.

### 4. GLM and mixed-effects support verification
The sampler has conjugate types for normal-normal and gamma-precision. Verify
end-to-end that:
- Poisson GLM with log link fits correctly (conjugate gamma-Poisson + slice for `mu`)
- Binomial/Bernoulli GLM with logit link fits correctly (slice sampler path)
- Mixed-effects model (random intercepts `b[j]`) fits correctly

### 5. R-reference scripts for GLMs
Add `tests/r-reference/poisson-glm.R` and `binomial-glm.R` (listed in CLAUDE.md
but not yet created).

### 6. Prior predictive check
`btnPriorCheck` in `app.js` shows `"not yet implemented"`. Implement by running
the sampler worker with data likelihood disabled (needs a flag in the worker
protocol).

### 7. UI polish / educational pop-up system / data viewer
`ui/popups.js` is listed in the architecture but not yet created. Add tooltip/modal
pop-ups for teaching use. Add a tab that shows teh loaded data as a table, for checking

### 8. `index.html` audit
Verify all DOM element IDs referenced in `app.js` (`model-editor`, `editor-error`,
`trace-container`, `density-container`, `summary-container`, `ppc-container`,
`settings-panel`, `btn-run`, `btn-stop`, `btn-download`, `btn-prior-check`,
`btn-model-1`, `btn-model-2`, `drop-zone`, `data-file-input`, `data-status`,
`btn-browse`, `btn-load-example`, `status-bar`, `status-text`, `progress-bar`,
tab buttons and panes) are all present in `index.html`.

---

## Running the App

```bash
# Serve locally (no build step needed)
npx serve .

# Run tests
npx vitest

# R reference tests (requires R + nimble)
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
```
