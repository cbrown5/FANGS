# Plan: a fast "compiled" standard sampler

Status: phase 1 implemented (2026-10-28): `src/samplers/chain-state.js`,
`ModelGraph.getBlanket()`, `tests/markov-blanket.test.js`. Phases 2 and 3 are
proposed.

## Goal

Make the **standard** (component-wise Gibbs) engine fast enough for
real-sized data while keeping it fully general: any model the parser accepts
should still run on it. The blocked engine stays the fastest option for the
GLMMs it supports. This plan makes the fallback path usable rather than
replacing the blocked engine.

There are three changes. Each ships as its own PR and leaves the previous
level in place as a correctness oracle:

| Phase | Change | Kind of win |
|-------|--------|-------------|
| 1 | Markov-blanket full conditionals plus a persistent value state | asymptotic: O(P·N) → O(blanket) per update |
| 2 | Compile the graph to specialised JavaScript on typed arrays | constant factor: removes interpreter overhead |
| 3 | Cache linear predictors and update them incrementally | constant factor: O(terms) → O(1) per affected row |

Success targets on the existing benchmark (`plans/sampler-engine-benchmarks.md`,
mixed model):

| Case | Today | Target after phase 3 |
|------|------:|------:|
| N=50 / J=5, 5000 samples × 3 chains | 34 s | ≤ 2 s |
| N=500 / J=20, 2000 × 2 | 194 s | ≤ 3 s |
| N=5000 / J=100, 2000 × 2 | 2 h 6 min | ≤ 60 s |

These targets are about speed only. Mixing is unchanged: the standard engine
still has ESS ≈ 100 for `alpha` on the mixed model. Mixing is the blocked
engine's job.

---

## Why the standard engine is slow today

These are the hot paths in `src/samplers/gibbs.js` and `src/parser/model-graph.js`:

1. **The slice fallback evaluates the full joint.** `updateParameter` builds
   its log full conditional as `graph.logPosterior(pv)`, which sums the
   log-density of *every* stochastic and observed node in the model. A slice
   update takes roughly 5–20 evaluations, so updating one random effect
   `b[3]` touches all N observations about 10 times.
2. **Every evaluation rebuilds the whole value map.** `_mergeValues` does an
   `Object.assign({}, _baseValues, paramValues)` over all data and parameters,
   then recomputes **every** deterministic node in topological order. The
   conjugate updates call it as well.
3. **Interpreter overhead.** `evaluateExpr` walks the AST recursively. For
   each `IndexExpr` it maps the indices through `Math.round`, builds a string
   key such as `"b[3]"`, and does a hash lookup. `_logDensityNode` allocates a
   `params` array on every call.

Point 1 together with point 2 makes one sweep cost about
O(P × N × slice steps), where P grows with J. That is why N=5000/J=100 is
quadratic in practice.

---

## Phase 1: Markov-blanket conditionals and persistent state

All work stays inside the existing interpreter, so this phase adds no new
evaluation machinery.

### Design

**1a. Precompute each parameter's blanket at `build()` time.** For each
unobserved stochastic node `p`, store:

- `blanket.detPath`: the deterministic descendants of `p` reached through
  deterministic-only paths, in topological order (a filtered slice of
  `_detNodesSorted`).
- `blanket.children`: the stochastic and observed nodes whose distribution
  parameters depend on `p` directly or through `detPath`.
- `blanket.priorChildren`: the subset of `children` that are unobserved. This
  is used in prior-only mode.

The log full conditional is then:

```
logFC(p) = logDensity(p | its parents) + Σ_{c ∈ children} logDensity(c | its parents)
```

This differs from `logPosterior` only by an additive constant that does not
depend on `p`. That is all the slice sampler and the Metropolis-Hastings
ratios need.

**1b. Keep a persistent `allValues` map per chain.** Replace the pattern of
merging on every call with a `ChainState` object that owns one merged map for
the whole chain:

- `state.set(p, v)` writes `p`, then re-evaluates only `blanket(p).detPath`.
- `state.logConditional(p)` sums the prior term and the children terms using
  the current map.
- A slice proposal does `set` then `logConditional`. On rejection the final
  `set` restores the accepted value. The slice sampler always finishes by
  setting the accepted value, so the state stays consistent.

**1c. Make the conjugate updates use `ChainState`.**
`conjugateNormalNormal(Offset)`, `conjugateBetaBinom` and
`conjugateGammaPoisson` stop calling `_mergeValues` and read from
`state.values`, iterating `blanket.children` instead of `node.children`.

