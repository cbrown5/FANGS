# Prior Predictive Check

A **prior predictive check** runs the model forward from the priors alone — before seeing any data — to inspect what values of the observable response your priors imply.

## Why do this?

Priors on parameters can seem reasonable in isolation but imply unrealistic data patterns when propagated through the model. For example:

- Weakly informative priors on regression coefficients may imply predicted responses in the millions
- A diffuse prior on precision τ may allow implausibly small or large variances

The prior predictive check makes the implied data scale visible, so you can adjust priors if needed.

## How it works

1. Draw a set of parameter values from the prior distributions (ignoring data)
2. For each draw, simulate a dataset from the likelihood
3. Display the distribution of those simulated response values

## What to look for

**Are the simulated values on a plausible scale?**
- If you are modelling plant heights in cm, prior predictions of −10,000 cm or +50,000 cm suggest overly diffuse priors

**Does the prior distribution cover the observed data range?**
- The observed data should not be in the extreme tails of the prior predictive distribution

**Is there strong prior information already?**
- Very narrow prior predictive distributions may over-constrain the model before seeing data

## Adjusting priors

If the prior predictive check reveals problems, tighten or shift the prior distributions. A common approach is to use **weakly informative priors** — not perfectly flat, but centred on zero with a scale that allows scientifically plausible values.

## Note

This tab runs sampling from the priors only, with no data likelihood. The posterior tabs will show results from the full Bayesian update using your data.
