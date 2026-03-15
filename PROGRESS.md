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
| `parser/model-graph.js` | Done | DAG from AST; detects conjugate structure per node (`conjugateType`); fixed IndexExpr edge wiring (`expr.object.name`) |
| `samplers/gibbs.js` | Done | Component-wise Gibbs loop; conjugate updates for normal-normal, gamma-precision, beta-binom, gamma-Poisson; falls back to slice; fixed `onProgress` call signature and `shouldStop` callback |
| `samplers/slice.js` | Done | Slice sampler fallback for non-conjugate nodes |
| `samplers/initialize.js` | Done | Overdispersed chain initialisation from priors |
| `samplers/sampler-worker.js` | Done | Web Worker wrapper: receives START/STOP messages, streams SAMPLES/PROGRESS/DONE/ERROR back to the main thread; supports `priorOnly` flag; accepts `dataConstants` |
| `data/csv-loader.js` | Done | CSV parsing and column preparation |
| `data/default-data.js` | Done | Built-in example dataset and pre-filled model text |
| `ui/editor.js` | Done | Model text editor with error display |
| `ui/trace-plot.js` | Done | Live chain trace plots (canvas) |
| `ui/density-plot.js` | Done | Posterior density plots (canvas) |
| `ui/summary-table.js` | Done | Posterior summary table (mean, SD, quantiles, Rhat, ESS) |
| `ui/ppc-plot.js` | Done | Posterior predictive check plot |
| `ui/settings.js` | Done | Sampler settings panel (chains, samples, burn-in, thin) |
| `ui/data-table.js` | Done | Renders loaded CSV as a scrollable HTML table (max 200 rows) |
| `ui/popups.js` | Done | Educational popup system: fetches Markdown files, parses to HTML, shows modal overlay; trigger buttons attached via `data-popup` attributes |
| `content/popups/*.md` | Done | 17 Markdown files containing popup text; edit these to update popup content |
| `utils/distributions.js` | Done | Log-densities and samplers for dnorm, dgamma, dbeta, dpois, dbern, dbinom, dunif, dlnorm; logit/invLogit; fixed rgamma underflow for small shape |
| `utils/math.js` | Done | Statistical math helpers |
| `utils/diagnostics.js` | Done | Rhat, ESS, convergence checks |

### Tests (`tests/`)

| File | Status | Notes |
|------|--------|-------|
| `parser.test.js` | Done | 148 tests — parser and lexer unit tests |
| `distributions.test.js` | Done | 92 tests — full unit tests for all log-density and sampler functions |
| `integration.test.js` | Done | 49 tests — linear model, mixed-effects, Poisson GLM, Bernoulli GLM; parse → graph → init → Gibbs → statistical validity |
| `r-reference/linear-model.R` | Done | R/nimble reference for linear model |
| `r-reference/mixed-effects.R` | Done | R/nimble reference for mixed-effects model |
| `r-reference/poisson-glm.R` | Done | R/nimble reference for Poisson GLM; includes exact analytical posterior |
| `r-reference/binomial-glm.R` | Done | R/nimble reference for Bernoulli/Beta model; includes exact analytical posterior |

**Total: 289 tests, all passing.**

---

## What Has Been Done (Recent)

### Model constants panel

Implemented per `handling-scalar-params.md`:
- `extractRequiredScalars(modelText)` in `app.js` scans for `1:NAME` patterns in for-loop bounds
- A **Model constants** panel appears automatically between the model editor and sampler settings whenever the model references scalar variables not present as CSV columns
- **N** is always read-only, inferred from the number of data rows
- **J** is auto-inferred as the number of unique `group` levels when a `group` column is present; otherwise editable
- Any other scalar (K, M, …) appears as an editable numeric input labeled "required — enter value"
- The panel updates live (debounced 400ms) as the model text changes and when new data is loaded
- Constants are passed to the sampler worker via `dataConstants` and merged into the `ModelGraph` data object so they are available as named scalars during evaluation

### Educational popup system

- `src/ui/popups.js`: scans `[data-popup]` elements on load and appends a small `?` button; clicking fetches `src/content/popups/<id>.md`, converts it with an inline Markdown parser, and shows a modal overlay
- 17 Markdown files in `src/content/popups/` cover all key concepts (MCMC, Gibbs, chains, burn-in, thinning, trace plots, R-hat, ESS, posterior, prior, credible intervals, PPC, prior check, precision/τ, mixed-effects, posteriors tab, summary tab)
- `?` buttons appear on: sampler setting labels (Chains, Samples, Burn-in, Thinning), the "Sampler settings" section header, and pane titles (Trace, Posteriors, Summary, PPC, Prior Check)
- Summary table column headers (R-hat, ESS, Mean, 2.5%, 97.5%) also get popup triggers via `attachPopupTrigger()` called from `app.js`

---

## What Needs to Be Done Next

### 1. Statistical validation against R/nimble references
Requires R + nimble to be installed.

- Run all four R reference scripts to generate JSON fixture files:
  ```bash
  Rscript tests/r-reference/linear-model.R
  Rscript tests/r-reference/mixed-effects.R
  Rscript tests/r-reference/poisson-glm.R
  Rscript tests/r-reference/binomial-glm.R
  ```
- Add fixture loading to `integration.test.js`: read the generated JSON files and
  assert that FANGS posterior means are within ~0.1 SD of nimble reference values
  and that 95% CIs overlap.

### ~~2. Educational pop-up system~~ ✓ Done
`src/ui/popups.js` implemented. 17 Markdown content files in `src/content/popups/`
cover MCMC, Gibbs sampling, chains, burn-in, thinning, trace plots, R-hat, ESS,
posteriors, priors, credible intervals, PPC, prior check, precision (τ), and
mixed-effects models. `?` trigger buttons are attached via `data-popup` HTML
attributes and programmatically on summary table column headers. See README.md
for instructions on adding new popups.

### 3. Posterior predictive samples (full PPC)
The PPC tab currently shows observed `y` only (no simulated predictions).
To complete it: after sampling, draw replicated data sets `y_rep` by sampling
from the likelihood at each posterior draw, then overlay the distribution of
`y_rep` against the observed histogram. This requires generating predictions
inside the worker and sending them back in the DONE message.

### 4. Logit-link GLM end-to-end test
A Bernoulli GLM with a logit link (e.g. `logit(p[i]) <- alpha + beta * x[i]`)
uses the slice sampler throughout. Add an integration test that fits this model
against a small toy dataset and checks that `alpha` and `beta` samples are
finite and the posterior mean is in the right direction.

### 5. UI polish
- Status-bar styling for `running` / `done` / `error` states
- Disable model selector buttons while sampling is in progress
- Show per-chain Rhat colour coding in the summary table (red if Rhat > 1.1)

---

## Running the App

```bash
# Serve locally (no build step needed)
npx serve .

# Run tests
node tests/parser.test.js
node tests/distributions.test.js
node tests/integration.test.js

# R reference tests (requires R + nimble)
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
Rscript tests/r-reference/poisson-glm.R
Rscript tests/r-reference/binomial-glm.R
```
