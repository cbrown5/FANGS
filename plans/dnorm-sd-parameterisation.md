# Plan: Switch dnorm to SD Parameterisation

## Goal

Replace the precision (τ) second parameter of `dnorm` with standard deviation (σ).
Users will write `y[i] ~ dnorm(mu[i], sigma)` instead of `y[i] ~ dnorm(mu[i], tau)`.

**Approach chosen: Option 1 — accept sigma syntax, use slice sampling for sigma.**

Mean parameters (alpha, beta, random effects) retain their conjugate normal-normal
Gibbs updates. Only the variance/SD parameter loses its conjugate update, falling
back to slice sampling. This is mathematically correct and requires the fewest changes.

---

## Why not keep conjugacy for sigma?

A Gamma prior on τ is conjugate with a Normal likelihood in precision form.
No standard prior on σ is conjugate with a Normal likelihood in SD form —
a uniform or half-normal prior on σ does not transform to a Gamma on τ = 1/σ².
Attempting to run the Gamma conjugate update with a sigma-space prior would
silently apply the wrong prior. Slice sampling is the correct fallback.

---

## Files to change

### 1. `src/utils/distributions.js`

**`dnorm(x, mu, sigma)` log-density**
- Change second parameter name from `tau` to `sigma`
- New formula: `−log(sigma) − 0.5*log(2π) − 0.5*((x−mu)/sigma)²`
- Guard: return `-Infinity` if `sigma <= 0`

**`rnorm(mu, sigma)` sampler**
- Change second parameter name from `tau` to `sigma`
- Remove internal `1/Math.sqrt(tau)` conversion — sigma is already SD
- Box-Muller output: `mu + sigma * z`

Update the file-level JSDoc comment that currently reads:
> `dnorm / rnorm use precision τ = 1/σ²`

### 2. `src/parser/model-graph.js`

**`LOG_DENSITY` map (line ~65)**
- `dnorm: (x, mu, sigma) => dnorm(x, mu, sigma)` — parameter name only, no math change needed since `distributions.js` is updated

**`RANDOM_SAMPLER` map (line ~80)**
- `dnorm: (mu, sigma) => rnorm(mu, sigma)` — same, just rename

**`DIST_MEAN` map (line ~95)**
- `dnorm: (mu, _sigma) => mu` — rename `_tau` to `_sigma`

**`detectConjugateType()` (lines ~478–492)**
- Remove the `gamma-normal` conjugacy detection block entirely.
  A Gamma prior on σ is not conjugate; the node will fall through to slice sampling.
- The `normal-normal` and `normal-normal-offset` detection blocks are unaffected —
  they look at position [0] (the mean), not position [1].

### 3. `src/samplers/gibbs.js`

**`updateParameter()` dispatch (lines ~144–166)**
- Remove the `case 'gamma-normal'` branch. No conjugate sampler fires for the
  SD parameter; it falls through to slice sampling automatically.

**`conjugateGammaOnPrecision()` function (lines ~368–395)**
- Delete the function entirely (no longer called).
- Also delete `collectNormalChildResiduals()` if it is only used by this function.

**`conjugateNormalNormal()` (lines ~221–235)**
- No math changes. Already uses τ from the child's *second* dnorm parameter.
  Now that second parameter is σ, so update the comment and extract sigma, then
  compute `tauLik = 1 / (sigma * sigma)` before the conjugate update arithmetic.
  The posterior update formula stays the same; it just needs to convert sigma → tau first.

**`conjugateNormalNormalOffset()` (lines ~237–312)**
- Same as above: wherever `tauLik` is extracted from the child's precision argument,
  convert: `tauLik = 1 / (sigma * sigma)`.

**`computeSliceWidth()` (lines ~691–694)**
- `case 'dnorm'`: second arg is now σ directly, so return `sigma` (clamped).
  Remove the `1 / Math.sqrt(tau)` conversion.

### 4. `src/samplers/initialize.js`

**`drawFromPrior()` dnorm case (lines ~95–114)**
- Second arg is now σ (SD), not τ (precision).
- Update overdispersion logic:
  - Replace `tau / 2` overdispersion with `sigma * Math.sqrt(2)` (doubling variance = multiplying SD by √2)
  - Replace the `tau < 0.01` diffuse-prior check with `sigma > 10`
  - Replace `rnorm(mu, 1/9)` (SD = 3) with `rnorm(mu, 3)`

### 5. `src/data/default-data.js`

All five default model templates must be updated.

**Replacements across all models:**
- `tau ~ dgamma(...)` → `sigma ~ dunif(0, 100)` (or a similar half-bounded prior; see Prior section below)
- `tau.b ~ dgamma(...)` → `sigma.b ~ dunif(0, 100)`
- Variable names: rename `tau` → `sigma`, `tau.b` → `sigma.b` throughout model strings
- Update inline comments: "tau (precision = 1/sigma^2)" → "sigma (residual SD)"

