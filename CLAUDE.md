# CLAUDE.md - FANGS Development Guide

## Project Overview

FANGS (Fast Accessible Numeric Gibbs Sampler) is a browser-based Bayesian inference tool for teaching mixed-effects models. Users write models in JAGS/NIMBLE (BUGS language) syntax, upload CSV data, and get interactive MCMC results — no software installation required.

## Architecture Decisions

### Language & Platform
- **Frontend**: JavaScript/TypeScript web app (single-page application)
- **Sampler engine**: JavaScript (avoids WASM compile complexity; sufficient for small teaching datasets)
- **No backend required** — everything runs client-side in the browser

### Sampler Strategy
- Implement a **component-wise Gibbs sampler** as the default
- Use **conjugate samplers** where possible (normal-normal, beta-binomial, gamma-Poisson). Note: FANGS parameterises `dnorm` by standard deviation, so the normal SD has no conjugate update and is slice-sampled.
- Fall back to **slice sampling** for non-conjugate full conditionals
- User does not need to choose samplers — the engine auto-selects based on the model graph
- Support multiple chains with independent initialization

### Model Syntax (BUGS/JAGS dialect)
The parser must handle the following BUGS language constructs:
- `model { ... }` block wrapper
- Stochastic nodes: `y[i] ~ dnorm(mu[i], sigma)`
- Deterministic nodes: `mu[i] <- alpha + beta * x[i]`
- `for(i in 1:N) { ... }` loops
- Indexing: `x[i]`, `beta[j]`, `y[i,j]`
- Key distributions: `dnorm(mean, sd)` (FANGS uses standard deviation, not precision), `dgamma(shape, rate)`, `dunif(lower, upper)`, `dbern(prob)`, `dpois(lambda)`, `dbin(prob, size)`, `dbeta(a, b)`, `dlnorm(meanlog, preclog)`
- Link functions via deterministic nodes (e.g., `log(mu[i]) <- ...` or `logit(p[i]) <- ...`)
- Truncation: `T(lower, upper)`
- Math functions: `pow()`, `exp()`, `log()`, `sqrt()`, `abs()`, `inverse()`

### Supported Model Types
1. Linear regression (Gaussian response)
2. GLMs: Poisson (log link), Binomial/Bernoulli (logit link)
3. Mixed-effects versions of the above with random intercepts (nested hierarchical design)

## Project Structure

