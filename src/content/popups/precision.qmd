# Precision (τ) vs. Variance (σ²)

BUGS/JAGS models parameterise the normal distribution using **precision** (τ, tau) rather than variance (σ²) or standard deviation (σ).

## The relationship

```
precision τ = 1 / variance σ²
           σ = 1 / sqrt(τ)
```

A **high precision** means observations are tightly clustered around the mean (low variance). A **low precision** means observations are spread out (high variance).

## Why precision?

The precision parameterisation leads to conjugate updates with normal likelihoods, making Gibbs sampling tractable. It was the convention adopted by BUGS when it was developed in the 1990s, and JAGS/NIMBLE follow the same convention.

## Common confusion

If you write `dnorm(mu, tau)` in BUGS syntax, the second argument is **precision**, not standard deviation or variance. This is different from most other software:

| Software | `dnorm(mean, ?)` |
|----------|-----------------|
| BUGS / JAGS / NIMBLE | precision τ = 1/σ² |
| R `dnorm()` | standard deviation σ |
| Stan | standard deviation σ |

## Interpreting τ in the summary table

The posterior for `tau` is on the precision scale. To convert to a more interpretable scale:

- **Posterior SD**: σ = 1/sqrt(τ)
- **Posterior variance**: σ² = 1/τ

For example, if the posterior mean of τ is 4, then σ ≈ 0.5, meaning the model's residual standard deviation is about 0.5.

## Typical priors on τ

`tau ~ dgamma(0.001, 0.001)` is a common vague prior that is nearly flat on the log scale, allowing τ to range from very small to very large values.
