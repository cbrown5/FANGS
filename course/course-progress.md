# Course Build Progress

_Last updated: 2026-06-19_

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

### Missing datasets

Five CSVs still need to be placed in `course/data/` before the hands-on FANGS modules will work:

| File | Used by | Expected columns |
|------|---------|-----------------|
| `oa-study.csv` | M11, M12 | response column, `treatment` (2-level factor) |
| `fish-counts.csv` | M13, M14 | `count` (response), predictor(s), factors `A` and `B` |
| `presence.csv` | M15, M16 | `present` (0/1), continuous predictor `x`, 3-level `site` factor |
| `random-effects.csv` | M18, M20 | response/count, predictor(s), factors, `group`/`reef` grouping column |

Note: `fish-lengths.csv` exists but `modules.js` references `jaw-length.csv` for M8/M9 and `fish-length.csv` for M5/M6/M7. These need to be reconciled — either rename the file or update `modules.js` to point to the real columns in `fish-lengths.csv`.

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

### Verification not yet done

Per the plan's verification checklist, these have **not been manually tested yet**:

- [ ] `npm run build:course` runs without error (Quarto installed)
- [ ] `npx serve .`, open `course/index.html` — all 20 modules load
- [ ] M1: wrong cells rejected; correct cells pass under both prior presets
- [ ] M2: MAP slider lights green only near the true argmax; prior switch moves the peak
- [ ] M3: sampler animates; ESS check gates the green light
- [ ] M4: buggy seed model rejected with line/col; fixed model passes
- [ ] M12/M19: recorder adds rows, survives reload, CSV download works
- [ ] localStorage state persists across page reload for all challenge types
- [ ] Navigation checkmarks update after passing each challenge

### Optional / out of scope

- Progress dashboard aggregating all localStorage green-states
- Final per-module minute timings (current values in `modules.js` are approximate)
- Unit tests for `bayes-math.js`, `numeric.js`, and `code-validator.js` logic (noted in plan but not written)