```
FANGS/
├── index.html              # Main entry point
├── assets/                 # Static assets (hex logo, images)
├── data/                   # Example datasets
│   ├── example.csv         # Default example dataset
│   ├── example-unscaled.csv
│   ├── bernoulli-example.csv
│   └── poisson-example.csv
├── paper/                  # Draft paper and blog post
│   ├── fangs-paper.md
│   ├── fangs-blog.md
│   └── instructions-for-agent.md
├── plans/                  # Architecture decision notes
│   └── dnorm-sd-parameterisation.md
├── results/                # Reference JSON posteriors (binomial, poisson)
├── scripts/                # Build scripts
│   ├── build-course.js
│   ├── build-popups-bundle.js
│   └── lib/render-content.js
├── src/
│   ├── app.js              # App initialization and UI orchestration
│   ├── parser/
│   │   ├── lexer.js        # Tokenizer for BUGS syntax
│   │   ├── parser.js       # AST builder from tokens
│   │   └── model-graph.js  # Build DAG from AST
│   ├── samplers/
│   │   ├── gibbs.js        # Main Gibbs sampler loop (includes conjugate updates)
│   │   ├── slice.js        # Slice sampler fallback
│   │   ├── initialize.js   # Chain initialization strategies
│   │   └── sampler-worker.js  # Web Worker wrapper for background sampling
│   ├── data/
│   │   ├── csv-loader.js       # CSV parsing and validation
│   │   ├── default-data.js     # Built-in example dataset
│   │   └── predictor-scaling.js # Internal predictor rescaling utilities
│   ├── ui/
│   │   ├── editor.js           # Model text editor
│   │   ├── settings.js         # Sampler settings panel
│   │   ├── trace-plot.js       # Live chain trace plots
│   │   ├── density-plot.js     # Posterior density plots
│   │   ├── summary-table.js    # Posterior summaries (quantiles, Rhat)
│   │   ├── ppc-plot.js         # Posterior predictive check
│   │   ├── predictions-plot.js # Regression line with 95% CI
│   │   ├── scatter-plot.js     # Joint posterior scatterplot
│   │   ├── data-table.js       # Data tab table view
│   │   └── popups.js           # Educational pop-up system
│   ├── content/
│   │   ├── popups-bundle.js    # Compiled popup HTML fallback (committed)
│   │   └── popups/             # 21 Quarto .qmd popup sources
│   └── utils/
│       ├── math.js             # Statistical math helpers
│       ├── distributions.js    # Distribution log-densities and samplers
│       └── diagnostics.js      # Rhat, ESS, convergence checks
├── tests/
│   ├── r-reference/            # R scripts using nimble for reference results
│   │   ├── linear-model.R
│   │   ├── poisson-glm.R
│   │   ├── binomial-glm.R
│   │   ├── mixed-effects.R
│   │   ├── benchmark.R
│   │   ├── compare-nimble-fangs.R
│   │   ├── compare-nimble-fangs-poisson.R
│   │   ├── generate-default-data.R
│   │   ├── R/                  # Shared R utilities
│   │   ├── nimble-models/      # .bugs model files
│   │   ├── results/            # Reference JSON + benchmark CSVs/plots
│   │   └── beta-comparison/    # Beta distribution comparison workflow
│   ├── bench/
│   │   └── fangs-cli.mjs       # CLI benchmark harness
│   ├── parser.test.js
│   ├── distributions.test.js
│   ├── integration.test.js     # End-to-end model fitting tests
│   ├── predictor-scaling.test.js
│   ├── course-challenges.test.js
│   ├── course-smoke.mjs        # Course page smoke test
│   └── popup-e2e.mjs           # Popup end-to-end test
├── development-notes.md        # Informal dev log / scratch notes
├── PROGRESS.md                 # Implementation progress tracker
├── CLAUDE.md
├── README.md
└── LICENSE
```

## Development Practices

### Testing Strategy
- **Red/Green TDD**: Write failing tests first, then implement
- **R reference tests**: Fit models with `library(nimble)` in R, save results as JSON fixtures, compare web app output against those reference posteriors (means within tolerance, credible intervals overlap)
- **Unit tests**: Parser, individual distributions, conjugate update math
- **Integration tests**: Full model parse -> fit -> check convergence pipeline
- **Statistical tolerance**: Posterior means should be within ~0.1 SD of NIMBLE reference; 95% CIs should overlap

### Code Style
- Vanilla JavaScript (no framework) to keep it simple and dependency-free
- ES modules for code organization
- JSDoc comments for public APIs
- Descriptive variable names matching statistical conventions (e.g., `sigma` for standard deviation, `mu` for mean)

### Key Implementation Notes
- FANGS deliberately parameterises `dnorm` by **standard deviation** (σ), unlike NIMBLE/JAGS which use precision (1/variance). When porting models or reference results from NIMBLE/JAGS, convert: σ = 1/√τ
- Rescale predictors internally before sampling for efficiency; back-transform results for display
- Initialize chains using overdispersed draws from the priors
- Use Web Workers for sampling to keep the UI responsive
- Canvas or SVG for plots (no heavy charting library needed)



## Default Example

The app should launch with:
- **Dataset**: ~50 observations with a continuous response `y`, one continuous predictor `x`, a categorical treatment factor `treatment` (2 levels), and a grouping variable `group` (~5 levels) for random effects
  Note: FANGS parameterises `dnorm` by **standard deviation** (σ), not precision (see below).
