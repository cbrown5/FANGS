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
#   Rscript poisson-glm.R
#
# Output:
#   tests/r-reference/poisson-glm-reference.json

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------

if (!requireNamespace("nimble", quietly = TRUE)) {
  stop("Please install nimble: install.packages('nimble')")
}
library(nimble)

has_jsonlite <- requireNamespace("jsonlite", quietly = TRUE)
if (has_jsonlite) library(jsonlite)

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

constants <- list(N = N)
data_list <- list(y = y)
inits     <- list(lambda = 3.0)

# ---------------------------------------------------------------------------
# 4. Compile and run MCMC
# ---------------------------------------------------------------------------

model <- nimbleModel(
  code      = poissonCode,
  constants = constants,
  data      = data_list,
  inits     = inits
)

compiled_model <- compileNimble(model)

mcmc_conf <- configureMCMC(model, monitors = c("lambda"))
mcmc      <- buildMCMC(mcmc_conf)
compiled_mcmc <- compileNimble(mcmc, project = model)

set.seed(42)
compiled_mcmc$run(20000)

samples <- as.matrix(compiled_mcmc$mvSamples)

# Discard first 5000 as burn-in
samples <- samples[5001:nrow(samples), , drop = FALSE]

# ---------------------------------------------------------------------------
# 5. Summarise
# ---------------------------------------------------------------------------

compute_rhat <- function(chains_list) {
  # Gelman-Rubin Rhat: chains_list is a list of numeric vectors
  m <- length(chains_list)
  n <- length(chains_list[[1]])
  chain_means <- sapply(chains_list, mean)
  chain_vars  <- sapply(chains_list, var)
  grand_mean  <- mean(chain_means)
  B <- n * var(chain_means)              # between-chain variance * n
  W <- mean(chain_vars)                  # within-chain variance
  var_hat <- ((n - 1) / n) * W + (1 / n) * B
  sqrt(var_hat / W)
}

params <- colnames(samples)
summary_list <- lapply(params, function(p) {
  s <- samples[, p]
  list(
    mean    = mean(s),
    sd      = sd(s),
    q2.5    = unname(quantile(s, 0.025)),
    q50     = unname(quantile(s, 0.50)),
    q97.5   = unname(quantile(s, 0.975))
  )
})
names(summary_list) <- params

# Also store exact analytical answers for reference
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

script_file <- tryCatch(sys.frame(1)$ofile, error = function(e) NULL)
out_path <- file.path(dirname(if (!is.null(script_file)) script_file else "."), "poisson-glm-reference.json")

if (has_jsonlite) {
  write(toJSON(result, auto_unbox = TRUE, digits = 6), out_path)
} else {
  # Manual serialisation fallback
  fmt_num <- function(x) formatC(x, digits = 6, format = "f")
  lines <- c(
    '{',
    sprintf('  "model": "poisson-glm",'),
    sprintf('  "N": %d,', N),
    sprintf('  "n_post_iter": %d,', nrow(samples)),
    '  "parameters": {',
    sprintf('    "lambda": { "mean": %s, "sd": %s, "q2.5": %s, "q50": %s, "q97.5": %s }',
      fmt_num(summary_list$lambda$mean),
      fmt_num(summary_list$lambda$sd),
      fmt_num(summary_list$lambda$q2.5),
      fmt_num(summary_list$lambda$q50),
      fmt_num(summary_list$lambda$q97.5)
    ),
    '  },',
    '  "exact": {',
    sprintf('    "lambda": { "mean": %s, "sd": %s, "q2.5": %s, "q97.5": %s }',
      fmt_num(exact$lambda$mean),
      fmt_num(exact$lambda$sd),
      fmt_num(exact$lambda$q2.5),
      fmt_num(exact$lambda$q97.5)
    ),
    '  }',
    '}'
  )
  writeLines(lines, out_path)
}

cat("Reference saved to:", out_path, "\n")
cat("Posterior mean of lambda:", round(summary_list$lambda$mean, 4), "\n")
cat("Exact posterior mean:    ", round(exact$lambda$mean, 4), "\n")
