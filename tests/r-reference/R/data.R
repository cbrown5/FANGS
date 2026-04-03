# R/data.R — data loading and generation helpers for FANGS reference scripts

#' Walk up from this script's location looking for package.json (project root)
find_project_root <- function() {
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
    "  Rscript tests/r-reference/<script>.R"
  )
}

#' Find data/example.csv, searching relative to a given script directory
#'
#' @param script_dir  Directory of the calling script (use dirname of sys.frame)
find_example_csv <- function(script_dir = getwd()) {
  candidates <- c(
    file.path(script_dir, "..", "..", "data", "example.csv"),
    file.path(getwd(), "data", "example.csv"),
    "data/example.csv"
  )
  for (p in candidates) {
    if (file.exists(p)) return(normalizePath(p))
  }
  stop("Cannot find data/example.csv. Run this script from the project root.")
}

#' Generate a synthetic data frame with the same DGP as data/example.csv
#'
#' DGP:  y_i       = 2 + 1.5*x_i + b[group_i] + eps_i
#'         b_j      ~ N(0, 0.5^2)      j = 1..5
#'         eps      ~ N(0, 0.7^2)
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
