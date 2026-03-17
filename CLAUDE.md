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
- Use **conjugate samplers** where possible (normal-normal, gamma-normal, beta-binomial, gamma-Poisson)
- Fall back to **slice sampling** for non-conjugate full conditionals
- User does not need to choose samplers — the engine auto-selects based on the model graph
- Support multiple chains with independent initialization

### Model Syntax (BUGS/JAGS dialect)
The parser must handle the following BUGS language constructs:
- `model { ... }` block wrapper
- Stochastic nodes: `y[i] ~ dnorm(mu[i], tau)`
- Deterministic nodes: `mu[i] <- alpha + beta * x[i]`
- `for(i in 1:N) { ... }` loops
- Indexing: `x[i]`, `beta[j]`, `y[i,j]`
- Key distributions: `dnorm(mean, precision)`, `dgamma(shape, rate)`, `dunif(lower, upper)`, `dbern(prob)`, `dpois(lambda)`, `dbin(prob, size)`, `dbeta(a, b)`, `dlnorm(meanlog, preclog)`
- Link functions via deterministic nodes (e.g., `log(mu[i]) <- ...` or `logit(p[i]) <- ...`)
- Truncation: `T(lower, upper)`
- Math functions: `pow()`, `exp()`, `log()`, `sqrt()`, `abs()`, `inverse()`

### Supported Model Types
1. Linear regression (Gaussian response)
2. GLMs: Poisson (log link), Binomial/Bernoulli (logit link)
3. Mixed-effects versions of the above with random intercepts (nested hierarchical design)

## Project Structure (Target)

```
FANGS/
├── index.html              # Main entry point
├── src/
│   ├── app.js              # App initialization and UI orchestration
│   ├── parser/
│   │   ├── lexer.js        # Tokenizer for BUGS syntax
│   │   ├── parser.js       # AST builder from tokens
│   │   └── model-graph.js  # Build DAG from AST
│   ├── samplers/
│   │   ├── gibbs.js        # Main Gibbs sampler loop
│   │   ├── conjugate.js    # Conjugate update rules
│   │   ├── slice.js        # Slice sampler fallback
│   │   └── initialize.js   # Chain initialization strategies
│   ├── data/
│   │   ├── csv-loader.js   # CSV parsing and validation
│   │   └── default-data.js # Built-in example dataset
│   ├── ui/
│   │   ├── editor.js       # Model text editor
│   │   ├── data-upload.js  # Drag-and-drop file upload
│   │   ├── settings.js     # Sampler settings panel
│   │   ├── trace-plot.js   # Live chain trace plots
│   │   ├── density-plot.js # Posterior density plots
│   │   ├── summary-table.js# Posterior summaries (quantiles, Rhat)
│   │   ├── ppc-plot.js     # Posterior predictive check
│   │   └── popups.js       # Educational pop-up system
│   └── utils/
│       ├── math.js         # Statistical math helpers
│       ├── distributions.js# Distribution log-densities and samplers
│       └── diagnostics.js  # Rhat, ESS, convergence checks
├── tests/
│   ├── r-reference/        # R scripts using nimble for reference results
│   │   ├── linear-model.R
│   │   ├── poisson-glm.R
│   │   ├── binomial-glm.R
│   │   └── mixed-effects.R
│   ├── parser.test.js      # Parser unit tests
│   ├── samplers.test.js    # Sampler correctness tests
│   ├── distributions.test.js
│   └── integration.test.js # End-to-end model fitting tests
├── data/
│   └── example.csv         # Default example dataset
├── instructions-for-agent.md
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
- Descriptive variable names matching statistical conventions (e.g., `tau` for precision, `mu` for mean)

### Key Implementation Notes
- NIMBLE/JAGS uses **precision** (1/variance) parameterization for `dnorm` — this must be handled correctly
- Rescale predictors internally before sampling for efficiency; back-transform results for display
- Initialize chains using overdispersed draws from the priors
- Use Web Workers for sampling to keep the UI responsive
- Canvas or SVG for plots (no heavy charting library needed)



## Default Example

The app should launch with:
- **Dataset**: ~50 observations with a continuous response `y`, one continuous predictor `x`, a categorical treatment factor `treatment` (2 levels), and a grouping variable `group` (~5 levels) for random effects
- **Pre-filled model 1** (simple linear):
  ```
  model {
    for (i in 1:N) {
      y[i] ~ dnorm(mu[i], tau)
      mu[i] <- alpha + beta * x[i]
    }
    alpha ~ dnorm(0, 0.001)
    beta ~ dnorm(0, 0.001)
    tau ~ dgamma(0.001, 0.001)
  }
  ```
- **Pre-filled model 2** (mixed-effects):
  ```
  model {
    for (i in 1:N) {
      y[i] ~ dnorm(mu[i], tau)
      mu[i] <- alpha + beta * x[i] + b[group[i]]
    }
    for (j in 1:J) {
      b[j] ~ dnorm(0, tau.b)
    }
    alpha ~ dnorm(0, 0.001)
    beta ~ dnorm(0, 0.001)
    tau ~ dgamma(0.001, 0.001)
    tau.b ~ dgamma(0.001, 0.001)
  }
  ```

## Commands

```bash
# Serve the app locally (required for fetch-based popup loading)
npx serve .

# Render popup .qmd files via Quarto and regenerate the JS bundle
# Prerequisite: Quarto must be installed (https://quarto.org)
npm run build:popups

# Start: build popups then serve
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
   - **Prior Check**: Run model forward from priors only (no data likelihood)
3. **Download button**: Export parameter samples as CSV
4. **Pop-up system**: Educational tooltips/modals that can be enabled for teaching

## Pop-up system

`src/ui/popups.js` implemented. 17 Quarto `.qmd` source files in `src/content/popups/`
cover MCMC, Gibbs sampling, chains, burn-in, thinning, trace plots, R-hat, ESS,
posteriors, priors, credible intervals, PPC, prior check, precision (τ), and
mixed-effects models. `?` trigger buttons are attached via `data-popup` HTML
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