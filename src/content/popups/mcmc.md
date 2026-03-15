# What is MCMC?

**Markov chain Monte Carlo (MCMC)** is an algorithm for drawing samples from a probability distribution that would otherwise be difficult to compute directly.

## Why do we need it?

In Bayesian statistics, the posterior distribution combines your prior beliefs with the data:

```
posterior ∝ likelihood × prior
```

For most realistic models this cannot be solved analytically — the integral to normalise it is intractable. MCMC sidesteps this by **sampling** from the posterior instead of computing it directly.

## How it works

1. Start at some initial parameter values
2. Propose a move to a nearby point in parameter space
3. Accept or reject the move based on the ratio of posterior densities
4. Repeat thousands of times

The resulting chain of accepted values is a **correlated sample** from the posterior. After enough iterations, the chain "forgets" where it started and the samples represent the true posterior distribution.

## What you get

Rather than a formula, you get a large set of numbers — one per iteration. You can summarise the posterior by computing:

- The **mean** of those numbers → posterior mean
- **Quantiles** → credible intervals
- **Histograms** → density plots

## See also

- *Trace plots* show the raw chain values over iterations
- *R-hat* tells you whether the chain has converged
- *ESS* measures how many independent samples you effectively have
