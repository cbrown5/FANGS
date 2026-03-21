#!/usr/bin/env Rscript
# compare.R
#
# Reads NIMBLE fixture JSONs (from fixtures/) and FANGS app result CSVs
# (from app-results/) and produces ggplot comparison figures.
#
# Main plot: posterior mean of beta — NIMBLE fixture vs. FANGS app, with
# a 1:1 reference line.  Points are coloured by model type and annotated
# with error bars for 95% credible intervals.
#
# Additional panels compare all shared parameters (alpha, tau, etc.).
#
# Usage:
#   Rscript tests/r-reference/beta-comparison/compare.R
#
# Prerequisites:
#   install.packages(c("ggplot2", "jsonlite", "dplyr", "tidyr", "patchwork"))
#
# Expected file layout:
#   fixtures/   {model}_beta_{tag}_fixture.json   (from generate-fixtures.R)
#   app-results/{model}_beta_{tag}_app.csv        (downloaded from FANGS app)
#
# beta tag encoding:
#   beta = -10 -> n10
#   beta = -5  -> n5
#   beta = 0   -> 0
#   beta = 5   -> 5
#   beta = 10  -> 10

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------

required_pkgs <- c("ggplot2", "jsonlite", "dplyr", "tidyr")
missing_pkgs  <- required_pkgs[!sapply(required_pkgs, requireNamespace, quietly = TRUE)]
if (length(missing_pkgs) > 0) {
  stop(paste("Please install missing packages:\n  install.packages(c(",
             paste(sprintf('"%s"', missing_pkgs), collapse = ", "), "))"))
}

library(ggplot2)
library(jsonlite)
library(dplyr)
library(tidyr)

has_patchwork <- requireNamespace("patchwork", quietly = TRUE)
if (has_patchwork) library(patchwork)

# ---------------------------------------------------------------------------
# 2. Locate directories
# ---------------------------------------------------------------------------

script_file <- tryCatch(
  normalizePath(sys.frame(1)$ofile, mustWork = FALSE),
  error = function(e) NULL
)
script_dir   <- if (!is.null(script_file)) dirname(script_file) else getwd()
fixtures_dir <- file.path(script_dir, "fixtures")
results_dir  <- file.path(script_dir, "app-results")
output_dir   <- script_dir   # plots saved here

# ---------------------------------------------------------------------------
# 3. Helpers
# ---------------------------------------------------------------------------

beta_tag <- function(b) if (b < 0) paste0("n", abs(b)) else as.character(b)

# Decode filename tag back to numeric beta
tag_to_beta <- function(tag) {
  if (startsWith(tag, "n")) -as.numeric(sub("^n", "", tag))
  else as.numeric(tag)
}

# Summarise a vector of posterior samples
summarise_samples <- function(vals) {
  list(
    mean  = mean(vals),
    sd    = sd(vals),
    q2_5  = unname(quantile(vals, 0.025)),
    q50   = unname(quantile(vals, 0.50)),
    q97_5 = unname(quantile(vals, 0.975))
  )
}

# Read one fixture JSON and return a data frame with one row per parameter
read_fixture <- function(path) {
  fix   <- jsonlite::fromJSON(path, simplifyVector = TRUE)
  meta  <- fix[["__meta__"]]
  model_name <- meta$model
  beta_true  <- meta$beta_true

  params <- setdiff(names(fix), "__meta__")
  rows   <- lapply(params, function(p) {
    s <- fix[[p]]
    data.frame(
      source     = "nimble",
      model      = model_name,
      beta_true  = beta_true,
      parameter  = p,
      mean       = s$mean,
      sd         = s$sd,
      q2_5       = s$q2_5,
      q97_5      = s$q97_5,
      stringsAsFactors = FALSE
    )
  })
  do.call(rbind, rows)
}

# Read one app result CSV and return a data frame with one row per parameter
read_app_result <- function(path, model_name, beta_true) {
  samples <- read.csv(path, stringsAsFactors = FALSE)
  params  <- colnames(samples)
  rows    <- lapply(params, function(p) {
    s <- summarise_samples(samples[[p]])
    data.frame(
      source     = "app",
      model      = model_name,
      beta_true  = beta_true,
      parameter  = p,
      mean       = s$mean,
      sd         = s$sd,
      q2_5       = s$q2_5,
      q97_5      = s$q97_5,
      stringsAsFactors = FALSE
    )
  })
  do.call(rbind, rows)
}

# ---------------------------------------------------------------------------
# 4. Discover and load all available data
# ---------------------------------------------------------------------------

model_types <- c("linear", "mixed", "bernoulli", "poisson")
beta_values <- c(-10, -5, 0, 5, 10)

all_rows <- list()

