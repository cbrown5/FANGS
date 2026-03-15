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
#   alpha ~ dnorm(0, 0.001)
#   beta  ~ dnorm(0, 0.001)
#   tau   ~ dgamma(0.001, 0.001)
#   tau.b ~ dgamma(0.001, 0.001)
#
# Note: dnorm in NIMBLE/JAGS uses precision (1/variance) as the second argument.
# sigma_residual = 1/sqrt(tau),  sigma_group = 1/sqrt(tau.b)
#
# Usage:
#   Rscript mixed-effects.R
#
# Output:
#   tests/r-reference/mixed-effects-reference.json

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
# 2. Load data
# ---------------------------------------------------------------------------

script_dir <- tryCatch(
  dirname(normalizePath(sys.frame(1)$ofile, mustWork = FALSE)),
  error = function(e) getwd()
)

candidate_paths <- c(
  file.path(script_dir, "..", "..", "data", "example.csv"),
  file.path(getwd(), "data", "example.csv"),
  "data/example.csv"
)

data_path <- NULL
for (p in candidate_paths) {
  if (file.exists(p)) {
    data_path <- p
    break
  }
}

if (is.null(data_path)) {
  stop("Cannot find data/example.csv.  Run this script from the project root.")
}

cat("Reading data from:", normalizePath(data_path), "\n")
dat <- read.csv(data_path)
cat(sprintf("Loaded %d rows, columns: %s\n", nrow(dat), paste(names(dat), collapse = ", ")))

N     <- nrow(dat)
J     <- length(unique(dat$group))   # number of groups
y     <- dat$y
x     <- dat$x
group <- dat$group   # integer group indices 1..J

cat(sprintf("N=%d observations, J=%d groups\n", N, J))
cat(sprintf("Group counts: %s\n", paste(table(group), collapse = ", ")))

# ---------------------------------------------------------------------------
# 3. NIMBLE model definition
# ---------------------------------------------------------------------------

mixed_code <- nimbleCode({
  for (i in 1:N) {
    y[i]  ~ dnorm(mu[i], tau)
    mu[i] <- alpha + beta * x[i] + b[group[i]]
  }
  for (j in 1:J) {
    b[j] ~ dnorm(0, tau.b)
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
  tau   ~ dgamma(0.001, 0.001)
  tau.b ~ dgamma(0.001, 0.001)
})

# ---------------------------------------------------------------------------
# 4. Build and compile the model
# ---------------------------------------------------------------------------

constants <- list(N = N, J = J)
data_list <- list(y = y, x = x, group = group)
inits     <- list(
  alpha = 0,
  beta  = 0,
  tau   = 1,
  tau.b = 1,
  b     = rep(0, J)
)

cat("Building NIMBLE model...\n")
model <- nimbleModel(
  code      = mixed_code,
  constants = constants,
  data      = data_list,
  inits     = inits
)

compiled_model <- compileNimble(model)

# ---------------------------------------------------------------------------
# 5. Configure and compile the MCMC
# ---------------------------------------------------------------------------

# Monitor population-level parameters and all group random effects.
monitors <- c("alpha", "beta", "tau", "tau.b", paste0("b[", 1:J, "]"))

mcmc_conf <- configureMCMC(model, monitors = monitors)
mcmc      <- buildMCMC(mcmc_conf)
compiled_mcmc <- compileNimble(mcmc, project = model)

# ---------------------------------------------------------------------------
# 6. Run MCMC
# ---------------------------------------------------------------------------

set.seed(2024)

n_chains  <- 3
n_samples <- 10000
burnin    <- 2000

cat(sprintf(
  "Running MCMC: %d chains, %d samples, %d burn-in...\n",
  n_chains, n_samples, burnin
))

samples_list <- runMCMC(
  compiled_mcmc,
  nchains  = n_chains,
  niter    = n_samples + burnin,
  nburnin  = burnin,
  setSeed  = TRUE,
  progressBar = interactive()
)

# ---------------------------------------------------------------------------
# 7. Compute posterior summaries
# ---------------------------------------------------------------------------

if (is.list(samples_list)) {
  all_samples <- do.call(rbind, samples_list)
} else {
  all_samples <- samples_list
}

# Population-level parameters plus all group random effects.
pop_params   <- c("alpha", "beta", "tau", "tau.b")
group_params <- paste0("b[", 1:J, "]")
param_names  <- c(pop_params, group_params)

summaries <- list()

for (p in param_names) {
  if (!(p %in% colnames(all_samples))) {
    cat(sprintf("Warning: parameter '%s' not found in MCMC output\n", p))
    next
  }
  vals <- all_samples[, p]
  summaries[[p]] <- list(
    mean   = unname(mean(vals)),
    sd     = unname(sd(vals)),
    q2_5   = unname(quantile(vals, 0.025)),
    q25    = unname(quantile(vals, 0.25)),
    q50    = unname(quantile(vals, 0.50)),
    q75    = unname(quantile(vals, 0.75)),
    q97_5  = unname(quantile(vals, 0.975)),
    n_eff  = effectiveSize_approx(vals),
    n_samples = length(vals)
  )
}

# Metadata
summaries[["__meta__"]] <- list(
  model       = "linear mixed-effects with group random intercepts",
  n_chains    = n_chains,
  n_samples   = n_samples,
  burnin      = burnin,
  generated   = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"),
  nimble_version = as.character(packageVersion("nimble")),
  data_file   = "data/example.csv",
  N           = N,
  J           = J,
  true_dgp    = list(
    alpha       = 2.0,
    beta        = 1.5,
    sigma       = 0.7,
    sigma_group = 0.5
  )
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
    cat(sprintf(
      "  %s: mean=%.4f  95%%CI=[%.4f, %.4f]\n",
      p, s$mean, s$q2_5, s$q97_5
    ))
  }
}

