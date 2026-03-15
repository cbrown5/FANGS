# Effective Sample Size (ESS)

**Effective sample size (ESS)** measures how many *independent* samples your MCMC chain is worth, accounting for autocorrelation.

## Why not just use the raw sample count?

MCMC samples are correlated — consecutive draws are similar. A chain of 2000 correlated samples contains less information than 2000 truly independent samples from the posterior.

ESS adjusts for this correlation:

```
ESS = N / (1 + 2 × sum of autocorrelations)
```

where *N* is the raw number of post-burn-in samples.

## Interpreting ESS

| ESS | Interpretation |
|-----|---------------|
| ≥ 400 | Good — reliable quantile estimates |
| 100–400 | Adequate for means, poor for tails |
| < 100 | Too low — increase samples or reduce thinning |

A rule of thumb: you need **ESS ≥ 400** per parameter for reliable 95% credible intervals.

## ESS < raw sample count

ESS will always be ≤ N. The ratio ESS / N is the *mixing efficiency*. A ratio close to 1 means the chain mixes well (low autocorrelation). A ratio close to 0 means the chain moves very slowly.

## Colour coding in the summary table

- **Orange** background → ESS < 100 (low effective sample size warning)
- No highlight → ESS ≥ 100 (acceptable)

## How to increase ESS

- **Run more iterations** — the most direct solution
- **Reparameterise** — e.g., centring or standardising predictors often improves mixing
- **Do not thin** — thinning reduces raw N without helping ESS per iteration
