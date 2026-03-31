#!/usr/bin/env Rscript
# benchmark.R
#
# Benchmark the FANGS JavaScript sampler against NIMBLE across:
#   (a) varying MCMC sample sizes  (n_samples)
#   (b) varying data sizes         (N observations)
#
# For each engine × model × setting combination this script records:
#   - elapsed time (seconds)
#   - posterior summaries (mean, SD, 95% CI) for key parameters
#
# All results are written to CSV in tests/r-reference/results/ so they can
# be loaded and explored interactively in R.  PDF plots are also produced.
#
# Usage (from project root):
#   Rscript tests/r-reference/benchmark.R
#
# Configuration at the top of Section 1 can be tuned to run faster or slower.

# ===========================================================================
# 0.  Project root & output directory
# ===========================================================================

find_project_root <- function() {
  # Walk up from this script's location looking for package.json.
  script_file <- tryCatch(
    normalizePath(sys.frame(1)$ofile, mustWork = FALSE),
    error = function(e) NULL
  )
  start_dir <- if (!is.null(script_file)) dirname(script_file) else getwd()

  dirs_to_try <- c(
    start_dir,
    file.path(start_dir, "../.."),
    getwd(),
    "."
  )
  for (d in dirs_to_try) {
    if (file.exists(file.path(d, "package.json"))) {
      return(normalizePath(d))
    }
  }
  stop(
    "Cannot locate FANGS project root (no package.json found).\n",
    "Run this script from the project root:\n",
    "  Rscript tests/r-reference/benchmark.R"
  )
}

FANGS_ROOT <- find_project_root()
cat("FANGS project root:", FANGS_ROOT, "\n")

OUTPUT_DIR <- file.path(FANGS_ROOT, "tests", "r-reference", "results")
if (!dir.exists(OUTPUT_DIR)) dir.create(OUTPUT_DIR, recursive = TRUE)

DEFAULT_DATA_CSV <- file.path(FANGS_ROOT, "data", "example.csv")

# ===========================================================================
# 1.  Configuration — edit these to trade speed for thoroughness
# ===========================================================================

# MCMC sample-size grid (post-burn-in samples per chain)
N_SAMPLES_GRID <- c(200, 500, 1000, 2000, 5000)

# Data-size grid (number of observations)
N_DATA_GRID <- c(50, 100, 250, 500, 1000)

# Fixed settings used when the other dimension is being varied
N_SAMPLES_FIXED <- 1000   # used for the data-size sweep
N_DATA_FIXED    <- 50     # used for the sample-size sweep (= default example.csv)

# Shared MCMC settings
N_CHAINS <- 3
BURNIN   <- 500
THIN     <- 1

# Models to benchmark
MODELS <- c("linear", "mixed")

# Timing replications per FANGS run (NIMBLE always gets 1 rep due to compile cost)
N_REPS_FANGS   <- 3
N_REPS_NIMBLE  <- 1

# ===========================================================================
# 2.  Package availability
# ===========================================================================

has_nimble  <- requireNamespace("nimble",  quietly = TRUE)
has_ggplot2 <- requireNamespace("ggplot2", quietly = TRUE)

if (!has_nimble) {
  message(
    "\n[NOTE] 'nimble' is not installed -- NIMBLE benchmarks will be skipped.\n",
    "       Install with: install.packages('nimble')\n"
  )
}
if (!has_ggplot2) {
  message("[NOTE] 'ggplot2' not installed -- falling back to base-R plots.")
}

# ===========================================================================
# 3.  Shared helpers
# ===========================================================================

#' Approximate effective sample size (Geyer's initial monotone sequence)
effective_size <- function(x) {
  n <- length(x)
  if (n < 4) return(n)
  acf_vals  <- acf(x, lag.max = min(n - 1, 500), plot = FALSE)$acf[-1]
  pairwise  <- acf_vals[seq(1, length(acf_vals) - 1, by = 2)] +
               acf_vals[seq(2, length(acf_vals),     by = 2)]
  first_neg <- which(pairwise < 0)[1]
  if (is.na(first_neg)) first_neg <- length(pairwise)
  rho_sum   <- sum(pairwise[seq_len(first_neg - 1)])
  n / max(1, 1 + 2 * rho_sum)
}

