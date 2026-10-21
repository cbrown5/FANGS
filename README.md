# FANGS

Give your browser Bayesian teeth.

FANGS is a Gibbs sampler that runs Bayesian inference in your browser. No software setup necessary. Fast Accessible Numeric Gibbs Sampler.

Built with Claude Code.

---

## Running the app

```bash
npx serve .
```

Then open `http://localhost:3000` in your browser.

## Sampler engines

The **Sampler engine** setting chooses how each MCMC sweep is run:

| Engine | What it does | Best for |
|--------|--------------|----------|
| Standard (default) | Component-wise Gibbs: one parameter at a time, conjugate draws or slice sampling | Any model; small teaching datasets |
| Blocked — GPU (WebGPU, experimental) | Blocked Gibbs for GLMMs: fixed effects updated jointly, all group-level effects updated in parallel on the GPU, hyperparameters from sufficient statistics | Large datasets or many groups |
| Blocked — CPU | The same blocked algorithm on the CPU | Medium datasets; browsers without WebGPU |

The blocked engines support normal, Poisson (log link) and Bernoulli/binomial
(logit link) responses whose linear predictor is linear in the coefficients,
with `dnorm` priors on the coefficients and random intercepts or slopes. That
covers all of the built-in examples. Other models fall back to the standard
sampler automatically, and the status bar says why. Design notes:
[`plans/gpu-blocked-sampler.md`](plans/gpu-blocked-sampler.md).

WebGPU is available in recent Chrome and Edge, and in Safari 26+. In Firefox it
may need enabling. Without it, the GPU option falls back to the blocked CPU
engine.

## Running tests

### JavaScript app tests

Install dependencies first (one-time):

```bash
npm install
```

Then run all tests:

```bash
npx vitest run
```

Or run a specific test file:

```bash
npx vitest run tests/parser.test.js
npx vitest run tests/distributions.test.js
npx vitest run tests/integration.test.js
```

### R reference tests

Requires R with the `nimble` package installed (`install.packages("nimble")`).

Run from the project root:

```bash
Rscript tests/r-reference/linear-model.R
Rscript tests/r-reference/mixed-effects.R
Rscript tests/r-reference/poisson-glm.R
Rscript tests/r-reference/binomial-glm.R
```

Or all at once:

```bash
Rscript tests/r-reference/{linear-model,mixed-effects,poisson-glm,binomial-glm}.R
```

Reference JSON fixtures are written to `tests/r-reference/results/`.

Matching app tests are run with: `npx vitest run tests/integration.test.js`

### GPU sampler test

`tests/blocked-sampler.test.js` (part of `npx vitest run`) covers the blocked
sampler on the CPU. The WebGPU kernels are checked in headless Chromium using
SwiftShader (a software GPU, so no graphics card is needed):

```bash
node tests/gpu-e2e.mjs            # GPU vs CPU posteriors for every example model
node tests/gpu-e2e.mjs --bench    # also time both backends on a simulated GLMM
```

To time the GPU on real hardware, serve the repo and open
`/tests/gpu-harness.html?bench=1&benchN=200000&benchJ=5000`.

## Adding or editing educational popups

Popup content is authored in [Quarto](https://quarto.org) `.qmd` files and rendered to HTML
at build time. The rendered HTML is bundled into `src/content/popups-bundle.js` as a fallback
so popups work even when opened via `file://` without a local server.

**Prerequisite:** Install [Quarto](https://quarto.org) as a system tool.

### Editing existing popup text

1. Open the relevant `.qmd` file in `src/content/popups/` and make your changes.
   Standard Markdown is supported, plus LaTeX math (`$...$` inline, `$$...$$` display).
2. Run `npm run build:popups` to re-render and regenerate the bundle.
3. Reload the app.

### Adding a new popup

**Step 1 — Write the content**

Create a new Quarto file in `src/content/popups/`:

```
src/content/popups/my-topic.qmd
```

**Step 2 — Build**

```bash
npm run build:popups
```

This renders all `.qmd` files to HTML fragments in `src/content/popups/_rendered/` and
regenerates `src/content/popups-bundle.js`.

**Step 3 — Attach the trigger to an HTML element**

*Option A — static HTML element*

Add `data-popup="my-topic"` to any element in `index.html`. A `?` button is appended automatically when the app loads:

```html
<label for="input-foo" data-popup="my-topic">My setting</label>
```

*Option B — dynamically created element (JavaScript)*

Import `attachPopupTrigger` and call it after the element exists in the DOM:

```js
import { attachPopupTrigger } from './ui/popups.js';

attachPopupTrigger(myElement, 'my-topic');
```

**Step 4 — Commit**

Commit the `.qmd` source file and the updated `popups-bundle.js`.
Do not commit `src/content/popups/_rendered/` (it is git-ignored).

---

## Existing popup files

| File | Topic |
|------|-------|
| `mcmc.qmd` | What is MCMC? |
| `gibbs-sampler.qmd` | How Gibbs sampling works |
| `sampler-engine.qmd` | Standard vs blocked (GPU/CPU) sampler engines |
| `chains.qmd` | Multiple chains |
| `burn-in.qmd` | Burn-in / warm-up |
| `thinning.qmd` | Thinning |
| `trace-plot.qmd` | Reading trace plots |
| `rhat.qmd` | R-hat convergence diagnostic |
| `ess.qmd` | Effective sample size |
| `posterior.qmd` | Posterior distributions |
| `prior.qmd` | Prior distributions |
| `credible-interval.qmd` | Credible intervals |
| `ppc.qmd` | Posterior predictive checks |
| `prior-check.qmd` | Prior predictive checks |
| `precision.qmd` | Standard deviation (σ) parameterisation |
| `mixed-effects.qmd` | Mixed-effects models |
| `posteriors-tab.qmd` | Reading the Posteriors tab |
| `summary-tab.qmd` | Reading the Summary table |
