# Plan: 1-Day FANGS Course — Modules + Embedded JS Challenges

## Context

FANGS is a dependency-free, vanilla-JS, single-page Bayesian teaching app. The
goal is a **1-day, hands-on workshop** that teaches Bayesian inference for
mixed-effects models, with marine-ecology examples, where students *do* far more
than they read or listen. Early conceptual modules (Bayes theory, MCMC) are
taught through **interactive JS challenge apps embedded directly in the page**;
from the first real model fit onward, students work in the live FANGS app and
the "challenge" becomes *fit the model correctly and check your answer*.

Decisions locked with the user:
- **Delivery format:** a standalone `course/` directory of per-module pages.
  Prose is authored as **Quarto `.qmd`** (reusing the existing popup pipeline →
  KaTeX math for free); interactive challenges are small **ES-module JS
  widgets** that reuse existing FANGS code. Hands-on modules link out to the
  live app (`index.html`); the app itself is *not* embedded.
- **Plan scope:** full curriculum (all ~20 modules: goals, content, challenge
  spec) + the embedding architecture + detailed specs for the handful of custom
  interactive widgets. Reference widgets are specified, not all built in one go.
- **Datasets:** the **user will supply real marine datasets**. The plan
  references each CSV's column structure as a placeholder; the author plugs in
  reference posterior values (from a one-time FANGS/R fit) into each
  "check-your-answer" challenge.
- **Pacing:** modules grouped into **6 themed sessions** with a rough minute
  budget so they fit a working day (~8h with breaks/lunch).

This change is purely additive — it introduces a new `course/` area and a build
script; it does not modify the existing sampler, parser, or app UI.

---

## Architecture

### Directory layout (new)

```
course/
├── index.html              # Landing page: session → module navigation
├── course.css              # Shared styling (reuse FANGS Dracula look + popup CSS)
├── course.js               # Loads rendered module HTML; mounts the module's challenge widget
├── content/                # AUTHORED module prose (.qmd, Markdown + LaTeX)
│   ├── s1-m01-discrete-bayes.qmd
│   ├── ... (one per module)
│   └── _rendered/          # git-ignored, produced by build:course
├── challenges/             # ES-module challenge widgets
│   ├── challenge-base.js    # shared framework: mount, submit/check, green-state, persistence
│   ├── numeric.js           # tolerance comparison helpers
│   ├── discrete-bayes.js    # M1
│   ├── map-slider.js        # M2
│   ├── mcmc-animation.js    # M3
│   ├── code-validator.js    # M4  (imports Lexer/Parser/ModelGraph)
│   ├── quiz.js              # M8 diagnostics + M15 random-effects concept quizzes
│   ├── results-recorder.js  # M10 (localStorage table + CSV download)
│   └── answer-check.js      # generic fit-and-compare checker (M5,M7,M11,M13,M16,M18,...)
└── data/                   # marine datasets supplied by user, one CSV per exercise
```

### Build pipeline (reuse what exists)

- Add `scripts/build-course.js`, modeled directly on
  `scripts/build-popups-bundle.js` (same Quarto-or-built-in-Markdown logic), but
  pointed at `course/content/`. It renders each `.qmd` → `_rendered/<id>.html`
  and optionally emits a `course-bundle.js` fallback for `file://` use, exactly
  as the popup build does (see `scripts/build-popups-bundle.js:208-294`).
- Add npm scripts to `package.json`: `"build:course"` and update `"start"` to
  also build the course. To avoid duplication, factor the shared render/convert
  logic out of `build-popups-bundle.js` into a small helper both scripts import.
- `course.js` loads a module's rendered HTML the same way `popups.js` does:
  `fetch('content/_rendered/<id>.html')` with the bundle as fallback
  (`src/ui/popups.js:118-139`). KaTeX CSS is injected the same way
  (`src/ui/popups.js:220-227`).

### Challenge widget framework (`challenges/challenge-base.js`)

A single contract every challenge uses, so all modules feel consistent and
"doing"-focused:

