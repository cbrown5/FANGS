#!/usr/bin/env Rscript
# mixed-effects.R
#
# Fit a Bayesian linear mixed-effects model with group-level random intercepts
# using NIMBLE and save posterior summaries as a JSON reference fixture for
# comparison against the FANGS JavaScript sampler.
#
# Model:
#   y[i]  ~ dnorm(mu[i], tau)
#   mu[i] <- alpha + beta * x[i] + b[group[i]]
#   b[j]  ~ dnorm(0, tau.b)          for j in 1:J
#   alpha ~ dnorm(0, 0.04)
#   beta  ~ dnorm(0, 0.04)
#   tau   ~ dgamma(1, 0.1)
#   tau.b ~ dgamma(1, 0.1)
#
# Note: dnorm in NIMBLE/JAGS uses precision (1/variance) as the second argument.
#
# Usage:
#   Rscript tests/r-reference/mixed-effects.R
#
# Output:
#   tests/r-reference/results/mixed-effects-reference.json

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

N     <- nrow(dat)
J     <- length(unique(dat$group))
y     <- dat$y
x     <- dat$x
group <- dat$group

cat(sprintf("N=%d observations, J=%d groups\n", N, J))
cat(sprintf("Group counts: %s\n", paste(table(group), collapse = ", ")))

# ---------------------------------------------------------------------------
# 3. Compile and run MCMC
# ---------------------------------------------------------------------------

set.seed(2024)

n_chains  <- 3
n_samples <- 10000
burnin    <- 2000

cat("Building NIMBLE model...\n")
obj <- nimble_compile_mixed(N, J, y, x, group)

monitors <- obj$monitors

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

pop_params   <- c("alpha", "beta", "tau", "tau.b")
group_params <- paste0("b[", seq_len(J), "]")
param_names  <- c(pop_params, group_params)

summaries <- list()
for (p in param_names) {
  if (!(p %in% colnames(all_samples))) {
    cat(sprintf("Warning: parameter '%s' not found in MCMC output\n", p))
    next
  }
  summaries[[p]] <- summarize_param(all_samples[, p])
}

summaries[["__meta__"]] <- list(
  model          = "linear mixed-effects with group random intercepts",
  n_chains       = n_chains,
  n_samples      = n_samples,
  burnin         = burnin,
  generated      = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"),
  nimble_version = as.character(packageVersion("nimble")),
  data_file      = "data/example.csv",
  N              = N,
  J              = J,
  true_dgp       = list(alpha = 2.0, beta = 1.5, sigma = 0.7, sigma_group = 0.5)
)

cat("\nPosterior summaries (population-level):\n")
for (p in pop_params) {
  if (!is.null(summaries[[p]])) {
    s <- summaries[[p]]
    cat(sprintf(
      "  %s: mean=%.4f  sd=%.4f  95%%CI=[%.4f, %.4f]\n",
      p, s$mean, s$sd, s$q2_5, s$q97_5
    ))
  }
}

cat("\nGroup random effects b[j]:\n")
for (p in group_params) {
  if (!is.null(summaries[[p]])) {
    s <- summaries[[p]]
    cat(sprintf("  %s: mean=%.4f  95%%CI=[%.4f, %.4f]\n", p, s$mean, s$q2_5, s$q97_5))
  }
}

# ---------------------------------------------------------------------------
# 5. Write JSON
# ---------------------------------------------------------------------------

output_path <- file.path(script_dir, "results", "mixed-effects-reference.json")
write_json_fixture(summaries, output_path)
