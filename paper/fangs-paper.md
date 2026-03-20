# FANGS: A Browser-Based Gibbs Sampler for Teaching Bayesian Mixed-Effects Models

**Authors:** Christopher J. Brown (seascapemodels.org)

**Keywords:** Bayesian statistics, MCMC, mixed-effects models, teaching tool, browser-based, JavaScript, Claude Code, test-driven development

---

## Abstract

We present FANGS (Fast Accessible Numeric Gibbs Sampler), a browser-based application for fitting Bayesian mixed-effects models using Gibbs sampling. FANGS requires no software installation and runs entirely client-side in the browser. Users write models in standard BUGS/JAGS syntax, upload CSV data, and receive interactive MCMC results including live trace plots, posterior densities, convergence diagnostics, and posterior predictive checks. The tool is designed to reduce barriers to teaching Bayesian statistics, allowing students to fit real mixed-effects models without needing to install R, JAGS, or NIMBLE. We describe the application's design, its statistical engine, and its pedagogical features. We also reflect on the development process, which used Claude Code (an AI coding assistant) with test-driven development to build a statistically robust and extensible codebase.

---

## 1. Introduction

Bayesian statistical methods have become central to modern ecology, biology, and social science. Mixed-effects models in particular are essential for analysing hierarchical and repeated-measures data. However, the computational tools most commonly used for Bayesian inference — JAGS, Stan, NIMBLE — require software installation, command-line familiarity, and significant setup time. This creates a substantial barrier in teaching contexts, where students may spend more time troubleshooting installations than learning statistics.

Browser-based tools have transformed many areas of scientific education. Web applications require no installation, run on any device, and can be accessed immediately. However, browser-based Bayesian tools capable of fitting real mixed-effects models with MCMC are rare. Existing tools typically offer only point-and-click interfaces for simple models or rely on server-side computation.

We developed FANGS to fill this gap. FANGS implements a component-wise Gibbs sampler in JavaScript, supporting:

- Linear regression with Gaussian response
- Generalised linear models (Poisson log-link, Binomial/Bernoulli logit-link)
- Mixed-effects versions of the above with random intercepts
- Full BUGS/JAGS model syntax including user-defined priors

The application runs entirely in the browser, using Web Workers for parallel chain sampling so the interface remains responsive during computation.

This paper has two intertwined themes. First, we describe FANGS as a pedagogical tool: its features, its model syntax, and how it can be used to teach Bayesian mixed-effects modelling. Second, we describe the development process, which relied heavily on Claude Code (Anthropic) with test-driven development (TDD) to produce a statistically correct and maintainable JavaScript codebase. We argue that AI-assisted development with systematic testing represents a viable approach for building statistically demanding scientific software.

---

## 2. The FANGS Application

### 2.1 Overview and Interface

FANGS presents a two-panel interface. The left panel contains:

- A data upload area (drag-and-drop CSV or example data)
- A model editor with pre-filled model presets
- A constants panel (auto-detected from the model and data)
- Sampler settings (chains, samples, burn-in, thinning)
- Run/Stop controls and a live progress bar

The right panel provides tabbed output:

- **Data** — preview of the loaded dataset
- **Trace** — live-updating chain trace plots during sampling
- **Posteriors** — kernel density estimates of posterior marginals
- **Summary** — table of posterior means, SDs, quantiles, R-hat, and ESS
- **PPC** — posterior predictive check (histogram/density fan and observed-vs-predicted scatter)
- **Prior Check** — prior predictive check (sample from priors only, ignoring data)

Throughout the interface, **?** buttons open educational pop-ups explaining MCMC concepts including chains, burn-in, thinning, trace plots, R-hat, ESS, credible intervals, PPCs, and mixed-effects models.

### 2.2 Model Syntax

Models are written in BUGS/JAGS syntax, which is widely taught in Bayesian statistics courses and directly transferable to NIMBLE or JAGS for production use. The parser handles:

- Stochastic nodes: `y[i] ~ dnorm(mu[i], tau)`
- Deterministic nodes: `mu[i] <- alpha + beta * x[i]`
- For loops: `for(i in 1:N) { ... }`
- Array indexing including nested indices: `b[group[i]]`
- Link functions via deterministic nodes: `log(mu[i]) <- ...`
- Distributions: `dnorm`, `dgamma`, `dbeta`, `dbern`, `dpois`, `dbinom`, `dunif`, `dlnorm`
- Truncation: `T(lower, upper)`
- Math functions: `pow`, `exp`, `log`, `sqrt`, `abs`

