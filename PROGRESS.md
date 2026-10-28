# FANGS Development Progress

## Status: Fully Working

All core modules are implemented and 275 tests pass.

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
| `samplers/blocked/*` | Optional blocked GLMM sampler ("Sampler engine" setting): `compile-model.js` turns the graph into a dense GLMM plan (or rejects with a reason), `blocked-sampler.js` runs sweeps + hyperparameter slice updates + intercept↔random-effect translation moves, `cpu-backend.js` does the Newton–MH block updates. See `plans/gpu-blocked-sampler.md` |
| `samplers/sampler-worker.js` | Web Worker: parallel-chain mode (one worker per chain via START+chainIdx → CHAIN_DONE) + coordinator mode (SUMMARIZE → DONE); legacy single-worker START path retained for prior check; supports `priorOnly` and `dataConstants` |
| `data/csv-loader.js` | CSV parsing and column preparation |
| `data/default-data.js` | Built-in dataset matching `data/example.csv` (R seed=42, N=50, 5 groups) |
| `ui/editor.js` | Model text editor with error display |
| `ui/trace-plot.js` | Live trace plots (canvas); fixed x-axis 1→nSamples; redraws batched every 100 samples |
| `ui/density-plot.js` | Posterior density plots (canvas); nice round tick labels |
| `ui/summary-table.js` | Posterior summary table (mean, SD, quantiles, Rhat, ESS) |
| `ui/ppc-plot.js` | PPC tab: fan/histogram plot + observed-vs-predicted scatter with 5th–95th CI error bars and 1:1 reference line |
| `ui/settings.js` | Sampler settings panel (chains, samples, burn-in, thin, sampler engine) |
| `ui/data-table.js` | CSV data preview (max 200 rows) |
| `ui/popups.js` | Educational popup system; fetch from `_rendered/` with `popups-bundle.js` fallback for `file://` |
| `content/popups/*.qmd` | 21 Quarto source files; build with `npm run build:popups` |
| `utils/distributions.js` | Log-densities and samplers for all supported distributions |
| `utils/math.js` | Statistical math helpers |
| `utils/diagnostics.js` | Rhat, ESS, convergence checks |

### Tests (`tests/`)

| File | Notes |
|------|-------|
| `parser.test.js` | 74 tests — parser and lexer |
| `distributions.test.js` | 92 tests — all log-density and sampler functions |
| `integration.test.js` | 75 tests — linear model, mixed-effects, Poisson GLM, Bernoulli GLM, logit-link GLM; fixture comparison vs NIMBLE reference for all four model types |
| `predictor-scaling.test.js` | 21 tests — internal predictor rescaling utilities |
| `predictions-grid.test.js` | 4 tests — predictions tab grid logic |
| `course-challenges.test.js` | 9 tests — course challenge widget logic |
| `blocked-sampler.test.js` | 30 tests — blocked sampler: model compilation/rejection, exact Gaussian block draws, Newton–MH vs quadrature, posteriors vs NIMBLE fixtures and numerical integration |
| `r-reference/*.R` | R/NIMBLE reference scripts; output to `tests/r-reference/results/` |

**275 tests passing (6 test files).**


---


## Next Steps

App is fully functional and good to use. 

### USER todo
- test poisson gamma 
- read the paper draft and suggest updates
- Confirm the samplers work as explained in the paper. I think there are still some mentions of conjugates
- Confirm number of tests is what is said in the paper
- Edits to help files
- Confirm ESS and Rhat equations in help and JS code
- edit pop-ups and help pages
- Add a writing style and update the help pages. 
- tests with x on different scales, mv X
- Review paper draft, read whole thing. 
- Check all references in paper
- Add report/ report bug button

### User course todo
-m20 need to be updated. Write up the block sampler first, then come to the other repreameterization tricks second.  Edit new section about blocked sampler
- m21 needs revision. Test it, use a fully categorical predictor
- GPU test is on branch jolly-lovelace, test that
- Chat in claude has an idea for improving speed of CPU based computation as well. 
- 
- Edit text in opening sections
- Add references to course modules.
- Pin reference posteriors for M14–M19, M21 (currently self-report mode).

### Claude todo
- In the modules menu add a cheatsheet that has URLs that give the model for each module. For user to use if they get stuck solving the problems themselves

### Referencing TODO
- add references for books to the course in appropriate places. 
- - McElreath, R. (2020). [*Statistical Rethinking: A Bayesian Course with Examples in R and Stan*](https://xcelab.net/rm/statistical-rethinking/) (2nd ed.). CRC Press.
- de Valpine, P., Turek, D., Paciorek, C. J., Anderson-Bergman, C., Temple Lang, D., & Bodik, R. (2017). Programming with models: writing statistical algorithms for general model structures with NIMBLE. *Journal of Computational and Graphical Statistics*, 26(2), 403–413. [doi:10.1080/10618600.2016.1172487](https://doi.org/10.1080/10618600.2016.1172487)
- [NIMBLE documentation](https://r-nimble.org/)
- Cross link across modules. 



## Future improvements
Review code and UX of the shiny stan package to get ideas for plots to add and how to present results. 
More sophisticated prediction tab. Could look at shinystan for inspiration? Or have user enter code that is parsed to make the plot? Or just provide tutorial do it with the download of samples


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