- **Pre-filled model 1** (simple linear):
  ```
  model {
    for (i in 1:N) {
      y[i] ~ dnorm(mu[i], sigma)
      mu[i] <- alpha + beta * x[i]
    }
    alpha ~ dnorm(0, 5)
    beta ~ dnorm(0, 5)
    sigma ~ dunif(0, 100)
  }
  ```
- **Pre-filled model 2** (mixed-effects):
  ```
  model {
    for (i in 1:N) {
      y[i] ~ dnorm(mu[i], sigma)
      mu[i] <- alpha + beta * x[i] + b[group[i]]
    }
    for (j in 1:J) {
      b[j] ~ dnorm(0, sigma.b)
    }
    alpha ~ dnorm(0, 5)
    beta ~ dnorm(0, 5)
    sigma ~ dunif(0, 100)
    sigma.b ~ dunif(0, 100)
  }
  ```

## Commands

```bash
# Serve the app locally (required for fetch-based popup loading)
npx serve .

# Render popup .qmd files via Quarto and regenerate the JS bundle
# Prerequisite: Quarto must be installed (https://quarto.org)
npm run build:popups

# Render course module .qmd files and regenerate the course bundle
npm run build:course

# Start: build popups + course, then serve
npm start

# Run tests
npx vitest

# Run R reference tests
Rscript tests/r-reference/linear-model.R
```

## UI Layout

The dashboard has:
1. **Left panel**: Data upload area (drag-and-drop), model text editor, sampler settings (chains, samples, thinning, burn-in), Run/Stop buttons
2. **Right panel (tabbed)**:
   - **Data**: Table view of data to check its loaded correctly
   - **Trace**: Live-updating chain trace plots during sampling
   - **Posteriors**: Density plots for each parameter
   - **Summary**: Table with mean, SD, quantiles (2.5%, 50%, 97.5%), Rhat, ESS
   - **PPC**: Posterior predictive check plot (observed vs. simulated data)
   - **Predictions**: x-y plot with observed data and posterior mean and 95% CIs regression line 
   - **Prior Check**: Run model forward from priors only (no data likelihood)
   - **Joint parameter distribution**: Plot of joint posterior samples for two selected parameters (scatterplot)
3. **Download button**: Export parameter samples as CSV
4. **Pop-up system**: Educational tooltips/modals that can be enabled for teaching
5. **Error and warning pop-ups**: Inform users of syntax errors, or UX issues such as not loading the data

## Pop-up system

`src/ui/popups.js` implemented. 21 Quarto `.qmd` source files in `src/content/popups/`
cover MCMC, Gibbs sampling, chains, burn-in, thinning, trace plots, R-hat, ESS,
posteriors, priors, credible intervals, PPC, prior check, standard deviation (σ),
mixed-effects models, log/logit links, overdispersion, precision, predictor scaling,
and the posteriors/summary tabs. `?` trigger buttons are attached via `data-popup` HTML
attributes and programmatically on summary table column headers.

### Popup content pipeline

```
src/content/popups/<id>.qmd        ← author here (Markdown + LaTeX math)
        │
        │  npm run build:popups
        │  (runs: quarto render src/content/popups)
        ▼
src/content/popups/_rendered/<id>.html   ← HTML fragment (git-ignored)
        │
        ├─ fetch() at runtime (server mode: npx serve .)
        │
src/content/popups-bundle.js             ← fallback bundle (committed to git)
        │
        └─ imported by popups.js when fetch() unavailable (file:// mode)
```

**Content authoring:**
- Write standard Markdown in `.qmd` files; LaTeX math with `$...$` (inline) and `$$...$$` (display) is supported — Quarto renders it to KaTeX HTML at build time
- After editing, run `npm run build:popups` to regenerate both `_rendered/` and `popups-bundle.js`
- Commit the `.qmd` source and the updated `popups-bundle.js` (not `_rendered/`)

