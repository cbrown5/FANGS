# Plan: Blocked GLMM sampler with a WebGPU backend

> **Status: partly historical.** The blocked GLMM sampler described here ships as
> the **Blocked** sampler engine, on the CPU. The **WebGPU backend was removed**
> (`gpu-backend.js`, `gpu-shaders.js`, `tests/gpu-e2e.mjs`,
> `tests/gpu-harness.html`): for teaching-sized data its one-readback-per-sweep
> design made it slower than the CPU backend, so it did not earn its complexity.
> See `plans/sampler-engine-benchmarks.md` for the measurements and
> `plans/remove-gpu-engine.md` for the removal. Everything below about the
> *algorithm* — the GLMM class, compilation, joint fixed-effect updates,
> per-group conditional independence, Newton–MH, translation moves — still
> describes what the code does; read the GPU-specific sections as a record of a
> prototype that is no longer in the tree.

## Goal

Offer a faster sampler for larger datasets and models with many groups, as an
**option** next to the standard component-wise Gibbs sampler. The idea is to
exploit conditional independence *within* a Gibbs sweep: given the fixed
effects and hyperparameters, every group's random effect is independent of
every other group's, so all groups can be updated at once (one GPU thread per
group). Sweeps themselves stay sequential.

**Approach chosen:** compile models in the GLMM class into dense arrays once,
then run a blocked sweep on either a WebGPU backend or a typed-array CPU
backend that implements the identical algorithm. Anything outside the class
falls back to the standard sampler, with the reason shown in the status bar.

---

## Why WebGPU (not JAX / CUDA)

FANGS has no backend: everything runs in the browser. WebGPU compute shaders
(WGSL) are the only route to the GPU from a web page, and they work inside the
Web Workers that already run each chain. JAX/NumPyro would need a Python
server, which FANGS is designed to avoid.

---

## Which models (the "blocked class")

```
y[i] ~ F(g⁻¹(eta[i]))          F ∈ {dnorm, dpois, dbern, dbin}, canonical link
eta[i] = offset[i] + Σ_k X[i,k] θ_k + Σ_f a_f[i] · b_f[g_f[i]]
```

- `θ` — fixed coefficients with `dnorm` priors, updated **jointly** (≤ 32)
- `b_f` — "families" such as `b[j]` (random intercepts) or `c[j]` (random
  slopes, `a_f[i] = x[i]`); each observation touches at most one member
- everything else (σ, σ_b, hyper-means, …) — hyperparameters

The structure is found **numerically**, not by pattern-matching model text
(`compile-model.js`): each parameter is perturbed, the change in eta becomes a
design column, and joint random perturbations confirm eta is linear in all of
them together. This rejects, e.g., `mu <- alpha * exp(beta * x)`, products such
as a non-centred `b[j] <- sigma.b * z[j]`, or a coefficient that also appears in
another parameter's prior.

All five built-in example models are in the class.

---

## One sweep

| Step | Where | How |
|------|-------|-----|
| Fixed block θ | GPU: per-observation kernel → 2-stage reduction of `Σ ℓ' x`, `Σ w x xᵀ` → single-thread Cholesky | Newton–MH (below) |
| Each family b_f | GPU: one thread per group, walking its observations (CSR layout) | Newton–MH, scalar |
| Translation move | CPU | exact Gaussian draw (below) |
| Hyperparameters | CPU, float64 | slice sampling on sufficient statistics: `Σ(y−η)²` for the residual SD, `Σb`, `Σb²` for a random-effect SD |

The CPU needs `θ`, `b` and `Σ(y−η)²` each sweep (for the hyperparameters and to
record draws), so each sweep is one command submission plus one small readback.

### Newton–MH update (`cpu-backend.js`)

At the current value the gradient G and negative Hessian A (likelihood + prior)
give a local Gaussian N(μ, A⁻¹), μ = θ + A⁻¹G. The proposal is the
autoregressive move

```
θ* = θ + ε(μ − θ) + √(ε(2−ε)) L⁻ᵀ z,   A = L Lᵀ
```

which leaves N(μ, A⁻¹) invariant for any ε ∈ (0, 1].

- **Normal response:** the approximation *is* the full conditional; with ε = 1
  the update is an exact conjugate Gibbs draw (no accept step).
- **Poisson / binomial:** exact MH accept/reject, so the chain targets the true
  posterior. ε is tuned during burn-in (target 65% acceptance, capped at 0.8:
  at ε = 1 the chain sticks in the tails because the reverse proposal becomes
  improbable). The first `min(50, burnin/4)` burn-in sweeps take greedy damped
  Newton steps (kept only if the log posterior increases) because overdispersed
  starts like `alpha = beta = 5` put Poisson chains where `exp(eta)` is huge and
  small MH steps crawl.

