# Course Build Progress

_Last updated: 2026-06-23 (M11–M12 content rewrite, M13 prior-comparison module, M12 reference posteriors pinned)_

## Summary

The course scaffold is **fully implemented** across all 21 modules. Infrastructure, challenge widgets, content prose, and navigation are all in place. The primary remaining work is **supplying real marine datasets** and **pinning reference posterior values** in `modules.js`.

---

## What is done

### Infrastructure

| Item | Status | File(s) |
|------|--------|---------|
| Landing page + navigation | ✅ Done | `course/index.html`, `course/course.js` |
| Session/module registry | ✅ Done | `course/modules.js` (all 21 modules wired) |
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
| `answer-check.js` — fit-in-FANGS then enter posterior means (+ self-report fallback) | M5,8,11,13–16,18,21 | ✅ Done |
| `results-recorder.js` — localStorage table + CSV download | M6,12,19,20 | ✅ Done |
| `quiz.js` — multiple-choice concept checks | M7,9,10,17 | ✅ Done |

### Module prose (`.qmd` source + rendered HTML)

All 21 `.qmd` files are authored and rendered to `content/_rendered/`:

| Session | Module | Title | Reference posteriors |
|---------|--------|-------|----------------------|
| S1 | M1 | Bayes' theorem with discrete models | N/A (embedded) |
| S1 | M2 | Bayes for a continuous parameter (MAP) | N/A (embedded) |
| S1 | M3 | Sampling the posterior with MCMC | N/A (embedded) |
| S2 | M4 | Writing models in BUGS/JAGS syntax | N/A (syntax check) |
| S2 | M5 | Fit your first model in FANGS | ✅ Pinned |
| S2 | M6 | Choosing a prior for σ | ✅ Pinned (recorder) |
| S2 | M7 | Prior predictive checks | ✅ Pinned (quiz) |
| S3 | M8 | Gaussian regression: jaw length ~ body length | ✅ Pinned |
| S3 | M9 | Posterior predictive checks | ✅ Pinned (quiz) |
| S3 | M10 | MCMC diagnostics: R-hat & ESS | ✅ Pinned (quiz) |
| S3 | M11 | Identifiability & bad ESS/R-hat: a case study | N/A (recorder) |
| S4 | M12 | Single-factor linear model & the design matrix | ✅ Pinned |
| S4 | M13 | Comparing priors with the OA study | N/A (recorder) |
| S5 | M14 | Poisson regression with a log link | ⚠️ Self-report (zeros) |
| S5 | M15 | Poisson with two factors | ⚠️ Self-report (zeros) |
| S5 | M16 | Binomial regression with a logit link | ⚠️ Self-report (zeros) |
| S5 | M17 | Binomial with a 3-level factor | ⚠️ Self-report (zeros) |
| S6 | M18 | The idea of random effects | N/A (quiz) |
| S6 | M19 | Fit a random-effects model | ⚠️ Self-report (zeros) |
| S6 | M20 | Improving sampling: priors & reparameterisation | N/A (recorder) |
| S6 | M21 | Summative challenge: multi-factor Poisson with random effects | ⚠️ Self-report (zeros) |

The `course-bundle.js` fallback (for `file://` mode) is also committed.

### Datasets

| File | Status | Used by |
|------|--------|---------|
| `course/data/fish-lengths.csv` | ✅ Present | M5, M6, M7 |
| `course/data/clownfish-oa.csv` | ✅ Present | M12, M13 |
| `course/data/fish-counts.csv` | ✅ Present | M14, M15 |
| `course/data/random-effects.csv` | ✅ Present | M19, M21 |
| `course/data/jaw-length.csv` | ❌ Missing | M8, M9 |
| `course/data/presence.csv` | ❌ Missing | M16, M17 |

---

## What is not done (open items for the author)

### Module updates

- **M00** — Add intro module: desktop/large-screen recommendation, how FANGS was made (draw on 'About' page).
- **Further reading page** — Include Bayesian workflow paper, McElreath, NIMBLE docs, etc.
- **M04** — Add three tabs with more complex syntax challenges requiring students to complete more of the syntax themselves.
- **M07** — Add a challenge like M06 where students enter prior predictive means and 95% CIs for `alpha` under different priors, from the 'Prior check' tab.
- **M08** — Add a task to run models with bad mixing as a teaching example.
- **Cross-linking** — Link related concepts across modules.

### Missing reference posterior values

Modules below are in self-report mode (accept any number). To pin them, load the dataset in FANGS (or run the R reference script), read posterior means + 95% CIs from the Summary tab, and paste into `modules.js` `config.params`.

| Module | Dataset | Parameters needed |
|--------|---------|-------------------|
| M14 | `fish-counts.csv` | `alpha`, `beta` (log scale) |
| M15 | `fish-counts.csv` | `alpha`, `beta_a`, `beta_b` |
| M16 | `presence.csv` ❌ missing | `alpha`, `beta` (logit scale) |
| M17 | `presence.csv` ❌ missing | `alpha`, `beta_2`, `beta_3` |
| M19 | `random-effects.csv` | `alpha`, `beta`, `sigma.b` |
| M21 | `random-effects.csv` | `alpha`, `beta_a`, `beta_b`, `sigma.b` |

### Missing datasets

Before M16/M17 can be completed, `presence.csv` and `jaw-length.csv` need to be created and added to `course/data/`. See dataset table above.


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
regenerated (all 21 entries non-empty, file passes `node --check`).

Because the previously committed bundle had been produced by Quarto (full
`<html>` documents with heading ids), regenerating via the converter reflows the
whole bundle to fragments — hence a large diff across all modules even though only
M1–M9 + M14 prose changed. When Quarto is available, re-running
`npm run build:course` will restore the Quarto-rendered form.

### Optional / out of scope

- Progress dashboard aggregating all localStorage green-states
- Final per-module minute timings (current values in `modules.js` are approximate)
- Unit tests for `bayes-math.js`, `numeric.js`, and `code-validator.js` logic (noted in plan but not written)