for (m in model_types) {
  for (b in beta_values) {
    tag <- beta_tag(b)

    fix_path <- file.path(fixtures_dir, sprintf("%s_beta_%s_fixture.json", m, tag))
    app_path <- file.path(results_dir,  sprintf("%s_beta_%s_app.csv",     m, tag))

    if (!file.exists(fix_path)) {
      cat(sprintf("Skipping %s beta=%g: fixture not found\n", m, b))
      next
    }

    fix_rows <- tryCatch(read_fixture(fix_path), error = function(e) {
      cat(sprintf("Error reading fixture %s: %s\n", basename(fix_path), e$message))
      NULL
    })
    if (!is.null(fix_rows)) all_rows[[length(all_rows) + 1]] <- fix_rows

    if (!file.exists(app_path)) {
      cat(sprintf("App result not yet available: %s\n", basename(app_path)))
      next
    }

    app_rows <- tryCatch(read_app_result(app_path, m, b), error = function(e) {
      cat(sprintf("Error reading app result %s: %s\n", basename(app_path), e$message))
      NULL
    })
    if (!is.null(app_rows)) all_rows[[length(all_rows) + 1]] <- app_rows
  }
}

if (length(all_rows) == 0) {
  stop("No data found. Run generate-fixtures.R first, then provide app-results CSVs.")
}

df <- do.call(rbind, all_rows)

# How many app results did we load?
n_app_results <- sum(df$source == "app")
cat(sprintf("\nLoaded %d fixture rows and %d app result rows\n",
    sum(df$source == "nimble"), n_app_results))

if (n_app_results == 0) {
  message("\nNo app results found yet. Plots will show fixtures only.\n",
          "Run the app for each dataset, download results, and save as:\n",
          "  app-results/{model}_beta_{tag}_app.csv\n",
          "Then re-run this script.")
}

# ---------------------------------------------------------------------------
# 5. Reshape for comparison: join nimble and app on (model, beta_true, parameter)
# ---------------------------------------------------------------------------

compare_df <- df %>%
  pivot_wider(
    id_cols      = c(model, beta_true, parameter),
    names_from   = source,
    values_from  = c(mean, sd, q2_5, q97_5),
    names_glue   = "{source}_{.value}"
  ) %>%
  filter(!is.na(nimble_mean)) %>%
  mutate(
    model = factor(model, levels = c("linear", "mixed", "bernoulli", "poisson"))
  )

# ---------------------------------------------------------------------------
# 6. Plot 1 — Main: beta posterior means, NIMBLE vs App (1:1 line)
# ---------------------------------------------------------------------------

beta_df <- compare_df %>% filter(parameter == "beta")

# Axis limits that include both sources plus room for error bars
all_beta_vals <- with(beta_df, c(nimble_mean, app_mean,
                                  nimble_q2_5, nimble_q97_5,
                                  app_q2_5, app_q97_5))
axis_lim <- range(all_beta_vals[is.finite(all_beta_vals)], na.rm = TRUE)
pad      <- diff(axis_lim) * 0.06
axis_lim <- axis_lim + c(-pad, pad)

p_main <- ggplot(beta_df, aes(x = nimble_mean, y = app_mean, colour = model)) +
  # 1:1 reference line
  geom_abline(slope = 1, intercept = 0, colour = "grey50", linetype = "dashed",
              linewidth = 0.7) +
  # Nimble 95% CI (horizontal error bars)
  geom_errorbarh(aes(xmin = nimble_q2_5, xmax = nimble_q97_5),
                 height = 0, alpha = 0.4, linewidth = 0.6) +
  # App 95% CI (vertical error bars)
  geom_errorbar(aes(ymin = app_q2_5, ymax = app_q97_5),
                width = 0, alpha = 0.4, linewidth = 0.6) +
  # Points
  geom_point(size = 3, shape = 21, fill = "white", stroke = 1.2) +
  # True beta labels
  geom_text(aes(label = beta_true), nudge_x = diff(axis_lim) * 0.03,
            size = 2.8, colour = "grey40", show.legend = FALSE) +
  scale_colour_brewer(palette = "Set1", name = "Model type") +
  coord_fixed(xlim = axis_lim, ylim = axis_lim) +
  labs(
    title    = "Beta posterior means: NIMBLE vs. FANGS app",
    subtitle = "Error bars = 95% credible intervals  |  Dashed line = 1:1",
    x        = "NIMBLE posterior mean (beta)",
    y        = "FANGS app posterior mean (beta)"
  ) +
  theme_bw(base_size = 12) +
  theme(
    legend.position  = "bottom",
    panel.grid.minor = element_blank()
  )

