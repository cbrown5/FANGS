# Multiple Chains

Running several **independent chains** in parallel is standard MCMC practice and serves two purposes: diagnosing convergence and improving coverage.

## What is a chain?

A single chain is one run of the MCMC algorithm, starting from a random initial point and producing a sequence of parameter values over thousands of iterations.

## Why run multiple chains?

**1. Convergence diagnosis**

If all chains start in different parts of parameter space but eventually mix together and look similar, that is strong evidence the sampler has found the posterior. The R-hat statistic formalises this comparison.

If chains look very different from each other, the sampler may be stuck in a local region — a sign that you need more iterations or a better model.

**2. Better exploration**

Different starting points can explore different parts of the posterior. Multiple chains together give a more complete picture than a single long chain.

## Recommended settings

- **3 chains** is the standard minimum for computing R-hat
- More chains give more reliable diagnostics but take proportionally longer
- Each chain is initialised from an overdispersed draw from the prior

## What to look for

In the trace plots, chains are shown in different colours. Well-behaved chains should:
- Overlap and intermix with each other
- Show no long-term trends
- Have similar mean and variance
