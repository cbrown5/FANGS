# Data Formatting

FANGS accepts **CSV files** with a header row. The first row must contain column names; each subsequent row is one observation.

## Required structure

```
y,x,group
2.1,0.5,1
3.4,1.2,1
1.8,-0.3,2
...
```

- Column names must match the variable names used in your model code.
- Every row must have the same number of fields.
- Missing values are not supported — remove incomplete rows before uploading.

## Numeric columns

Any column whose values are all numbers is treated as a continuous variable and passed directly to the sampler. Use these as-is in your model (e.g. `y[i]`, `x[i]`).

## Categorical columns

If a column contains **any non-numeric values** (e.g. `"A"`, `"control"`, `"site1"`), the app automatically converts it to **1-based integer codes** in the order the levels first appear.

For example, a `treatment` column with values `A, B, A, C` becomes `1, 2, 1, 3`.

**You do not need to create a dummy/design matrix yourself.** Reference the integer-coded column directly in your BUGS model:

```
for (i in 1:N) {
  y[i] ~ dnorm(mu[i], tau)
  mu[i] <- alpha[treatment[i]] + beta * x[i]
}
for (k in 1:K) {
  alpha[k] ~ dnorm(0, 0.001)
}
```

Here `K` is the number of treatment levels (set in the Constants panel).

## Grouping variables for random effects

A column named `group` (integer or auto-encoded) is used for random intercepts:

```
mu[i] <- alpha + beta * x[i] + b[group[i]]
```

The app infers `J` (the number of groups) automatically from the unique values in the `group` column, so you do not need to set it manually.

## Constants panel

After loading data, the app scans your model for uppercase scalars like `N`, `J`, `K` used in `1:N`-style loop bounds:

- **N** is always set automatically to the number of rows.
- **J** is inferred from the `group` column if present.
- Other scalars (e.g. `K` for number of treatment levels) appear as editable inputs — fill these in before running.

## Checking your data

Switch to the **Data** tab after uploading to confirm the table looks correct. The app shows original string values for categorical columns so you can verify the mapping.
