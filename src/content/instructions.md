# Getting started

FANGS fits Bayesian mixed-effects models using Gibbs sampling — entirely in your browser, with no software installation required.

## 1. Load data

Drag and drop a CSV file onto the **Data** panel, or click *Load example data* to use the built-in dataset. Your CSV must have a header row. The response variable should be named `y`; predictors can have any name.

## 2. Choose a model

Select **Linear Model**, **Mixed Effects**, **Poisson GLM**, or **Bernoulli GLM** to load a pre-written model, or type your own BUGS/JAGS model code in the editor. Supported distributions: `dnorm`, `dgamma`, `dbeta`, `dbern`, `dpois`, `dbinom`, `dunif`, `dlnorm`.

## 3. Configure sampler settings

- **Chains** — number of independent MCMC chains (3 is a good default).
- **Samples** — post burn-in samples per chain.
- **Burn-in** — initial iterations discarded.
- **Thinning** — save every n-th sample (1 = keep all).

## 4. Run and inspect results

Click **Run**. Watch the live trace plots, then browse the *Posteriors*, *Summary*, and *PPC* tabs once sampling completes. The **Summary** tab flags convergence issues (Rhat > 1.1) in red.

## 5. Prior predictive check

On the *Prior Check* tab, click **Run Prior Check** to sample from the prior only (ignoring data) and inspect prior sensitivity.

## 6. Download samples

Use the **↙ Download CSV** button in the header to export all posterior samples.

## Tip: click the **?** buttons

Throughout the interface, **?** buttons open educational pop-ups that explain MCMC concepts such as chains, burn-in, thinning, R-hat, ESS, and more.

## Model syntax

Models are written in BUGS/JAGS syntax (compatible with NIMBLE). Each model must be enclosed in a `model { }` block and can contain:

- Stochastic nodes: `y[i] ~ dnorm(mu[i], tau)`
- Deterministic nodes: `mu[i] <- alpha + beta * x[i]`
- For loops: `for(i in 1:N) { ... }`
- Link functions via deterministic nodes: `log(mu[i]) <- ...` or `logit(p[i]) <- ...`

Constants from your data (like `N`, `J`) are detected automatically and editable in the **Constants** panel.