- `mountChallenge(containerEl, { id, render(root), check(state) })`.
- Renders a **Submit / Check** button, an **attempt counter**, and a success
  indicator that **lights green** when `check()` returns `{correct:true}` (the
  user's "lights up when correct" requirement).
- Persists pass/attempt state to `localStorage` keyed by module `id` so progress
  survives reloads.
- `check(state) → { correct: boolean, feedback: string }`. Numeric checks use
  `challenges/numeric.js` tolerance helpers (absolute + relative).

### Reusable FANGS code (do NOT reimplement)

- **Distributions** for prior/likelihood curves: `dnorm`, `dgamma`, `dunif`,
  `dpois`, `dbinom`, `invLogit`, etc. — all exported from
  `src/utils/distributions.js`.
- **Math helpers:** `linspace`, `mean`, `std`, `quantile`, `logSumExp` from
  `src/utils/math.js`.
- **Parser for the code-validation challenge:** `Lexer` (`src/parser/lexer.js`),
  `Parser` + `ParseError` (`src/parser/parser.js`), `ModelGraph` +
  `ModelGraphError` (`src/parser/model-graph.js`). Errors carry line/col for
  inline feedback.
- **Error display:** `showErrorModal(title, detail, suggestion)` from
  `src/ui/popups.js:52` for parser-error feedback.
- **Canvas plotting patterns:** KDE/quantile/`_niceTicks` approach in
  `src/ui/density-plot.js` and the live-redraw batching in
  `src/ui/trace-plot.js` are the templates for the MAP-slider and MCMC-animation
  widgets (copy the pattern; the internal `_kde`/`_quantile` helpers are
  module-private, so reuse via copy or by exporting them).

### Recording results in the browser (answers the M10 question)

Yes. `results-recorder.js` appends each student's recorded run (prior choice +
posterior summary) as a row in `localStorage`, renders a growing table, and
offers **Download CSV** (same client-side blob-download approach as the app's
sample export). No backend needed.

---

## Curriculum — 6 sessions, ~20 modules

Marine theme throughout. `[EMBEDDED]` = interactive JS challenge on the course
page. `[FANGS]` = student works in the live app, then verifies via a
`answer-check` widget on the course page. New modules requested by the user are
marked `[NEW]`.

### Session 1 — Bayesian thinking from scratch (~80 min, all embedded)

**M1 — Bayes' theorem, discrete.** `[EMBEDDED]`
Concept: numerator = prior × likelihood; denominator = **sum of the numerators
across all hypotheses**; posterior = numerator / denominator. Example: a tagged
fish was caught — which of 3 reefs did it come from, given a detection
likelihood?
*Challenge (`discrete-bayes.js`):* table of hypotheses with given likelihoods;
user enters prior, computes each numerator, the denominator (sum), and each
posterior. Cells validated individually with tolerance; the denominator cell
explicitly checks it equals the sum of entered numerators. Two prior presets
(flat vs informative) to compare how the posterior shifts.

**M2 — Bayes for a continuous parameter.** `[EMBEDDED]`
Concept: mean fish **jaw length** μ with fixed σ. The denominator is now an
**integral**; show it as the limit of summing ever-finer slices of μ-space.
*Challenge (`map-slider.js`):* canvas shows prior curve and likelihood curve
(and unnormalised posterior) via `dnorm` + `linspace`. User drags a slider to
the **MAP** value and hits Submit — lights green when within tolerance of the
true argmax. Repeat across 2–3 prior presets to show prior influence.

**M3 — MCMC sampling.** `[EMBEDDED]`
Concept: when you can't integrate, you sample. Step-by-step animated
Metropolis/Gibbs walk over the M2 posterior with a **live-updating** density/
histogram of accumulated draws (trace-plot batching pattern).
*Challenge (`mcmc-animation.js`):* user adjusts sampling params (proposal SD,
n-steps, burn-in) and runs; submit succeeds when the sampled density matches the
target within tolerance (or a simple ESS-style criterion is met), teaching the
effect of tuning.

### Session 2 — Your first models in FANGS (~80 min)

