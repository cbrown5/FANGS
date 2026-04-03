#!/usr/bin/env Rscript
# poisson-glm.R
#
# Fit a Bayesian Poisson GLM using NIMBLE and save posterior summaries as a
# JSON reference fixture for comparison against the FANGS JavaScript sampler.
#
# Model:
#   y[i] ~ dpois(lambda)
#   lambda ~ dgamma(1, 0.1)
#
# Data: counts y = c(3,5,2,4,3,6,2,4)  (N=8, sum=29)
# Exact posterior: lambda | data ~ Gamma(1+29, 0.1+8) = Gamma(30, 8.1)
#   Posterior mean  = 30 / 8.1 ≈ 3.704
#   Posterior SD    = sqrt(30) / 8.1 ≈ 0.675
#   95% CI ≈ [2.50, 5.14]   (exact quantiles of Gamma(30, 8.1))
#
# Usage:
#   Rscript tests/r-reference/poisson-glm.R
#
# Output:
#   tests/r-reference/results/poisson-glm-reference.json

script_dir <- tryCatch(
  dirname(normalizePath(sys.frame(1)$ofile, mustWork = FALSE)),
  error = function(e) getwd()
)
source(file.path(script_dir, "R", "utils.R"))

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------

if (!requireNamespace("nimble", quietly = TRUE)) {
  stop("Please install nimble: install.packages('nimble')")
}
library(nimble)

# ---------------------------------------------------------------------------
# 2. Data
# ---------------------------------------------------------------------------

y <- c(3L, 5L, 2L, 4L, 3L, 6L, 2L, 4L)
N <- length(y)

# ---------------------------------------------------------------------------
# 3. NIMBLE model
# ---------------------------------------------------------------------------

poissonCode <- nimbleCode({
  for (i in 1:N) {
    y[i] ~ dpois(lambda)
  }
  lambda ~ dgamma(1, 0.1)
})

model <- nimbleModel(
  code      = poissonCode,
  constants = list(N = N),
  data      = list(y = y),
  inits     = list(lambda = 3.0)
)

compiled_model <- compileNimble(model)

mcmc_conf <- configureMCMC(model, monitors = c("lambda"))
mcmc      <- buildMCMC(mcmc_conf)
compiled_mcmc <- compileNimble(mcmc, project = model)

# ---------------------------------------------------------------------------
# 4. Run MCMC
# ---------------------------------------------------------------------------

set.seed(42)
compiled_mcmc$run(20000)

samples <- as.matrix(compiled_mcmc$mvSamples)
samples <- samples[5001:nrow(samples), , drop = FALSE]   # discard burn-in

# ---------------------------------------------------------------------------
# 5. Summarise
# ---------------------------------------------------------------------------

params <- colnames(samples)
summary_list <- lapply(setNames(params, params), function(p) {
  s <- samples[, p]
  list(
    mean  = mean(s),
    sd    = sd(s),
    q2.5  = unname(quantile(s, 0.025)),
    q50   = unname(quantile(s, 0.50)),
    q97.5 = unname(quantile(s, 0.975))
  )
})

exact <- list(
  lambda = list(
    posterior_dist = "Gamma(30, 8.1)",
    mean  = 30 / 8.1,
    sd    = sqrt(30) / 8.1,
    q2.5  = unname(qgamma(0.025, shape = 30, rate = 8.1)),
    q97.5 = unname(qgamma(0.975, shape = 30, rate = 8.1))
  )
)

result <- list(
  model       = "poisson-glm",
  N           = N,
  n_post_iter = nrow(samples),
  parameters  = summary_list,
  exact       = exact
)

# ---------------------------------------------------------------------------
# 6. Write JSON
# ---------------------------------------------------------------------------

out_path <- file.path(script_dir, "results", "poisson-glm-reference.json")
write_json_fixture(result, out_path)

cat("Posterior mean of lambda:", round(summary_list$lambda$mean, 4), "\n")
cat("Exact posterior mean:    ", round(exact$lambda$mean, 4), "\n")
