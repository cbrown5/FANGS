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
