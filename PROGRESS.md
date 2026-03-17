# FANGS Development Progress

## Status: Fully Working

All core modules are implemented and 252 tests pass.

### Source files (`src/`)

| File | Notes |
|------|-------|
| `app.js` | UI orchestration: editor, data upload, tab switching, run/stop/download, worker wiring, prior predictive check, model constants panel |
| `parser/lexer.js` | Tokenises BUGS/JAGS syntax |
| `parser/parser.js` | AST from token stream |
| `parser/model-graph.js` | DAG from AST; conjugacy detection (`normal-normal`, `normal-normal-offset`, `gamma-normal`, `beta-binom`, `gamma-Poisson`); parents list handles indexed deps like `b[group[i]]` |
| `samplers/gibbs.js` | Component-wise Gibbs; conjugate updates + slice fallback; `collectNormalChildResiduals` includes latent stochastic nodes (needed for tau.b) |
| `samplers/slice.js` | Slice sampler fallback |
| `samplers/initialize.js` | Overdispersed init from priors; diffuse normal (`tau < 0.01`) capped at SD=3; `normal-normal-offset` nodes start at SD=1 |
| `samplers/sampler-worker.js` | Web Worker: START/STOP messages; streams SAMPLES/PROGRESS/DONE/ERROR; supports `priorOnly` and `dataConstants` |
| `data/csv-loader.js` | CSV parsing and column preparation |
| `data/default-data.js` | Built-in dataset matching `data/example.csv` (R seed=42, N=50, 5 groups) |
| `ui/editor.js` | Model text editor with error display |
| `ui/trace-plot.js` | Live trace plots (canvas); fixed x-axis 1→nSamples; redraws batched every 100 samples |
| `ui/density-plot.js` | Posterior density plots (canvas); nice round tick labels |
| `ui/summary-table.js` | Posterior summary table (mean, SD, quantiles, Rhat, ESS) |
| `ui/ppc-plot.js` | PPC tab: fan/histogram plot + observed-vs-predicted scatter with 5th–95th CI error bars and 1:1 reference line |
| `ui/settings.js` | Sampler settings panel (chains, samples, burn-in, thin) |
| `ui/data-table.js` | CSV data preview (max 200 rows) |
| `ui/popups.js` | Educational popup system; fetch from `_rendered/` with `popups-bundle.js` fallback for `file://` |
| `content/popups/*.qmd` | 17 Quarto source files; build with `npm run build:popups` |
| `utils/distributions.js` | Log-densities and samplers for all supported distributions |
| `utils/math.js` | Statistical math helpers |
| `utils/diagnostics.js` | Rhat, ESS, convergence checks |

### Tests (`tests/`)

| File | Notes |
|------|-------|
| `parser.test.js` | 148 tests — parser and lexer |
| `distributions.test.js` | 92 tests — all log-density and sampler functions |
| `integration.test.js` | ~241 tests — linear model, mixed-effects, Poisson GLM, Bernoulli GLM, logit-link GLM; fixture comparison vs NIMBLE reference for all four model types |
| `r-reference/*.R` | R/NIMBLE reference scripts; output to `tests/r-reference/results/` |

**252 tests passing.**

---

## Known Issues / Caveats

- **R reference fixtures** use weakly-informative priors (`dgamma(1, 0.1)`, `dnorm(0, 0.04)`). Re-run when R + NIMBLE is available to keep fixtures current:
  ```
  Rscript tests/r-reference/linear-model.R
  Rscript tests/r-reference/mixed-effects.R
  ```
  Existing fixtures still pass the 0.3-SD tolerance since posteriors are data-dominated.

---

## Next Steps

1. **Add GLM example models** — Poisson and Bernoulli GLM presets in the model selector
2. **GLM popup content** — new `.qmd` files covering log link, logit link, overdispersion
3. **Regenerate R fixtures** — run all four R reference scripts once R + NIMBLE is available

---

## Running the App

```bash
npx serve .          # serve locally (required for popup fetch)
npm install          # install JS deps (one-time)
npx vitest run       # run all JS tests

# R reference tests (requires R + nimble)
Rscript tests/r-reference/generate-default-data.R
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
Rscript tests/r-reference/poisson-glm.R
Rscript tests/r-reference/binomial-glm.R
```
