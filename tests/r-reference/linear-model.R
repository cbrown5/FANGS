#!/usr/bin/env Rscript
# linear-model.R
#
# Fit a simple Bayesian linear regression using NIMBLE and save posterior
# summaries as a JSON reference fixture for comparison against the FANGS
# JavaScript sampler.
#
# Model:
#   y[i] ~ dnorm(mu[i], tau)
#   mu[i] <- alpha + beta * x[i]
#   alpha ~ dnorm(0, 0.04)
#   beta  ~ dnorm(0, 0.04)
#   tau   ~ dgamma(1, 0.1)
#
# Note: dnorm in NIMBLE/JAGS uses precision (1/variance) as the second argument.
#
# Usage:
#   Rscript tests/r-reference/linear-model.R
#
# Output:
#   tests/r-reference/results/linear-model-reference.json

script_dir <- tryCatch(
  dirname(normalizePath(sys.frame(1)$ofile, mustWork = FALSE)),
  error = function(e) getwd()
)
source(file.path(script_dir, "R", "utils.R"))
source(file.path(script_dir, "R", "data.R"))
source(file.path(script_dir, "R", "nimble-models.R"))

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------

if (!requireNamespace("nimble", quietly = TRUE)) {
  stop("Please install nimble: install.packages('nimble')")
}
library(nimble)

# ---------------------------------------------------------------------------
# 2. Load data
# ---------------------------------------------------------------------------

data_path <- find_example_csv(script_dir)
cat("Reading data from:", data_path, "\n")
dat <- read.csv(data_path)
cat(sprintf("Loaded %d rows, columns: %s\n", nrow(dat), paste(names(dat), collapse = ", ")))

N <- nrow(dat)
y <- dat$y
x <- dat$x

# ---------------------------------------------------------------------------
# 3. Compile and run MCMC
# ---------------------------------------------------------------------------

set.seed(2024)

n_chains  <- 3
n_samples <- 10000
burnin    <- 2000

cat("Building NIMBLE model...\n")
obj <- nimble_compile_linear(N, y, x)

cat(sprintf(
  "Running MCMC: %d chains, %d samples, %d burn-in...\n",
  n_chains, n_samples, burnin
))

samples_list <- runMCMC(
  obj$compiled_mcmc,
  nchains     = n_chains,
  niter       = n_samples + burnin,
  nburnin     = burnin,
  setSeed     = TRUE,
  progressBar = interactive()
)

# ---------------------------------------------------------------------------
# 4. Compute posterior summaries
# ---------------------------------------------------------------------------

all_samples <- if (is.list(samples_list)) do.call(rbind, samples_list) else samples_list

param_names <- c("alpha", "beta", "tau")
summaries   <- lapply(setNames(param_names, param_names), function(p) {
  summarize_param(all_samples[, p])
})

summaries[["__meta__"]] <- list(
  model          = "simple linear regression",
  n_chains       = n_chains,
  n_samples      = n_samples,
  burnin         = burnin,
  generated      = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"),
  nimble_version = as.character(packageVersion("nimble")),
  data_file      = "data/example.csv",
  N              = N,
  true_dgp       = list(alpha = 2.0, beta = 1.5, sigma = 0.7)
)

cat("\nPosterior summaries:\n")
for (p in param_names) {
  s <- summaries[[p]]
  cat(sprintf(
    "  %s: mean=%.4f  sd=%.4f  95%%CI=[%.4f, %.4f]\n",
    p, s$mean, s$sd, s$q2_5, s$q97_5
  ))
}

# ---------------------------------------------------------------------------
# 5. Write JSON
# ---------------------------------------------------------------------------

output_path <- file.path(script_dir, "results", "linear-model-reference.json")
write_json_fixture(summaries, output_path)