Constants (scalar integers appearing in the model but not as parameters, such as `N` and `J`) are automatically detected and presented in an editable constants panel, so users can adjust them without editing model code.

### 2.3 Pre-loaded Model Examples

FANGS ships with four pre-loaded models and a corresponding example dataset:

1. **Linear model**: Normal response, single continuous predictor
2. **Mixed-effects model**: Linear model with random intercepts by group
3. **Poisson GLM**: Log-link, count response
4. **Bernoulli GLM**: Logit-link, binary response

### 2.4 Pedagogical Pop-up System

An educational pop-up system provides contextual explanations for MCMC concepts. Each pop-up is authored in Quarto Markdown (supporting LaTeX mathematics) and rendered to HTML at build time. Pop-ups are triggered by **?** buttons attached to relevant interface elements. Topics include:

- What is MCMC / Gibbs sampling?
- Chains and parallel chains
- Burn-in and thinning
- Trace plots and convergence
- R-hat and effective sample size
- Posterior distributions and credible intervals
- Posterior predictive checks
- Prior predictive checks
- Precision parameterisation (τ = 1/σ²)
- Random effects and mixed-effects models

---

## 3. Statistical Implementation

### 3.1 Sampler Architecture

FANGS implements a component-wise Gibbs sampler. For each parameter, the sampler:

1. Inspects the model graph to determine the node's full conditional distribution
2. Checks whether a conjugate update is available
3. If yes, samples directly from the conjugate posterior
4. If no, falls back to slice sampling

Supported conjugate update pairs include:

| Prior | Likelihood | Update |
|-------|-----------|--------|
| Normal (on linear coefficient) | Normal | Normal-Normal conjugate |
| Gamma (on precision) | Normal | Gamma-Normal conjugate |
| Beta | Bernoulli/Binomial | Beta-Binomial conjugate |
| Gamma | Poisson | Gamma-Poisson conjugate |

For parameters with random-effects structure (`b[j] ~ dnorm(0, tau.b)`), the sampler correctly identifies the hierarchical full conditional and uses conjugate updates when possible.

### 3.2 Parallel Chains

Each MCMC chain runs in a dedicated Web Worker, enabling true OS-level parallelism on multi-core machines. A coordinator worker collects chains and computes final summaries (posterior means, SDs, quantiles, R-hat, ESS, and predictions) after all chains complete.

### 3.3 Convergence Diagnostics

FANGS computes:

- **R-hat** (potential scale reduction factor) across chains
- **Effective Sample Size (ESS)** using the standard spectral estimator

R-hat values > 1.1 are highlighted in red in the Summary tab, indicating potential non-convergence.

### 3.4 Posterior Predictive Checks

After sampling, FANGS generates replicated datasets from the posterior predictive distribution and displays:

1. A histogram of observed data overlaid with a fan of predicted density curves (one per replicate) and the mean predicted curve
2. An observed-vs-predicted scatter plot with 90% credible interval error bars and a 1:1 reference line

---

## 4. Development Process: AI-Assisted TDD

### 4.1 Overview

FANGS was developed using Claude Code (Anthropic), an AI coding assistant, with test-driven development as the primary methodology. The entire codebase — parser, Gibbs sampler, conjugate update rules, slice sampler, UI components, and diagnostic calculations — was built iteratively with tests written before or alongside implementation.

### 4.2 Test Suite

The test suite comprises:

- **Parser tests** (~148 tests): Tokenisation and AST construction for BUGS syntax, including edge cases in indexing, nested indices, link functions, and truncation
- **Distribution tests** (~92 tests): Log-density and sampling functions for all supported distributions, verified against known analytical values
- **Integration tests** (~241 tests): End-to-end model fitting for linear, mixed-effects, Poisson GLM, and Bernoulli GLM models. Results are compared against reference posteriors generated with NIMBLE in R

The integration tests use R/NIMBLE reference scripts that save posterior summaries as JSON fixtures. FANGS posterior means must fall within 0.3 standard deviations of the NIMBLE reference, and 95% credible intervals must overlap.

### 4.3 Role of AI-Assisted Development

Claude Code was used for:

