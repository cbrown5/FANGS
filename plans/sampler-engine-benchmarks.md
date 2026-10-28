# Sampler engine benchmarks: standard vs blocked (CPU) vs blocked (GPU)

Run on 2026-10-22, branch `claude/jolly-lovelace-snvdm9` (commit 07cdbb7).
Machine: macOS (darwin 25.6.0), node v24.16.0.

Harness: `node tests/bench/fangs-cli.mjs --engine standard|cpu-blocked`.
Raw posterior summaries: `tests/r-reference/results/engine-comparison/`.

## Headline

The blocked CPU engine is 24–103× faster than standard on teaching-sized data,
and the advantage grows to >10,000× at realistic data sizes. All engines target
the same posterior. The more important result is **mixing**, not raw speed: on
hierarchical models the standard sampler fails to converge on the intercept at
sizes the blocked sampler handles in under a second.

## Timing: data/example.csv (N=50, J=5), 5000 samples / 1000 burn-in / 3 chains

| model     | standard  | cpu-blocked | speedup |
|-----------|----------:|------------:|--------:|
| linear    |  9,337 ms |      280 ms |    33×  |
| mixed     | 34,098 ms |      330 ms |   103×  |
| poisson   | 12,157 ms |      323 ms |    38×  |
| bernoulli |  8,992 ms |      373 ms |    24×  |

## Scaling: mixed model, simulated data, 2000 samples / 500 burn-in / 2 chains

| N / J      |     standard | cpu-blocked |  speedup |
|------------|-------------:|------------:|---------:|
| 50 / 5     |    34,098 ms |      330 ms |     103× |
| 500 / 20   |   194,306 ms |      177 ms |   1,096× |
| 5000 / 100 | 7,554,400 ms |      717 ms |  10,537× |

7,554,400 ms = 2 h 6 min. The standard engine is effectively unusable at
N=5000 with 100 groups.

## Validation against NIMBLE fixtures

Deviation of posterior mean from the reference, in units of the reference
posterior SD. Project tolerance is ~0.1 SD; all 95% CIs overlapped NIMBLE in
every case.

`tests/r-reference/results/linear-model-reference.json`:

| param | standard | cpu-blocked |
|-------|---------:|------------:|
| alpha |   +0.010 |      +0.016 |
| beta  |   +0.007 |      -0.018 |
| sigma |   -0.023 |      -0.027 |

`tests/r-reference/results/mixed-effects-reference.json`:

| param   | std @5k | std @40k | blocked @5k |
|---------|--------:|---------:|------------:|
| alpha   |  -0.167 |   -0.006 |      -0.039 |
| beta    |  +0.006 |   +0.006 |      +0.008 |
| sigma   |  +0.011 |   +0.023 |      +0.010 |
| sigma.b |  +0.151 |   +0.048 |      +0.064 |
| b[1]    |  +0.131 |   -0.019 |      +0.023 |
| b[3]    |  +0.153 |   +0.009 |      +0.031 |

The standard engine's 0.13–0.17 SD deviations at 5000 draws are **not a bug**.
Re-running it with 40,000 samples × 3 chains (286,432 ms) collapsed every
deviation to ≤0.05 SD. The gap was pure Monte Carlo error from ESS ≈ 100.

At N=5000 the two engines agree to 3–4 significant figures:
alpha 2.026/2.032, beta 1.5064/1.5063, sigma 0.6899/0.6895, sigma.b 0.6049/0.6065.

## Mixing (the real win)

Mixed model, 15,000 total draws:

| param   | standard ESS | cpu-blocked ESS |
|---------|-------------:|----------------:|
| alpha   |           87 |          13,178 |
| sigma.b |          122 |           1,496 |
| b[1]    |           99 |           4,444 |

At N=5000 / J=100 after 2 h 6 min, the standard engine left `alpha` at
**R-hat 1.041, ESS 62 — not converged**. The blocked engine reached ESS 3,825
on the same parameter in 717 ms.

Cost to reach equivalent accuracy on the mixed model:

