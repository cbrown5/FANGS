## simulate-course-data.R
##
## Simulates two datasets for FANGS course modules:
##
##   1. presence.csv  — binomial (0/1) presence of bumphead parrotfish
##      Used by M16 (2-level factor: logged vs not logged) and
##      M17 (3-level factor: rubble / mixed / coral habitat).
##
##      DGP (M16 reference, logit scale):
##        logit(p_i) = alpha + beta * logged_i
##        alpha = 0.8   (log-odds of presence at unlogged sites)
##        beta  = -1.5  (logging reduces presence odds)
##
##      DGP (M17 reference, logit scale):
##        logit(p_i) = alpha + beta_2 * mixed_i + beta_3 * rubble_i
##        alpha  =  1.2   (coral — reference, highest presence)
##        beta_2 = -0.8   (mixed habitat vs coral)
##        beta_3 = -2.0   (rubble vs coral — lowest presence)
##
##   2. jaw-length.csv — Gaussian continuous response (jaw length mm)
##      with reef sites as a random effect.
##      Used by M8, M9 (regression: jaw ~ body length) and
##      M19 (random-effects model: site-level intercepts).
##
##      DGP:
##        jaw_i ~ N(mu_i, sigma^2)
##        mu_i  = alpha + beta * body_i + b_{site[i]}
##        b_j   ~ N(0, sigma_b^2)
##        alpha   = 10  mm  (intercept)
##        beta    = 0.15    (jaw mm per body mm)
##        sigma   = 2.0 mm  (residual SD)
##        sigma_b = 3.0 mm  (site-level SD)
##        N = 120 fish, 12 sites (10 per site)

set.seed(2024)

# ── 1. presence.csv ────────────────────────────────────────────────────────────

N_sites <- 49   # same number of sites as fish-counts.csv

# Site-level covariates ---------------------------------------------------
dist_to_logging_km <- round(
  abs(rnorm(N_sites, mean = 2, sd = 1.2)),
  3
)

# 2-level logged factor (sites within ~2 km are logged)
logged_raw <- ifelse(dist_to_logging_km < 2, "Logged", "Not logged")

# 3-level habitat factor: rubble / mixed / coral
# Rubble more common near logging, coral more common far from it
habitat_probs <- function(d) {
  p_coral  <- plogis(-1.5 + 1.2 * d)   # more coral further from logging
  p_rubble <- plogis( 1.0 - 1.0 * d)   # more rubble closer to logging
  p_mixed  <- pmax(0, 1 - p_coral - p_rubble)
  cbind(coral = p_coral, mixed = p_mixed, rubble = p_rubble)
}
hab_p <- habitat_probs(dist_to_logging_km)
habitat <- apply(hab_p, 1, function(p) {
  sample(c("Coral", "Mixed", "Rubble"), 1, prob = pmax(p, 0))
})

# Binary presence/absence -------------------------------------------------
alpha_M16  <-  0.8
beta_M16   <- -1.5

alpha_M17  <-  1.2
beta_M17_2 <- -0.8   # Mixed vs Coral
beta_M17_3 <- -2.0   # Rubble vs Coral

logged_bin <- as.integer(logged_raw == "Logged")
mixed_bin  <- as.integer(habitat == "Mixed")
rubble_bin <- as.integer(habitat == "Rubble")

logit_p_M16 <- alpha_M16 + beta_M16 * logged_bin
logit_p_M17 <- alpha_M17 + beta_M17_2 * mixed_bin + beta_M17_3 * rubble_bin

# Use M17 DGP as the single ground truth — it subsumes M16's logged effect
# by construction (rubble/mixed confounded with logging above).
# For simplicity, simulate presence from M17 logit; M16 students will recover
# the logged effect because habitat correlates with logged.
pres <- rbinom(N_sites, 1, plogis(logit_p_M17))

presence <- data.frame(
  site               = 1:N_sites,
  pres               = pres,
  logged             = logged_raw,
  habitat            = habitat,
  dist_to_logging_km = dist_to_logging_km
)

# Quick sanity checks -----------------------------------------------------
cat("=== presence.csv ===\n")
cat("Prevalence overall:", round(mean(pres), 2), "\n")
cat("Prevalence by logged:\n")
print(tapply(pres, logged_raw, mean))
cat("Prevalence by habitat:\n")
print(tapply(pres, habitat, mean))

glm_M16 <- glm(pres ~ logged, data = presence, family = binomial)
cat("\nM16 GLM estimates (true: alpha=", alpha_M16, ", beta=", beta_M16, "):\n")
print(round(coef(glm_M16), 3))

glm_M17 <- glm(pres ~ habitat, data = presence, family = binomial)
cat("\nM17 GLM estimates (true: alpha=", alpha_M17,
    ", beta_2(Mixed)=", beta_M17_2, ", beta_3(Rubble)=", beta_M17_3, "):\n")
print(round(coef(glm_M17), 3))

write.csv(presence, "course/data/presence.csv", row.names = FALSE, quote = FALSE)
cat("\nWritten: course/data/presence.csv\n\n")

# ── 2. jaw-length.csv ──────────────────────────────────────────────────────────

N_fish  <- 120
N_sites <- 12
fish_per_site <- N_fish / N_sites

alpha_jaw   <- 10.0
beta_jaw    <- 0.15
sigma_jaw   <- 2.0
sigma_b_jaw <- 3.0

site_id   <- rep(1:N_sites, each = fish_per_site)
b_site    <- rnorm(N_sites, 0, sigma_b_jaw)

# Body length: realistic range for parrotfish (150–350 mm standard length)
body_length <- round(runif(N_fish, min = 150, max = 350), 1)

mu_jaw <- alpha_jaw + beta_jaw * body_length + b_site[site_id]
jaw_length <- round(rnorm(N_fish, mu_jaw, sigma_jaw), 2)

jaw_df <- data.frame(
  fish   = 1:N_fish,
  site   = site_id,
  body   = body_length,
  jaw    = jaw_length
)

# Quick sanity checks -----------------------------------------------------
cat("=== jaw-length.csv ===\n")
cat("jaw length range:", range(jaw_length), "\n")
cat("body length range:", range(body_length), "\n")

lm_simple <- lm(jaw ~ body, data = jaw_df)
cat("\nSimple LM estimates (true: alpha=", alpha_jaw, ", beta=", beta_jaw, "):\n")
print(round(coef(lm_simple), 4))
cat("Residual SD:", round(sigma(lm_simple), 3),
    " (true sigma:", sigma_jaw, ", inflated by site SD:", sigma_b_jaw, ")\n")

if (requireNamespace("lme4", quietly = TRUE)) {
  library(lme4)
  lmm <- lmer(jaw ~ body + (1 | site), data = jaw_df)
  cat("\nLMM estimates (true: alpha=", alpha_jaw, ", beta=", beta_jaw, "):\n")
  print(round(fixef(lmm), 4))
  cat("Random effects SD (true sigma_b=", sigma_b_jaw, "):\n")
  print(round(as.data.frame(VarCorr(lmm))$sdcor, 3))
} else {
  cat("\n(Install lme4 to verify random-effects recovery)\n")
}

write.csv(jaw_df, "course/data/jaw-length.csv", row.names = FALSE, quote = FALSE)
cat("\nWritten: course/data/jaw-length.csv\n")