# ---------------------------------------------------------------------------
# 8. Write JSON
# ---------------------------------------------------------------------------

output_path <- file.path(script_dir, "mixed-effects-reference.json")
if (!dir.exists(dirname(output_path))) {
  output_path <- "tests/r-reference/mixed-effects-reference.json"
}

if (has_jsonlite) {
  json_str <- jsonlite::toJSON(summaries, pretty = TRUE, auto_unbox = TRUE)
} else {
  json_str <- to_json_manual(summaries)
}

writeLines(json_str, output_path)
cat(sprintf("\nReference JSON written to: %s\n", normalizePath(output_path)))

# ---------------------------------------------------------------------------
# Helper: approximate effective sample size (Geyer's monotone sequence)
# ---------------------------------------------------------------------------

effectiveSize_approx <- function(x) {
  n <- length(x)
  if (n < 4) return(n)
  acf_vals <- acf(x, lag.max = min(n - 1, 500), plot = FALSE)$acf[-1]
  pairwise  <- acf_vals[seq(1, length(acf_vals) - 1, by = 2)] +
               acf_vals[seq(2, length(acf_vals),     by = 2)]
  first_neg <- which(pairwise < 0)[1]
  if (is.na(first_neg)) first_neg <- length(pairwise)
  rho_sum <- sum(pairwise[seq_len(first_neg - 1)])
  n / max(1, 1 + 2 * rho_sum)
}

# ---------------------------------------------------------------------------
# Helper: manual JSON serialiser
# ---------------------------------------------------------------------------

to_json_manual <- function(x, indent = 0) {
  pad  <- paste(rep("  ", indent),     collapse = "")
  pad1 <- paste(rep("  ", indent + 1), collapse = "")

  if (is.list(x)) {
    if (is.null(names(x))) {
      items <- vapply(x, to_json_manual, character(1), indent = indent + 1)
      paste0("[\n", paste(pad1, items, sep = "", collapse = ",\n"), "\n", pad, "]")
    } else {
      kvs <- mapply(function(k, v) {
        paste0(pad1, '"', k, '": ', to_json_manual(v, indent + 1))
      }, names(x), x, SIMPLIFY = FALSE)
      paste0("{\n", paste(unlist(kvs), collapse = ",\n"), "\n", pad, "}")
    }
  } else if (is.character(x)) {
    paste0('"', gsub('"', '\\"', x), '"')
  } else if (is.numeric(x) && length(x) == 1) {
    if (is.nan(x) || is.infinite(x)) "null"
    else formatC(x, format = "g", digits = 8)
  } else if (is.logical(x) && length(x) == 1) {
    if (x) "true" else "false"
  } else if (is.numeric(x)) {
    vals <- ifelse(is.nan(x) | is.infinite(x), "null",
                   formatC(x, format = "g", digits = 8))
    paste0("[", paste(vals, collapse = ", "), "]")
  } else {
    paste0('"', as.character(x), '"')
  }
}
