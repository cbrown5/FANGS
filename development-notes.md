
## Sampler Performance Optimizations (2026-03-17)

Six hot-path optimizations were applied on branch `claude/optimize-sampler-performance-ZjCXZ`.
All changes were verified with manual Node.js smoke tests (distributions, linear model, mixed-effects).
If any optimization causes a regression, revert them individually in the order listed below
(each is self-contained).

### Change 1 — `_mergeValues` single-pass topo eval (`src/parser/model-graph.js`)

**What:** At `build()` time, precompute `_baseValues` (observed node values + scalar data
constants) and `_detNodesSorted` (deterministic nodes in topological order).
`_mergeValues()` now does one `Object.assign({}, _baseValues, paramValues)` plus a single
forward pass over `_detNodesSorted` instead of the old repeated-pass loop.

**Why:** `_mergeValues` is called on every density evaluation (slice sampling: ~250
calls/parameter/iteration; conjugate updates: once per call). The old approach was O(D²)
worst case; the new one is O(D) with zero allocation for topo-sort recomputation.

**Revert signal:** logPosterior returns wrong values or throws; `_detNodesSorted` is undefined.

**How to revert:** Restore `_mergeValues` to the original repeated-pass implementation and
remove `_buildBaseValues` / `_topoSortDeterministic` methods and their calls in `build()`.

---

### Change 2 — Slice sampler `logFC` mutate+restore (`src/samplers/gibbs.js`)

**What:** In `updateParameter`, the `logFC` closure no longer creates
`{ ...paramValues, [paramName]: value }` on every call. Instead it mutates
`paramValues[paramName] = value` before calling `logFn(paramValues)`.

**Why safe:** `logFn` calls `graph.logPosterior(pv)` → `_mergeValues(pv)` which does
`Object.assign({}, ...)` copying the object before use, so the mutation is invisible outside
the closure. After `sliceSample` returns, `paramValues[paramName]` is overwritten with the
accepted sample anyway.

**Why:** Eliminates O(params) object allocation per density evaluation (~250×/param/iter
during slice sampling).

**Revert signal:** Slice-sampled parameters drift or produce -Infinity likelihoods.

**How to revert:** Restore the original `logFC`:
```js
const logFC = (value) => {
  const testValues = { ...paramValues, [paramName]: value };
  return logFn(testValues);
};
```

---

### Change 3 — `conjugateNormalNormalOffset` per-child mutate+restore (`src/samplers/gibbs.js`)

**What:** The numerical-differentiation step for computing `c[i] = ∂mu[i]/∂θ` previously
created two object spreads per observed child (`pvPlus`, `pvMinus`). Now it mutates
`paramValues[node.name]` in-place (±eps), calls `graph.evaluateExpr`, then restores.

**Why safe:** Same reasoning as Change 2 — `graph.evaluateExpr` calls `_mergeValues` which
copies internally.

**Revert signal:** Slopes/random effects samples are systematically off.

**How to revert:** Restore the original spread pattern:
```js
const pvPlus  = { ...paramValues, [node.name]: theta + eps };
const pvMinus = { ...paramValues, [node.name]: theta - eps };
const muPlus  = graph.evaluateExpr(meanExpr, pvPlus);
const muMinus = graph.evaluateExpr(meanExpr, pvMinus);
```

---

### Change 4 — Conjugate child-collection uses `node.children` (`src/samplers/gibbs.js`)

**What:** `collectNormalChildren`, `collectNormalChildResiduals`, the inner loops of
`conjugateBetaBinom`, and `conjugateGammaPoisson` previously iterated over all `graph.nodes`
(O(all nodes)) to find relevant children. They now iterate `node.children` (pre-wired at
`build()` time, O(children)).

**Why:** For a model with N=50 observations and P=5 parameters, the old approach did
50×5×iterations graph-full scans; the new one scans only the ~50-element children list.

**Revert signal:** Conjugate updates return wrong sufficient statistics (e.g. tau posteriors
near its prior, not data-informed).

**How to revert:** Change each `for (const childName of node.children)` back to
`for (const [, child] of graph.nodes)` and remove the `graph.nodes.get(childName)` lookup.

---

### Change 5 — In-place shuffle (`src/samplers/gibbs.js`)

**What:** The per-iteration `shuffled(params)` call (which allocated a new array) was
replaced with a pre-allocated `order = params.slice()` per chain and `shuffleInPlace(order)`
each iteration.

**Why:** Avoids one array allocation per iteration (minor, but free win).

**Revert signal:** Parameters are always updated in the same order (would show as unusually
correlated samples, not a crash).

**How to revert:** Replace `shuffleInPlace(order)` with `const order = shuffled(params)` and
restore the original `shuffled()` function.

---

### Change 6 — Lanczos coefficients at module scope (`src/utils/distributions.js`)

**What:** The 9-element Lanczos coefficient array `c` inside `logGamma` was re-created on
every call. Moved to module-scope constants `_LANCZOS_G` / `_LANCZOS_C`.

**Why:** `logGamma` is called by `dgamma`, `dbeta`, `dpois`, `dbinom` on every density
evaluation. Array allocation in a hot loop is wasteful.

**Revert signal:** `dgamma` / `dbeta` / `dpois` / `dbinom` return wrong values.

**How to revert:** Move the array back inside `logGamma` and replace `_LANCZOS_G` /
`_LANCZOS_C` references with the local `g` / `c` names.


## Parallel Chains (2026-03-18)

Implemented on branch `claude/parallel-chains-sampler-b6pks`.

Previously all chains ran sequentially in a single Web Worker. Each chain now runs in its own Web Worker, enabling true OS-level parallelism and an ~N-fold wall-clock speedup for N chains on a multi-core machine.

### How it works

1. **`sampler-worker.js`** gained two new modes alongside the original `START` path:
   - **Single-chain mode** (`START` + `chainIdx`): runs `runGibbs` with `nChains: 1`, remaps the internal chain index to the real index in all SAMPLES/PROGRESS messages, then sends `CHAIN_DONE` with that chain's raw samples.
   - **Coordinator mode** (`SUMMARIZE`): rebuilds the graph from model source + data, calls `summarizeAll` and `_generatePredictions` across all collected chains, sends the final `DONE` message.

2. **`app.js`** Run button now spins up one Worker per chain simultaneously. Progress bar shows the average across all chains. When all `CHAIN_DONE` messages have arrived, a summary worker is created and sent `SUMMARIZE`. Stop button terminates all chain workers and the summary worker.

3. **Prior-check path** is unchanged — still uses the original single-worker `START` flow.

