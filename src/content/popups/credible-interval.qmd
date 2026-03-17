# Credible Intervals

A **credible interval** is the Bayesian analogue of a confidence interval. It is a range of parameter values that contains a specified posterior probability.

## What the 95% interval means

A **95% credible interval** (also called a *posterior interval* or *Bayesian interval*) means:

> Given the data and model, there is a 95% probability that the true parameter value lies within this range.

This is the direct, intuitive interpretation. Unlike frequentist confidence intervals, you *can* make probability statements about the parameter directly.

## How it is computed

FANGS reports the **equal-tailed** interval, defined by the 2.5th and 97.5th percentiles of the posterior samples:

- **2.5%** — lower bound (shown in the "2.5%" column)
- **97.5%** — upper bound (shown in the "97.5%" column)

The **median** (50th percentile) is also shown as a robust central estimate.

## Interpreting width

- **Narrow interval** → high certainty about the parameter
- **Wide interval** → high uncertainty; more data would help
- **Interval spanning zero** → data are consistent with no effect

## Comparison to frequentist confidence intervals

A frequentist 95% confidence interval means: if you repeated the experiment many times and computed an interval each time, 95% of those intervals would contain the true value. It does *not* mean there is a 95% probability the true value lies in *this particular* interval.

The credible interval gives you the probabilistic statement directly, which is usually what people actually want.
