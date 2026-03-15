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

## What Has Been Done (Recent)

### Test infrastructure and R reference results

- Installed `vitest` via `npm install` (was listed in `package.json` but not installed)
- All tests now run with `npx vitest run` — **219/222 passing**
- **3 pre-existing failures** in `Pipeline: posterior means in ballpark of true DGP (100 iterations)`:
  - After 100 iterations the Gibbs sampler returns alpha≈−3.5, beta≈−1.8, tau≈0.015
  - OLS on the default data gives alpha≈1.79, beta≈1.48, confirming the data is correct
  - Root cause is likely poor convergence or an initialisation issue in a very short run;
    also, the current data includes a `treatment` effect not in the simple model, which confounds alpha
  - These failures are blocked on item 2 below (simplify default data) — once treatment is
    removed from the DGP, re-run and re-verify the test bounds
- Moved R reference JSON outputs from project root into `tests/r-reference/results/`
- Updated all four R scripts to write to `tests/r-reference/results/` (with auto-create)
- Updated README and PROGRESS.md running instructions to reflect `npx vitest run` and new output path

### Code review cleanup

Identified and fixed bugs, dead code, and a fragile heuristic found during a
full codebase audit:

- **Bug fix (critical)**: `sampler-worker.js` — the post-`runGibbs` flush used
  `this._buffers` where `this` was `globalThis`/`undefined`, not the settings
  object. The final batch of < `BATCH_SIZE` samples was silently dropped every
  run. Fixed by replacing with a `chainBuffers` closure variable declared before
  the `runGibbs` call.
- **Dead code removed**: unused `totalSaved` variable in `sampler-worker.js`;
  four unused `LOG_DENSITY` aliases (`dnormal`, `dpoisson`, `dbernoulli`,
  `dbinomial`) in `model-graph.js`.
- **Logic improvement**: `distributionUsesParam` in `gibbs.js` previously
  detected parameter dependencies by numerical perturbation (evaluate expression
  twice, compare). Replaced with a deterministic recursive AST traversal
  (`exprReferencesVar`), eliminating false negatives from flat expressions and
  false positives from floating-point noise.
- **Comment fixes**: misleading "Circular buffer" comment in `trace-plot.js`
  (implementation uses `Array.shift`, a sliding window); ambiguous Poisson
  initialisation comment in `initialize.js`.

---

## What Needs to Be Done Next

### 1. Statistical validation against R/nimble references

R reference scripts have been run; JSON fixtures are in `tests/r-reference/results/`.

Remaining:
- Add fixture loading to `integration.test.js`: read the JSON files and assert that
  FANGS posterior means are within ~0.1 SD of nimble reference values and that 95% CIs overlap.
- **Blocked** on item 2 (simplify default data) — the 3 failing pipeline tests use the current
  data with a treatment effect not present in the simple model, giving wrong DGP expectations.
  Fix the data first, then re-verify test bounds, then add reference comparisons.

### 2. Minor bug fixes
- Bug in pop-up system. Clicking a '?' causes the page to freeze. Needs to be fixed. 
- The traces in the 'Trace plots' start on the RHS of the graph and go backwards. The x-limits are wrong (go from 1 to 25, instead of showing 1000s). They should start at 1 and to left to right
- Scales on all plots are difficult to read. Should use whole numbers for tick marks (e.g. -2, -1, 0, 1, 2 or -5, 0, 5, 10), that scale with scale of variables/parameters. Research JS plotting packages we can use. There is probably a good js plotting package we can import to handle this for us?
- Simplify the model for the default data and provide an R script to generate the default data so I can easily change the default data. Use the model (ie no 'treatment' effect):
 *   y_i = 2 + 1.5*x_i + b_{group[i]} + eps_i
 *   b_group ~ N(0, 0.5),  eps ~ N(0, 0.7)
 * N=50, 5 groups, treatment coded 0/1.

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

### 6. Add about and instructions pages
Add pages for About and Instructions. Access these via a hamburger menu in header bar. 
Also add links to Github and seascapemodels.org

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
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
Rscript tests/r-reference/poisson-glm.R
Rscript tests/r-reference/binomial-glm.R
```