# If no app data yet, show fixture values only (diagonal expectation)
if (n_app_results == 0 || all(is.na(beta_df$app_mean))) {
  p_main <- ggplot(beta_df, aes(x = nimble_mean, y = nimble_mean, colour = model)) +
    geom_abline(slope = 1, intercept = 0, colour = "grey50", linetype = "dashed",
                linewidth = 0.7) +
    geom_errorbarh(aes(xmin = nimble_q2_5, xmax = nimble_q97_5),
                   height = 0.3, alpha = 0.5, linewidth = 0.6) +
    geom_point(size = 3, shape = 21, fill = "white", stroke = 1.2) +
    geom_text(aes(label = beta_true), nudge_x = diff(axis_lim) * 0.03,
              size = 2.8, colour = "grey40", show.legend = FALSE) +
    scale_colour_brewer(palette = "Set1", name = "Model type") +
    coord_fixed(xlim = axis_lim, ylim = axis_lim) +
    labs(
      title    = "Beta posterior means: NIMBLE fixtures (app results not yet available)",
      subtitle = "Horizontal error bars = 95% CI  |  Run app + save results to app-results/",
      x        = "NIMBLE posterior mean (beta)",
      y        = "NIMBLE posterior mean (beta) [placeholder for app]"
    ) +
    theme_bw(base_size = 12) +
    theme(legend.position = "bottom", panel.grid.minor = element_blank())
}

# ---------------------------------------------------------------------------
# 7. Plot 2 — Beta comparison faceted by model type
# ---------------------------------------------------------------------------

p_facet <- ggplot(beta_df, aes(x = nimble_mean, y = app_mean, colour = model)) +
  geom_abline(slope = 1, intercept = 0, colour = "grey50", linetype = "dashed") +
  geom_errorbarh(aes(xmin = nimble_q2_5, xmax = nimble_q97_5),
                 height = 0, alpha = 0.5, linewidth = 0.6) +
  geom_errorbar(aes(ymin = app_q2_5, ymax = app_q97_5),
                width = 0, alpha = 0.5, linewidth = 0.6) +
  geom_point(size = 2.5, shape = 21, fill = "white", stroke = 1.1) +
  geom_text(aes(label = beta_true), size = 2.5, nudge_y = 0.4,
            colour = "grey30", show.legend = FALSE) +
  facet_wrap(~model, scales = "free", ncol = 2) +
  scale_colour_brewer(palette = "Set1", guide = "none") +
  labs(
    title    = "Beta estimates by model type",
    subtitle = "NIMBLE vs. FANGS app  |  Dashed line = 1:1",
    x        = "NIMBLE posterior mean",
    y        = "App posterior mean"
  ) +
  theme_bw(base_size = 11) +
  theme(panel.grid.minor = element_blank())

# ---------------------------------------------------------------------------
# 8. Plot 3 — All parameters: posterior mean NIMBLE vs App
# ---------------------------------------------------------------------------

# Only include parameters that have both nimble and app values
all_param_df <- compare_df %>%
  filter(!is.na(nimble_mean), !is.na(app_mean)) %>%
  # Shorten long random-effect labels for display
  mutate(
    param_short = sub("^b\\[([0-9]+)\\]$", "b[j]", parameter),
    # Focus on key parameters; random effects are pooled to one label
    is_random   = grepl("^b\\[", parameter)
  )

if (nrow(all_param_df) > 0) {
  lim_all  <- range(c(all_param_df$nimble_mean, all_param_df$app_mean), na.rm = TRUE)
  pad_all  <- diff(lim_all) * 0.06
  lim_all  <- lim_all + c(-pad_all, pad_all)

  p_all <- ggplot(all_param_df,
                  aes(x = nimble_mean, y = app_mean,
                      colour = model, shape = param_short)) +
    geom_abline(slope = 1, intercept = 0, colour = "grey50", linetype = "dashed",
                linewidth = 0.7) +
    geom_point(size = 2.5, alpha = 0.8) +
    scale_colour_brewer(palette = "Set1", name = "Model") +
    scale_shape_manual(
      name   = "Parameter",
      values = setNames(
        (15:(15 + length(unique(all_param_df$param_short)) - 1)) %% 25,
        sort(unique(all_param_df$param_short))
      )
    ) +
    coord_fixed(xlim = lim_all, ylim = lim_all) +
    labs(
      title    = "All parameters: NIMBLE vs. FANGS app",
      subtitle = "Each point is one parameter from one dataset",
      x        = "NIMBLE posterior mean",
      y        = "App posterior mean"
    ) +
    theme_bw(base_size = 11) +
    theme(legend.position = "right", panel.grid.minor = element_blank())
} else {
  p_all <- ggplot() +
    annotate("text", x = 0.5, y = 0.5, size = 5, colour = "grey50",
             label = "No matched app results yet") +
    theme_void() +
    labs(title = "All parameters: NIMBLE vs. FANGS app")
}

