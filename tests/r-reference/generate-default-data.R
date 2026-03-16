## generate-default-data.R
## Generates the FANGS default dataset and writes it to data/example.csv
## and prints the CSV content for embedding in src/data/default-data.js.
##
## DGP:
##   y_i = 2 + 1.5 * x_i + b_{group[i]} + eps_i
##   b_group ~ N(0, sigma_b^2),  sigma_b = 0.5
##   eps_i   ~ N(0, sigma^2),    sigma   = 0.7
##   N = 50, 5 groups (10 obs each), treatment coded 0/1 (kept as covariate)

set.seed(42)

N       <- 50
J       <- 5
alpha   <- 2
beta    <- 1.5
sigma_b <- 0.5
sigma   <- 0.7

group     <- rep(1:J, each = N / J)
b         <- rnorm(J, 0, sigma_b)
x         <- round(rnorm(N, 0, 1), 4)
eps       <- rnorm(N, 0, sigma)
y         <- round(alpha + beta * x + b[group] + eps, 4)

df <- data.frame(
  id        = 1:N,
  y         = y,
  x         = x,
  group     = group
)

## Write to data/example.csv (run from project root)
out_dir <- file.path(dirname(dirname(dirname(rstudioapi::getActiveDocumentContext()$path))), "data")
if (!dir.exists("data")) dir.create("data", recursive = TRUE)
write.csv(df, "data/example.csv", row.names = FALSE, quote = FALSE)

## Print CSV for embedding in default-data.js
cat(format_csv <- paste(capture.output(write.csv(df, stdout(), row.names = FALSE, quote = FALSE)), collapse = "\n"), "\n")

## Quick sanity check: OLS estimates should be close to true values
fit <- lm(y ~ x, data = df)
cat("\nOLS estimates (simple linear, no group effect):\n")
print(coef(fit))
cat("True: alpha=2, beta=1.5\n")
cat("sigma estimate:", sigma(fit), " (true:", sigma, ")\n")
