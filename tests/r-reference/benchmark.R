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
# 0.  Directories
# ===========================================================================
library(tidyverse)
R_DIR <- file.path("tests", "r-reference", "R")
source(file.path(R_DIR, "utils.R"))
source(file.path(R_DIR, "data.R"))
source(file.path(R_DIR, "nimble-models.R"))

OUTPUT_DIR <- file.path("tests", "r-reference", "results")

DEFAULT_DATA_CSV <- file.path("data", "example.csv")

# ===========================================================================
# 1.  Configuration — edit these to trade speed for thoroughness
# ===========================================================================

# MCMC sample-size grid (post-burn-in samples per chain)
N_SAMPLES_GRID <- c(200, 500, 1000, 2000, 5000)

# Data-size grid (number of observations)
N_DATA_GRID <- c(20, 50, 100)

# Fixed settings used when the other dimension is being varied
N_SAMPLES_FIXED <- 1000 # used for the data-size sweep
N_DATA_FIXED <- 50 # used for the sample-size sweep (= default example.csv)

# Shared MCMC settings
N_CHAINS <- 3
BURNIN <- 500
THIN <- 1

# Models to benchmark
MODELS <- c("linear", "mixed")

# Timing replications per FANGS run (NIMBLE always gets 1 rep due to compile cost)
N_REPS_FANGS <- 3
N_REPS_NIMBLE <- 1

# ===========================================================================
# 2.  Package availability
# ===========================================================================

has_nimble <- requireNamespace("nimble", quietly = TRUE)

if (!has_nimble) {
  message(
    "\n[NOTE] 'nimble' is not installed -- NIMBLE benchmarks will be skipped.\n",
    "       Install with: install.packages('nimble')\n"
  )
}

# ===========================================================================
# 3.  Shared helpers — loaded from R/utils.R, R/data.R, R/nimble-models.R
# ===========================================================================

# ===========================================================================
# 4.  Run FANGS via the Node.js CLI
# ===========================================================================

# ===========================================================================
# 5.  NIMBLE runners — loaded from R/nimble-models.R
#     run_nimble_linear() and run_nimble_mixed() use default args below.
# ===========================================================================

run_nimble_linear_bench <- function(n_samples, data_csv = DEFAULT_DATA_CSV) {
  if (!has_nimble) {
    return(NULL)
  }
  run_nimble_linear(n_samples, N_CHAINS, BURNIN, THIN, data_csv)
}

run_nimble_mixed_bench <- function(n_samples, data_csv = DEFAULT_DATA_CSV) {
  if (!has_nimble) {
    return(NULL)
  }
  run_nimble_mixed(n_samples, N_CHAINS, BURNIN, THIN, data_csv)
}

# ===========================================================================
# 6.  Benchmark sweep A: n_samples vs time  (fixed data = example.csv)
# ===========================================================================

cat("\n========================================================\n")
cat("Benchmark A: MCMC sample size vs fitting time\n")
cat(sprintf("  Models: %s\n", paste(MODELS, collapse = ", ")))
cat(sprintf("  n_samples grid: %s\n", paste(N_SAMPLES_GRID, collapse = ", ")))
cat(sprintf(
  "  N_data (fixed): %d  |  chains: %d  |  burnin: %d\n",
  N_DATA_FIXED,
  N_CHAINS,
  BURNIN
))
cat("========================================================\n\n")

timing_a <- list()
posterior_a <- list()

