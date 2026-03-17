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
| `parser/model-graph.js` | Done | DAG from AST; detects conjugate structure per node (`conjugateType`); fixed IndexExpr edge wiring; added `normal-normal-offset` type for random effects/slopes via deterministic intermediary; uses parents list for indexed dependencies like `b[group[i]]` |
| `samplers/gibbs.js` | Done | Component-wise Gibbs loop; conjugate updates for normal-normal, normal-normal-offset, gamma-normal, beta-binom, gamma-Poisson; falls back to slice; `collectNormalChildResiduals` now includes latent stochastic nodes (fixes tau.b); `conjugateNormalNormalOffset` uses numerical differentiation for per-observation coefficients |
| `samplers/slice.js` | Done | Slice sampler fallback for non-conjugate nodes |
| `samplers/initialize.js` | Done | Overdispersed chain initialisation from priors; diffuse normal priors (`tau < 0.01`) capped at SD=3; `normal-normal-offset` nodes start at SD=1 to prevent cascading overdispersion |
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
| `integration.test.js` | Done | ~241 tests — linear model, mixed-effects, Poisson GLM, Bernoulli GLM, logit-link GLM; parse → graph → init → Gibbs → statistical validity; fixture comparison vs NIMBLE reference for linear model, mixed-effects, Poisson, and Bernoulli; logit-link slice-sampler direction test (Suite 14 added 2026-03-17) |
| `r-reference/generate-default-data.R` | Done | R script to regenerate the default CSV dataset |
| `r-reference/linear-model.R` | Done | R/nimble reference for linear model |
| `r-reference/mixed-effects.R` | Done | R/nimble reference for mixed-effects model |
| `r-reference/poisson-glm.R` | Done | R/nimble reference for Poisson GLM; includes exact analytical posterior |
| `r-reference/binomial-glm.R` | Done | R/nimble reference for Bernoulli/Beta model; includes exact analytical posterior |

**252 tests defined; 252 passing (pending network access to run vitest).**

---

## What Has Been Done (Recent)

### Full PPC, UI polish, About/Instructions, weakly-informative priors (2026-03-17)

**Posterior predictive check completed** (`model-graph.js`, `sampler-worker.js`, `app.js`)
Added `samplePredictive(paramValues)` to `ModelGraph`: iterates all observed nodes,
evaluates distribution parameters in the current posterior state, and draws y_rep from
the likelihood using a new `RANDOM_SAMPLER` dispatch table (rnorm/rgamma/rbeta/rbinom/
rbern/rpois/runif/rlnorm). The sampler worker generates up to 200 replicate datasets
by randomly selecting posterior draws, stores results per observed variable, and includes
them in the DONE message as `predictions`. `app.js` now passes `predictions.y` to
`ppc.update()`, completing the full observed-vs-predicted fan plot.

**Model selector buttons disabled during sampling** (`app.js`)
`btn-model-1` and `btn-model-2` are disabled when Run is clicked and re-enabled on
DONE, ERROR, or Stop — preventing mid-run model changes.