### 6. Default prior choice

Replace `tau ~ dgamma(0.001, 0.001)` with:

```
sigma ~ dunif(0, 100)
```

**Rationale:**
- Simple to explain to students: σ is between 0 and 100
- Weakly informative for typical teaching datasets (response scaled to data range)
- Proper prior (integrates to 1), so posterior is guaranteed proper
- The upper bound of 100 can be noted as a modelling assumption; for most teaching
  datasets responses will be well within this range
- Alternative `dgamma(2, 0.1)` on sigma could be considered later but `dunif` is
  more transparent for teaching

**For random effects SD (`sigma.b`):**
```
sigma.b ~ dunif(0, 100)
```
Same reasoning applies.

---

## Slice sampling behaviour for sigma

With `sigma ~ dunif(0, 100)`:
- `getParameterBounds()` in `gibbs.js` must return `lower = 0, upper = 100`
  (it already handles `dunif` bounds — verify this is the case)
- The slice sampler will respect `lower = 0` (sigma is positive)
- `computeSliceWidth()` will return `(100 - 0) / 4 = 25` for the prior width,
  which is too wide initially; the adaptive step-out in the slice sampler will
  correct this during burn-in. Consider adding a post-burn-in width adaptation if
  mixing is slow for sigma in practice.

---

## Tests to update

### `tests/distributions.test.js`
- All `dnorm` / `rnorm` tests: invert parameterisation.
  `dnorm(x, 0, 1)` now means mean=0, SD=1 (was precision=1, i.e., SD=1 anyway for that case).
  Update tests that specifically exercise the precision formula.
- `rnorm` variance check: `variance ≈ sigma²` (replace `1/tau`).

### `tests/parser.test.js`
- Tests that parse `y[i] ~ dnorm(mu[i], tau)` — rename `tau` → `sigma` in test fixtures.
  Parser itself needs no changes (it is parameter-name agnostic).

### `tests/samplers.test.js`
- Remove any tests for `conjugateGammaOnPrecision`.
- Update normal-normal tests where `tauLik` is hardcoded.

### `tests/integration.test.js`
- Update all model strings in fixtures: `tau ~ dgamma(...)` → `sigma ~ dunif(0, 100)`.
- Update expected posterior summaries — posterior for sigma will now come from the
  slice sampler, so tolerances may need slight widening (e.g., 0.15 SD instead of 0.1 SD).
- R reference scripts (`tests/r-reference/`) must be updated to use SD parameterisation
  and regenerate JSON fixtures.

### `tests/r-reference/*.R`
- NIMBLE/JAGS use precision by default. Add a conversion layer in the R scripts:
  fit model with tau in NIMBLE, then derive `sigma = 1/sqrt(tau)` and save sigma
  posteriors as the reference fixture. This keeps the R code using JAGS syntax while
  producing SD-scale reference values to compare against the JS output.

---

## Popup content to update

### `src/content/popups/precision.qmd`
- This popup explains the precision parameterisation. It should be **replaced or
  substantially revised** to explain SD parameterisation instead.
- New content: explain that σ is the standard deviation, σ² is variance,
  note that JAGS/BUGS use 1/σ² but FANGS uses σ for clarity.

### `src/content/popups-bundle.js`
- Regenerate by running `npm run build:popups` after editing the `.qmd` file.

---

## Sequence of work

1. Update `distributions.js` (math core) + its tests — verify unit tests pass
2. Update `model-graph.js` dispatch maps and remove `gamma-normal` conjugacy detection
3. Update `gibbs.js`: remove conjugate precision sampler, fix tauLik conversions in normal-normal samplers, fix slice width
4. Update `initialize.js` overdispersion logic
5. Update `default-data.js` model templates
6. Update `default-data.js` model templates
7. Update and regenerate R reference fixtures
8. Update integration tests
9. Update `precision.qmd` popup and rebuild bundle
10. Manual smoke test: load app, run model 1 and model 2, check sigma posteriors look reasonable

---

## What is NOT changing

- Parser (`lexer.js`, `parser.js`) — fully agnostic to parameter names; no changes needed
- `normal-normal` and `normal-normal-offset` conjugate samplers — still fire for alpha, beta, random effects
- `beta-binom` and `gamma-poisson` conjugate samplers — unaffected
- All GLM model templates (Poisson, Bernoulli) — they use `dnorm` only for priors on regression coefficients, not as a likelihood; update prior tau → sigma there too
- The BUGS distribution set recognised by the parser — `dnorm` name unchanged