for (model_name in MODELS) {
  for (ns in N_SAMPLES_GRID) {
    # --- FANGS (multiple reps for stable timing) ---
    for (rep in seq_len(N_REPS_FANGS)) {
      cat(sprintf(
        "  [FANGS]  model=%-6s  n_samples=%5d  rep=%d/%d  ... ",
        model_name,
        ns,
        rep,
        N_REPS_FANGS
      ))
      flush.console()

      res <- tryCatch(
        run_fangs(model = model_name, n_samples = ns),
        error = function(e) {
          warning(e$message)
          NULL
        }
      )

      if (!is.null(res)) {
        timing_a[[length(timing_a) + 1]] <- data.frame(
          engine = "fangs",
          model = model_name,
          N_data = unique(res$N_data),
          n_samples = ns,
          rep = rep,
          elapsed_s = unique(as.numeric(res$elapsed_ms), na.rm = TRUE) / 1000,
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
      cat(sprintf("  [NIMBLE] model=%-6s  n_samples=%5d  ... ", model_name, ns))
      flush.console()

      nim_fn <- if (model_name == "linear") {
        run_nimble_linear_bench
      } else {
        run_nimble_mixed_bench
      }
      nim_res <- tryCatch(
        nim_fn(n_samples = ns),
        error = function(e) {
          warning(e$message)
          NULL
        }
      )

      if (!is.null(nim_res)) {
        timing_a[[length(timing_a) + 1]] <- data.frame(
          engine = "nimble",
          model = model_name,
          N_data = unique(nim_res$N_data),
          n_samples = ns,
          rep = 1L,
          elapsed_s = unique(nim_res$elapsed_wall_s),
          elapsed_wall_s = unique(nim_res$elapsed_total_s),
          stringsAsFactors = FALSE
        )
        posterior_a[[length(posterior_a) + 1]] <- nim_res
        cat(sprintf(
          "%.2fs (mcmc) + %.2fs (compile)\n",
          unique(nim_res$elapsed_wall_s),
          unique(nim_res$elapsed_compile_s)
        ))
      } else {
        cat("FAILED\n")
      }
    }
  }
}

timing_df_a <- if (length(timing_a) > 0) {
  do.call(rbind, timing_a)
} else {
  data.frame()
}
posterior_df_a <- if (length(posterior_a) > 0) {
  bind_rows(posterior_a)
} else {
  data.frame()
}

# ===========================================================================
# 8.  Benchmark sweep B: data size (N) vs time  (fixed n_samples)
# ===========================================================================

cat("\n========================================================\n")
cat("Benchmark B: Data size (N) vs fitting time\n")
cat(sprintf("  Models: %s\n", paste(MODELS, collapse = ", ")))
cat(sprintf("  N_data grid: %s\n", paste(N_DATA_GRID, collapse = ", ")))
cat(sprintf(
  "  n_samples (fixed): %d  |  chains: %d  |  burnin: %d\n",
  N_SAMPLES_FIXED,
  N_CHAINS,
  BURNIN
))
cat("========================================================\n\n")

timing_b <- list()
posterior_b <- list()

for (N_obs in N_DATA_GRID) {
  dat <- generate_data(N_obs)
  tmp_csv <- tempfile(fileext = ".csv")
  write.csv(dat, tmp_csv, row.names = FALSE)

  for (model_name in MODELS) {
    # --- FANGS ---
    for (rep in seq_len(N_REPS_FANGS)) {
      cat(sprintf(
        "  [FANGS]  model=%-6s  N=%5d  rep=%d/%d  ... ",
        model_name,
        N_obs,
        rep,
        N_REPS_FANGS
      ))
      flush.console()

      res <- tryCatch(
        run_fangs(
          model = model_name,
          n_samples = N_SAMPLES_FIXED,
          data_csv = tmp_csv
        ),
        error = function(e) {
          warning(e$message)
          NULL
        }
      )

      if (!is.null(res)) {
        timing_b[[length(timing_b) + 1]] <- data.frame(
          engine = "fangs",
          model = model_name,
          N_data = N_obs,
          n_samples = N_SAMPLES_FIXED,
          rep = rep,
          elapsed_s = unique(as.numeric(res$elapsed_ms), na.rm = TRUE) / 1000,
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

      nim_fn <- if (model_name == "linear") {
        run_nimble_linear_bench
      } else {
        run_nimble_mixed_bench
      }
      nim_res <- tryCatch(
        nim_fn(n_samples = N_SAMPLES_FIXED, data_csv = tmp_csv),
        error = function(e) {
          warning(e$message)
          NULL
        }
      )

      if (!is.null(nim_res)) {
        timing_b[[length(timing_b) + 1]] <- data.frame(
          engine = "nimble",
          model = model_name,
          N_data = N_obs,
          n_samples = N_SAMPLES_FIXED,
          rep = 1L,
          elapsed_s = unique(nim_res$elapsed_wall_s),
          elapsed_wall_s = unique(nim_res$elapsed_total_s),
          stringsAsFactors = FALSE
        )
        posterior_b[[length(posterior_b) + 1]] <- nim_res
        cat(sprintf(
          "%.2fs (mcmc) + %.2fs (compile)\n",
          unique(nim_res$elapsed_wall_s),
          unique(nim_res$elapsed_compile_s)
        ))
      } else {
        cat("FAILED\n")
      }
    }
  }

  unlink(tmp_csv)
}

timing_df_b <- if (length(timing_b) > 0) {
  do.call(rbind, timing_b)
} else {
  data.frame()
}
posterior_df_b <- if (length(posterior_b) > 0) {
  bind_rows(posterior_b)
} else {
  data.frame()
}

# ===========================================================================
# 9.  Save CSVs
# ===========================================================================

paths <- list(
  timing_nsamples = file.path(OUTPUT_DIR, "benchmark-timing-nsamples.csv"),
  timing_ndata = file.path(OUTPUT_DIR, "benchmark-timing-ndata.csv"),
  posteriors_nsamples = file.path(
    OUTPUT_DIR,
    "benchmark-posteriors-nsamples.csv"
  ),
  posteriors_ndata = file.path(OUTPUT_DIR, "benchmark-posteriors-ndata.csv")
)

save_csv <- function(df, path) {
  if (is.data.frame(df) && nrow(df) > 0) {
    write.csv(df, path, row.names = FALSE)
    cat("  Saved:", path, "\n")
  }
}

cat("\n--- Saving CSVs ---\n")
save_csv(timing_df_a, paths$timing_nsamples)
save_csv(timing_df_b, paths$timing_ndata)
save_csv(posterior_df_a, paths$posteriors_nsamples)
save_csv(posterior_df_b, paths$posteriors_ndata)

# ===========================================================================
# 10. Plots
# ===========================================================================

# ---------------------------------------------------------------------------
# Helper: aggregate timing to mean across reps
# ---------------------------------------------------------------------------
agg_timing <- function(df) {
  if (!is.data.frame(df) || nrow(df) == 0) {
    return(df)
  }
  aggregate(
    cbind(elapsed_s, elapsed_wall_s) ~ engine + model + N_data + n_samples,
    data = df,
    FUN = mean
  )
}


engine_colours <- c("fangs" = "#2171b5", "nimble" = "#d73027")
model_ltypes <- c("linear" = "solid", "mixed" = "dashed")

# ---------------------------------------------------------------------------
# Helper: pivot timing data to long format for two-panel plots
#   Panel 1 — "Sampler only":  FANGS excludes Node startup/parse;
#                               NIMBLE excludes C++ compilation
#   Panel 2 — "Total incl. setup": FANGS includes startup/parse (~0.4s);
#                               NIMBLE includes compilation (~14s per call)
# ---------------------------------------------------------------------------
pivot_timing_long <- function(agg) {
  panel1 <- agg
  panel1$time_s <- agg$elapsed_s
  panel1$timing <- "Sampler only\n(NIMBLE excludes compile)"

  panel2 <- agg
  panel2$time_s <- agg$elapsed_wall_s
  panel2$timing <- "Total wall time\n(NIMBLE includes compile)"

  rbind(panel1, panel2)
}

# Plot A: n_samples vs time
if (is.data.frame(timing_df_a) && nrow(timing_df_a) > 0) {
  agg_a <- agg_timing(timing_df_a)
  long_a <- pivot_timing_long(agg_a)

  p_a <- ggplot(
    long_a,
    aes(
      x = n_samples,
      y = time_s,
      colour = engine,
      linetype = model,
      shape = model
    )
  ) +
    geom_line(linewidth = 0.9) +
    geom_point(size = 2.5) +
    facet_wrap(~timing, ncol = 2, scales = "free_y") +
    scale_x_log10(
      breaks = N_SAMPLES_GRID,
      labels = scales::comma_format()
    ) +
    scale_y_log10(labels = scales::comma_format(suffix = "s")) +
    scale_colour_manual(values = engine_colours) +
    scale_linetype_manual(values = model_ltypes) +
    labs(
      title = "MCMC sample size vs fitting time",
      subtitle = sprintf(
        "N_data = %d  |  chains = %d  |  burn-in = %d\nNIMBLE is faster once compiled; FANGS is faster for a quick first run",
        N_DATA_FIXED,
        N_CHAINS,
        BURNIN
      ),
      x = "Post-burn-in samples per chain",
      y = "Elapsed time (s, log scale)",
      colour = "Engine",
      linetype = "Model",
      shape = "Model"
    ) +
    theme_bw(base_size = 12) +
    theme(legend.position = "bottom")
  print(p_a)
  ggsave(
    file.path(OUTPUT_DIR, "plot-timing-vs-nsamples.png"),
    p_a,
    width = 11,
    height = 5
  )
  cat("  Plot saved: plot-timing-vs-nsamples.png\n")
}

# Plot B: N_data vs time
if (is.data.frame(timing_df_b) && nrow(timing_df_b) > 0) {
  agg_b <- agg_timing(timing_df_b)
  long_b <- pivot_timing_long(agg_b)

  p_b <- ggplot(
    long_b,
    aes(
      x = N_data,
      y = time_s,
      colour = engine,
      linetype = model,
      shape = model
    )
  ) +
    geom_line(linewidth = 0.9) +
    geom_point(size = 2.5) +
    facet_wrap(~timing, ncol = 2, scales = "free_y") +
    scale_x_log10(
      breaks = N_DATA_GRID,
      labels = scales::comma_format()
    ) +
    scale_y_log10(labels = scales::comma_format(suffix = "s")) +
    scale_colour_manual(values = engine_colours) +
    scale_linetype_manual(values = model_ltypes) +
    labs(
      title = "Data size vs fitting time",
      subtitle = sprintf(
        "n_samples = %d  |  chains = %d  |  burn-in = %d\nNIMBLE is faster once compiled; FANGS is faster for a quick first run",
        N_SAMPLES_FIXED,
        N_CHAINS,
        BURNIN
      ),
      x = "N (observations)",
      y = "Elapsed time (s, log scale)",
      colour = "Engine",
      linetype = "Model",
      shape = "Model"
    ) +
    theme_bw(base_size = 12) +
    theme(legend.position = "bottom")
  print(p_b)
  ggsave(
    file.path(OUTPUT_DIR, "plot-timing-vs-ndata.png"),
    p_b,
    width = 11,
    height = 5
  )
  cat("  Plot saved: plot-timing-vs-ndata.png\n")
}

# Plot C: posterior means vs n_samples (convergence check)
if (is.data.frame(posterior_df_a) && nrow(posterior_df_a) > 0) {
  pop_params <- c("alpha", "beta", "sigma")
  sub <- posterior_df_a[
    posterior_df_a$param %in% pop_params,
    ,
    drop = FALSE
  ]
  sub$n_samples <- as.numeric(sub$n_samples)
  pd <- position_dodge(width = 0.05)
  p_c <- ggplot(
    sub,
    aes(
      x = n_samples,
      y = mean,
      colour = engine,
      fill = engine,
      ymin = q2_5,
      ymax = q97_5
    )
  ) +
    geom_linerange(alpha = 0.9, position = pd) +
    geom_point(position = pd) +
    facet_grid(param ~ model, scales = "free_y") +
    scale_x_log10(labels = scales::comma_format()) +
    scale_colour_manual(values = engine_colours) +
    scale_fill_manual(values = engine_colours) +
    labs(
      title = "Posterior means & 95% CIs vs MCMC sample size",
      x = "Post-burn-in samples per chain",
      y = "Posterior estimate",
      colour = "Engine",
      fill = "Engine"
    ) +
    theme_bw(base_size = 11) +
    theme(legend.position = "bottom")
  print(p_c)
  ggsave(
    file.path(OUTPUT_DIR, "plot-posteriors-vs-nsamples.png"),
    p_c,
    width = 9,
    height = 7
  )
  cat("  Plot saved: plot-posteriors-vs-nsamples.png\n")
}

# ===========================================================================
# 11. Summary table
# ===========================================================================

cat("\n--- Timing summary (mean across reps) ---\n")

if (is.data.frame(timing_df_a) && nrow(timing_df_a) > 0) {
  cat("\n[A] n_samples sweep (N_data =", N_DATA_FIXED, "):\n")
  agg <- agg_timing(timing_df_a)
  print(
    agg[
      order(agg$model, agg$engine, agg$n_samples),
      c("engine", "model", "n_samples", "elapsed_s")
    ],
    row.names = FALSE,
    digits = 3
  )
}

if (is.data.frame(timing_df_b) && nrow(timing_df_b) > 0) {
  cat("\n[B] N_data sweep (n_samples =", N_SAMPLES_FIXED, "):\n")
  agg <- agg_timing(timing_df_b)
  print(
    agg[
      order(agg$model, agg$engine, agg$N_data),
      c("engine", "model", "N_data", "elapsed_s")
    ],
    row.names = FALSE,
    digits = 3
  )
}

cat("\n=== Benchmark complete ===\n")
cat("Results directory:", OUTPUT_DIR, "\n")
cat("CSV files:\n")
for (nm in names(paths)) {
  cat("  ", paths[[nm]], "\n")
}
