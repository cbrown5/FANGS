# Gibbs Sampling

The **Gibbs sampler** is a specific MCMC algorithm that updates one parameter at a time while holding all others fixed.

## The key idea

Instead of moving all parameters simultaneously (which is hard), Gibbs sampling cycles through each parameter and draws a new value from its **full conditional distribution** — the distribution of that parameter given the current values of every other parameter and the data.

## One iteration

For a model with parameters α, β, and τ, one Gibbs iteration looks like:

1. Draw new α from `p(α | β, τ, data)`
2. Draw new β from `p(β | α, τ, data)`
3. Draw new τ from `p(τ | α, β, data)`

Then repeat.

## Conjugate updates

When the prior and likelihood belong to the same distributional family (a *conjugate pair*), the full conditional has a known closed form and can be sampled exactly. This is fast and exact.

**Examples used in FANGS:**
- Normal likelihood + normal prior → normal full conditional (updates α, β)
- Gamma prior on precision τ + normal likelihood → gamma full conditional

## Slice sampling fallback

When conjugacy does not apply (e.g., logistic regression), FANGS falls back to **slice sampling** — a derivative-free method that still samples from the correct distribution, just less efficiently.

## Why it works

Each update leaves the joint posterior distribution invariant. After many cycles, the chain converges to samples from the true joint posterior.