**Adding a new popup:**
1. Create `src/content/popups/<your-id>.qmd`
2. Run `npm run build:popups`
3. Add `data-popup="your-id"` to an HTML element, or call `attachPopupTrigger(element, 'your-id')` from JS
4. Commit `.qmd` + updated `popups-bundle.js`

**Prerequisites:** [Quarto](https://quarto.org) must be installed as a system tool to run `build:popups`. The committed `popups-bundle.js` means the app works for users without Quarto installed.

## Course

A standalone 1-day hands-on workshop (`course/`) built on top of the FANGS app, teaching Bayesian inference for mixed-effects models with marine-ecology examples. Full implementation plan and progress tracking live in `course/course-plan.md` and `course/course-progress.md`.

### Structure

```
course/
├── index.html          # Landing page: session → module navigation
├── course.js           # Loads rendered module HTML; mounts challenge widgets
├── course.css          # Shared styling
├── modules.js          # Single source of truth: session grouping, module order, challenge wiring
├── content/            # Module prose authored as Quarto .qmd (same pipeline as popups)
│   ├── m01-*.qmd … m20-*.qmd
│   ├── _rendered/      # git-ignored, produced by npm run build:course
│   └── course-bundle.js  # fallback for file:// mode (committed to git)
├── challenges/         # ES-module interactive widgets
│   ├── challenge-base.js    # shared mount/submit/check/persistence framework
│   ├── numeric.js           # tolerance comparison helpers
│   ├── discrete-bayes.js    # M1: Bayes table widget
│   ├── map-slider.js        # M2: MAP slider on canvas
│   ├── mcmc-animation.js    # M3: animated Metropolis sampler
│   ├── code-validator.js    # M4: parser-backed syntax checker
│   ├── quiz.js              # M10, M17: multiple-choice/matching
│   ├── results-recorder.js  # M12: localStorage table + CSV download
│   └── answer-check.js      # generic fit-and-compare (M5 onward)
└── data/               # Marine datasets (user-supplied CSVs)
```

### Curriculum overview (6 sessions, 20 modules)

| Session | Modules | Theme |
|---------|---------|-------|
| 1 | M1–M3 | Bayesian thinking from scratch (all embedded JS challenges) |
| 2 | M4–M7 | First models in FANGS |
| 3 | M8–M10 | Regression & model checking |
| 4 | M11–M12 | Factors & design matrices |
| 5 | M13–M16 | Generalised linear models (Poisson, Binomial) |
| 6 | M17–M20 | Random effects & summative challenge |

`[EMBEDDED]` modules use interactive JS widgets on the course page. `[FANGS]` modules have students work in the live app then verify via an `answer-check` widget.

### Content pipeline (same pattern as popups)

```
course/content/<id>.qmd          ← author here
        │  npm run build:course
        ▼
course/content/_rendered/<id>.html   ← git-ignored
        │
        ├─ fetch() at runtime
        │
course/content/course-bundle.js      ← fallback (committed)
```

**Building:** `npm run build:course` (or `npm start` to build everything and serve).

**Adding a module:**
1. Add an entry to `MODULES` in `course/modules.js`
2. Create `course/content/<id>.qmd`
3. Run `npm run build:course`
4. Commit `.qmd` + updated `course-bundle.js`

### Datasets

User-supplied CSVs in `course/data/`. For each `answer-check` module, fit the model once in FANGS (or via `tests/r-reference/`) and paste the reference posterior mean + 95% CI into that module's `config.params` in `modules.js`. Until reference values are filled in, modules run in **self-report mode**.

| CSV | Used by modules | Status |
|-----|----------------|--------|
| `fish-lengths.csv` | M5, M6, M7 | present |
| `jaw-length.csv` | M2, M8, M9 | missing |
| `clownfish-oa.csv` | M11, M12 | present |
| `fish-counts.csv` | M13, M14 | missing |
| `presence.csv` | M15, M16 | missing |
| `random-effects.csv` | M18, M20 | missing |

Note: `clownfish-oa.csv` replaces the originally planned `oa-study.csv`. Four datasets still need to be added.