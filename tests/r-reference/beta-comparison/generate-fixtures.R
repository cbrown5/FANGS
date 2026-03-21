#!/usr/bin/env Rscript
# generate-fixtures.R
#
# Generates 20 datasets (5 beta values × 4 model types) and fits each with
# NIMBLE to produce JSON reference fixtures for comparing against FANGS app
# posteriors.
#
# Model types:
#   linear   - Gaussian response, identity link
#   mixed    - Gaussian response + random group intercepts
#   bernoulli - Binary response, logit link
#   poisson  - Count response, log link
#
# Beta values: -10, -5, 0, 5, 10
#
# Output:
#   datasets/  <- CSV files to load into the FANGS app (one per dataset)
#   fixtures/  <- JSON posterior summaries from NIMBLE (one per dataset)
#
# Usage (run from project root or this directory):
#   Rscript tests/r-reference/beta-comparison/generate-fixtures.R
#
# ============================================================
# App model text — copy these into the FANGS editor per model type:
# ============================================================
#
# LINEAR (variables: y, x, N):
#   model {
#     for (i in 1:N) {
#       y[i] ~ dnorm(mu[i], tau)
#       mu[i] <- alpha + beta * x[i]
#     }
#     alpha ~ dnorm(0, 0.001)
#     beta  ~ dnorm(0, 0.001)
#     tau   ~ dgamma(1, 0.1)
#   }
#
# MIXED (variables: y, x, group, N, J — set J = 5):
#   model {
#     for (i in 1:N) {
#       y[i] ~ dnorm(mu[i], tau)
#       mu[i] <- alpha + beta * x[i] + b[group[i]]
#     }
#     for (j in 1:J) {
#       b[j] ~ dnorm(0, tau.b)
#     }
#     alpha ~ dnorm(0, 0.001)
#     beta  ~ dnorm(0, 0.001)
#     tau   ~ dgamma(1, 0.1)
#     tau.b ~ dgamma(1, 0.1)
#   }
#
# BERNOULLI (variables: y, x, N):
#   model {
#     for (i in 1:N) {
#       y[i] ~ dbern(p[i])
#       logit(p[i]) <- alpha + beta * x[i]
#     }
#     alpha ~ dnorm(0, 0.001)
#     beta  ~ dnorm(0, 0.001)
#   }
#
# POISSON (variables: y, x, N):
#   model {
#     for (i in 1:N) {
#       y[i] ~ dpois(lambda[i])
#       log(lambda[i]) <- alpha + beta * x[i]
#     }
#     alpha ~ dnorm(0, 0.001)
#     beta  ~ dnorm(0, 0.001)
#   }
#
# ============================================================
# App result naming convention:
#   Save downloaded CSV as: {model}_beta_{tag}_app.csv
#   where tag encodes the beta value, e.g.:
#     beta=-10 -> tag=n10   (linear_beta_n10_app.csv)
#     beta=-5  -> tag=n5
#     beta=0   -> tag=0
#     beta=5   -> tag=5
#     beta=10  -> tag=10
# ============================================================

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
# 2. Locate output directories relative to this script
# ---------------------------------------------------------------------------

script_file <- tryCatch(
  normalizePath(sys.frame(1)$ofile, mustWork = FALSE),
  error = function(e) NULL
)
script_dir <- if (!is.null(script_file)) dirname(script_file) else getwd()