# ---------------------------------------------------------------------------
# 9. Plot 4 — Posterior SD comparison for beta (uncertainty calibration)
# ---------------------------------------------------------------------------

beta_sd_df <- compare_df %>%
  filter(parameter == "beta", !is.na(nimble_sd), !is.na(app_sd))

if (nrow(beta_sd_df) > 0) {
  lim_sd  <- range(c(beta_sd_df$nimble_sd, beta_sd_df$app_sd), na.rm = TRUE)
  pad_sd  <- diff(lim_sd) * 0.1
  lim_sd  <- lim_sd + c(-pad_sd, pad_sd)

  p_sd <- ggplot(beta_sd_df, aes(x = nimble_sd, y = app_sd, colour = model)) +
    geom_abline(slope = 1, intercept = 0, colour = "grey50", linetype = "dashed") +
    geom_point(size = 3, shape = 21, fill = "white", stroke = 1.2) +
    geom_text(aes(label = beta_true), nudge_x = diff(lim_sd) * 0.04,
              size = 2.8, colour = "grey40", show.legend = FALSE) +
    scale_colour_brewer(palette = "Set1", name = "Model") +
    coord_fixed(xlim = lim_sd, ylim = lim_sd) +
    labs(
      title    = "Beta posterior SD: NIMBLE vs. FANGS app",
      subtitle = "Uncertainty calibration check",
      x        = "NIMBLE posterior SD",
      y        = "App posterior SD"
    ) +
    theme_bw(base_size = 11) +
    theme(legend.position = "bottom", panel.grid.minor = element_blank())
} else {
  p_sd <- ggplot() +
    annotate("text", x = 0.5, y = 0.5, size = 5, colour = "grey50",
             label = "No matched app results yet") +
    theme_void() +
    labs(title = "Beta posterior SD: NIMBLE vs. app")
}

# ---------------------------------------------------------------------------
# 10. Assemble and save
# ---------------------------------------------------------------------------

# Main standalone plot
out_main <- file.path(output_dir, "beta_comparison_main.pdf")
ggsave(out_main, plot = p_main, width = 7, height = 6.5, device = "pdf")
cat(sprintf("Saved: %s\n", out_main))

# Faceted beta plot
out_facet <- file.path(output_dir, "beta_comparison_facets.pdf")
ggsave(out_facet, plot = p_facet, width = 8, height = 7, device = "pdf")
cat(sprintf("Saved: %s\n", out_facet))

# Combined panel (patchwork if available, otherwise individual files)
if (has_patchwork) {
  combined <- (p_main + p_sd) / (p_facet + p_all) +
    plot_annotation(
      title   = "FANGS vs. NIMBLE posterior comparison",
      subtitle = sprintf("Beta values: %s  |  Model types: %s",
                         paste(beta_values, collapse = ", "),
                         paste(model_types, collapse = ", ")),
      theme   = theme(plot.title = element_text(size = 14, face = "bold"))
    )
  out_combined <- file.path(output_dir, "beta_comparison_combined.pdf")
  ggsave(out_combined, plot = combined, width = 14, height = 13, device = "pdf")
  cat(sprintf("Saved: %s\n", out_combined))
} else {
  ggsave(file.path(output_dir, "all_params_comparison.pdf"),
         plot = p_all,  width = 8, height = 6, device = "pdf")
  ggsave(file.path(output_dir, "beta_sd_comparison.pdf"),
         plot = p_sd,   width = 6, height = 5.5, device = "pdf")
  cat("(Install 'patchwork' for combined panel output)\n")
}

# ---------------------------------------------------------------------------
# 11. Print summary table
# ---------------------------------------------------------------------------

cat("\n=====================================================\n")
cat("Summary: NIMBLE vs App — beta posterior mean\n")
cat("=====================================================\n")

if (nrow(beta_df) > 0 && !all(is.na(beta_df$app_mean))) {
  summary_tbl <- beta_df %>%
    filter(!is.na(app_mean)) %>%
    mutate(
      bias        = app_mean - nimble_mean,
      bias_in_sd  = bias / nimble_sd,
      ci_overlap  = (app_q2_5  <= nimble_q97_5) & (app_q97_5 >= nimble_q2_5)
    ) %>%
    select(model, beta_true, nimble_mean, app_mean, bias, bias_in_sd, ci_overlap)

  print(as.data.frame(summary_tbl), digits = 3, row.names = FALSE)

  cat(sprintf("\nOverall: %d/%d CIs overlap\n",
      sum(summary_tbl$ci_overlap), nrow(summary_tbl)))
  cat(sprintf("Mean |bias| in posterior SDs: %.3f\n",
      mean(abs(summary_tbl$bias_in_sd), na.rm = TRUE)))
} else {
  cat("No app results available yet — run app and provide CSVs to app-results/\n")
}

cat("=====================================================\n")