#' Summarise a vector of posterior samples into a one-row data.frame
summarize_chain <- function(vals, param_name) {
  data.frame(
    param = param_name,
    mean  = mean(vals),
    sd    = sd(vals),
    q2_5  = unname(quantile(vals, 0.025)),
    q50   = unname(quantile(vals, 0.50)),
    q97_5 = unname(quantile(vals, 0.975)),
    ess   = effective_size(vals),
    stringsAsFactors = FALSE
  )
}

# ===========================================================================
# 4.  Generate synthetic data at arbitrary N  (same DGP as example.csv)
# ===========================================================================

#' Generate a data frame with the same DGP as data/example.csv
#'
#' DGP:  y_i = 2 + 1.5*x_i + b[group_i] + eps_i
#'         b_j  ~ N(0, 0.5^2)      j = 1..5
#'         eps  ~ N(0, 0.7^2)
#'       y_count_i ~ Poisson(exp(1.0 + 0.5*x_i))
#'       y_bin_i   ~ Bernoulli(plogis(1.5*x_i))
#'
#' @param N     Number of observations
#' @param seed  Random seed for reproducibility
generate_data <- function(N, seed = 42) {
  set.seed(seed)
  n_groups <- 5
  group    <- rep(seq_len(n_groups), length.out = N)
  x        <- rnorm(N)
  b_group  <- rnorm(n_groups, 0, 0.5)
  y        <- 2 + 1.5 * x + b_group[group] + rnorm(N, 0, 0.7)
  y_count  <- rpois(N, exp(1.0 + 0.5 * x))
  y_bin    <- rbinom(N, 1, plogis(1.5 * x))
  data.frame(
    id      = seq_len(N),
    y       = y,
    x       = x,
    group   = group,
    y_count = y_count,
    y_bin   = y_bin
  )
}

# ===========================================================================
# 5.  Run FANGS via the Node.js CLI
# ===========================================================================

#' Run the FANGS Gibbs sampler via the Node.js CLI and return results
#'
#' @param model       Model name: "linear", "mixed", "poisson", "bernoulli"
#' @param n_samples   Post-burn-in samples per chain
#' @param n_chains    Number of parallel chains
#' @param burnin      Burn-in iterations (discarded)
#' @param thin        Thinning interval
#' @param data_csv    Path to the input data CSV
#' @return  data.frame with posterior summaries + timing columns, or NULL on failure
run_fangs <- function(
    model,
    n_samples,
    n_chains  = N_CHAINS,
    burnin    = BURNIN,
    thin      = THIN,
    data_csv  = DEFAULT_DATA_CSV
) {
  cli_path <- file.path(FANGS_ROOT, "tests", "bench", "fangs-cli.mjs")
  if (!file.exists(cli_path)) {
    stop("FANGS CLI not found at: ", cli_path, "\n",
         "Expected: tests/bench/fangs-cli.mjs")
  }

  out_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(out_csv), add = TRUE)

  args <- c(
    cli_path,
    "--model",       model,
    "--n-samples",   as.character(n_samples),
    "--chains",      as.character(n_chains),
    "--burnin",      as.character(burnin),
    "--thin",        as.character(thin),
    "--data",        normalizePath(data_csv, mustWork = FALSE),
    "--output",      out_csv
  )

  # Capture stderr to parse the FANGS_ELAPSED_MS line
  stderr_tmp <- tempfile()
  on.exit(unlink(stderr_tmp), add = TRUE)

  t_wall_start <- proc.time()[["elapsed"]]
  exit_status  <- system2(
    "node", args = args,
    stdout = TRUE, stderr = stderr_tmp
  )
  t_wall_end <- proc.time()[["elapsed"]]

  wall_s <- t_wall_end - t_wall_start

  # Parse elapsed_ms reported from inside Node.js (excludes startup overhead)
  elapsed_ms_js <- NA_real_
  if (file.exists(stderr_tmp)) {
    stderr_lines <- readLines(stderr_tmp, warn = FALSE)
    m <- regmatches(stderr_lines,
                    regexpr("(?<=FANGS_ELAPSED_MS:)[0-9.]+", stderr_lines, perl = TRUE))
    if (length(m) > 0 && nchar(m[1]) > 0) elapsed_ms_js <- as.numeric(m[1])
  }

  if (!file.exists(out_csv) || file.info(out_csv)$size == 0) {
    warning(sprintf(
      "FANGS CLI returned no output for model=%s n_samples=%d\n",
      model, n_samples
    ))
    return(NULL)
  }

  res <- read.csv(out_csv, stringsAsFactors = FALSE)
  res$elapsed_ms      <- elapsed_ms_js          # sampler time (from JS)
  res$elapsed_wall_s  <- wall_s                  # wall time including startup
  res$engine          <- "fangs"
  res
}

