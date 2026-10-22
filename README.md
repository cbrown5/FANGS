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
| Standard (default) | Component-wise Gibbs: one parameter at a time, conjugate draws or slice sampling | Any model FANGS can parse |
| Blocked | Blocked Gibbs for GLMMs: fixed effects updated jointly, all group-level effects updated at once, hyperparameters from sufficient statistics, plus intercept↔random-effect translation moves | Mixed-effects models; larger data or many groups |

The blocked engine supports normal, Poisson (log link) and Bernoulli/binomial
(logit link) responses whose linear predictor is linear in the coefficients,
with `dnorm` priors on the coefficients and random intercepts or slopes. That
covers all of the built-in examples. Other models fall back to the standard
sampler automatically, and the status bar says why.

Both engines target the same posterior. On the 50-row example dataset the
blocked engine is 24–103× faster per sweep, and it mixes far better on
hierarchical models — see
[`plans/sampler-engine-benchmarks.md`](plans/sampler-engine-benchmarks.md) for
measurements, and [`plans/gpu-blocked-sampler.md`](plans/gpu-blocked-sampler.md)
for the algorithm's design notes.

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

### Blocked sampler test

`tests/blocked-sampler.test.js` (part of `npx vitest run`) covers the blocked
sampler: the model compiler, the block update maths, and the posteriors it
produces.

To time the engines against each other, use the CLI harness:

```bash
node tests/bench/fangs-cli.mjs --model mixed --engine standard    --output /tmp/std.csv
node tests/bench/fangs-cli.mjs --model mixed --engine cpu-blocked --output /tmp/blk.csv
```

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
| `sampler-engine.qmd` | Standard vs blocked sampler engines |
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
