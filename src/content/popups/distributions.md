# Distributions

FANGS supports the following distributions for stochastic nodes in your model.

## Continuous distributions

### `dnorm(mean, sd)` — Normal

$$y \sim \text{Normal}(\mu, \sigma)$$

- **mean** $\mu$: location parameter
- **sd** $\sigma > 0$: standard deviation

> **FANGS uses standard deviation**, not precision. This differs from JAGS, which parameterises `dnorm` by precision $\tau = 1/\sigma^2$. NIMBLE parameterises by precision as its default, but can also support `sd` parameterisation e.g. with `dnorm(mean, sd = sd)`. If converting a model from NIMBLE/JAGS, convert: $\sigma = 1/\sqrt{\tau}$.

---

### `dlnorm(meanlog, sdlog)` — Log-normal

$$y \sim \text{LogNormal}(\mu_{\log}, \sigma_{\log})$$

- **meanlog** $\mu_{\log}$: mean of $\log(y)$
- **sdlog** $\sigma_{\log} > 0$: standard deviation of $\log(y)$

Use for positive, right-skewed responses.

---

### `dgamma(shape, rate)` — Gamma

$$y \sim \text{Gamma}(\alpha, \beta)$$

- **shape** $\alpha > 0$
- **rate** $\beta > 0$ (rate = 1/scale)

Often used as a prior for precision or rate parameters.

---

### `dbeta(a, b)` — Beta

$$y \sim \text{Beta}(a, b)$$

- **a** > 0, **b** > 0 (shape parameters)

Defined on $(0, 1)$; natural prior for probabilities.

---

### `dunif(lower, upper)` — Uniform

$$y \sim \text{Uniform}(L, U)$$

- **lower** $L$, **upper** $U$: endpoints of the interval

A common non-informative prior for variance or scale parameters (e.g. `sigma ~ dunif(0, 100)`).

---

### `dexp(rate)` — Exponential

$$y \sim \text{Exponential}(\lambda)$$

- **rate** $\lambda > 0$

Equivalent to `dgamma(1, rate)`. Useful as a weakly informative prior for scale parameters.

---

## Discrete distributions

### `dpois(lambda)` — Poisson

$$y \sim \text{Poisson}(\lambda)$$

- **lambda** $\lambda > 0$: expected count

Standard likelihood for count data. Combine with a log link: `log(mu[i]) <- alpha + beta * x[i]`.

---

### `dbern(prob)` — Bernoulli

$$y \sim \text{Bernoulli}(p)$$

- **prob** $p \in (0,1)$: probability of success

For binary (0/1) outcomes. Use with a logit link: `logit(p[i]) <- alpha + beta * x[i]`.

---

### `dbin(prob, size)` — Binomial

$$y \sim \text{Binomial}(n, p)$$

- **prob** $p \in (0,1)$: success probability
- **size** $n$: number of trials

Generalises Bernoulli to multiple trials. Also used with a logit link.
