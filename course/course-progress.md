# Course Build Progress

_Last updated: 2026-06-19 (dataset alignment, M1–M9 rewrite, M3 sampler slowdown)_

## Summary

The course scaffold is **fully implemented** across all 20 modules. Infrastructure, challenge widgets, content prose, and navigation are all in place. The primary remaining work is **supplying real marine datasets** and **pinning reference posterior values** in `modules.js`.

---

## What is done

### Infrastructure

| Item | Status | File(s) |
|------|--------|---------|
| Landing page + navigation | ✅ Done | `course/index.html`, `course/course.js` |
| Session/module registry | ✅ Done | `course/modules.js` (all 20 modules wired) |
| Course CSS (Dracula theme) | ✅ Done | `course/course.css` |
| Content loader (fetch + bundle fallback) | ✅ Done | `course/course.js` |
| KaTeX math rendering | ✅ Done | loaded dynamically in `course.js` |
| Build script (`npm run build:course`) | ✅ Done | `scripts/build-course.js` |
| `package.json` scripts (`build`, `start`) | ✅ Done | calls both popup + course builders |

### Challenge widget framework

| Widget | Module(s) | Status |
|--------|-----------|--------|
| `challenge-base.js` — mount/check/green-state/localStorage | all | ✅ Done |
| `numeric.js` — `withinAbs`, `withinRel`, `parseNum` | all | ✅ Done |
| `bayes-math.js` — `numerators`, `denominator`, `posterior` | M1 | ✅ Done |
| `discrete-bayes.js` — cell-validated Bayes table, 2 prior presets | M1 | ✅ Done |
| `map-slider.js` — canvas prior/likelihood/posterior + MAP slider | M2 | ✅ Done |
| `mcmc-animation.js` — animated Metropolis + live histogram + ESS check | M3 | ✅ Done |
| `code-validator.js` — real Lexer→Parser syntax check with line/col errors | M4 | ✅ Done |
| `answer-check.js` — fit-in-FANGS then enter posterior means (+ self-report fallback) | M5,8,11,13–16,18,20 | ✅ Done |
| `results-recorder.js` — localStorage table + CSV download | M6,12,19 | ✅ Done |
| `quiz.js` — multiple-choice concept checks | M7,9,10,17 | ✅ Done |

### Module prose (`.qmd` source + rendered HTML)

All 20 `.qmd` files are authored and rendered to `content/_rendered/`:

| Session | Module | Title |
|---------|--------|-------|
| S1 | M1 | Bayes' theorem with discrete models |
| S1 | M2 | Bayes for a continuous parameter (MAP) |
| S1 | M3 | Sampling the posterior with MCMC |
| S2 | M4 | Writing models in BUGS/JAGS syntax |
| S2 | M5 | Fit your first model in FANGS |
| S2 | M6 | Choosing a prior for σ |
| S2 | M7 | Prior predictive checks |
| S3 | M8 | Gaussian regression: jaw length ~ body length |
| S3 | M9 | Posterior predictive checks |
| S3 | M10 | MCMC diagnostics: R-hat & ESS |
| S4 | M11 | Single-factor linear model & the design matrix |
| S4 | M12 | Comparing priors with the OA study |
| S5 | M13 | Poisson regression with a log link |
| S5 | M14 | Poisson with two factors |
| S5 | M15 | Binomial regression with a logit link |
| S5 | M16 | Binomial with a 3-level factor |
| S6 | M17 | The idea of random effects |
| S6 | M18 | Fit a random-effects model |
| S6 | M19 | Improving sampling: priors & reparameterisation |
| S6 | M20 | Summative challenge: multi-factor Poisson with random effects |

The `course-bundle.js` fallback (for `file://` mode) is also committed.

### Datasets

| File | Status |
|------|--------|
| `course/data/fish-lengths.csv` | ✅ Supplied (frogfish morphology: `Tree_name`, `Standard_length`, `Lower_jaw_length`, `Mouth_width`) |

---

## What is not done (open items for the author)

### Align datasets with modules — ✅ done (2026-06-19)

`modules.js` now points the relevant modules at datasets that actually exist,
with real column names:

- **M5, M6, M7** → `fish-lengths.csv`, intercept-only model on `Standard_length`
  (was the non-existent `fish-length.csv`).
