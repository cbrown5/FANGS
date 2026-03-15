#!/usr/bin/env Rscript
# binomial-glm.R
#
# Fit a Bayesian Bernoulli/Beta model using NIMBLE and save posterior summaries
# as a JSON reference fixture for comparison against the FANGS JavaScript sampler.
#
# Model:
#   y[i] ~ dbern(p)
#   p ~ dbeta(1, 1)
#
# Data: binary outcomes y = c(1,1,0,1,0,1,1,0)  (N=8, 5 successes)
# Exact posterior: p | data ~ Beta(1+5, 1+3) = Beta(6, 4)
#   Posterior mean  = 6 / 10 = 0.6
#   Posterior SD    = sqrt(6*4 / (10^2 * 11)) ≈ 0.1528
#   95% CI ≈ [0.277, 0.865]  (exact quantiles of Beta(6,4))
#
# Usage:
#   Rscript binomial-glm.R
#
# Output:
#   tests/r-reference/results/binomial-glm-reference.json

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

y <- c(1L, 1L, 0L, 1L, 0L, 1L, 1L, 0L)
N <- length(y)

# ---------------------------------------------------------------------------
# 3. NIMBLE model
# ---------------------------------------------------------------------------

bernCode <- nimbleCode({
  for (i in 1:N) {
    y[i] ~ dbern(p)
  }
  p ~ dbeta(1, 1)
})

constants <- list(N = N)
data_list <- list(y = y)
inits     <- list(p = 0.5)

# ---------------------------------------------------------------------------
# 4. Compile and run MCMC
# ---------------------------------------------------------------------------

model <- nimbleModel(
  code      = bernCode,
  constants = constants,
  data      = data_list,
  inits     = inits
)

compiled_model <- compileNimble(model)

mcmc_conf <- configureMCMC(model, monitors = c("p"))
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

params <- colnames(samples)
summary_list <- lapply(params, function(par) {
  s <- samples[, par]
  list(
    mean    = mean(s),
    sd      = sd(s),
    q2.5    = unname(quantile(s, 0.025)),
    q50     = unname(quantile(s, 0.50)),
    q97.5   = unname(quantile(s, 0.975))
  )
})
names(summary_list) <- params

# Exact analytical answers
exact <- list(
  p = list(
    posterior_dist = "Beta(6, 4)",
    mean  = 6 / 10,
    sd    = sqrt(6 * 4 / (10^2 * 11)),
    q2.5  = unname(qbeta(0.025, shape1 = 6, shape2 = 4)),
    q97.5 = unname(qbeta(0.975, shape1 = 6, shape2 = 4))
  )
)

result <- list(
  model       = "binomial-glm",
  N           = N,
  n_post_iter = nrow(samples),
  parameters  = summary_list,
  exact       = exact
)

# ---------------------------------------------------------------------------
# 6. Write JSON
# ---------------------------------------------------------------------------

script_file <- tryCatch(sys.frame(1)$ofile, error = function(e) NULL)
script_dir <- dirname(if (!is.null(script_file)) script_file else ".")
out_path <- file.path(script_dir, "results", "binomial-glm-reference.json")
if (!dir.exists(dirname(out_path))) dir.create(dirname(out_path), recursive = TRUE)

if (has_jsonlite) {
  write(toJSON(result, auto_unbox = TRUE, digits = 6), out_path)
} else {
  # Manual serialisation fallback
  fmt_num <- function(x) formatC(x, digits = 6, format = "f")
  lines <- c(
    '{',
    sprintf('  "model": "binomial-glm",'),
    sprintf('  "N": %d,', N),
    sprintf('  "n_post_iter": %d,', nrow(samples)),
    '  "parameters": {',
    sprintf('    "p": { "mean": %s, "sd": %s, "q2.5": %s, "q50": %s, "q97.5": %s }',
      fmt_num(summary_list$p$mean),
      fmt_num(summary_list$p$sd),
      fmt_num(summary_list$p$q2.5),
      fmt_num(summary_list$p$q50),
      fmt_num(summary_list$p$q97.5)
    ),
    '  },',
    '  "exact": {',
    sprintf('    "p": { "mean": %s, "sd": %s, "q2.5": %s, "q97.5": %s }',
      fmt_num(exact$p$mean),
      fmt_num(exact$p$sd),
      fmt_num(exact$p$q2.5),
      fmt_num(exact$p$q97.5)
    ),
    '  }',
    '}'
  )
  writeLines(lines, out_path)
}

cat("Reference saved to:", out_path, "\n")
cat("Posterior mean of p:", round(summary_list$p$mean, 4), "\n")
cat("Exact posterior mean:", round(exact$p$mean, 4), "\n")
