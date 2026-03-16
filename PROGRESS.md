# FANGS Development Progress

## What Has Been Built

All core modules are in place. The project is fully scaffolded with working
implementations across parser, samplers, UI, and tests.

### Source files (`src/`)

| File | Status | Notes |
|------|--------|-------|
| `app.js` | Done | Full UI orchestration: editor, data upload, tab switching, run/stop/download, sampler worker wiring, prior predictive check, model constants panel |
| `parser/lexer.js` | Done | Tokenises BUGS/JAGS syntax |
| `parser/parser.js` | Done | Builds AST from token stream; fixed infinite-loop on unclosed brace |
| `parser/model-graph.js` | Done | DAG from AST; detects conjugate structure per node (`conjugateType`); fixed IndexExpr edge wiring; fixed `'beta-binomial'` → `'beta-binom'` string; normal-normal only tagged when param is direct mean |
| `samplers/gibbs.js` | Done | Component-wise Gibbs loop; conjugate updates for normal-normal, gamma-normal, beta-binom, gamma-Poisson; falls back to slice; fixed `'gamma-precision'` → `'gamma-normal'` conjugate type name mismatch |
| `samplers/slice.js` | Done | Slice sampler fallback for non-conjugate nodes |
| `samplers/initialize.js` | Done | Overdispersed chain initialisation from priors; fixed catastrophic underflow for very diffuse gamma priors (`dgamma(0.001, 0.001)`) — now starts at `Gamma(1,1)` |
| `samplers/sampler-worker.js` | Done | Web Worker wrapper: receives START/STOP messages, streams SAMPLES/PROGRESS/DONE/ERROR back to the main thread; supports `priorOnly` flag; accepts `dataConstants` |
| `data/csv-loader.js` | Done | CSV parsing and column preparation |
| `data/default-data.js` | Done | Built-in example dataset now matches `data/example.csv` (same R seed=42 data used by reference tests); removed `treatment` column |
| `ui/editor.js` | Done | Model text editor with error display |
| `ui/trace-plot.js` | Done | Live chain trace plots (canvas); left-to-right draw; real iteration numbers on x-axis; nice round tick labels |
| `ui/density-plot.js` | Done | Posterior density plots (canvas); nice round tick labels via `_niceTicks()` |
| `ui/summary-table.js` | Done | Posterior summary table (mean, SD, quantiles, Rhat, ESS) |
| `ui/ppc-plot.js` | Done | Posterior predictive check plot |
| `ui/settings.js` | Done | Sampler settings panel (chains, samples, burn-in, thin) |
| `ui/data-table.js` | Done | Renders loaded CSV as a scrollable HTML table (max 200 rows) |
| `ui/popups.js` | Done | Educational popup system; `type="button"` fix; 5-second fetch timeout with helpful file:// error message |
| `content/popups/*.md` | Done | 17 Markdown files containing popup text; edit these to update popup content |
| `utils/distributions.js` | Done | Log-densities and samplers for dnorm, dgamma, dbeta, dpois, dbern, dbinom, dunif, dlnorm; logit/invLogit; fixed rgamma underflow for small shape |
| `utils/math.js` | Done | Statistical math helpers |
| `utils/diagnostics.js` | Done | Rhat, ESS, convergence checks |

### Tests (`tests/`)

| File | Status | Notes |
|------|--------|-------|
| `parser.test.js` | Done | 148 tests — parser and lexer unit tests |
| `distributions.test.js` | Done | 92 tests — full unit tests for all log-density and sampler functions |
| `integration.test.js` | Done | 222 tests — linear model, mixed-effects, Poisson GLM, Bernoulli GLM; parse → graph → init → Gibbs → statistical validity; mixed-effects convergence test updated to 3 chains × 500 samples |
| `r-reference/generate-default-data.R` | Done | R script to regenerate the default CSV dataset |
| `r-reference/linear-model.R` | Done | R/nimble reference for linear model |
| `r-reference/mixed-effects.R` | Done | R/nimble reference for mixed-effects model |
| `r-reference/poisson-glm.R` | Done | R/nimble reference for Poisson GLM; includes exact analytical posterior |
| `r-reference/binomial-glm.R` | Done | R/nimble reference for Bernoulli/Beta model; includes exact analytical posterior |

**222 tests defined; 222 passing.**

---

## What Has Been Done (Recent)

### Gibbs sampler statistical validation (2026-03-16)

Four bugs were found and fixed by running 3 chains × 5000 samples and comparing
to R/NIMBLE reference posteriors (`tests/r-reference/results/linear-model-reference.json`).
After fixes, FANGS posterior means match NIMBLE to within 0.02 SD for all parameters.

**Bug 1 — `'gamma-precision'` / `'gamma-normal'` name mismatch** (`gibbs.js`)
`detectConjugateType` in `model-graph.js` returned `'gamma-normal'` for a Gamma
prior on a precision parameter, but the switch in `updateParameter` used `'gamma-precision'`.
Tau always fell through to slice sampling and returned values near 0 (~0.009 vs reference ~1.94).