# ===========================================================================
# 6.  Run NIMBLE models
# ===========================================================================

#' Helper: compile a NIMBLE model and return compiled objects + compile time
.nimble_compile_linear <- function(N, y, x) {
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
    mcmc_conf      <- configureMCMC(model, monitors = c("alpha", "beta", "tau"))
    mcmc           <- buildMCMC(mcmc_conf)
    compiled_mcmc  <- compileNimble(mcmc, project = model)
  })
  list(compiled_mcmc = compiled_mcmc, monitors = c("alpha", "beta", "tau"))
}

.nimble_compile_mixed <- function(N, J, y, x, group) {
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

#' Run a pre-compiled NIMBLE MCMC and return a summary data.frame
.nimble_run <- function(compiled_mcmc, monitors, n_samples, n_chains, burnin, thin,
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
        model             = model_name,
        N_data            = N,
        n_samples         = n_samples,
        n_chains          = n_chains,
        burnin            = burnin,
        thin              = thin,
        elapsed_ms        = elapsed_mcmc_s * 1000,  # MCMC-only ms
        elapsed_wall_s    = elapsed_mcmc_s,
        engine            = "nimble",
        stringsAsFactors  = FALSE
      ),
      s
    )
  })
  do.call(rbind, rows)
}

#' Compile and run NIMBLE linear model, returning timing + posterior data.frame
run_nimble_linear <- function(n_samples, n_chains = N_CHAINS, burnin = BURNIN,
                              thin = THIN, data_csv = DEFAULT_DATA_CSV) {
  if (!has_nimble) return(NULL)
  dat <- read.csv(data_csv)
  N   <- nrow(dat)

  t_compile_start <- proc.time()[["elapsed"]]
  obj             <- .nimble_compile_linear(N, dat$y, dat$x)
  elapsed_compile_s <- proc.time()[["elapsed"]] - t_compile_start

  res <- .nimble_run(obj$compiled_mcmc, obj$monitors,
                     n_samples, n_chains, burnin, thin, "linear", N)

  # Adjust elapsed_ms / elapsed_wall_s to include compile time
  res$elapsed_compile_s <- elapsed_compile_s
  res$elapsed_total_s   <- res$elapsed_wall_s + elapsed_compile_s
  res
}

#' Compile and run NIMBLE mixed-effects model
run_nimble_mixed <- function(n_samples, n_chains = N_CHAINS, burnin = BURNIN,
                             thin = THIN, data_csv = DEFAULT_DATA_CSV) {
  if (!has_nimble) return(NULL)
  dat   <- read.csv(data_csv)
  N     <- nrow(dat)
  J     <- length(unique(dat$group))

  t_compile_start <- proc.time()[["elapsed"]]
  obj             <- .nimble_compile_mixed(N, J, dat$y, dat$x, dat$group)
  elapsed_compile_s <- proc.time()[["elapsed"]] - t_compile_start

  res <- .nimble_run(obj$compiled_mcmc, obj$monitors,
                     n_samples, n_chains, burnin, thin, "mixed", N)

  res$elapsed_compile_s <- elapsed_compile_s
  res$elapsed_total_s   <- res$elapsed_wall_s + elapsed_compile_s
  res
}

# ===========================================================================
# 7.  Benchmark sweep A: n_samples vs time  (fixed data = example.csv)
# ===========================================================================