- **M8, M9** → `fish-lengths.csv`, regression `Lower_jaw_length ~ Standard_length`
  (was the missing `jaw-length.csv`; the frogfish dataset already contains both
  jaw and body length, so a separate jaw dataset is not needed).
- **M11** → `clownfish-oa.csv` (was the missing `oa-study.csv`); columns
  `group` (Normal seawater / Acidified) and `time`.

The matching prose in `m05`–`m09` `.qmd` files was updated to reference
`fish-lengths.csv` and the real `Standard_length` / `Lower_jaw_length` columns.

Still pending datasets (no change here): `fish-counts.csv` exists but its column
schema (`site,fish,flow,logged,dist_to_logging_km,,fish_pres`) has not been
wired into M13/M14 model strings; `presence.csv` and `random-effects.csv`/
column mapping for M15/M16/M18/M20 still need author attention.

### Missing reference posterior values

All `answer-check` modules in `modules.js` have placeholder zeros in their `config.params`:

```js
{ name: 'alpha', label: 'Mean length α', mean: 0, ci: [0, 0], tol: 0.5 }
```

For each FANGS module, the author needs to:
1. Load the dataset into FANGS (or run the matching R reference script)
2. Read the posterior means and 95% CIs from the Summary tab
3. Paste the real values into `modules.js`

Affected modules: **M5, M8, M11, M13, M14, M15, M16, M18, M20**

Until these are filled in, those challenges fall back to self-report mode (they accept any number and mark the student done).

**Status: still open.** Requires running the models (R/NIMBLE or FANGS), which
needs resources not available in the automated environment. Placeholders left in
place; self-report mode remains the fallback.

### Re-write modules — ✅ first pass done (2026-06-19)

Modules **M1–M9** `.qmd` prose was rewritten to be less technical and more
narrative, anchored in the marine case studies (acoustic-tagged reef fish for
M1; the big-mouthed frogfish morphology dataset for M2–M9). Headings, math,
`Your task` sections and all challenge wiring were preserved. M10–M20 still read
in the original, more clipped style and could get the same treatment.

Note: the committed `course-bundle.js` was regenerated with the **built-in
Markdown converter** (Quarto is not installed in this environment — see the build
note below). The converter renders `**bold**` / `*italic*` only when the span sits
on a single source line, so authored prose keeps each inline-emphasis span on one
line. M14 had a pre-existing cross-line bold span that was also fixed.

### M3 - slow down sampler — ✅ done (2026-06-19)

`course/challenges/mcmc-animation.js` now has an **Animation speed** slider
(Crawl / Slow / Medium / Fast / Turbo) that controls how many Metropolis steps are
drawn per animation frame and the delay between frames (default = Slow). A moving
orange marker shows the chain's current position so the walk is visible. The ESS
gating (`ctx._ess >= targetEss`) and green-state logic are unchanged; the speed
slider can also be adjusted mid-run.

### Verification not yet done

Per the plan's verification checklist, these have **not been manually tested yet**:

- [ ] M1: wrong cells rejected; correct cells pass under both prior presets
- [ ] M2: MAP slider lights green only near the true argmax; prior switch moves the peak
- [ ] M3: sampler animates; ESS check gates the green light
- [ ] M4: buggy seed model rejected with line/col; fixed model passes
- [ ] M12/M19: recorder adds rows, survives reload, CSV download works
- [ ] localStorage state persists across page reload for all challenge types
- [ ] Navigation checkmarks update after passing each challenge

### Build note: `npm run build:course`

Quarto is **not installed** in the automated environment, so `build-course.js`
fell back to the built-in Markdown converter in `scripts/lib/render-content.js`.
This is a supported path: it emits HTML fragments with `\(...\)` / `\[...\]` /
`$$...$$` math delimiters that the runtime KaTeX auto-render in `course.js`
resolves client-side. The build ran cleanly and `course-bundle.js` was
regenerated (all 20 entries non-empty, file passes `node --check`).

Because the previously committed bundle had been produced by Quarto (full
`<html>` documents with heading ids), regenerating via the converter reflows the
whole bundle to fragments — hence a large diff across all modules even though only
M1–M9 + M14 prose changed. When Quarto is available, re-running
`npm run build:course` will restore the Quarto-rendered form.

### Optional / out of scope

- Progress dashboard aggregating all localStorage green-states
- Final per-module minute timings (current values in `modules.js` are approximate)
- Unit tests for `bayes-math.js`, `numeric.js`, and `code-validator.js` logic (noted in plan but not written)