Each update does a fixed amount of work (two passes over the data), so GPU
threads stay in lock-step. Slice or rejection samplers would make each thread's
loop length random, and the threads would diverge.

**Why not Pólya–Gamma augmentation for the logit models?** It gives exact Gibbs
draws, but needs a PG(n, z) sampler on the GPU (an alternating-series rejection
sampler whose loop length varies, plus a loop over n for binomial sizes) and
does nothing for Poisson. Newton–MH covers both with one code path; PG is a
possible later addition for logistic models.

### Translation move (`BlockedChainState.translate`)

The data only identify `alpha + b[j]`. With few groups and a vague SD prior,
blockwise and component-wise updates both crawl along that ridge. In testing, a
chain sat at `alpha = 11, b ≈ −10` for thousands of iterations: the standard
sampler's long run had R̂ ≈ 1.35, and the blocked sampler did the same before
this move. The compiler detects (fixed column, family) pairs whose shift
θ_k + c, b_j − c leaves eta unchanged, such as intercept ↔ random intercepts and
slope ↔ random slopes. The shift generalises to θ_k + c, b_j − c·w_j whenever
the fixed column is a per-group multiple w_j of the family's coefficients, which
covers a group-level covariate beside random intercepts (e.g. a site-level
`logged` factor with `b[site[i]]`: w_j is site j's value). For such a pair the
conditional of c is Gaussian in closed form (Liu & Sabatti 2000 generalised
Gibbs), so one exact draw per sweep removes the ridge problem. On
`course/data/random-effects-full.csv` (Poisson, 49 sites, site-level `logged`)
the weighted move raised the ESS of the `logged` coefficient from ~25 to ~2000
per 6000 draws.

---

## GPU details (`gpu-backend.js`, `gpu-shaders.js`)

- **RNG:** Philox4x32-10, counter = (sweep, stream, thread, k), key = per-chain
  seed. Stateless and independent across threads.
- **float32:** per-observation log-likelihood *differences* are summed (never
  two large totals subtracted), eta is recomputed from scratch every sweep, and
  hyperparameters stay in float64 on the CPU.
- **Limits:** ≤ 8 storage buffers per kernel (y and binomial sizes share one
  buffer, CSR offsets and observation ids share one); 2-D dispatch beyond
  65,535 workgroups; adapter's maximum buffer size requested.
- **Fallbacks:** no `navigator.gpu`, no adapter, or a shader/validation error →
  blocked CPU backend, reported in the status bar.

---

## When the GPU helps

Each GPU sweep has a fixed cost: around 20 kernel launches plus a readback,
roughly 0.1–1 ms on real hardware. The CPU blocked backend is 30–250× faster
than the standard sampler on the 50-row example models. On a simulated mixed
model with N = 2,000 and J = 100 groups (`tests/bench/fangs-cli.mjs --engine`),
it takes ~0.25 ms per sweep against ~2 s for the standard sampler, whose cost
grows like (#parameters × N). For teaching-sized data the CPU backend is the
better choice, and the GPU only pays off once the per-sweep work is
large (≳10⁴–10⁵ observations, or thousands of groups). This has not been
benchmarked on physical GPUs yet: CI uses SwiftShader (a software Vulkan
implementation), which checks correctness only. `tests/gpu-harness.html?bench=1`
times both backends on a simulated Poisson GLMM for anyone with a real GPU.

The GPU does not improve **mixing**, only time per sweep. The joint fixed-block
update and the translation move are what improve mixing.

---

## Verification

- `tests/blocked-sampler.test.js`: compiler classification and rejections;
  the Gaussian block update matches the analytic conditional; Newton–MH matches
  1-D quadrature; posteriors vs the NIMBLE fixtures (linear, mixed) and vs 2-D
  numerical integration (Poisson, logistic GLMs).
- `tests/gpu-e2e.mjs`: runs every built-in model plus Poisson/logistic GLMMs on
  the WebGPU backend in headless Chromium (SwiftShader) and compares with the
  CPU backend.

---

## Possible next steps

1. Run all chains in one GPU dispatch (chains as an extra parallel dimension)
   instead of one device per chain worker.
2. Move the hyperparameter slice updates onto the GPU (WGSL code generation for
   the prior expressions) to remove the per-sweep readback.
3. Let users choose which parameters to monitor. With thousands of groups,
   recording and plotting every `b[j]` costs more than sampling them.
4. Pólya–Gamma augmentation for logistic models; chromatic (graph-colouring)
   updates for spatial CAR/MRF models.