cat("\n========================================================\n")
cat("Benchmark A: MCMC sample size vs fitting time\n")
cat(sprintf("  Models: %s\n", paste(MODELS, collapse = ", ")))
cat(sprintf("  n_samples grid: %s\n", paste(N_SAMPLES_GRID, collapse = ", ")))
cat(sprintf("  N_data (fixed): %d  |  chains: %d  |  burnin: %d\n",
            N_DATA_FIXED, N_CHAINS, BURNIN))
cat("========================================================\n\n")

timing_a    <- list()
posterior_a <- list()

for (model_name in MODELS) {
  for (ns in N_SAMPLES_GRID) {

    # --- FANGS (multiple reps for stable timing) ---
    for (rep in seq_len(N_REPS_FANGS)) {
      cat(sprintf("  [FANGS]  model=%-6s  n_samples=%5d  rep=%d/%d  ... ",
                  model_name, ns, rep, N_REPS_FANGS))
      flush.console()

      res <- tryCatch(
        run_fangs(model = model_name, n_samples = ns),
        error = function(e) { warning(e$message); NULL }
      )

      if (!is.null(res)) {
        timing_a[[length(timing_a) + 1]] <- data.frame(
          engine         = "fangs",
          model          = model_name,
          N_data         = unique(res$N_data),
          n_samples      = ns,
          rep            = rep,
          elapsed_s      = unique(as.numeric(res$elapsed_ms), na.rm = TRUE) / 1000,
          elapsed_wall_s = unique(res$elapsed_wall_s),
          stringsAsFactors = FALSE
        )
        posterior_a[[length(posterior_a) + 1]] <- res
        cat(sprintf("%.2fs\n", unique(res$elapsed_wall_s)))
      } else {
        cat("FAILED\n")
      }
    }

    # --- NIMBLE (one rep; compilation dominates for small n_samples) ---
    if (has_nimble) {
      cat(sprintf("  [NIMBLE] model=%-6s  n_samples=%5d  ... ",
                  model_name, ns))
      flush.console()

      nim_fn  <- if (model_name == "linear") run_nimble_linear else run_nimble_mixed
      nim_res <- tryCatch(
        nim_fn(n_samples = ns),
        error = function(e) { warning(e$message); NULL }
      )

      if (!is.null(nim_res)) {
        timing_a[[length(timing_a) + 1]] <- data.frame(
          engine            = "nimble",
          model             = model_name,
          N_data            = unique(nim_res$N_data),
          n_samples         = ns,
          rep               = 1L,
          elapsed_s         = unique(nim_res$elapsed_wall_s),
          elapsed_wall_s    = unique(nim_res$elapsed_total_s),
          stringsAsFactors  = FALSE
        )
        posterior_a[[length(posterior_a) + 1]] <- nim_res
        cat(sprintf("%.2fs (mcmc) + %.2fs (compile)\n",
                    unique(nim_res$elapsed_wall_s),
                    unique(nim_res$elapsed_compile_s)))
      } else {
        cat("FAILED\n")
      }
    }
  }
}

timing_df_a    <- if (length(timing_a)    > 0) do.call(rbind, timing_a)    else data.frame()
posterior_df_a <- if (length(posterior_a) > 0) do.call(rbind, posterior_a) else data.frame()

# ===========================================================================
# 8.  Benchmark sweep B: data size (N) vs time  (fixed n_samples)
# ===========================================================================

cat("\n========================================================\n")
cat("Benchmark B: Data size (N) vs fitting time\n")
cat(sprintf("  Models: %s\n", paste(MODELS, collapse = ", ")))
cat(sprintf("  N_data grid: %s\n", paste(N_DATA_GRID, collapse = ", ")))
cat(sprintf("  n_samples (fixed): %d  |  chains: %d  |  burnin: %d\n",
            N_SAMPLES_FIXED, N_CHAINS, BURNIN))
cat("========================================================\n\n")

timing_b    <- list()
posterior_b <- list()