**M4 — Writing models: BUGS/JAGS syntax.** `[EMBEDDED]`
Walk through FANGS model syntax with a simple fish-length example. Stress
FANGS's **σ (SD) parameterisation** of `dnorm`.
*Challenge (`code-validator.js`):* textarea pre-seeded with a fish-length model
containing a deliberate bug. "Check syntax" runs `Lexer`→`Parser`→`ModelGraph`;
errors shown via `showErrorModal` with line/col; lights green when it builds a
valid graph.

**M5 — Fit a model to data.** `[FANGS]`
Guided tour of the FANGS UI: data upload, model editor, chains/samples/burn-in,
Trace and Posteriors tabs.
*Challenge:* fit the fish-length model on `data/fish-length.csv`; return and
enter posterior mean + 95% CI for the key parameter — `answer-check` lights
green if within tolerance of the reference fit.

**M6 — Priors for σ.** `[FANGS]`
Discuss prior choices for the SD (`dunif`, half-normal via truncation, etc.) and
why σ has no conjugate update (slice-sampled).
*Challenge:* refit M5 under two σ priors and compare posteriors (recorded via
M10's recorder, introduced here).

**M7 — Prior predictive checks.** `[NEW]` `[FANGS]`
Use the **Prior Check** tab: simulate data from priors only and ask "are these
fish lengths physically plausible?" Tie back to M2/M6 prior choices.
*Challenge:* identify which prior produces absurd predictions; record the
verdict.

### Session 3 — Regression & model checking (~75 min)

**M8 — Gaussian GLM: jaw length ~ body length.** `[FANGS]` *(user's M7)*
Full linear regression walkthrough; interpret slope/intercept posteriors.
*Challenge:* fit on `data/jaw-length.csv`; `answer-check` against reference
slope/intercept. This "fit + check answer" is the recurring pattern from here.

**M9 — Posterior predictive checks.** `[NEW]` `[FANGS]`
Use the **PPC** tab: do simulated datasets from the posterior look like the
observed data? Contrast with the prior predictive from M7.
*Challenge:* interpret a PPC plot (good vs poor fit) — short quiz + record.

**M10 — MCMC diagnostics: R-hat & ESS.** `[FANGS/EMBEDDED]` *(user's M8)*
R-hat (convergence across chains) and ESS (independent information).
*Challenge (`quiz.js`):* match trace-plot thumbnails to converged/not-converged;
interpret given R-hat/ESS values.

### Session 4 — Factors & design matrices (~70 min)

**M11 — Single-factor linear model.** `[FANGS]` *(user's M9)*
Explain the **design matrix** with binary (0/1) coding for a 2-level factor.
Example: ocean-acidification (OA) study, control vs acidified.
*Challenge:* fit on `data/oa-study.csv`; check the treatment-effect posterior.

**M12 — Comparing priors with the OA study.** `[FANGS]` *(user's M10)*
Explore prior sensitivity on the treatment effect.
*Challenge (`results-recorder.js`):* run under several priors and **record each
result in the browser** (localStorage table + CSV download) to compare.

### Session 5 — Generalised linear models (~90 min)

**M13 — Poisson model with log link.** `[FANGS]` *(user's M11)*
Counts of fish; `log(λ) <- α + β·x`. Interpret on the count scale.
*Challenge:* fit `data/fish-counts.csv`; check posteriors.

**M14 — Poisson with two factors.** `[FANGS]` *(user's M12)*
Two categorical predictors; interpreting combined design-matrix effects.
*Challenge:* fit + check.

**M15 — Binomial model with logit link.** `[FANGS]` *(user's M13)*
Presence/absence; `logit(p) <- α + β·x`.
*Challenge:* fit `data/presence.csv`; check.

**M16 — Binomial with a 3-level factor.** `[FANGS]` *(user's M14)*
Design matrix for a 3-level factor (reference + 2 contrasts).
*Challenge:* fit + check; identify which contrast is which.

### Session 6 — Random effects & bringing it together (~75 min)

**M17 — The idea of random effects.** `[EMBEDDED]` *(user's M15)*
Partial pooling, shared variance across groups (e.g. reefs/sites).
*Challenge (`quiz.js`):* conceptual quiz — when to pool, fixed vs random.

**M18 — Fit a random-effects model.** `[FANGS]` *(user's M16)*
Random intercepts by group on `data/random-effects.csv`.
*Challenge:* fit + check the group-level SD and a couple of group effects.

**M19 — Improving sampling.** `[FANGS]` *(user's M17)*
Show bad priors → poor chains (high R-hat, low ESS) and how
**reparameterisation** fixes it.
*Challenge:* take a badly-mixing setup and improve it until diagnostics pass.

**M20 — Summative challenge.** `[FANGS]` *(user's M18)*
Multi-factor Poisson with random effects — combines everything.
*Challenge:* fit the full model and pass the `answer-check` on all key
parameters.

---

## Datasets (user-supplied; placeholders to fill)

One CSV per exercise in `course/data/`. The author fits each once (in FANGS or
via the R reference scripts in `tests/r-reference/`) and pastes reference
posterior summaries into the matching `answer-check` config.

| CSV | Used by | Expected columns |
|-----|---------|------------------|
| `fish-length.csv` | M5, M6, M7 | `length` (response) |
| `jaw-length.csv` | M2, M8, M9 | `jaw_length` (resp), `body_length` (pred) |
| `oa-study.csv` | M11, M12 | response, `treatment` (2-level factor) |
| `fish-counts.csv` | M13, M14 | `count` (resp), predictor(s), factor(s) |
| `presence.csv` | M15, M16 | `present` (0/1), predictor, 3-level factor |
| `random-effects.csv` | M18, M20 | response, predictor(s), factor(s), `site`/`reef` group |

Factors can stay as strings — `csv-loader.js` auto-encodes them (1-based) and
records the mapping, so no manual design-matrix prep is needed by students.

---

## Reference challenge widgets to implement first

These establish the pattern; remaining modules reuse `answer-check.js`/`quiz.js`.

1. `challenge-base.js` + `numeric.js` — framework, green-state, persistence.
2. `discrete-bayes.js` (M1) — cell-validated Bayes table, 2 priors.
3. `map-slider.js` (M2) — canvas prior/likelihood + MAP slider + submit.
4. `mcmc-animation.js` (M3) — animated sampler + live density + tuning.
5. `code-validator.js` (M4) — parser-backed syntax checker.
6. `answer-check.js` — generic fit-and-compare (used M5 onward).
7. `results-recorder.js` (M12) — localStorage table + CSV download.
8. `quiz.js` (M10, M17) — multiple-choice / matching.

---

## Verification

- **Build:** `npm run build:course` renders all `.qmd` without error and writes
  `_rendered/` (+ optional bundle). Run with Quarto installed; confirm the
  built-in-Markdown fallback path also works (mirror the popup build test).
- **Manual walkthrough:** `npx serve .`, open `course/index.html`, step through
  every module. Confirm each challenge mounts, Submit/Check works, the indicator
  **lights green** on correct answers, and green/attempt state **persists across
  reload** (localStorage).
  - M1: wrong numerators/denominator rejected; correct ones pass under both priors.
  - M2: MAP slider lights green only near the true argmax; behaviour changes with prior preset.
  - M4: seeded buggy model rejected with a line/col error; fixed model passes.
  - M12: recorder adds rows, survives reload, downloads a valid CSV.
- **Reference accuracy:** cross-check each `answer-check` reference value against
  a live FANGS fit and/or `tests/r-reference/*` outputs (convert σ vs precision
  per CLAUDE.md when porting NIMBLE values).
- **Unit tests (vitest, under `tests/`):** pure-logic checkers — discrete-Bayes
  math, numeric tolerance comparison, and the parser-validity check used by M4.

## Out of scope / open items for author

- Supplying the real marine CSVs and their reference posterior values.
- Final per-module minute timings (budgets above are approximate).
- Optional: a progress dashboard aggregating localStorage green-states.