| run              | time    | ESS(alpha) | deviation |
|------------------|--------:|-----------:|----------:|
| standard, 5k     |  34.1 s |         87 |  ~0.15 SD |
| standard, 40k    | 286.4 s |      2,483 |  <0.05 SD |
| blocked CPU, 5k  |  0.33 s |     13,178 |  ~0.03 SD |

≈900× saving in time-to-equivalent-accuracy, on top of the 103× per-sweep gain.

The cause is the `alpha` ↔ `b[j]` ridge: the data pin down `alpha + b[j]` much
better than either separately, so one-at-a-time updates crawl along the ridge.
The blocked engine's joint fixed-effect update and intercept↔random-effect
translation moves address exactly this. This is the same non-identifiability
that course module M20 teaches.

## Test suite

`tests/blocked-sampler.test.js` + `tests/integration.test.js`: **105 passed**.
All five built-in models (`linear`, `mixed`, `poisson`, `logistic`,
`randomSlopes`) compile to blocked plans with no fallbacks.

## GPU backend: not benchmarked

No GPU timings were obtained, for two separate reasons.

1. **Could not be measured in the agent sandbox.** The WebGPU backend only runs
   in a browser. `tests/gpu-e2e.mjs` and manual runs of `tests/gpu-harness.html`
   both need a local HTTP server plus a Chromium launch; the sandbox denies TCP
   `listen()` (EPERM on both 0.0.0.0 and 127.0.0.1) and unix-socket `bind()`,
   which Chromium requires for its profile ProcessSingleton — Edge aborts with
   "Failed to create socket directory". Playwright is not installed.
2. **The user ran it manually and reported it was "really slow."**

That slowness is expected from the design, not a defect: `gpu-backend.js` does
one readback per sweep, a fixed latency cost that only amortises when there is
enough per-sweep work to share across threads. The existing
`src/content/popups/sampler-engine.qmd` already says a GPU "has a fixed cost per
iteration, so it is *slower* than the CPU when there is little work to share
out." FANGS' teaching datasets (tens to hundreds of rows) are far below the
crossover; the harness's own `bench` mode uses N=200,000 / J=5,000 to find it.

Note also that `tests/gpu-e2e.mjs` defaults to SwiftShader (software Vulkan),
so that path validates GPU **correctness** only — its timings are meaningless.

## Decision

Given the above, the GPU option does not earn its complexity for this project's
audience. Next session: **remove the GPU engine, keep blocked CPU.** See
`plans/remove-gpu-engine.md`.

## Standard engine after phase 1 (Markov-blanket conditionals), 2026-10-28

Phase 1 of `plans/compiled-standard-sampler.md`: each update now evaluates only
the parameter's Markov blanket against a persistent per-chain state. Run in a
Linux cloud container (node v22.22.0), slower than the macOS machine above.
"before" is commit 4a7a5ac and "after" is phase 1. Both ran **on the same
machine at the same time**, one process each, so compare within a row and
not with the tables above. Same harness and settings as above. The 500/20 and
5000/100 data are simulated (`y = 1 + 0.5x + b[group] + N(0, 0.8)`).

| case                       | before (4a7a5ac) | after phase 1 | speedup |
|----------------------------|-----------------:|--------------:|--------:|
| linear, N=50               |         29,586 ms |     13,273 ms |   2.2×  |
| mixed, N=50 / J=5          |        100,112 ms |     29,881 ms |   3.4×  |
| poisson, N=50              |          6,904 ms |      3,536 ms |   2.0×  |
| bernoulli, N=50            |          7,003 ms |      3,326 ms |   2.1×  |
| mixed, N=500 / J=20        |        743,728 ms |     86,030 ms |   8.6×  |
| mixed, N=5000 / J=100      |      not run (est. ~6 h) | 1,586,764 ms (26 min) | ≈14× (est.) |

The before/after ratio grows with J, as expected from removing the
O(P · N) factor. Phase 1 makes no change to mixing (ESS ≈ 250–450 for `b[j]` at
500/20 both before and after). It also leaves the interpreter cost per
evaluation unchanged: a CPU profile of the linear model shows ~80% of the time
in `evaluateExpr`. That cost is what phase 2, compiling the model to
JavaScript, is meant to remove.