for (N_obs in N_DATA_GRID) {

  dat     <- generate_data(N_obs)
  tmp_csv <- tempfile(fileext = ".csv")
  write.csv(dat, tmp_csv, row.names = FALSE)

  for (model_name in MODELS) {

    # --- FANGS ---
    for (rep in seq_len(N_REPS_FANGS)) {
      cat(sprintf("  [FANGS]  model=%-6s  N=%5d  rep=%d/%d  ... ",
                  model_name, N_obs, rep, N_REPS_FANGS))
      flush.console()

      res <- tryCatch(
        run_fangs(model = model_name, n_samples = N_SAMPLES_FIXED,
                  data_csv = tmp_csv),
        error = function(e) { warning(e$message); NULL }
      )

      if (!is.null(res)) {
        timing_b[[length(timing_b) + 1]] <- data.frame(
          engine         = "fangs",
          model          = model_name,
          N_data         = N_obs,
          n_samples      = N_SAMPLES_FIXED,
          rep            = rep,
          elapsed_s      = unique(as.numeric(res$elapsed_ms), na.rm = TRUE) / 1000,
          elapsed_wall_s = unique(res$elapsed_wall_s),
          stringsAsFactors = FALSE
        )
        posterior_b[[length(posterior_b) + 1]] <- res
        cat(sprintf("%.2fs\n", unique(res$elapsed_wall_s)))
      } else {
        cat("FAILED\n")
      }
    }

    # --- NIMBLE ---
    if (has_nimble) {
      cat(sprintf("  [NIMBLE] model=%-6s  N=%5d  ... ", model_name, N_obs))
      flush.console()

      nim_fn  <- if (model_name == "linear") run_nimble_linear else run_nimble_mixed
      nim_res <- tryCatch(
        nim_fn(n_samples = N_SAMPLES_FIXED, data_csv = tmp_csv),
        error = function(e) { warning(e$message); NULL }
      )

      if (!is.null(nim_res)) {
        timing_b[[length(timing_b) + 1]] <- data.frame(
          engine            = "nimble",
          model             = model_name,
          N_data            = N_obs,
          n_samples         = N_SAMPLES_FIXED,
          rep               = 1L,
          elapsed_s         = unique(nim_res$elapsed_wall_s),
          elapsed_wall_s    = unique(nim_res$elapsed_total_s),
          stringsAsFactors  = FALSE
        )
        posterior_b[[length(posterior_b) + 1]] <- nim_res
        cat(sprintf("%.2fs (mcmc) + %.2fs (compile)\n",
                    unique(nim_res$elapsed_wall_s),
                    unique(nim_res$elapsed_compile_s)))
      } else {
        cat("FAILED\n")
      }
    }
  }

  unlink(tmp_csv)
}

timing_df_b    <- if (length(timing_b)    > 0) do.call(rbind, timing_b)    else data.frame()
posterior_df_b <- if (length(posterior_b) > 0) do.call(rbind, posterior_b) else data.frame()

# ===========================================================================
# 9.  Save CSVs
# ===========================================================================

paths <- list(
  timing_nsamples  = file.path(OUTPUT_DIR, "benchmark-timing-nsamples.csv"),
  timing_ndata     = file.path(OUTPUT_DIR, "benchmark-timing-ndata.csv"),
  posteriors_nsamples = file.path(OUTPUT_DIR, "benchmark-posteriors-nsamples.csv"),
  posteriors_ndata    = file.path(OUTPUT_DIR, "benchmark-posteriors-ndata.csv")
)

save_csv <- function(df, path) {
  if (is.data.frame(df) && nrow(df) > 0) {
    write.csv(df, path, row.names = FALSE)
    cat("  Saved:", path, "\n")
  }
}

cat("\n--- Saving CSVs ---\n")
save_csv(timing_df_a,    paths$timing_nsamples)
save_csv(timing_df_b,    paths$timing_ndata)
save_csv(posterior_df_a, paths$posteriors_nsamples)
save_csv(posterior_df_b, paths$posteriors_ndata)

# ===========================================================================
# 10. Plots
# ===========================================================================

# ---------------------------------------------------------------------------
# Helper: aggregate timing to mean across reps
# ---------------------------------------------------------------------------
agg_timing <- function(df) {
  if (!is.data.frame(df) || nrow(df) == 0) return(df)
  aggregate(
    cbind(elapsed_s, elapsed_wall_s) ~ engine + model + N_data + n_samples,
    data = df, FUN = mean
  )
}

