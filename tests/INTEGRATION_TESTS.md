# FANGS Integration Tests

## Overview

`tests/integration.test.js` is the main end-to-end test file. It tests the full
pipeline: model text → parse → build graph → initialize chains → run Gibbs sampler
→ check output structure and statistical validity.

There are 14 test suites, described below.

---

## Test Suites

### Suite 1 — Parse and build graph (linear model)
Verifies the lexer, parser, and `ModelGraph` construction on the default linear
regression model. Checks that the correct parameters are identified, observed nodes
are counted, and `logPosterior` returns finite values at plausible starting points.

### Suite 2 — Chain initialization (linear model)
Checks that `initializeChains` returns the right number of chains, all parameters
are initialized with finite values, `tau` is positive, and different chains start at
different points (overdispersion).

### Suite 3 — Sampler output structure (short run, linear model)
Runs 20–50 samples to verify structure: correct number of chains, correct number of
samples per chain, all values finite, thinning works, `tau` stays positive.

### Suite 4 — Statistical validity (100 iterations, linear model)
Checks that posterior means are in a plausible range after a short run:
`alpha` ≈ 2.0, `beta` ≈ 1.5, `tau` > 0. Tolerances are loose (±2 units) to keep
the suite fast.

### Suite 5 — Single-parameter updates (unit-level, linear model)
Tests `updateParameter` directly: parameters change value, `tau` stays positive, and
all updated values are finite after 20 successive updates.

### Suite 6 — Mixed-effects model graph and sampler run
Builds the random-intercept mixed-effects model (defaultModel2) using the default
dataset. Checks graph construction, parameter identification (α, β, τ, τ.b, b[1]…b[5]),
observed node count, finite log-posterior, and a short sampler run that produces
positive τ and τ.b samples and a plausible α posterior mean.

### Suite 7 — Poisson GLM (graph and sampler)
Uses a small inline dataset (N=8, y = [3,5,2,4,3,6,2,4]) with a simple
`y[i] ~ dpois(lambda)` model. Checks graph construction, that `lambda` is the only
parameter, logPosterior validity, and that sampled values are positive. Verifies the
posterior mean of λ is close to the exact conjugate posterior Gamma(30, 8.1), mean ≈ 3.70.

### Suite 8 — Bernoulli/Beta GLM (graph and sampler)
Uses a small inline dataset (N=8, y = [1,1,0,1,0,1,1,0], 5 successes) with
`y[i] ~ dbern(p)` and `p ~ dbeta(1, 1)`. Checks that `p` samples are in (0,1) and
that the posterior mean matches the exact conjugate Beta(6,4) posterior, mean ≈ 0.6.

### Suite 9 — Float64Array columns (regression test)
Verifies that ModelGraph works correctly when data columns are `Float64Array`s (the
format produced by `prepareDataColumns` in the real app), not plain JS arrays. This
was introduced to catch a bug where `Array.isArray(Float64Array)` returns false,
causing index resolution to fail at runtime.

### Suite 10 — Mixed-effects model vs NIMBLE reference fixture
Runs the mixed-effects model (3 chains × 1500 samples, 1000 burn-in) against the
reference JSON at `tests/r-reference/results/mixed-effects-reference.json`. Checks:
- Posterior mean within 0.3 SD of the NIMBLE reference mean (0.5 SD for random effects, 1.0 SD for τ.b)
- 95% CI overlaps with NIMBLE 95% CI

Parameters checked: `alpha`, `beta`, `tau`, `tau.b`, `b[1]`…`b[5]`.

### Suite 11 — Poisson GLM vs exact conjugate posterior
Runs the small Poisson model (Suite 7 dataset) for 3 chains × 1000 samples and
compares `lambda` against the exact Gamma(30, 8.1) posterior stored in
`tests/r-reference/results/poisson-glm-reference.json`. Tolerance: 0.3 SD.

### Suite 12 — Bernoulli GLM vs exact conjugate posterior
Runs the small Bernoulli model (Suite 8 dataset) for 3 chains × 1000 samples and
compares `p` against the exact Beta(6, 4) posterior stored in
`tests/r-reference/results/binomial-glm-reference.json`. Tolerance: 0.3 SD.

### Suite 13 — Logit-link Bernoulli GLM (slice sampler end-to-end)
Fits `logit(p[i]) <- alpha + beta * x[i]` on a 10-observation toy dataset using the
slice sampler (non-conjugate). Checks finite samples and that `beta > 0` (the data
clearly show higher x → higher probability of y=1).

### Suite 14 — Linear model vs NIMBLE reference fixture
Runs the simple linear regression (3 chains × 2000 samples, 1000 burn-in) against
`tests/r-reference/results/linear-model-reference.json`. Checks `alpha`, `beta`,
`tau` posterior means within 0.3 SD of NIMBLE and overlapping 95% CIs.

---

## Reference fixtures (`tests/r-reference/results/`)

| File | Contents | Used by |
|------|----------|---------|
| `linear-model-reference.json` | NIMBLE posterior summaries for α, β, τ | Suite 14 |
| `mixed-effects-reference.json` | NIMBLE posterior summaries for α, β, τ, τ.b, b[1]…b[5] | Suite 10 |
| `poisson-glm-reference.json` | Exact Gamma(30,8.1) posterior + NIMBLE MCMC for λ | Suite 11 |
| `binomial-glm-reference.json` | Exact Beta(6,4) posterior + NIMBLE MCMC for p | Suite 12 |

Each file is generated by running the corresponding R script in `tests/r-reference/`:

```bash
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
Rscript tests/r-reference/poisson-glm.R
Rscript tests/r-reference/binomial-glm.R
```

These scripts require R + NIMBLE. The committed JSON fixtures allow the tests to
run without R installed.

---

## Datasets used in tests

| Suite(s) | Dataset | Description |
|----------|---------|-------------|
| 1–5, 9, 14 | `defaultCSV` (50 rows) | Default example: y = 2 + 1.5x + b[group] + ε, 5 groups |
| 6, 10 | `defaultCSV` (50 rows) | Same dataset, uses `group` column for random effects |
| 7, 11 | Inline `POISSON_CSV` (8 rows) | Simple λ model with known conjugate posterior |
| 8, 12 | Inline `BERN_CSV` (8 rows) | Simple p model with known conjugate posterior |
| 13 | Inline `LOGIT_CSV` (10 rows) | Logit-link model to exercise slice sampler |

**Note on dataset coverage:** Each fixture-based test suite (10–14) uses a single
dataset per model type. The inline datasets (Suites 7, 8, 11, 12) are designed to
have analytically tractable posteriors for exact validation. The default dataset
(Suites 1–6, 9, 14) is the main multi-purpose dataset used across model types.

If broader coverage against multiple datasets were needed, additional fixture files
and corresponding describe blocks could be added following the same pattern used in
Suites 10–14.

---

## Running the tests

```bash
npx vitest run                     # all 252 tests
npx vitest run tests/integration.test.js   # integration tests only
npx vitest run --reporter=verbose  # verbose output with test names
```
