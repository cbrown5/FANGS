# R/utils.R — shared statistical utilities for FANGS reference scripts

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

#' Full posterior summary list for a single parameter (used in JSON fixtures)
summarize_param <- function(vals) {
  list(
    mean      = unname(mean(vals)),
    sd        = unname(sd(vals)),
    q2_5      = unname(quantile(vals, 0.025)),
    q25       = unname(quantile(vals, 0.25)),
    q50       = unname(quantile(vals, 0.50)),
    q75       = unname(quantile(vals, 0.75)),
    q97_5     = unname(quantile(vals, 0.975)),
    n_eff     = effective_size(vals),
    n_samples = length(vals)
  )
}

#' Minimal JSON serialiser — fallback when jsonlite is not installed
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

#' Write a list as JSON, using jsonlite if available else to_json_manual
write_json_fixture <- function(obj, path) {
  has_jsonlite <- requireNamespace("jsonlite", quietly = TRUE)
  if (!dir.exists(dirname(path))) dir.create(dirname(path), recursive = TRUE)
  if (has_jsonlite) {
    json_str <- jsonlite::toJSON(obj, pretty = TRUE, auto_unbox = TRUE)
  } else {
    json_str <- to_json_manual(obj)
  }
  writeLines(json_str, path)
  cat(sprintf("Reference JSON written to: %s\n", normalizePath(path)))
}

#' Run the FANGS Gibbs sampler and return raw posterior samples
#'
#' @param model       Model name ("linear", "mixed", "poisson", "bernoulli"),
#'                    path to a .bugs/.txt model file, or a multi-line model
#'                    string starting with "model {".
#' @param n_samples   Post-burn-in samples per chain
#' @param n_chains    Number of parallel chains
#' @param burnin      Burn-in iterations (discarded)
#' @param thin        Thinning interval
#' @param data_csv    Path to the input data CSV
#' @return  data.frame with columns chain, iteration, <param1>, <param2>, ...
#'          or NULL on failure
run_fangs_samples <- function(
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

  # If model is an inline string (starts with "model {"), write to a temp file
  model_tmp <- NULL
  if (grepl("^\\s*model\\s*\\{", model)) {
    model_tmp <- tempfile(fileext = ".bugs")
    writeLines(model, model_tmp)
    on.exit(unlink(model_tmp), add = TRUE)
    model <- model_tmp
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
    "--output",      out_csv,
    "--raw-samples"
  )

  stderr_tmp <- tempfile()
  on.exit(unlink(stderr_tmp), add = TRUE)

  system2("node", args = args, stdout = TRUE, stderr = stderr_tmp)

  if (!file.exists(out_csv) || file.info(out_csv)$size == 0) {
    warning(sprintf(
      "FANGS CLI returned no output for model=%s n_samples=%d\n",
      model, n_samples
    ))
    return(NULL)
  }

  read.csv(out_csv, stringsAsFactors = FALSE)
}

#' Run the FANGS Gibbs sampler via the Node.js CLI and return results
#'
#' @param model       Model name ("linear", "mixed", "poisson", "bernoulli"),
#'                    path to a .bugs/.txt model file, or a multi-line model
#'                    string starting with "model {".
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

  # If model is an inline string (starts with "model {"), write to a temp file
  model_tmp <- NULL
  if (grepl("^\\s*model\\s*\\{", model)) {
    model_tmp <- tempfile(fileext = ".bugs")
    writeLines(model, model_tmp)
    on.exit(unlink(model_tmp), add = TRUE)
    model <- model_tmp
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