**1d. Make graph construction cheaper.** The `parents.includes` /
`children.includes` checks in `_resolveEdges` cost O(N²) for a node like
`alpha` with N children. Switch them to `Set`s during the build and convert
to arrays afterwards. Every phase depends on build time, and it starts to
matter at N ≥ 5000.

### API shape

```js
// src/samplers/chain-state.js (new)
export class ChainState {
  constructor(graph, initialValues, { priorOnly = false } = {})
  get values()                 // read-only view, used by onSample/onProgress
  set(paramName, value)        // writes the value and refreshes detPath
  logConditional(paramName)    // prior term plus blanket children
  snapshot()                   // { param: value } for saved samples
  checkConsistency()           // test-only: compares against a fresh _mergeValues
}
```

`runGibbs` creates one `ChainState` per chain. `updateParameter(paramName,
graph, paramValues, options)` keeps its current signature as a thin wrapper,
because existing tests call it directly. Internally it delegates to a new
`updateParameterState(paramName, state, options)`.

### Phase 1 tests: `tests/markov-blanket.test.js`

All of these tests use a shared **model zoo** fixture (see "Shared test
infrastructure" below).

1. **Blanket structure.**
   - In the mixed model, the blanket of `b[j]` contains exactly the `y[i]`
     with `group[i] == j` and their `mu[i]`.
   - The blanket of `sigma` contains all `y[i]` and no deterministic nodes.
   - The blanket of `sigma.b` contains exactly `b[1..J]`.
   - With nested deterministic nodes (`eta[i] <- …; mu[i] <- 2*eta[i]`),
     both appear in `detPath`, in topological order.
2. **Equivalence with the full joint, which is the key correctness test.**
   For every model in the zoo, every parameter `p`, and 20 random pairs of
   values (v₁, v₂) drawn from the prior with all other parameters held fixed:
   `logConditional(p@v₁) − logConditional(p@v₂)` equals
   `logPosterior(…v₁) − logPosterior(…v₂)` within 1e-9 relative error.
   Repeat with `priorOnly: true` against `logPriorOnly`. Handle `-Infinity`
   explicitly: both sides must be `-Infinity` together, for example when a
   value falls outside a `dunif` bound.
3. **State consistency (property test).** Apply 2,000 random `set` calls,
   including rejected slice proposals, then assert that
   `state.checkConsistency()` finds every deterministic node equal to a fresh
   `_mergeValues` within 1e-12.
4. **Work counting.** Add a test-only counter hook to `_logDensityNode` and
   count density evaluations in one sweep of the mixed model at N=500, J=20.
   Assert the count is below `c · N · slice steps`. Today it is about
   `P · N · slice steps`. This is a deterministic stand-in for a speed test,
   so it can run in CI without timing flakiness.
5. **Unchanged behaviour.** Run the existing `tests/integration.test.js` NIMBLE
   and exact-posterior comparisons unmodified. They must still pass.

---

## Phase 2: compile the model to JavaScript

### Design

**2a. Record which loop statement produced each node.** During unrolling
(`_processStochastic` / `_processDeterministic`), tag each node with
`stmtId` (the AST statement it came from) and `loopIndex` (its tuple of loop
variable values). This small parser change is what allows "re-rolling" the
unrolled graph back into loops. Without it, the generated code would contain
one line per observation, which gives huge functions at N=5000 and a JIT
that gives up on them.

**2b. Slot layout.** `compileModel(graph)` assigns:

- A `Float64Array S` holding every parameter and deterministic node, one slot
  each.
- One `Float64Array` per observed variable and per data column.
- For every indexed reference inside a statement, an `Int32Array` that maps
  each instance of the statement to a slot or data offset. For example,
  `b[group[i]]` becomes `S[ref_7[k]]`, where `ref_7[k]` is the slot of
  `b[group[i_k]]`.

Index resolution, the 1-based to 0-based shift, `Math.round` and bounds
checks all happen once, at compile time. An out-of-range index such as
`group[i] = 6` with `J = 5` becomes a compile-time error that names the row.
Today it is a runtime error in the middle of sampling.

**2c. Code generation.** For each statement, emit a JavaScript function that
loops over an `Int32Array` of instance ids:

```js
// generated for: y[i] ~ dnorm(mu[i], sigma), where mu[i] <- alpha + beta*x[i] + b[group[i]]
function ll_stmt3(S, D, inst, n) {
  let acc = 0;
  for (let t = 0; t < n; t++) {
    const k = inst[t];
    const mu = S[0] + S[1] * D.x[k] + S[R5[k]];   // det node inlined
    acc += dnorm(D.y[k], mu, S[2]);
    if (acc === -Infinity) return acc;
  }
  return acc;
}
```

- A deterministic node used by exactly one statement is **inlined** as a
  local, as above. Otherwise it gets its own slot and its own generated
  "refresh" loop, which runs over the `detPath` instances from phase 1.
- For each parameter `p`, the compiler builds `instancesOf(p, stmt)`, the
  `Int32Array` of blanket instances per statement, using the phase 1 blanket.
  The generated `logConditional[p](S)` is then the prior term plus calls to
  `ll_stmt*` over those instance lists.
- Density kernels are the existing functions from `src/utils/distributions.js`,
  passed into the generated factory as arguments. Each one is small enough
  for V8 and SpiderMonkey to inline. Link functions and math functions such
  as `pow`, `exp`, `log`, `sqrt`, `abs`, `inverse`, `ilogit` and `probit` are
  passed in the same way.
- The generated code produces log-densities that match the interpreter
  exactly, including constants. Dropping constants would be a later
  optimisation. Matching exactly keeps the equivalence tests simple.

**2d. Generation safety.**

- The generated text contains only slot numbers, array names that the
  compiler generates itself (`R5`, `D.x`), function names from a fixed
  allow-list, and numeric literals formatted with `Number.prototype.toString`.
  User identifiers never appear in the source text. Data columns are reached
  through a `Map` built beforehand, not by spelling the name.
- The source is turned into a function with `new Function(...)`. If that
  throws, for example `EvalError` under a Content-Security-Policy without
  `unsafe-eval`, the compiler returns an `UnsupportedModelError`-style reason
  and the sampler falls back to the phase 1 interpreter path. This follows
  the existing blocked-engine pattern in `compile-model.js`.
- The generated source is kept on the compiled object (`compiled.source`).
  That helps debugging, and it could later become a "show compiled code"
  teaching feature.

**2e. Updates on compiled state.**

- The slice sampler calls `compiled.logConditional[p]`. It writes `S[slot]`
  directly and calls `compiled.refresh[p]()` only when `p` has non-inlined
  deterministic descendants.
- Conjugate normal updates use the fact that the log conditional is exactly
  quadratic in θ. Three evaluations of the compiled `logConditional` at θ₀−h,
  θ₀ and θ₀+h give the posterior precision and mean exactly, up to floating
  point. This generalises the finite-difference trick already used in
  `conjugateNormalNormalOffset`.
- Beta-binomial and gamma-Poisson updates get small generated
  sufficient-statistic loops over the blanket instances (Σy, Σn, and the sum
  of the λ multipliers).

**2f. Engine wiring.**

- The UI keeps the same two choices, Standard and Blocked.
- With "Standard", `sampler-worker.js` tries `compileModel(graph)` first. If
  it succeeds, it posts `ENGINE { used: 'standard', compiled: true }`. If it
  fails, it posts `compiled: false` with a reason, mirroring the blocked
  fallback message.
- A hidden setting `compile: false` forces the interpreter. This is used for
  tests, benchmarks, and debugging.
- The blocked engine's fallback goes to the compiled standard engine
  automatically, because it calls `runGibbs`.

### Phase 2 tests: `tests/compiled-model.test.js`

1. **Layout.**
   - Every parameter and non-inlined deterministic node gets exactly one slot,
     and the slots are unique.
   - Data index arrays are correct for 1-D (`x[i]`), nested (`b[group[i]]`),
     2-D (`y[i,j]`) and computed (`x[i-1]`) indices, checked against the
     interpreter's resolved names.
   - Compiling with `group[i] = J+1` throws a compile error that names the
     row.
2. **Equivalence with the interpreter.** For every zoo model, every
   parameter, and 50 random states: compiled `logConditional[p]` equals the
   phase 1 `ChainState.logConditional(p)` within 1e-10 relative error. Also
   check the `-Infinity` cases and prior-only mode. After `refresh[p]`, the
   deterministic slots must match `_mergeValues`.
3. **Conjugate updates.** Using a seeded `Math.random` (see "Shared test
   infrastructure"), one compiled conjugate update and one interpreted update
   from the same state and the same random stream give the same draw within
   1e-8. Also test the quadratic-fit precision against the closed-form
   precision for `normal-normal` and `normal-normal-offset` across scales
   (σ from 1e-3 to 1e3), so that the choice of `h` is checked for
   cancellation error.
4. **Fallback.**
   - Stub `globalThis.Function` so it throws `EvalError`. `runGibbs` must
     still complete on the interpreter path and report
     `compiled: false, reason: /eval/`.
   - A construct the compiler doesn't handle yet must fall back with a
     reason, not crash.
5. **Injection safety.** Models with hostile but parser-legal names, such as
   a data column named `constructor`, `__proto__`, `toString`, or a name
   containing `$`, compile and give correct results. A test asserts that no
   user-supplied identifier string appears in `compiled.source`.
6. **Statistical end-to-end tests.** Parameterise the existing NIMBLE and
   exact-posterior `describe` blocks in `tests/integration.test.js` over
   `engine ∈ {'interpreted', 'compiled'}`, with the same tolerances. Add a
   Geweke "getting it right" joint-distribution test
   (`tests/geweke.test.js`) for the small linear and Poisson models: it
   compares marginal-conditional and successive-conditional simulators of
   (θ, y) with a KS or mean-and-variance z-test at a fixed seed. It catches
   subtle sampler bugs, such as a wrong conditional or a stale cache, that
   posterior-mean tolerances miss. Keep the iteration count CI-sized, about
   5 s.
7. **Real browser.** Extend the Playwright smoke test (`tests/course-smoke.mjs`
   pattern, or a new `tests/compiled-worker-smoke.mjs`) to run the default
   mixed model in Chromium through the Web Worker. Assert that the `ENGINE`
   message reports `compiled: true` and that summaries render.

---

## Phase 3: incremental linear predictors

### Design

Most FANGS models compute a mean of the form
`mu[i] = alpha + beta*x[i] + b[group[i]] (+ …)`.

After phase 2, updating `sigma` still evaluates the full `mu` expression for
every row, and updating `beta` evaluates every term of it. Phase 3 caches the
predictor instead.

**3a. Detect affine terms.** For each statement with an inlined or
slotted deterministic predictor `eta` (on the link scale), and each parameter
`p` in its blanket, decide symbolically whether `eta` is affine in `p` with a
**data-only** coefficient:

- `eta = rest + coef_k · p`, where `coef_k` depends only on data and
  constants.
- Examples that qualify: `beta*x[i]` (coefficient `x[i]`), `b[group[i]]`
  (coefficient 1), `b[group[i]]*x[i]` (a random slope, coefficient `x[i]`).
- Examples that do not: `beta*beta`, `exp(beta)`, `beta*gamma*x[i]` (the
  coefficient depends on a parameter), and anything inside a nonlinear call.
  These keep the phase 2 full-expression evaluation for that parameter only.

When the term qualifies, precompute `coef` as a `Float64Array` over the
statement's instances (for example, a copy of `x`, or all ones).

**3b. Cache.** Keep `ETA_stmt` as a `Float64Array` holding the current link-scale
predictor for every instance of the statement.

- **Proposal for `p` (θ₀ → θ):** the children evaluate
  `density(y_k, invlink(ETA[k] + (θ−θ₀)·coef[k]), …)`. That is one fused
  multiply-add per row instead of re-evaluating the whole expression.
- **Accept:** `ETA[k] += (θ−θ₀)·coef[k]` over the blanket instances only.
- **Parameters that are not in `eta`** (such as the residual SD
  `sigma`): the children read `ETA[k]` directly with no
  arithmetic.
- **Drift control:** every `refreshEvery` sweeps (default 100) and at the end
  of burn-in, recompute `ETA` from scratch. In debug mode, assert that the
  maximum drift is below 1e-9 before overwriting.

**3c. Scope.** The cache is per chain and per statement. It lives in the
compiled state object, never on the graph, so concurrent chain workers stay
independent.

### Phase 3 tests: `tests/incremental-eta.test.js`

1. **Affinity detection.** A table-driven test covering every example listed
   in 3a, plus `alpha + b[group[i]] + c[site[i]]` (two random-effect
   families), link-scale statements (`log(lambda[i]) <- …`,
   `logit(p[i]) <- …`), and a predictor that reaches the observed node
   through two deterministic hops. Each case asserts the expected
   affine/non-affine verdict and the coefficient array.
2. **Cache consistency (property test).** On each zoo model, run 10,000
   random accepted and rejected proposals. After every step,
   `ETA` equals a full recompute within 1e-10. Also run 10⁶ accepted updates
   with refreshing disabled and assert that drift stays below 1e-8, which
   documents the floating-point error budget.
3. **Equivalence.** Compiled `logConditional[p]` with the cache equals the
   phase 2 version without it, within 1e-10, for random states.
4. **Statistical tests.** Add `'compiled+eta'` to the engine parameterisation
   from phase 2 item 6, and run the Geweke test on the mixed model with a
   random slope.
5. **Work counting.** Using the phase 1 counter hook, one `b[j]` update costs
   O(n_j) fused multiply-adds plus densities, and one `sigma` update evaluates
   zero predictor expressions.

---

## Shared test infrastructure

- **`tests/fixtures/model-zoo.js`**: model text, a small data generator, and
  the expected parameter list for each of the following:
  - linear
  - mixed (default)
  - Poisson-log
  - Bernoulli-logit
  - binomial with varying trial counts
  - beta-binomial conjugate
  - gamma-Poisson conjugate
  - `dlnorm` response
  - nested deterministic nodes
  - 2-D indexing `y[i,j]`
  - two crossed random-effect families
  - a random slope
  - `dunif` bounds that depend on a parameter
  - every math function (`pow`, `exp`, `log`, `sqrt`, `abs`, `inverse`)
  - hyperprior on hyperprior (`sigma.b ~ dunif(0, A)`, `A ~ dgamma`)

  Every equivalence and property test iterates over the zoo, so a new parser
  feature gets tested on every evaluation path by adding one entry.
- **`tests/helpers/seeded-random.js`**: a small PRNG (mulberry32 or sfc32)
  installed with `vi.spyOn(Math, 'random')`. `distributions.js` uses
  `Math.random` directly, so no production code changes are needed. Only
  single-update comparisons rely on identical streams. Whole chains are
  compared statistically, because harmless floating-point differences in
  summation order can change a slice-acceptance decision.
- **Engine parameterisation helper**: `describe.each(ENGINES)` with
  `ENGINES = ['interpreted', 'compiled', 'compiled+eta']`, growing as each
  phase lands.

## Benchmarks

- Extend `tests/bench/fangs-cli.mjs` with `--compile on|off` and
  `--eta-cache on|off`, and add `--sim N,J` so it can generate the scaling
  data directly.
- After each phase, re-run the existing matrix (4 models on
  `data/example.csv`, plus mixed at 50/5, 500/20 and 5000/100). Append the
  results to `plans/sampler-engine-benchmarks.md` as columns `standard (p1)`,
  `(p2)` and `(p3)`, alongside the existing `cpu-blocked` column.
- Record ESS per second as well as wall time, so that a speed win is never
  reported if it costs mixing. Mixing should be identical by construction,
  and the benchmark checks that.
- Wall-clock numbers are **not** asserted in CI because they are flaky. CI
  relies on the deterministic work-counting tests instead.

## Rollout and docs

1. **PR 1 (phase 1):**
   - Ships independently. No new files in the browser path except
     `chain-state.js`.
   - Expected to be the single largest speedup at large N, because it fixes
     the asymptotics.
2. **PR 2 (phase 2):**
   - Adds `src/samplers/compiled/` (`layout.js`, `codegen.js`,
     `compiled-sampler.js`).
   - Includes the parser change from 2a, the worker wiring from 2f, and the
     browser smoke test.
3. **PR 3 (phase 3):** extends the code generator and the compiled state.
4. After each PR, update `CLAUDE.md` (sampler strategy and project
   structure), `src/content/popups/` sampler-engines text (one sentence:
   "Standard is compiled to fast JavaScript; it falls back to an interpreter
   if your browser blocks that"), and the benchmark note.

## Risks and open questions

- **Generated code size.** Re-rolling (2a) keeps functions small, but models
  with many distinct statements, or loops nested inside loops with ragged
  index sets, may still produce large sources. Mitigation: generate one
  function per statement rather than one per parameter, and cap the source
  size, falling back to the interpreter above the cap.
- **JIT shape stability.** All arrays passed to generated code must be
  monomorphic (`Float64Array` / `Int32Array`, never mixed with plain arrays).
  The CSV loader already produces `Float64Array` columns. Integer index
  columns should be converted at compile time.
- **Semantics drift between the interpreter and compiled code**: link
  functions on observed nodes (`_applyLink` on `x`), how `-Infinity` and
  `NaN` propagate, and indices computed with `Math.round`. The equivalence
  tests over the zoo are the guard. Any new construct gets a zoo entry before
  it gets a code generator path.
- **The interpreter remains the specification.** It is kept, tested and used
  as the fallback, so its correctness keeps mattering. It also stays the
  readable reference implementation for teaching.
- **Future reuse.** The slot layout and code generator are the foundation
  for gradient code generation (HMC/NUTS), and could later replace the
  hand-written GLMM compiler in `blocked/compile-model.js`. That is out of
  scope here, but phase 2 should avoid decisions that block it. In
  particular, keep expression code generation as a pure function from AST
  to source string.