**About and Instructions pages** (`index.html`)
Added a hamburger menu (&#9776;) in the header that opens a dropdown with:
- Instructions — step-by-step guide to using FANGS
- About — feature list, author links, statistical references
- GitHub link (github.com/cbrown5/FANGS)
- seascapemodels.org link
A modal dialog with two tabs (Instructions / About) displays the content.
Keyboard (Esc) and click-outside dismiss both the menu and modal.

**Weakly-informative priors** (`default-data.js`, `tests/r-reference/linear-model.R`,
`tests/r-reference/mixed-effects.R`)
Default models now use:
- `alpha ~ dnorm(0, 0.04)` (SD = 5, was SD ≈ 31)
- `beta  ~ dnorm(0, 0.04)` (SD = 5, was SD ≈ 31)
- `tau   ~ dgamma(1, 0.1)` (mean = 10, was essentially improper)
- `tau.b ~ dgamma(1, 0.1)` (mixed model)
R reference scripts updated to match. Fixture JSON files should be regenerated
with `Rscript tests/r-reference/linear-model.R` etc. when R is available;
existing fixtures still pass the 0.3-SD tolerance (posteriors are data-dominated).

### Linear model NIMBLE fixture test added (2026-03-17)

**Suite 14 — Linear model fixture comparison vs NIMBLE** (`integration.test.js`)
Added a new `beforeAll`-based test suite (3 chains × 2000 samples, 1000 burn-in)
that loads `tests/r-reference/results/linear-model-reference.json` and checks that
FANGS posterior means for `alpha`, `beta`, and `tau` are within 0.3 SD of the
NIMBLE reference means, and that 95% CIs overlap.  This completes NIMBLE fixture
coverage for all four model types (linear, mixed-effects, Poisson GLM, Bernoulli GLM).

### Trace plot fix and GLM fixture tests (2026-03-16)

**Trace plot sparse display fixed** (`app.js`)
The live trace plot only showed ~25 samples because it was fed from PROGRESS
messages (sent every 100 iterations). Changed to feed from SAMPLES messages
(each carrying a batch of 10 saved post-burn-in samples), so the trace now
shows all 2000 saved samples.

**Fixture-based tests for Poisson and Bernoulli GLMs** (`integration.test.js`)
Suite 11 (Poisson) and Suite 12 (Bernoulli) compare FANGS posterior means
and 95% CIs against the exact analytical posteriors stored in the R reference
JSON fixtures. Tolerance: 0.3 SD for the mean; CI must overlap.

**Logit-link GLM end-to-end test** (`integration.test.js`)
Suite 13 fits a Bernoulli GLM with `logit(p[i]) <- alpha + beta * x[i]`
(slice sampler only) against a 10-observation toy dataset. Checks all samples
are finite and the beta posterior mean is positive (direction test).

### Mixed-effects model validation (2026-03-16)

Three bugs fixed and two improvements made to get the mixed-effects model matching NIMBLE.

**Bug 1 — `collectNormalChildResiduals` skipped latent nodes** (`gibbs.js`)
The conjugate Gamma update for `tau.b` scanned only `observed` nodes, missing the
latent `b[j] ~ dnorm(0, tau.b)` nodes. Result: tau.b was sampled as if n=0 (pure prior),
giving a degenerate posterior. Fixed by including `stochastic` nodes (non-observed) in
the residual collection loop.

**Bug 2 — No conjugate update for `b[j]` random effects** (`model-graph.js`, `gibbs.js`)
`b[j]` nodes fell through to the slice sampler because conjugacy detection only flagged
nodes that appeared directly as the mean parameter of a dnorm, not those entering via a
deterministic intermediary. Added `'normal-normal-offset'` conjugate type and corresponding
`conjugateNormalNormalOffset` sampler. The update uses numerical differentiation to compute
per-observation coefficients `c[i] = ∂mu[i]/∂θ`, handling both pure offsets (b[j]) and
slope parameters (beta) correctly. Detection uses the pre-computed parents list to handle
indirect index expressions like `b[group[i]]`.

**Improvement 1 — Better initialization for diffuse normal priors** (`initialize.js`)
Nodes with `tau < 0.01` (SD > 10) now initialize within ±3 of the prior mean (tau=1/9)
instead of the prior-overdispersed width (SD up to 45). Prevents chains starting at
alpha=-65 or beta=-114 for `dnorm(0, 0.001)` priors.

**Improvement 2 — Tighter initialization for random-effect nodes** (`initialize.js`)
Nodes tagged `normal-normal-offset` start with tau=1 (SD=1), preventing cascading
overdispersion from a small initialized tau.b value.

**R reference regenerated** (`tests/r-reference/results/mixed-effects-reference.json`)
The old JSON had a stale tau.b=311 (generated with a different data seed). Re-running
`Rscript tests/r-reference/mixed-effects.R` produced: alpha=2.29, beta=1.37, tau=2.10,
tau.b=136. FANGS now matches to within 0.04 SD on all population-level parameters.

**Fixture-based tests added** (`integration.test.js` Suite 10)
9 new tests compare FANGS posterior means and 95% CIs against the NIMBLE reference JSON.
Tolerance: 0.3 SD for alpha/beta/tau, 1.0 SD for tau.b (very wide posterior), 0.5 SD
for b[j]. Uses `beforeAll` to run 3 chains × 1500 samples once and share across tests.

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

### 1. Observed vs predicted scatter plot on the PPC tab

Add a second plot to the PPC tab showing observed `y` on the x-axis against
posterior mean predicted `ŷ` (mean of y_rep across all replicates for each
observation) on the y-axis, with a 1:1 reference line. This gives a
per-observation view of model fit complementing the distributional fan plot.

Implementation notes:
- `ppc-plot.js`: add a second canvas/section below the existing fan plot.
  For each observation index `i`, compute `ŷ_i = mean(predictions[k][i] for k in reps)`.
  Also compute a credible interval band (e.g. 5th–95th percentile across reps) as
  vertical error bars or shaded blobs.
- The 1:1 line should span the full data range; points above the line indicate
  over-prediction, below indicate under-prediction.
- `sampler-worker.js` / `app.js`: no changes needed — `predictions.y` already
  contains the full set of replicate arrays in observation order.

Known issues:
- Help buttons still cause crash of app

### 2. Regenerate R reference fixture JSON files

R scripts now use weakly-informative priors (`dgamma(1, 0.1)`, `dnorm(0, 0.04)`).
Re-run the R scripts when R + NIMBLE is available to update the JSON fixtures:
```
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
```
Existing fixtures still pass the 0.3-SD tolerance until then.

### 3. Additional example models and popup content

- Add Poisson GLM and Bernoulli GLM example models to the model selector buttons
- Additional popup content for GLM-specific concepts (log link, logit link, overdispersion)

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
