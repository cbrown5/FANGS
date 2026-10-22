# Next session: remove the GPU engine, keep blocked CPU

Decision context: `plans/sampler-engine-benchmarks.md`. The blocked CPU engine
is 24–10,537× faster than standard and mixes far better on hierarchical models.
The WebGPU backend could not be benchmarked in the agent sandbox, and when run
manually it was slow — as its one-readback-per-sweep design predicts for
teaching-sized data. It is not worth the complexity.

Three tasks, in order.

## 1. Remove the GPU option (keep blocked CPU)

Engine names become `standard` and `cpu-blocked` only.

**Delete:**
- `src/samplers/blocked/gpu-backend.js`
- `src/samplers/blocked/gpu-shaders.js`
- `tests/gpu-e2e.mjs`
- `tests/gpu-harness.html`

**Keep** (the CPU blocked sampler and its support):
- `src/samplers/blocked/{blocked-sampler,compile-model,cpu-backend,linalg}.js`
- `tests/blocked-sampler.test.js`

**Edit — verified touchpoints (GPU surface outside `blocked/` is small):**

| file | line | what |
|---|---|---|
| `src/ui/settings.js` | 19 | `ENGINES = ['standard', 'gpu', 'cpu-blocked']` → drop `'gpu'` |
| `index.html` | 898 | remove `<option value="gpu">Blocked — GPU (WebGPU, experimental)</option>`; relabel the CPU option (e.g. just "Blocked (faster for mixed models)") |
| `src/app.js` | 598 | drop the `gpu:` key from the engine-label map |
| `src/samplers/sampler-worker.js` | ~69–106 | in `chooseSampler`, drop the `'gpu'` branch, the `createBlockedBackend('gpu', …)` probe and its WebGPU-unavailable fallback `reason`; keep the unsupported-model fallback |
| `src/samplers/blocked/blocked-sampler.js` | — | drop `backend: 'gpu'` dispatch in `createBlockedBackend`; CPU-only |
| `tests/blocked-sampler.test.js` | 12–13 | header comment referencing the WebGPU backend / `gpu-e2e.mjs` |

Also check for stale references in: `CLAUDE.md` (project structure tree,
Commands section's `node tests/gpu-e2e.mjs` line, sampler-strategy paragraph),
`README.md`, `PROGRESS.md`, and `plans/gpu-blocked-sampler.md` (supersede or mark
historical — do not silently delete the design rationale).

Already checked, **no work needed**:
- `src/utils/share-url.js` — does not carry `engine` at all, so no stale `'gpu'`
  can arrive via a share link.
- `src/ui/settings.js:88` — `applyValues` already guards with
  `ENGINES.includes(val)`, so a persisted `engine: 'gpu'` silently falls back to
  the default once `'gpu'` leaves `ENGINES`. Confirm the default is `standard`
  or `cpu-blocked` (see `_readEngine`, ~line 134) and no further migration is
  required.
- `scripts/build-data-zip.js` and `course/course.js` — their "blocked" matches
  are unrelated (fetch being blocked in `file://` mode).

**Popup content:** rewrite `src/content/popups/sampler-engine.qmd` for two
engines. It currently has a "Blocked (GPU or CPU)" section, a "Which should I
pick?" section with GPU advice, and a "What the GPU does not fix" section. Keep
the (good) explanation of joint fixed-effect updates, conditional independence
of groups, translation moves, and the caveat that faster iterations do not
improve mixing — just drop the GPU framing. Then `npm run build:popups` and
commit the updated `src/content/popups-bundle.js`.

**Verify:** `npx vitest` (expect the blocked + integration suites to stay green,
105 tests before removal) and a manual run of the app with each engine selected.

## 2. Add a note to a course module about when to use blocked CPU

Put it in **`course/content/m20-improving-sampling.qmd`** — the best fit, since
M20 already teaches the `alpha` ↔ `beta[site]` non-identifiability that is
exactly what the blocked sampler's joint and translation moves target. M20's
existing sections: The data / A broken model / Non-identifiability /
Fix 1: partial pooling and sensible priors / Fix 2: Reparameterisation / Your task.

Add a short subsection after "Fix 2: Reparameterisation" (before "Your task"),
framed so it does **not** undercut M20's Folk Theorem message — respecifying the
model comes first; the engine is a speed/mixing aid, not a fix for a bad model.

Content to convey:
- The **Sampler engine** setting has Standard (works for any model) and Blocked
  (GLMMs: normal/Poisson/binomial with `dnorm` priors on coefficients).
- Use Blocked when fitting **mixed-effects models**, especially with many groups
  or more than a few hundred rows. Measured: 103× faster on the 50-row course
  example, and the standard engine needs ~900× more time to match its accuracy
  because of the intercept↔random-effect ridge.
- It draws from the **same posterior** — a speed and mixing improvement, not a
  different model.
- It **does not rescue an over-specified model.** A non-identifiable model still
  has bad R-hat and ESS on any engine; fix the model first (Fixes 1 and 2).
- If a model is unsupported, FANGS falls back to Standard and says so.

Then `npm run build:course` and commit the updated `course/content/course-bundle.js`.

Worth deciding: whether the M20 note should also appear in M19
(`m19-random-effects-fit.qmd`), where students first fit a random-effects model
and would feel the speed difference. A one-line pointer there may be enough.

## 3. Merge into main

Branch `claude/jolly-lovelace-snvdm9` → `main`. Currently one commit ahead
(07cdbb7 "Add optional blocked GLMM sampler with WebGPU and CPU backends"), tree
clean as of 2026-10-22.

Sequence: finish tasks 1 and 2 → `npx vitest` green → rebuild both bundles
(`npm run build:popups`, `npm run build:course`) and confirm they are committed →
merge to `main`.

Since the GPU backend is being removed before the branch ever lands on `main`,
consider whether the WebGPU work should remain in `main`'s history at all. The
branch commit message mentions WebGPU, so either squash-merge with a message
describing what actually ships ("Add optional blocked CPU GLMM sampler"), or
keep the history and let the removal commit stand on its own. Ask the user which
they prefer — do not squash someone's history unprompted.
