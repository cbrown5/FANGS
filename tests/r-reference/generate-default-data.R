## generate-default-data.R
## Generates the FANGS default dataset and writes it to data/example.csv
## and prints the CSV content for embedding in src/data/default-data.js.
##
## DGP (continuous response y):
##   y_i = 2 + 1.5 * x_i + b_{group[i]} + eps_i
##   b_group ~ N(0, sigma_b^2),  sigma_b = 0.5
##   eps_i   ~ N(0, sigma^2),    sigma   = 0.7
##   N = 50, 5 groups (10 obs each)
##
## Additional columns derived from the predictor x (same seed, independent):
##   y_count[i] ~ Poisson(exp(1.0 + 0.5 * x_i))  — for Poisson GLM example
##   y_bin[i]   ~ Bernoulli(plogis(1.5 * x_i))    — for Bernoulli GLM example

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

## Poisson count response: log(lambda_i) = 1.0 + 0.5 * x_i
y_count <- rpois(N, exp(1.0 + 0.5 * x))

## Bernoulli binary response: logit(p_i) = 1.5 * x_i
y_bin <- rbinom(N, 1, plogis(1.5 * x))

df <- data.frame(
  id      = 1:N,
  y       = y,
  x       = x,
  group   = group,
  y_count = y_count,
  y_bin   = y_bin
)

## Write to data/example.csv (run from project root)
if (!dir.exists("data")) dir.create("data", recursive = TRUE)
write.csv(df, "data/example.csv", row.names = FALSE, quote = FALSE)

## Print CSV for embedding in default-data.js
cat(paste(capture.output(write.csv(df, stdout(), row.names = FALSE, quote = FALSE)), collapse = "\n"), "\n")

## Quick sanity checks
fit <- lm(y ~ x, data = df)
cat("\nOLS estimates (simple linear, no group effect):\n")
print(coef(fit))
cat("True: alpha=2, beta=1.5\n")
cat("sigma estimate:", sigma(fit), " (true:", sigma, ")\n")

cat("\nPoisson GLM (true: alpha=1.0, beta=0.5):\n")
fit_pois <- glm(y_count ~ x, family = poisson, data = df)
print(coef(fit_pois))

cat("\nBernoulli GLM (true: alpha=0, beta=1.5):\n")
fit_bern <- glm(y_bin ~ x, family = binomial, data = df)
print(coef(fit_bern))