- Writing the BUGS parser (lexer and AST builder) from scratch
- Implementing conjugate update rules (deriving sufficient statistics analytically)
- Building the slice sampler with the correct log-full-conditional interface
- Debugging convergence failures in the mixed-effects sampler
- Optimising the hot path in the Gibbs loop (six targeted optimisations improving speed ~3–5×)
- Writing all tests and R reference scripts
- Building the UI components (canvas plots, summary table, data table)

The key enabler was the test suite. Whenever Claude Code introduced a regression or statistical error, the tests identified it immediately. This allowed confident refactoring and optimisation. Without systematic tests, it would have been very difficult to verify statistical correctness of an MCMC implementation built with AI assistance.

### 4.4 Reflections on AI-Assisted Scientific Software Development

Several patterns emerged from the development process:

**Tests as specification**: Writing tests before implementation forced clear thinking about statistical correctness. When we specified "posterior mean for beta should be within 0.3 SD of NIMBLE's value", this became an executable contract that Claude Code had to satisfy.

**Iterative refinement**: Complex statistical components (particularly the conjugate update for random effects with tau.b) required several rounds of debugging. The tests made it clear when each refinement was correct.

**Code review remains essential**: Claude Code occasionally produced code that passed all tests but had subtle issues (e.g., incorrect parameterisation for a rarely-tested distribution). Human review of the statistical logic remained necessary.

**Productivity**: The development of a statistically validated, feature-complete MCMC engine in JavaScript would typically require months of effort. AI-assisted TDD compressed this substantially while maintaining correctness through the test suite.

---

## 5. Pedagogical Applications

### 5.1 Suggested Teaching Workflows

FANGS is suited to:

1. **Introduction to Bayesian inference**: Use the linear model with the example dataset. Compare posterior summaries to frequentist estimates. Examine how changing prior precision affects posteriors.

2. **Understanding MCMC**: Use the trace plots to illustrate convergence, burn-in, and mixing. Show students what "bad" chains look like by using very few samples or a strongly misspecified model.

3. **Mixed-effects models**: Fit the mixed-effects model and compare posterior distributions of fixed effects and random-effects variance. Discuss shrinkage.

4. **Model comparison via PPC**: Fit both the linear model and mixed-effects model to the same data. Compare PPCs to informally assess which model fits better.

5. **Prior sensitivity**: Use the Prior Check tab to visualise prior predictive distributions before observing any data. Adjust priors and observe effects on the posterior.

### 5.2 Limitations

FANGS is a teaching tool, not a production sampler. Limitations include:

- Performance: suitable for N < 500 observations; larger datasets may be slow
- Model complexity: no support for multivariate distributions, ordinal models, or time-series structures
- No formal model comparison (DIC, LOO-CV)
- The JavaScript sampler may have numerical precision issues in extreme cases

For production use, students should transition to NIMBLE, Stan, or JAGS.

---

## 6. Discussion

FANGS addresses a genuine gap in Bayesian statistics education by providing a zero-installation tool capable of fitting realistic hierarchical models. The BUGS syntax ensures that skills learned with FANGS transfer directly to production tools.

The development process demonstrated that AI-assisted development with systematic TDD can produce statistically correct scientific software efficiently. The critical ingredient is the test suite: without verifiable correctness criteria, AI-generated statistical code cannot be trusted. With a comprehensive test suite including reference comparisons against established software (NIMBLE), the development loop of write-test-fix became fast and reliable.

We hope FANGS encourages broader adoption of Bayesian mixed-effects models in undergraduate and graduate courses where software barriers have historically been a deterrent.

---

## Acknowledgements

TODO

---

## References

TODO — will be formatted for target journal

---

## Appendix: Example Model Code

### Linear model

```
model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], tau)
    mu[i] <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
  tau   ~ dgamma(0.001, 0.001)
}
```

### Mixed-effects model with random intercepts

```
model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], tau)
    mu[i] <- alpha + beta * x[i] + b[group[i]]
  }
  for (j in 1:J) {
    b[j] ~ dnorm(0, tau.b)
  }
  alpha  ~ dnorm(0, 0.001)
  beta   ~ dnorm(0, 0.001)
  tau    ~ dgamma(0.001, 0.001)
  tau.b  ~ dgamma(0.001, 0.001)
}
```

### Poisson GLM

```
model {
  for (i in 1:N) {
    y[i] ~ dpois(mu[i])
    log(mu[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
}
```

### Bernoulli GLM

```
model {
  for (i in 1:N) {
    y[i] ~ dbern(p[i])
    logit(p[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
}
```
