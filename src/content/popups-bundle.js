/**
 * popups-bundle.js
 * Auto-generated inline bundle of popup Markdown content.
 *
 * To regenerate after editing .md files, run:
 *   node src/content/build-popups-bundle.js
 *
 * This file is used by popups.js so the app works when opened directly via
 * file:// without a local server (no fetch() required).
 */

export const POPUP_CONTENT = {

'burn-in': `# Burn-in

**Burn-in** (also called *warm-up*) refers to the early iterations of an MCMC chain that are discarded before analysis.

## Why discard early samples?

MCMC chains start at an arbitrary initial value — typically an overdispersed draw from the prior. It takes some number of iterations for the chain to "forget" where it started and settle into sampling the posterior properly.

The early samples are influenced by the starting point rather than the posterior, so they are biased and should not be included in your posterior summaries.

## Visualising burn-in

In the trace plot, you will often see an initial period where the chain drifts or jumps before stabilising. The burn-in period covers these early iterations.

## How many to discard?

- A common default is **25–50% of total samples** (e.g., 500 out of 2000)
- For well-specified models with good initialisations, burn-in can be short
- For complex or poorly-conditioned models, you may need much more

## Checking whether burn-in was enough

- Trace plots should show no visible trend after burn-in
- R-hat values close to 1.0 suggest the post-burn-in samples are reliable
- If R-hat > 1.1, consider increasing both burn-in and total samples

## Terminology note

Some software (e.g. Stan) uses the term *warm-up* rather than *burn-in*. They mean the same thing.`,

'chains': `# Multiple Chains

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
- Have similar mean and variance`,

'credible-interval': `# Credible Intervals

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

The credible interval gives you the probabilistic statement directly, which is usually what people actually want.`,

'ess': `# Effective Sample Size (ESS)

**Effective sample size (ESS)** measures how many *independent* samples your MCMC chain is worth, accounting for autocorrelation.

## Why not just use the raw sample count?

MCMC samples are correlated — consecutive draws are similar. A chain of 2000 correlated samples contains less information than 2000 truly independent samples from the posterior.

ESS adjusts for this correlation:

\`\`\`
ESS = N / (1 + 2 × sum of autocorrelations)
\`\`\`

where *N* is the raw number of post-burn-in samples.

## Interpreting ESS

| ESS | Interpretation |
|-----|---------------|
| ≥ 400 | Good — reliable quantile estimates |
| 100–400 | Adequate for means, poor for tails |
| < 100 | Too low — increase samples or reduce thinning |

A rule of thumb: you need **ESS ≥ 400** per parameter for reliable 95% credible intervals.

## ESS < raw sample count

ESS will always be ≤ N. The ratio ESS / N is the *mixing efficiency*. A ratio close to 1 means the chain mixes well (low autocorrelation). A ratio close to 0 means the chain moves very slowly.

## Colour coding in the summary table

- **Orange** background → ESS < 100 (low effective sample size warning)
- No highlight → ESS ≥ 100 (acceptable)

## How to increase ESS

- **Run more iterations** — the most direct solution
- **Reparameterise** — e.g., centring or standardising predictors often improves mixing
- **Do not thin** — thinning reduces raw N without helping ESS per iteration`,

'gibbs-sampler': `# Gibbs Sampling

The **Gibbs sampler** is a specific MCMC algorithm that updates one parameter at a time while holding all others fixed.

## The key idea

Instead of moving all parameters simultaneously (which is hard), Gibbs sampling cycles through each parameter and draws a new value from its **full conditional distribution** — the distribution of that parameter given the current values of every other parameter and the data.

## One iteration

For a model with parameters α, β, and τ, one Gibbs iteration looks like:

1. Draw new α from \`p(α | β, τ, data)\`
2. Draw new β from \`p(β | α, τ, data)\`
3. Draw new τ from \`p(τ | α, β, data)\`

Then repeat.

## Conjugate updates

When the prior and likelihood belong to the same distributional family (a *conjugate pair*), the full conditional has a known closed form and can be sampled exactly. This is fast and exact.

**Examples used in FANGS:**
- Normal likelihood + normal prior → normal full conditional (updates α, β)
- Gamma prior on precision τ + normal likelihood → gamma full conditional

## Slice sampling fallback

When conjugacy does not apply (e.g., logistic regression), FANGS falls back to **slice sampling** — a derivative-free method that still samples from the correct distribution, just less efficiently.

## Why it works

Each update leaves the joint posterior distribution invariant. After many cycles, the chain converges to samples from the true joint posterior.`,

'mcmc': `# What is MCMC?

**Markov chain Monte Carlo (MCMC)** is an algorithm for drawing samples from a probability distribution that would otherwise be difficult to compute directly.

## Why do we need it?

In Bayesian statistics, the posterior distribution combines your prior beliefs with the data:

\`\`\`
posterior ∝ likelihood × prior
\`\`\`

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
- *ESS* measures how many independent samples you effectively have`,

'mixed-effects': `# Mixed-Effects Models

A **mixed-effects model** (also called a *multilevel* or *hierarchical* model) includes both **fixed effects** (population-level parameters) and **random effects** (group-level deviations).

## When to use them

Use a mixed-effects model when your data have a **grouped or nested structure**:

- Students nested within schools
- Repeated measurements within subjects
- Plants within plots within sites

Ignoring this structure underestimates uncertainty and can give misleading inference.

## The structure

\`\`\`
y[i] ~ dnorm(mu[i], tau)
mu[i] <- alpha + beta * x[i] + b[group[i]]
b[j]  ~ dnorm(0, tau.b)
\`\`\`

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

\`tau.b\` controls how much groups are allowed to differ from each other. A posterior value of tau.b near infinity means very little group variation; near zero means groups are very different.

## Benefits

- Accounts for non-independence in grouped data
- Borrows strength across groups (partial pooling)
- Provides inference on group-level variation
- More reliable predictions for new groups`,

'posterior': `# Posterior Distribution

The **posterior distribution** is the central object in Bayesian statistics. It represents your updated belief about a parameter after combining your prior knowledge with the observed data.

## Bayes' theorem

\`\`\`
p(θ | data) ∝ p(data | θ) × p(θ)
   posterior    likelihood   prior
\`\`\`

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

The density plots in FANGS show the posterior for each parameter as a smooth curve. The x-axis is the parameter value; the y-axis is the posterior density. Taller, narrower curves mean more certainty; flatter, wider curves mean more uncertainty.`,

'posteriors-tab': `# Posterior Density Plots

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

To see how much the data have updated your prior beliefs, compare these plots with the densities in the **Prior Check** tab. Parameters where the posterior is much narrower than the prior are strongly informed by the data.`,

'ppc': `# Posterior Predictive Check (PPC)

A **posterior predictive check** tests whether your model can reproduce the key features of the observed data.

## The idea

After fitting the model, use the posterior samples to simulate new datasets under the model. If the model is a good fit, the simulated data should look similar to the real data.

Formally:

\`\`\`
p(y_rep | y) = ∫ p(y_rep | θ) p(θ | y) dθ
\`\`\`

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

PPCs use the same data for fitting and checking. A model can "overfit" the check by design. PPCs are most useful for detecting obvious failures, not subtle ones.`,

'precision': `# Precision (τ) vs. Variance (σ²)

BUGS/JAGS models parameterise the normal distribution using **precision** (τ, tau) rather than variance (σ²) or standard deviation (σ).

## The relationship

\`\`\`
precision τ = 1 / variance σ²
           σ = 1 / sqrt(τ)
\`\`\`

A **high precision** means observations are tightly clustered around the mean (low variance). A **low precision** means observations are spread out (high variance).

## Why precision?

The precision parameterisation leads to conjugate updates with normal likelihoods, making Gibbs sampling tractable. It was the convention adopted by BUGS when it was developed in the 1990s, and JAGS/NIMBLE follow the same convention.

## Common confusion

If you write \`dnorm(mu, tau)\` in BUGS syntax, the second argument is **precision**, not standard deviation or variance. This is different from most other software:

| Software | \`dnorm(mean, ?)\` |
|----------|-----------------|
| BUGS / JAGS / NIMBLE | precision τ = 1/σ² |
| R \`dnorm()\` | standard deviation σ |
| Stan | standard deviation σ |

## Interpreting τ in the summary table

The posterior for \`tau\` is on the precision scale. To convert to a more interpretable scale:

- **Posterior SD**: σ = 1/sqrt(τ)
- **Posterior variance**: σ² = 1/τ

For example, if the posterior mean of τ is 4, then σ ≈ 0.5, meaning the model's residual standard deviation is about 0.5.

## Typical priors on τ

\`tau ~ dgamma(0.001, 0.001)\` is a common vague prior that is nearly flat on the log scale, allowing τ to range from very small to very large values.`,

'prior-check': `# Prior Predictive Check

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

This tab runs sampling from the priors only, with no data likelihood. The posterior tabs will show results from the full Bayesian update using your data.`,

'prior': `# Prior Distribution

A **prior distribution** encodes your belief about a parameter *before* observing any data. It is one of the two ingredients in Bayes' theorem.

## What does a prior represent?

The prior answers: "What values of this parameter are plausible, before I look at the data?"

It can represent:
- **Previous studies** — use results from earlier experiments
- **Domain knowledge** — a regression coefficient for body weight cannot plausibly be 10,000
- **Vague uncertainty** — if you have little prior knowledge, use a weakly informative prior

## Types of priors

**Weakly informative (diffuse) priors**
Allow a wide range of values, letting the data dominate. Example: \`dnorm(0, 0.001)\` in BUGS notation places most prior mass across a very wide range.

**Informative priors**
Encode specific knowledge. Useful when data are limited and you have reliable external information.

**Improper priors**
Priors that do not integrate to 1 (e.g., uniform on all real numbers). Can be used mathematically but require care — they can sometimes lead to improper posteriors.

## Common priors in this app

| Parameter | Prior | Interpretation |
|-----------|-------|----------------|
| \`alpha\`, \`beta\` | \`dnorm(0, 0.001)\` | Very diffuse — almost any value is plausible |
| \`tau\` | \`dgamma(0.001, 0.001)\` | Diffuse over positive values; allows very small or large precision |

## Prior sensitivity

It is good practice to check that your conclusions do not depend strongly on the prior. The **Prior Check** tab lets you sample from the prior alone to see what values it implies for observable quantities.`,

'rhat': `# R-hat (Potential Scale Reduction Factor)

**R-hat** (written R-hat, pronounced "R-hat") is the standard MCMC convergence diagnostic. It compares variation *between* chains to variation *within* chains.

## The idea

If all chains have converged to the same distribution, within-chain variation and between-chain variation should be similar. R-hat measures their ratio.

- **R-hat ≈ 1.00** → chains agree; convergence is likely
- **R-hat > 1.1** → chains disagree; do not trust the results yet
- **R-hat > 1.5** → serious convergence failure

## How it is calculated

R-hat is approximately the square root of the ratio:

\`\`\`
R-hat ≈ sqrt( (between-chain variance + within-chain variance) / within-chain variance )
\`\`\`

When chains have fully mixed, this ratio approaches 1.

## What to do if R-hat > 1.1

1. **Run more iterations** — chains may just need more time to mix
2. **Increase burn-in** — discard more early samples
3. **Check trace plots** — look for chains stuck in different regions
4. **Reparameterise** — some models mix better with different parameterisations
5. **Check the model** — identifiability issues cause non-convergence

## Colour coding in the summary table

- **Red** background → R-hat > 1.1 (convergence warning)
- No highlight → R-hat ≤ 1.1 (acceptable)

## Limitations

R-hat requires at least 2 chains. With a single chain it cannot be computed. It also cannot detect multimodality if all chains are stuck in the same mode.`,

'summary-tab': `# Posterior Summary Table

The **Summary** tab presents key statistics computed from the MCMC samples for each parameter.

## Columns

| Column | Meaning |
|--------|---------|
| **Mean** | Posterior mean — the average of all post-burn-in samples |
| **SD** | Posterior standard deviation — spread of the posterior |
| **2.5%** | Lower bound of the 95% credible interval |
| **Median** | Posterior median (50th percentile) — robust central estimate |
| **97.5%** | Upper bound of the 95% credible interval |
| **R-hat** | Convergence diagnostic (should be ≤ 1.1) |
| **ESS** | Effective sample size (should be ≥ 400) |

## Using the summary for inference

**Is an effect present?**
Check whether the 95% credible interval includes zero. If the interval is entirely positive or entirely negative, the effect is credibly non-zero.

**How large is the effect?**
The posterior mean (or median) gives a point estimate. The credible interval gives the range of plausible values.

**Is the model reliable?**
Check R-hat (≤ 1.1) and ESS (≥ 400). Red or orange highlights indicate potential problems.

## Colour coding

- **Red cell** in R-hat column → R-hat > 1.1 (convergence warning — do not interpret results yet)
- **Orange cell** in ESS column → ESS < 100 (too few effective samples for reliable tail estimates)

## Point estimates

For symmetric posteriors, the mean and median are similar. For skewed posteriors (e.g., τ, variance components), the **median** is often a more representative point estimate than the mean.`,

'thinning': `# Thinning

**Thinning** means keeping only every *k*-th sample from the MCMC chain and discarding the rest.

## Why thin?

MCMC samples are **correlated** — consecutive samples are similar because each is derived from the previous. Thinning reduces this autocorrelation so that the kept samples are closer to being independent.

## Example

With thinning = 10 and 2000 samples, only every 10th iteration is kept, giving 200 stored samples from 2000 iterations.

## Is thinning necessary?

**Usually not.** Modern consensus is that thinning wastes information — it is almost always better to keep all samples and accept some correlation. The effective sample size (ESS) already accounts for autocorrelation when summarising uncertainty.

Thinning is mainly useful when:
- **Memory is limited** and you cannot store millions of samples
- **Posterior predictive checks** require expensive computations per sample

## Thinning does not fix poor mixing

If chains mix poorly (high autocorrelation, R-hat > 1.1), thinning makes the stored samples less correlated but does not improve the underlying chain quality. Fix the chain first — run more iterations or reparameterise the model.

## Default

A thinning interval of **1** (no thinning) is the standard recommendation.`,

'trace-plot': `# Reading Trace Plots

A **trace plot** shows the sampled parameter value at each MCMC iteration, one line per chain. It is the most important diagnostic tool for checking whether your sampler is working.

## What a good trace looks like

A healthy trace plot looks like a "hairy caterpillar" — a dense, horizontal band of noisy variation with no long-term trend.

**Signs of a good chain:**
- Rapidly oscillates up and down (fast mixing)
- All chains overlap each other and cannot be distinguished
- No visible upward or downward drift
- Consistent width throughout

## Warning signs

**Slow mixing (high autocorrelation)**
- The chain moves slowly, producing smooth wave-like patterns
- Consecutive values are very similar
- Fix: run more iterations, reparameterise, or adjust the sampler

**Stuck chains**
- A chain is flat or barely moving for long stretches
- Often indicates a highly constrained parameter or a near-degenerate distribution
- Fix: check the model specification and priors

**Chains not overlapping**
- Different chains are exploring different regions
- The chains have not converged to the same distribution
- Fix: increase burn-in, run longer, or reconsider the model

**Drift / trend**
- The chain has not yet settled — burn-in may be too short
- Fix: increase burn-in

## Vertical axis

The y-axis shows the parameter value on its natural scale. The range reflects the posterior spread — wide traces mean high posterior uncertainty.

## Burn-in

The period before the chain stabilises is the burn-in. It is normal for chains to start far apart and then converge. Only the post-burn-in samples are used for inference.`,

};
