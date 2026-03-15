# Posterior Predictive Check (PPC)

A **posterior predictive check** tests whether your model can reproduce the key features of the observed data.

## The idea

After fitting the model, use the posterior samples to simulate new datasets under the model. If the model is a good fit, the simulated data should look similar to the real data.

Formally:

```
p(y_rep | y) = ∫ p(y_rep | θ) p(θ | y) dθ
```

For each posterior draw of θ, simulate a new dataset y_rep from the likelihood. The distribution of y_rep is the **posterior predictive distribution**.

## What the plot shows

The histogram of the **observed** y values is overlaid with the distribution of **simulated** y_rep values from the posterior predictive distribution.

- **Good fit**: simulated data closely matches the observed distribution
- **Poor fit**: systematic differences reveal model misspecification

## What to look for

**Mean**: does the model predict the right average response?

**Spread**: is the model's predicted variance similar to the observed variance?

**Shape**: is the overall distributional shape consistent? (e.g., skewness, multimodality)

**Outliers**: are there observed values far outside the predictive distribution?

## Common problems PPC can reveal

- Wrong distributional family (e.g., assuming normality when data are skewed)
- Overdispersion or underdispersion
- Missing predictors (systematic residual patterns)
- Zero-inflation

## Important limitation

PPCs use the same data for fitting and checking. A model can "overfit" the check by design. PPCs are most useful for detecting obvious failures, not subtle ones.
