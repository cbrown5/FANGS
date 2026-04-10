# FANGS Development Progress

## Status: Fully Working

All core modules are implemented and 252 tests pass.

### Source files (`src/`)

| File | Notes |
|------|-------|
| `app.js` | UI orchestration: editor, data upload, tab switching, run/stop/download, worker wiring, prior predictive check, model constants panel; parallel-chain run spawns one Web Worker per chain plus a final summary worker |
| `parser/lexer.js` | Tokenises BUGS/JAGS syntax |
| `parser/parser.js` | AST from token stream |
| `parser/model-graph.js` | DAG from AST; conjugacy detection (`normal-normal`, `normal-normal-offset`, `gamma-normal`, `beta-binom`, `gamma-Poisson`); parents list handles indexed deps like `b[group[i]]` |
| `samplers/gibbs.js` | Component-wise Gibbs; conjugate updates + slice fallback; `collectNormalChildResiduals` includes latent stochastic nodes (needed for tau.b) |
| `samplers/slice.js` | Slice sampler fallback |
| `samplers/initialize.js` | Overdispersed init from priors; diffuse normal (`tau < 0.01`) capped at SD=3; `normal-normal-offset` nodes start at SD=1 |
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
- test tests/r-reference/benchmark.R to do time benchmarking. 
- test poisson gamma, 
- is the slice faster than the conjuaget? seems to be? 
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
- Nimble uses SD not precision for dnorm. So need to check all the fixtures to make sure we are doing correct conversions, including for the priors. Or just change FANGS to use the SD instead? Its more straightforward
- Scaling of predictors. Change pop-up appearance for " Predictors auto-scaled for sampling ". Only show it when scaling is used. Also the scaling is only applied at the end of sampling. The Trace plot shows scaled parameters. The posterior distribution shows scaled parameters, but then updates to unscaled once sampling is done. Can we have them show unscaled parameters during sampling, or will that be too slow?
- Remove red stop light on the 'Joint parameters' page. If the. model hasn't run just show the message "Run the model to see the joint distribution of parameters"
- PPC observer vs predicted plot doesnt show for poisson amd binomial models. works for other models
- remove line/border around ribbon on predictions plot. show just as a shaded ribbon with line for mean. 
- model is optimized for predictors that are on unit SD scale amd centered. brainstorm options for begginer friendly handling if predictors on any scale. 
- Plots use sensible scale for tick labels (e.g. 0.2, 0.4, not 0.23456789).
- Issue with one of the tests Returns:
```
tests/integration.test.js > Bernoulli GLM: fixture comparison vs exact posterior > p posterior mean matches exact Beta(6,4) within 0.3 SD
TypeError: Cannot read properties of undefined (reading 'toFixed')
 ❯ checkParam tests/integration.test.js:1098:106
    1096|     const rq97_5 = exact.q97_5;
    1097|     const overlaps = fq2_5 < rq97_5 && fq97_5 > rq2_5;
    1098|     expect(overlaps, `${paramName}: 95% CI [${fq2_5.toFixed(3)}, ${fq97_5.toFixed(3)}] vs exact [${rq2_5.toFix…
       |                                                                                                          ^
    1099|       .toBe(true);
    1100|   }
 ❯ tests/integration.test.js:1102:70
 ```


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