# ---------------------------------------------------------------------------
# ggplot2 plots
# ---------------------------------------------------------------------------
if (has_ggplot2) {
  library(ggplot2)

  engine_colours <- c("fangs" = "#2171b5", "nimble" = "#d73027")
  model_ltypes   <- c("linear" = "solid",  "mixed"  = "dashed")

  # Plot A: n_samples vs time
  if (is.data.frame(timing_df_a) && nrow(timing_df_a) > 0) {
    agg_a <- agg_timing(timing_df_a)
    p_a <- ggplot(agg_a,
                  aes(x = n_samples, y = elapsed_s,
                      colour = engine, linetype = model, shape = model)) +
      geom_line(linewidth = 0.9) +
      geom_point(size = 2.5) +
      scale_x_log10(
        breaks = N_SAMPLES_GRID,
        labels = scales::comma_format()
      ) +
      scale_y_log10(labels = scales::comma_format(suffix = "s")) +
      scale_colour_manual(values = engine_colours) +
      scale_linetype_manual(values = model_ltypes) +
      labs(
        title   = "MCMC sample size vs fitting time",
        subtitle = sprintf("N_data = %d  |  chains = %d  |  burn-in = %d",
                            N_DATA_FIXED, N_CHAINS, BURNIN),
        x       = "Post-burn-in samples per chain",
        y       = "Elapsed time (s, log scale)",
        colour  = "Engine",
        linetype = "Model",
        shape    = "Model"
      ) +
      theme_bw(base_size = 12) +
      theme(legend.position = "bottom")

    ggsave(file.path(OUTPUT_DIR, "plot-timing-vs-nsamples.pdf"),
           p_a, width = 7, height = 5)
    cat("  Plot saved: plot-timing-vs-nsamples.pdf\n")
  }

  # Plot B: N_data vs time
  if (is.data.frame(timing_df_b) && nrow(timing_df_b) > 0) {
    agg_b <- agg_timing(timing_df_b)
    p_b <- ggplot(agg_b,
                  aes(x = N_data, y = elapsed_s,
                      colour = engine, linetype = model, shape = model)) +
      geom_line(linewidth = 0.9) +
      geom_point(size = 2.5) +
      scale_x_log10(
        breaks = N_DATA_GRID,
        labels = scales::comma_format()
      ) +
      scale_y_log10(labels = scales::comma_format(suffix = "s")) +
      scale_colour_manual(values = engine_colours) +
      scale_linetype_manual(values = model_ltypes) +
      labs(
        title    = "Data size vs fitting time",
        subtitle = sprintf("n_samples = %d  |  chains = %d  |  burn-in = %d",
                            N_SAMPLES_FIXED, N_CHAINS, BURNIN),
        x        = "N (observations)",
        y        = "Elapsed time (s, log scale)",
        colour   = "Engine",
        linetype = "Model",
        shape    = "Model"
      ) +
      theme_bw(base_size = 12) +
      theme(legend.position = "bottom")

    ggsave(file.path(OUTPUT_DIR, "plot-timing-vs-ndata.pdf"),
           p_b, width = 7, height = 5)
    cat("  Plot saved: plot-timing-vs-ndata.pdf\n")
  }

  # Plot C: posterior means vs n_samples (convergence check)
  if (is.data.frame(posterior_df_a) && nrow(posterior_df_a) > 0) {
    pop_params <- c("alpha", "beta", "tau")
    sub <- posterior_df_a[
      posterior_df_a$param %in% pop_params, , drop = FALSE
    ]
    sub$n_samples <- as.numeric(sub$n_samples)

    p_c <- ggplot(sub, aes(x = n_samples, y = mean,
                           colour = engine, fill = engine,
                           ymin = q2_5, ymax = q97_5)) +
      geom_ribbon(alpha = 0.15, colour = NA) +
      geom_line(linewidth = 0.8) +
      facet_grid(param ~ model, scales = "free_y") +
      scale_x_log10(labels = scales::comma_format()) +
      scale_colour_manual(values = engine_colours) +
      scale_fill_manual(values = engine_colours) +
      labs(
        title    = "Posterior means & 95% CIs vs MCMC sample size",
        x        = "Post-burn-in samples per chain",
        y        = "Posterior estimate",
        colour   = "Engine",
        fill     = "Engine"
      ) +
      theme_bw(base_size = 11) +
      theme(legend.position = "bottom")

    ggsave(file.path(OUTPUT_DIR, "plot-posteriors-vs-nsamples.pdf"),
           p_c, width = 9, height = 7)
    cat("  Plot saved: plot-posteriors-vs-nsamples.pdf\n")
  }

} else {
  # ---------------------------------------------------------------------------
  # Base-R fallback plots
  # ---------------------------------------------------------------------------

  make_base_plot <- function(agg_df, x_col, title, xlab, filename) {
    if (!is.data.frame(agg_df) || nrow(agg_df) == 0) return(invisible(NULL))

    pdf(file.path(OUTPUT_DIR, filename))
    engines <- unique(agg_df$engine)
    models  <- unique(agg_df$model)
    cols    <- c("fangs" = "steelblue", "nimble" = "tomato3")
    ltys    <- c("linear" = 1L, "mixed" = 2L)
    pchs    <- c("linear" = 16L, "mixed" = 17L)

    x_range <- range(agg_df[[x_col]])
    y_range <- range(agg_df$elapsed_s[agg_df$elapsed_s > 0], na.rm = TRUE)

    plot(NA,
         xlim = x_range, ylim = y_range,
         log  = "xy",
         xlab = xlab, ylab = "Elapsed time (s)",
         main = title)
    grid(equilogs = FALSE)

    for (eng in engines) {
      for (mod in models) {
        sub <- agg_df[agg_df$engine == eng & agg_df$model == mod, ]
        if (nrow(sub) == 0) next
        sub <- sub[order(sub[[x_col]]), ]
        lines(sub[[x_col]], sub$elapsed_s,
              col = cols[eng], lty = ltys[mod], lwd = 2)
        points(sub[[x_col]], sub$elapsed_s,
               col = cols[eng], pch = pchs[mod])
      }
    }

    legend_labels <- as.vector(outer(engines, models, paste))
    legend_cols   <- as.vector(outer(cols[engines], rep(1, length(models)), "*"))
    legend_ltys   <- as.vector(outer(rep(1, length(engines)), ltys[models], "*"))
    legend("topleft",
           legend = legend_labels, col = legend_cols,
           lty = legend_ltys, lwd = 2, bty = "n")

    dev.off()
    cat("  Plot saved:", filename, "\n")
  }

  make_base_plot(agg_timing(timing_df_a), "n_samples",
                 "MCMC sample size vs fitting time",
                 "Post-burn-in samples per chain",
                 "plot-timing-vs-nsamples.pdf")

  make_base_plot(agg_timing(timing_df_b), "N_data",
                 "Data size vs fitting time",
                 "N (observations)",
                 "plot-timing-vs-ndata.pdf")
}

# ===========================================================================
# 11. Summary table
# ===========================================================================

cat("\n--- Timing summary (mean across reps) ---\n")

if (is.data.frame(timing_df_a) && nrow(timing_df_a) > 0) {
  cat("\n[A] n_samples sweep (N_data =", N_DATA_FIXED, "):\n")
  agg <- agg_timing(timing_df_a)
  print(agg[order(agg$model, agg$engine, agg$n_samples),
             c("engine", "model", "n_samples", "elapsed_s")],
        row.names = FALSE, digits = 3)
}

if (is.data.frame(timing_df_b) && nrow(timing_df_b) > 0) {
  cat("\n[B] N_data sweep (n_samples =", N_SAMPLES_FIXED, "):\n")
  agg <- agg_timing(timing_df_b)
  print(agg[order(agg$model, agg$engine, agg$N_data),
             c("engine", "model", "N_data", "elapsed_s")],
        row.names = FALSE, digits = 3)
}

cat("\n=== Benchmark complete ===\n")
cat("Results directory:", OUTPUT_DIR, "\n")
cat("CSV files:\n")
for (nm in names(paths)) cat("  ", paths[[nm]], "\n")
