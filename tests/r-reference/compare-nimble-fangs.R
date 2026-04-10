# Simple script that compres one NIMBLe and one FANGS model
#note NIMBLE uses the SD parameterization, not precision, so have to convert the tau parameter to sigma for comparison

library(tidyverse)
library(nimble)

R_DIR <- "tests/r-reference/R"
source(file.path(R_DIR, "utils.R"))
source(file.path(R_DIR, "data.R"))
source(file.path(R_DIR, "nimble-models.R"))

# Generate data
N <- 50
dat <- generate_data(N = N, seed = 323)
ggplot(dat, aes(x = x, y = y)) + geom_point()
coef(lm(y ~ x, data = dat))

model <- nimbleCode({
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], tau)
    mu[i] <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.04)
  beta ~ dnorm(0, 0.04)
  tau ~ dgamma(1, 0.1)
})

#convert expression to plain text
model_text <- paste("model", paste(deparse(model), collapse = "\n"))
writeLines(model_text, "tests/r-reference/nimble-models/linear.bugs")

#
# Fit FANGS model
#
FANGS_ROOT <- find_project_root()
DEFAULT_DATA_CSV <- find_example_csv()
N_CHAINS <- 3
BURNIN <- 500
THIN <- 1

fangs_summary <- run_fangs(
  model = "tests/r-reference/nimble-models/linear.bugs",
  n_samples = 2000,
  data_csv = DEFAULT_DATA_CSV
)


#
# Fit NIMBLE model
#

model <- nimbleModel(
  model,
  data = dat,
  constants = list(N = N),
  inits = list(alpha = 0, beta = 0, tau = 1)
)

compiled_model <- compileNimble(model)
monitors <- c("alpha", "beta", "tau")
mcmc_conf <- configureMCMC(model, monitors = monitors)
mcmc <- buildMCMC(mcmc_conf)
compiled_mcmc <- compileNimble(mcmc, project = model)
fit <- runMCMC(
  compiled_mcmc,
  niter = 1000 + BURNIN,
  nburnin = BURNIN,
  thin = THIN,
  nchains = N_CHAINS
)

fitall <- do.call(rbind, fit)

#
# Summarise NIMBLE posterior
#
nimble_summary <- do.call(
  rbind,
  lapply(monitors, function(p) {
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
  fangs_summary$param %in% monitors,
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