datasets_dir <- file.path(script_dir, "datasets")
fixtures_dir <- file.path(script_dir, "fixtures")
dir.create(datasets_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(fixtures_dir, showWarnings = FALSE, recursive = TRUE)

# ---------------------------------------------------------------------------
# 3. Helpers
# ---------------------------------------------------------------------------

# Approximate ESS via Geyer's monotone sequence estimator
effectiveSize_approx <- function(x) {
  n <- length(x)
  if (n < 4) return(n)
  acf_vals <- acf(x, lag.max = min(n - 1, 500), plot = FALSE)$acf[-1]
  pairwise  <- acf_vals[seq(1, length(acf_vals) - 1, by = 2)] +
               acf_vals[seq(2, length(acf_vals),     by = 2)]
  first_neg <- which(pairwise < 0)[1]
  if (is.na(first_neg)) first_neg <- length(pairwise)
  rho_sum <- sum(pairwise[seq_len(max(first_neg - 1, 0))])
  n / max(1, 1 + 2 * rho_sum)
}

# Summarise one parameter vector
summarise_param <- function(vals) {
  list(
    mean      = unname(mean(vals)),
    sd        = unname(sd(vals)),
    q2_5      = unname(quantile(vals, 0.025)),
    q25       = unname(quantile(vals, 0.25)),
    q50       = unname(quantile(vals, 0.50)),
    q75       = unname(quantile(vals, 0.75)),
    q97_5     = unname(quantile(vals, 0.975)),
    n_eff     = effectiveSize_approx(vals),
    n_samples = length(vals)
  )
}

# Manual JSON fallback (no external dependency)
to_json_manual <- function(x, indent = 0) {
  pad  <- paste(rep("  ", indent),     collapse = "")
  pad1 <- paste(rep("  ", indent + 1), collapse = "")
  if (is.list(x)) {
    if (is.null(names(x))) {
      items <- vapply(x, to_json_manual, character(1), indent = indent + 1)
      paste0("[\n", paste(pad1, items, sep = "", collapse = ",\n"), "\n", pad, "]")
    } else {
      kvs <- mapply(function(k, v)
        paste0(pad1, '"', k, '": ', to_json_manual(v, indent + 1)),
        names(x), x, SIMPLIFY = FALSE)
      paste0("{\n", paste(unlist(kvs), collapse = ",\n"), "\n", pad, "}")
    }
  } else if (is.character(x)) {
    paste0('"', gsub('"', '\\"', x), '"')
  } else if (is.numeric(x) && length(x) == 1) {
    if (is.nan(x) || is.infinite(x)) "null" else formatC(x, format = "g", digits = 8)
  } else if (is.logical(x) && length(x) == 1) {
    if (x) "true" else "false"
  } else if (is.numeric(x)) {
    vals <- ifelse(is.nan(x) | is.infinite(x), "null", formatC(x, format = "g", digits = 8))
    paste0("[", paste(vals, collapse = ", "), "]")
  } else {
    paste0('"', as.character(x), '"')
  }
}

write_fixture <- function(result, path) {
  if (has_jsonlite) {
    json_str <- jsonlite::toJSON(result, pretty = TRUE, auto_unbox = TRUE)
  } else {
    json_str <- to_json_manual(result)
  }
  writeLines(json_str, path)
  cat("  Fixture written:", path, "\n")
}

# Encode beta value as a filename-safe tag
beta_tag <- function(b) {
  if (b < 0) paste0("n", abs(b)) else as.character(b)
}

# ---------------------------------------------------------------------------
# 4. NIMBLE model code blocks (priors match FANGS default app models)
# ---------------------------------------------------------------------------

linear_code <- nimbleCode({
  for (i in 1:N) {
    y[i]   ~ dnorm(mu[i], tau)
    mu[i]  <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
  tau   ~ dgamma(1, 0.1)
})

mixed_code <- nimbleCode({
  for (i in 1:N) {
    y[i]   ~ dnorm(mu[i], tau)
    mu[i]  <- alpha + beta * x[i] + b[group[i]]
  }
  for (j in 1:J) {
    b[j] ~ dnorm(0, tau.b)
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
  tau   ~ dgamma(1, 0.1)
  tau.b ~ dgamma(1, 0.1)
})

bernoulli_code <- nimbleCode({
  for (i in 1:N) {
    y[i] ~ dbern(p[i])
    logit(p[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
})

poisson_code <- nimbleCode({
  for (i in 1:N) {
    y[i] ~ dpois(lambda[i])
    log(lambda[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.001)
  beta  ~ dnorm(0, 0.001)
})

# ---------------------------------------------------------------------------
# 5. Data generation functions
# ---------------------------------------------------------------------------

# Linear: y = alpha + beta*x + eps,  eps ~ N(0, sigma^2)
# x in [-1, 1] gives a comfortable signal-to-noise ratio for |beta| up to 10.
gen_linear <- function(beta_true, seed, N = 50, alpha_true = 2, sigma = 2) {
  set.seed(seed)
  x <- runif(N, -1, 1)
  y <- alpha_true + beta_true * x + rnorm(N, 0, sigma)
  list(
    data   = data.frame(x = x, y = y),
    true   = list(alpha = alpha_true, beta = beta_true, sigma = sigma),
    consts = list(N = N)
  )
}

# Mixed: y = alpha + beta*x + b[group] + eps
# Same x range; 5 groups of 10 observations each.
gen_mixed <- function(beta_true, seed, N = 50, J = 5, alpha_true = 2,
                       sigma = 2, sigma_b = 1) {
  set.seed(seed)
  x     <- runif(N, -1, 1)
  group <- rep(1:J, each = N / J)
  b     <- rnorm(J, 0, sigma_b)
  y     <- alpha_true + beta_true * x + b[group] + rnorm(N, 0, sigma)
  list(
    data   = data.frame(x = x, y = y, group = group),
    true   = list(alpha = alpha_true, beta = beta_true, sigma = sigma,
                  sigma_b = sigma_b, b = b),
    consts = list(N = N, J = J)
  )
}

# Bernoulli: logit(p) = alpha + beta*x
# x in [-0.3, 0.3] keeps logit(p) in [-3, 3] for |beta|=10, so p stays
# in [0.05, 0.95] — avoiding near-degenerate outcomes.
gen_bernoulli <- function(beta_true, seed, N = 100, alpha_true = 0) {
  set.seed(seed)
  x   <- runif(N, -0.3, 0.3)
  eta <- alpha_true + beta_true * x
  p   <- 1 / (1 + exp(-eta))
  y   <- rbinom(N, 1, p)
  list(
    data   = data.frame(x = x, y = y),
    true   = list(alpha = alpha_true, beta = beta_true),
    consts = list(N = N)
  )
}

# Poisson: log(lambda) = alpha + beta*x
# x in [-0.3, 0.3] keeps lambda in [exp(-2), exp(4)] ≈ [0.14, 55]
# for |beta|=10, alpha=1.
gen_poisson <- function(beta_true, seed, N = 100, alpha_true = 1) {
  set.seed(seed)
  x      <- runif(N, -0.3, 0.3)
  lambda <- exp(alpha_true + beta_true * x)
  y      <- rpois(N, lambda)
  list(
    data   = data.frame(x = x, y = y),
    true   = list(alpha = alpha_true, beta = beta_true),
    consts = list(N = N)
  )
}

# ---------------------------------------------------------------------------
# 6. NIMBLE fitting functions
# ---------------------------------------------------------------------------

n_chains  <- 3
n_samples <- 5000   # post-burnin per chain
burnin    <- 2000

fit_linear <- function(ds, seed_offset = 0) {
  consts    <- ds$consts
  data_list <- list(y = ds$data$y, x = ds$data$x)
  inits     <- list(alpha = 0, beta = 0, tau = 1)

  model <- nimbleModel(linear_code, constants = consts,
                       data = data_list, inits = inits)
  cm    <- compileNimble(model)
  conf  <- configureMCMC(model, monitors = c("alpha", "beta", "tau"))
  mcmc  <- buildMCMC(conf)
  cmcmc <- compileNimble(mcmc, project = model)

  samples_list <- runMCMC(cmcmc, nchains = n_chains,
                          niter = n_samples + burnin, nburnin = burnin,
                          setSeed = 100 + seed_offset, progressBar = interactive())
  do.call(rbind, if (is.list(samples_list)) samples_list else list(samples_list))
}

fit_mixed <- function(ds, seed_offset = 0) {
  consts    <- ds$consts
  J         <- consts$J
  data_list <- list(y = ds$data$y, x = ds$data$x, group = ds$data$group)
  inits     <- list(alpha = 0, beta = 0, tau = 1, tau.b = 1, b = rep(0, J))

  model <- nimbleModel(mixed_code, constants = consts,
                       data = data_list, inits = inits)
  cm    <- compileNimble(model)
  monitors <- c("alpha", "beta", "tau", "tau.b", paste0("b[", seq_len(J), "]"))
  conf  <- configureMCMC(model, monitors = monitors)
  mcmc  <- buildMCMC(conf)
  cmcmc <- compileNimble(mcmc, project = model)

  samples_list <- runMCMC(cmcmc, nchains = n_chains,
                          niter = n_samples + burnin, nburnin = burnin,
                          setSeed = 200 + seed_offset, progressBar = interactive())
  do.call(rbind, if (is.list(samples_list)) samples_list else list(samples_list))
}

fit_bernoulli <- function(ds, seed_offset = 0) {
  consts    <- ds$consts
  data_list <- list(y = ds$data$y, x = ds$data$x)
  inits     <- list(alpha = 0, beta = 0)

  model <- nimbleModel(bernoulli_code, constants = consts,
                       data = data_list, inits = inits)
  cm    <- compileNimble(model)
  conf  <- configureMCMC(model, monitors = c("alpha", "beta"))
  mcmc  <- buildMCMC(conf)
  cmcmc <- compileNimble(mcmc, project = model)

  samples_list <- runMCMC(cmcmc, nchains = n_chains,
                          niter = n_samples + burnin, nburnin = burnin,
                          setSeed = 300 + seed_offset, progressBar = interactive())
  do.call(rbind, if (is.list(samples_list)) samples_list else list(samples_list))
}

fit_poisson <- function(ds, seed_offset = 0) {
  consts    <- ds$consts
  data_list <- list(y = ds$data$y, x = ds$data$x)
  inits     <- list(alpha = 1, beta = 0)

  model <- nimbleModel(poisson_code, constants = consts,
                       data = data_list, inits = inits)
  cm    <- compileNimble(model)
  conf  <- configureMCMC(model, monitors = c("alpha", "beta"))
  mcmc  <- buildMCMC(conf)
  cmcmc <- compileNimble(mcmc, project = model)

  samples_list <- runMCMC(cmcmc, nchains = n_chains,
                          niter = n_samples + burnin, nburnin = burnin,
                          setSeed = 400 + seed_offset, progressBar = interactive())
  do.call(rbind, if (is.list(samples_list)) samples_list else list(samples_list))
}

# ---------------------------------------------------------------------------
# 7. Main loop: generate data, fit, save
# ---------------------------------------------------------------------------

beta_values <- c(-10, -5, 0, 5, 10)

model_configs <- list(
  linear    = list(gen = gen_linear,    fit = fit_linear,    label = "linear"),
  mixed     = list(gen = gen_mixed,     fit = fit_mixed,     label = "mixed"),
  bernoulli = list(gen = gen_bernoulli, fit = fit_bernoulli, label = "bernoulli"),
  poisson   = list(gen = gen_poisson,   fit = fit_poisson,   label = "poisson")
)

cat("=============================================================\n")
cat("FANGS beta-comparison fixture generator\n")
cat("=============================================================\n")
cat(sprintf("Generating %d datasets x %d model types = %d total\n",
    length(beta_values), length(model_configs),
    length(beta_values) * length(model_configs)))
cat(sprintf("MCMC: %d chains x %d samples + %d burn-in\n\n",
    n_chains, n_samples, burnin))

for (m_name in names(model_configs)) {
  cfg <- model_configs[[m_name]]

  for (bi in seq_along(beta_values)) {
    beta_true <- beta_values[bi]
    tag       <- beta_tag(beta_true)

    cat(sprintf("--- %s | beta = %g ---\n", m_name, beta_true))

    # Generate dataset
    ds   <- cfg$gen(beta_true, seed = bi * 13 + which(names(model_configs) == m_name) * 100)
    csv_path <- file.path(datasets_dir, sprintf("%s_beta_%s.csv", m_name, tag))
    write.csv(ds$data, csv_path, row.names = FALSE)
    cat(sprintf("  Dataset: %s  (N=%d)\n", basename(csv_path), nrow(ds$data)))

    # Fit NIMBLE
    cat("  Fitting NIMBLE... ")
    flush.console()
    all_samples <- tryCatch(
      cfg$fit(ds, seed_offset = bi),
      error = function(e) {
        cat(sprintf("FAILED: %s\n", conditionMessage(e)))
        NULL
      }
    )

    if (is.null(all_samples)) next
    cat("done\n")

    # Compute summaries for all monitored parameters
    param_names <- colnames(all_samples)
    summaries   <- setNames(
      lapply(param_names, function(p) summarise_param(all_samples[, p])),
      param_names
    )

    # Print beta summary
    b_s <- summaries[["beta"]]
    cat(sprintf("  beta: mean=%.3f  95%%CI=[%.3f, %.3f]  (true=%g)\n",
        b_s$mean, b_s$q2_5, b_s$q97_5, beta_true))

    # Metadata
    summaries[["__meta__"]] <- list(
      model           = m_name,
      beta_true       = beta_true,
      dataset_file    = basename(csv_path),
      app_result_file = sprintf("%s_beta_%s_app.csv", m_name, tag),
      n_chains        = n_chains,
      n_samples       = n_samples,
      burnin          = burnin,
      generated       = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"),
      nimble_version  = as.character(packageVersion("nimble")),
      true_dgp        = ds$true,
      constants       = ds$consts
    )

    fix_path <- file.path(fixtures_dir, sprintf("%s_beta_%s_fixture.json", m_name, tag))
    write_fixture(summaries, fix_path)
    cat("\n")
  }
}

cat("=============================================================\n")
cat("Done. Next steps:\n")
cat("  1. Load each CSV from datasets/ into the FANGS app\n")
cat("  2. Use the model text shown at the top of this script\n")
cat("  3. Run MCMC, download CSV, save to app-results/ with naming:\n")
cat("       {model}_beta_{tag}_app.csv\n")
cat("     e.g. linear_beta_n10_app.csv, poisson_beta_5_app.csv\n")
cat("  4. Run compare.R to generate the comparison plots\n")
cat("=============================================================\n")
