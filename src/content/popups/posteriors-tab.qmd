# Posterior Density Plots

The **Posteriors** tab shows a smoothed density plot for each model parameter, estimated from the MCMC samples.

## What you are looking at

Each plot shows the **marginal posterior distribution** of one parameter — the distribution of that parameter after averaging over uncertainty in all other parameters.

- **x-axis** — parameter value
- **y-axis** — posterior probability density
- **Vertical dashed line** — posterior mean
- **Shaded region** — 95% credible interval (2.5th to 97.5th percentile)

## Reading the shape

**Symmetric, bell-shaped** — typical for well-identified parameters with sufficient data; the posterior mean and median are similar.

**Skewed** — common for variance parameters (τ) or proportions; the mean and median may differ noticeably.

**Multimodal (multiple peaks)** — indicates identifiability problems; different parameter combinations fit the data equally well. This usually signals a model problem.

**Very wide** — the data contain little information about this parameter; the prior dominates.

**Very narrow** — the data strongly constrain this parameter.

## Multiple chains

If you ran multiple chains, samples from all chains are combined into a single density estimate. Well-converged chains will produce a smooth, consistent density. Poor convergence (R-hat > 1.1) can produce ragged or multimodal densities.

## Comparing prior and posterior

To see how much the data have updated your prior beliefs, compare these plots with the densities in the **Prior Check** tab. Parameters where the posterior is much narrower than the prior are strongly informed by the data.
