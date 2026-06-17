# FANGS Development Progress

## Status: Fully Working

All core modules are implemented and 253 tests pass.

### Source files (`src/`)

| File | Notes |
|------|-------|
| `app.js` | UI orchestration: editor, data upload, tab switching, run/stop/download, worker wiring, prior predictive check, model constants panel; parallel-chain run spawns one Web Worker per chain plus a final summary worker |
| `parser/lexer.js` | Tokenises BUGS/JAGS syntax |
| `parser/parser.js` | AST from token stream |
| `parser/model-graph.js` | DAG from AST; conjugacy detection (`normal-normal`, `normal-normal-offset`, `beta-binom`, `gamma-Poisson`); the normal SD parameter has no conjugate update and falls to slice sampling; parents list handles indexed deps like `b[group[i]]` |
| `samplers/gibbs.js` | Component-wise Gibbs; conjugate updates + slice fallback; `dnorm` uses the SD parameterisation (σ), converted to precision internally for normal-normal conjugate updates |
| `samplers/slice.js` | Slice sampler fallback (also samples `sigma`/`sigma.b`) |
| `samplers/initialize.js` | Overdispersed init from priors; diffuse normal (`sigma > 10`) capped at SD=3; `normal-normal-offset` nodes start at SD=1 |
| `samplers/sampler-worker.js` | Web Worker: parallel-chain mode (one worker per chain via START+chainIdx → CHAIN_DONE) + coordinator mode (SUMMARIZE → DONE); legacy single-worker START path retained for prior check; supports `priorOnly` and `dataConstants` |
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


## Next Steps

### USER todo
- Halfway through running benchmark.R to save results and do plots. 
- Try compare-nimble-fangs with different random initials. 
- test tests/r-reference/benchmark.R to do time benchmarking. 
- test poisson gamma, 
- read the paper draft and suggest updates
- Confirm the samplers work as explained in the paper
- Confirm number of tests is what is said in the paper
- Edits to help files
- Confirm ESS and Rhat equations in help and JS code
- test app performance interactively
- edit pop-ups and help pages
- Add a writing style and update the help pages. 
- nimble tests covering conjugate and non conjugate dists
- tests with x on different scales, mv X


### Claude todo
- Need to also update help files so they talk abotu SD instead of precision. Make sure help files explain we use an SD parameterisation
- Add suggestion for  mixed effects model help file: with a non-cenntered parameterisation, see if it improves convergence: b[j] = sigma.b * z[j]
z[j] ~ dnorm(0, 1)
- Scaling of predictors. Change pop-up appearance for " Predictors auto-scaled for sampling ". Only show it when scaling is used. Also the scaling is only applied at the end of sampling. The Trace plot shows scaled parameters. The posterior distribution shows scaled parameters, but then updates to unscaled once sampling is done. Can we have them show unscaled parameters during sampling, or will that be too slow?
- Remove red stop light on the 'Joint parameters' page. If the. model hasn't run just show the message "Run the model to see the joint distribution of parameters"
- PPC observer vs predicted plot doesnt show for poisson amd binomial models. works for other models
- remove line/border around ribbon on predictions plot. show just as a shaded ribbon with line for mean. 
- model is optimized for predictors that are on unit SD scale amd centered. brainstorm options for begginer friendly handling if predictors on any scale. 
- Plots use sensible scale for tick labels (e.g. 0.2, 0.4, not 0.23456789).



## Future improvements
Review code and UX of the shiny stan package to get ideas for plots to add and how to present results. 

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
