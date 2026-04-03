# R/nimble-models.R — NIMBLE model definitions, compilation, and MCMC runners
#
# Depends on: R/utils.R (summarize_chain)

#' Compile a NIMBLE linear regression model
#'
#' @param N  Number of observations
#' @param y  Response vector
#' @param x  Predictor vector
#' @return list(compiled_mcmc, monitors)
nimble_compile_linear <- function(N, y, x) {
  library(nimble, quietly = TRUE)
  suppressMessages({
    model <- nimbleModel(
      code      = nimbleCode({
        for (i in 1:N) {
          y[i]  ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i]
        }
        alpha ~ dnorm(0, 0.04)
        beta  ~ dnorm(0, 0.04)
        tau   ~ dgamma(1, 0.1)
      }),
      constants = list(N = N),
      data      = list(y = y, x = x),
      inits     = list(alpha = 0, beta = 0, tau = 1)
    )
    compiled_model <- compileNimble(model)
    monitors       <- c("alpha", "beta", "tau")
    mcmc_conf      <- configureMCMC(model, monitors = monitors)
    mcmc           <- buildMCMC(mcmc_conf)
    compiled_mcmc  <- compileNimble(mcmc, project = model)
  })
  list(compiled_mcmc = compiled_mcmc, monitors = monitors)
}

#' Compile a NIMBLE linear mixed-effects model (random intercepts by group)
#'
#' @param N      Number of observations
#' @param J      Number of groups
#' @param y      Response vector
#' @param x      Predictor vector
#' @param group  Integer group index vector (1..J)
#' @return list(compiled_mcmc, monitors)
nimble_compile_mixed <- function(N, J, y, x, group) {
  library(nimble, quietly = TRUE)
  suppressMessages({
    model <- nimbleModel(
      code      = nimbleCode({
        for (i in 1:N) {
          y[i]  ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i] + b[group[i]]
        }
        for (j in 1:J) {
          b[j] ~ dnorm(0, tau.b)
        }
        alpha ~ dnorm(0, 0.04)
        beta  ~ dnorm(0, 0.04)
        tau   ~ dgamma(1, 0.1)
        tau.b ~ dgamma(1, 0.1)
      }),
      constants = list(N = N, J = J),
      data      = list(y = y, x = x, group = group),
      inits     = list(alpha = 0, beta = 0, tau = 1, tau.b = 1, b = rep(0, J))
    )
    compiled_model <- compileNimble(model)
    monitors       <- c("alpha", "beta", "tau", "tau.b", paste0("b[", seq_len(J), "]"))
    mcmc_conf      <- configureMCMC(model, monitors = monitors)
    mcmc           <- buildMCMC(mcmc_conf)
    compiled_mcmc  <- compileNimble(mcmc, project = model)
  })
  list(compiled_mcmc = compiled_mcmc, monitors = monitors)
}

#' Run a pre-compiled NIMBLE MCMC and return a tidy summary data.frame
#'
#' @param compiled_mcmc  Compiled NIMBLE MCMC object
#' @param monitors       Character vector of monitored parameter names
#' @param n_samples      Post-burn-in samples per chain
#' @param n_chains       Number of chains
#' @param burnin         Burn-in iterations (discarded)
#' @param thin           Thinning interval
#' @param model_name     Label for the 'model' column
#' @param N              Number of observations (for 'N_data' column)
#' @return data.frame with one row per population-level parameter
nimble_run <- function(compiled_mcmc, monitors, n_samples, n_chains, burnin, thin,
                       model_name, N) {
  t_start <- proc.time()[["elapsed"]]
  samples_list <- suppressMessages(runMCMC(
    compiled_mcmc,
    nchains     = n_chains,
    niter       = n_samples + burnin,
    nburnin     = burnin,
    thin        = thin,
    setSeed     = TRUE,
    progressBar = FALSE
  ))
  elapsed_mcmc_s <- proc.time()[["elapsed"]] - t_start

  all_samp <- if (is.list(samples_list)) do.call(rbind, samples_list) else samples_list

  # Focus on population-level parameters (skip random effects b[j])
  pop_params <- intersect(monitors, c("alpha", "beta", "tau", "tau.b"))
  rows <- lapply(pop_params, function(p) {
    s <- summarize_chain(all_samp[, p], p)
    cbind(
      data.frame(
        model            = model_name,
        N_data           = N,
        n_samples        = n_samples,
        n_chains         = n_chains,
        burnin           = burnin,
        thin             = thin,
        elapsed_ms       = elapsed_mcmc_s * 1000,
        elapsed_wall_s   = elapsed_mcmc_s,
        engine           = "nimble",
        stringsAsFactors = FALSE
      ),
      s
    )
  })
  do.call(rbind, rows)
}

#' Compile and run NIMBLE linear model; return timing + posterior data.frame
#'
#' @param n_samples   Post-burn-in samples per chain
#' @param n_chains    Number of chains
#' @param burnin      Burn-in iterations
#' @param thin        Thinning interval
#' @param data_csv    Path to CSV with columns y, x
#' @return data.frame (NULL if nimble not installed)
run_nimble_linear <- function(n_samples, n_chains, burnin, thin, data_csv) {
  if (!requireNamespace("nimble", quietly = TRUE)) return(NULL)
  dat <- read.csv(data_csv)
  N   <- nrow(dat)

  t_compile_start   <- proc.time()[["elapsed"]]
  obj               <- nimble_compile_linear(N, dat$y, dat$x)
  elapsed_compile_s <- proc.time()[["elapsed"]] - t_compile_start

  res <- nimble_run(obj$compiled_mcmc, obj$monitors,
                    n_samples, n_chains, burnin, thin, "linear", N)
  res$elapsed_compile_s <- elapsed_compile_s
  res$elapsed_total_s   <- res$elapsed_wall_s + elapsed_compile_s
  res
}

#' Compile and run NIMBLE mixed-effects model; return timing + posterior data.frame
#'
#' @param n_samples   Post-burn-in samples per chain
#' @param n_chains    Number of chains
#' @param burnin      Burn-in iterations
#' @param thin        Thinning interval
#' @param data_csv    Path to CSV with columns y, x, group
#' @return data.frame (NULL if nimble not installed)
run_nimble_mixed <- function(n_samples, n_chains, burnin, thin, data_csv) {
  if (!requireNamespace("nimble", quietly = TRUE)) return(NULL)
  dat <- read.csv(data_csv)
  N   <- nrow(dat)
  J   <- length(unique(dat$group))

  t_compile_start   <- proc.time()[["elapsed"]]
  obj               <- nimble_compile_mixed(N, J, dat$y, dat$x, dat$group)
  elapsed_compile_s <- proc.time()[["elapsed"]] - t_compile_start

  res <- nimble_run(obj$compiled_mcmc, obj$monitors,
                    n_samples, n_chains, burnin, thin, "mixed", N)
  res$elapsed_compile_s <- elapsed_compile_s
  res$elapsed_total_s   <- res$elapsed_wall_s + elapsed_compile_s
  res
}
