# Simple script that compares one NIMBLE and one FANGS model.

library(tidyverse)
library(nimble)

R_DIR <- "tests/r-reference/R"
source(file.path(R_DIR, "utils.R"))
source(file.path(R_DIR, "data.R"))
source(file.path(R_DIR, "nimble-models.R"))

# Generate data — edit N and seed here to explore different datasets
N <- 50
SEED <- 500
dat <- generate_data(N = N, seed = SEED)
ggplot(dat, aes(x = x, y = y)) + geom_point()
coef(lm(y ~ x, data = dat))

# Save to a temp file so both engines use identical data
tmp_csv <- tempfile(fileext = ".csv")
write.csv(dat, tmp_csv, row.names = FALSE)

nimble_model <- nimbleCode({
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], sd = sigma)
    mu[i] <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, sd = 5)
  beta ~ dnorm(0, sd = 5)
  sigma ~ dunif(0, 100)
})

# FANGS model text uses the same SD parameterisation.
fangs_model_text <- "model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], sigma)
    mu[i] <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 5)
  beta ~ dnorm(0, 5)
  sigma ~ dunif(0, 100)
}"
writeLines(fangs_model_text, "tests/r-reference/nimble-models/linear.bugs")

#
# Fit FANGS model
#
FANGS_ROOT <- find_project_root()
N_CHAINS <- 3
BURNIN <- 500
THIN <- 1

fangs_summary <- run_fangs(
  model = "tests/r-reference/nimble-models/linear.bugs",
  n_samples = 2000,
  data_csv = tmp_csv
)


#
# Fit NIMBLE model
#

model <- nimbleModel(
  nimble_model,
  data = list(y = dat$y, x = dat$x),
  constants = list(N = N),
  inits = list(alpha = 0, beta = 0, sigma = 1)
)

compiled_model <- compileNimble(model)
monitors <- c("alpha", "beta", "sigma")
mcmc_conf <- configureMCMC(model, monitors = monitors)
mcmc <- buildMCMC(mcmc_conf)
compiled_mcmc <- compileNimble(mcmc, project = model)
fit <- runMCMC(
  compiled_mcmc,
  niter = 2000 + BURNIN,
  nburnin = BURNIN,
  thin = THIN,
  nchains = N_CHAINS
)

fitall <- do.call(rbind, fit)

#  compare on
# alpha, beta, sigma.
compare_params <- c("alpha", "beta", "sigma")

#
# Summarise NIMBLE posterior
#
nimble_summary <- do.call(
  rbind,
  lapply(compare_params, function(p) {
    vals <- fitall[, p]
    data.frame(
      engine = "nimble",
      param = p,
      mean = mean(vals),
      sd = sd(vals),
      q2_5 = unname(quantile(vals, 0.025)),
      q50 = unname(quantile(vals, 0.50)),
      q97_5 = unname(quantile(vals, 0.975)),
      stringsAsFactors = FALSE
    )
  })
)

#
# Align FANGS summary to the same columns
#
fangs_summary2 <- fangs_summary[
  fangs_summary$param %in% compare_params,
  c("param", "mean", "sd", "q2_5", "q50", "q97_5")
]
fangs_summary2$engine <- "fangs"
fangs_summary2 <- fangs_summary2[, c(
  "engine",
  "param",
  "mean",
  "sd",
  "q2_5",
  "q50",
  "q97_5"
)]

#
# Side-by-side comparison table
#
combined <- rbind(nimble_summary, fangs_summary2)
combined <- combined[order(combined$param, combined$engine), ]

cat("\n=== NIMBLE vs FANGS posterior summary ===\n")
fmt <- combined
fmt[, c("mean", "sd", "q2_5", "q50", "q97_5")] <-
  lapply(fmt[, c("mean", "sd", "q2_5", "q50", "q97_5")], round, digits = 4)
print(fmt, row.names = FALSE)

#
# Coefficient plot: parameter estimates with 95% CIs
#
engine_colours <- c("fangs" = "#2171b5", "nimble" = "#d73027")

combined$y_offset <- ifelse(combined$engine == "nimble", 0.15, -0.15)
param_levels <- sort(unique(combined$param))
combined$y <- as.numeric(factor(combined$param, levels = param_levels)) +
  combined$y_offset

p <- ggplot(
  combined,
  aes(x = mean, y = y, colour = engine, xmin = q2_5, xmax = q97_5)
) +
  geom_vline(xintercept = 0, linetype = "dashed", colour = "grey60") +
  geom_errorbarh(height = 0.15, linewidth = 0.8) +
  geom_point(size = 3) +
  scale_y_continuous(
    breaks = seq_along(param_levels),
    labels = param_levels
  ) +
  scale_colour_manual(values = engine_colours) +
  labs(
    title = "NIMBLE vs FANGS — posterior estimates with 95% CIs",
    x = "Posterior mean (bars = 95% CI)",
    y = "Parameter",
    colour = "Engine"
  ) +
  theme_bw(base_size = 12) +
  theme(legend.position = "bottom")

print(p)