**Bug 2 — `'beta-binomial'` / `'beta-binom'` name mismatch** (`model-graph.js`)
Same class of bug for the Beta prior conjugate update.

**Bug 3 — Normal-normal conjugate update applied to indirect mean parameters** (`model-graph.js`)
`alpha` and `beta` were tagged `'normal-normal'` despite entering `y[i]` through a
deterministic `mu[i]` node. The conjugate formula only applies when the parameter IS
the direct mean of the likelihood. With no children found, n=0, and the update sampled
from the prior with SD=31. Fixed by requiring the parameter appear directly (not through
a deterministic intermediary) as the first argument of the dnorm children.

**Bug 4 — Catastrophic initialization for diffuse gamma priors** (`initialize.js`)
`tau ~ dgamma(0.001, 0.001)` initialized with `shape/2 = 0.0005`, causing `u^(1/shape)
= u^2000 → 0` (floating-point underflow) via the Gamma boosting trick. Result: tau≈0 at
chain start, making all slice sampler widths degenerate. Fixed by using `Gamma(1, 1)` as
the starting distribution when shape < 0.1 or rate < 0.01.

**Data mismatch fixed** (`default-data.js`)
The embedded `defaultCSV` in `default-data.js` was generated with a different random seed
than `data/example.csv` used by the R reference tests. Updated `defaultCSV` to match
`data/example.csv` exactly (R seed=42, no `treatment` column). OLS estimates on the
shared dataset: alpha ≈ 2.29, beta ≈ 1.38, tau ≈ 1.94 — consistent with NIMBLE reference.

### Default data simplified

- New DGP (no treatment confound): `y_i = 2 + 1.5·x_i + b_{group[i]} + ε_i`,
  `b_group ~ N(0, 0.5²)`, `ε ~ N(0, 0.7²)`, N=50, 5 groups of 10
- R script to regenerate: `tests/r-reference/generate-default-data.R`

### Bug fixes (UI)

- **Popup freeze**: `?` trigger buttons now have `type="button"` (prevents accidental
  form submission); `fetch()` uses a 5-second `AbortController` timeout with a clear
  message if the app is opened via `file://` instead of a local server.
- **Trace plot x-axis**: traces draw left-to-right from the first sample; x-axis labels
  show real iteration numbers (e.g. 1 → 2000) rather than buffer indices.
- **Axis tick labels**: both `trace-plot.js` and `density-plot.js` use a `_niceTicks()`
  helper that picks round step sizes (1, 2, 5, 10, …) and formats labels as whole
  numbers where possible (e.g. `-2, -1, 0, 1, 2` instead of `-1.97, -0.983, …`).

### Earlier work (summarised)

- Model constants panel (auto-detects scalar loop bounds; N read-only, J auto-inferred)
- Educational popup system (17 Markdown files, modal overlay, `attachPopupTrigger` API)
- Test infrastructure: vitest installed, R reference JSON fixtures in `tests/r-reference/results/`
- Code review: critical sampler-worker buffer-flush bug fixed; dead code removed;
  `distributionUsesParam` rewritten as deterministic AST traversal

---

## What Needs to Be Done Next

### 1. Statistical validation against R/nimble references

Simple linear model validated: FANGS matches NIMBLE to within 0.02 SD (3 chains × 5000 samples).

Remaining:
- Add fixture-loading tests to `integration.test.js`: read the JSON files and assert that
  FANGS posterior means are within ~0.1 SD of nimble reference values and that 95% CIs overlap.
- Run R reference scripts for mixed-effects, Poisson GLM, and Bernoulli GLM and validate those too.

### 2. Posterior predictive samples (full PPC)

The PPC tab currently shows observed `y` only (no simulated predictions).
To complete it: after sampling, draw replicated data sets `y_rep` by sampling
from the likelihood at each posterior draw, then overlay the distribution of
`y_rep` against the observed histogram. This requires generating predictions
inside the worker and sending them back in the DONE message.

### 3. Logit-link GLM end-to-end test

A Bernoulli GLM with a logit link (e.g. `logit(p[i]) <- alpha + beta * x[i]`)
uses the slice sampler throughout. Add an integration test that fits this model
against a small toy dataset and checks that `alpha` and `beta` samples are
finite and the posterior mean is in the right direction.

### 4. UI polish

- Status-bar styling for `running` / `done` / `error` states
- Disable model selector buttons while sampling is in progress
- Show per-chain Rhat colour coding in the summary table (red if Rhat > 1.1)

### 5. Add About and Instructions pages

Add pages for About and Instructions. Access via a hamburger menu in the header bar.
Also add links to Github and seascapemodels.org.

---

## Running the App

```bash
# Serve locally (no build step needed)
npx serve .

# Install JS dependencies (one-time)
npm install

# Run all JS tests
npx vitest run

# R reference tests (requires R + nimble)
# Output goes to tests/r-reference/results/
Rscript tests/r-reference/generate-default-data.R
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
Rscript tests/r-reference/poisson-glm.R
Rscript tests/r-reference/binomial-glm.R
```
