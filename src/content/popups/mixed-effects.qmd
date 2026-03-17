# Mixed-Effects Models

A **mixed-effects model** (also called a *multilevel* or *hierarchical* model) includes both **fixed effects** (population-level parameters) and **random effects** (group-level deviations).

## When to use them

Use a mixed-effects model when your data have a **grouped or nested structure**:

- Students nested within schools
- Repeated measurements within subjects
- Plants within plots within sites

Ignoring this structure underestimates uncertainty and can give misleading inference.

## The structure

```
y[i] ~ dnorm(mu[i], tau)
mu[i] <- alpha + beta * x[i] + b[group[i]]
b[j]  ~ dnorm(0, tau.b)
```

- **alpha** — overall intercept (fixed effect)
- **beta** — slope for x (fixed effect)
- **b[j]** — random intercept for group j (random effect)
- **tau.b** — precision of the random effects (hyperparameter)

## Fixed vs. random effects

**Fixed effects** (alpha, beta) apply to the whole population. They are estimated directly from data.

**Random effects** (b[j]) are group-specific deviations. They are assumed to come from a distribution with mean 0 and some variance — this is the *random effects assumption*. The variance is estimated from the data.

## Partial pooling

Mixed-effects models achieve **partial pooling**: group estimates are shrunk towards the overall mean. Groups with little data are pulled more towards the average; groups with lots of data are pulled less. This reduces overfitting compared to fitting each group separately.

## The hyperparameter tau.b

`tau.b` controls how much groups are allowed to differ from each other. A posterior value of tau.b near infinity means very little group variation; near zero means groups are very different.

## Benefits

- Accounts for non-independence in grouped data
- Borrows strength across groups (partial pooling)
- Provides inference on group-level variation
- More reliable predictions for new groups
