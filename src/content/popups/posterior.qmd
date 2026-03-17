# Posterior Distribution

The **posterior distribution** is the central object in Bayesian statistics. It represents your updated belief about a parameter after combining your prior knowledge with the observed data.

## Bayes' theorem

```
p(θ | data) ∝ p(data | θ) × p(θ)
   posterior    likelihood   prior
```

- **Prior** p(θ) — what you believed before seeing the data
- **Likelihood** p(data | θ) — how probable the data are for each value of θ
- **Posterior** p(θ | data) — your updated belief after seeing the data

## What the posterior tells you

The posterior is a full probability distribution over the parameter, not just a single estimate. From it you can extract:

- **Posterior mean** — the average parameter value, weighted by posterior probability
- **Posterior median** — the middle value of the distribution
- **Credible intervals** — a range containing a specified probability (e.g., 95%)
- **Probability statements** — e.g., "the probability that β > 0 is 0.97"

## Posterior vs. frequentist confidence intervals

A **95% credible interval** directly means: given the data, there is a 95% probability that the true parameter lies in this interval.

This is the intuitive interpretation that frequentist confidence intervals cannot make — frequentist intervals refer to long-run coverage over hypothetical repeated experiments.

## Visualising the posterior

The density plots in FANGS show the posterior for each parameter as a smooth curve. The x-axis is the parameter value; the y-axis is the posterior density. Taller, narrower curves mean more certainty; flatter, wider curves mean more uncertainty.
