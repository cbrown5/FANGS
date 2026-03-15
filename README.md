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

## Running tests

```bash
node tests/parser.test.js
node tests/distributions.test.js
node tests/integration.test.js
```

## Adding a new educational popup

Popups are plain Markdown files. No build step is needed.

**1. Create the Markdown file**

Add a new file to `src/content/popups/`:

```
src/content/popups/my-topic.md
```

Write normal Markdown. Supported syntax: headings (`#`, `##`, `###`), bold (`**text**`), italic (`*text*`), inline code (`` `code` ``), unordered lists (`- item`), fenced code blocks (` ``` `), and tables (`| col | col |`).

**2. Attach the trigger to an HTML element**

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

That's it. The popup will fetch and display `src/content/popups/my-topic.md` when the `?` button is clicked.

---

## Existing popup files

| File | Topic |
|------|-------|
| `mcmc.md` | What is MCMC? |
| `gibbs-sampler.md` | How Gibbs sampling works |
| `chains.md` | Multiple chains |
| `burn-in.md` | Burn-in / warm-up |
| `thinning.md` | Thinning |
| `trace-plot.md` | Reading trace plots |
| `rhat.md` | R-hat convergence diagnostic |
| `ess.md` | Effective sample size |
| `posterior.md` | Posterior distributions |
| `prior.md` | Prior distributions |
| `credible-interval.md` | Credible intervals |
| `ppc.md` | Posterior predictive checks |
| `prior-check.md` | Prior predictive checks |
| `precision.md` | Precision (τ) vs variance |
| `mixed-effects.md` | Mixed-effects models |
| `posteriors-tab.md` | Reading the Posteriors tab |
| `summary-tab.md` | Reading the Summary table |
