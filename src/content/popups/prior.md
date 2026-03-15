# Prior Distribution

A **prior distribution** encodes your belief about a parameter *before* observing any data. It is one of the two ingredients in Bayes' theorem.

## What does a prior represent?

The prior answers: "What values of this parameter are plausible, before I look at the data?"

It can represent:
- **Previous studies** — use results from earlier experiments
- **Domain knowledge** — a regression coefficient for body weight cannot plausibly be 10,000
- **Vague uncertainty** — if you have little prior knowledge, use a weakly informative prior

## Types of priors

**Weakly informative (diffuse) priors**
Allow a wide range of values, letting the data dominate. Example: `dnorm(0, 0.001)` in BUGS notation places most prior mass across a very wide range.

**Informative priors**
Encode specific knowledge. Useful when data are limited and you have reliable external information.

**Improper priors**
Priors that do not integrate to 1 (e.g., uniform on all real numbers). Can be used mathematically but require care — they can sometimes lead to improper posteriors.

## Common priors in this app

| Parameter | Prior | Interpretation |
|-----------|-------|----------------|
| `alpha`, `beta` | `dnorm(0, 0.001)` | Very diffuse — almost any value is plausible |
| `tau` | `dgamma(0.001, 0.001)` | Diffuse over positive values; allows very small or large precision |

## Prior sensitivity

It is good practice to check that your conclusions do not depend strongly on the prior. The **Prior Check** tab lets you sample from the prior alone to see what values it implies for observable quantities.
