FANGS R Reference Tests
=======================

These R scripts fit Bayesian models using NIMBLE and save posterior summary
statistics as JSON fixtures.  The FANGS JavaScript sampler is validated by
comparing its output against these reference values.


PREREQUISITES
-------------

Install NIMBLE (which requires R >= 4.0):

    install.packages("nimble")

Optionally install jsonlite for cleaner JSON output:

    install.packages("jsonlite")

NIMBLE requires a C++ compiler (Rtools on Windows, Xcode CLI on macOS,
build-essential on Linux).  See https://r-nimble.org/download for details.


RUNNING THE SCRIPTS
-------------------

Run from the project root directory (FANGS/):

    Rscript tests/r-reference/linear-model.R
    Rscript tests/r-reference/mixed-effects.R

To batch run tests:

    for f in tests/r-reference/*.R; do
      echo "Running $f"
      Rscript "$f"
    done

Each script will:
  1. Read data/example.csv
  2. Compile and run a NIMBLE MCMC (3 chains, 10000 samples, 2000 burn-in)
  3. Write a JSON reference file to tests/r-reference/


SCRIPTS
-------

linear-model.R
    Fits:  y[i] ~ dnorm(mu[i], tau);  mu[i] <- alpha + beta * x[i]
    Priors: alpha, beta ~ dnorm(0, 0.001);  tau ~ dgamma(0.001, 0.001)
    Output: linear-model-reference.json

mixed-effects.R
    Fits:  y[i] ~ dnorm(mu[i], tau);  mu[i] <- alpha + beta * x[i] + b[group[i]]
           b[j] ~ dnorm(0, tau.b)  for j in 1:J
    Priors: alpha, beta ~ dnorm(0, 0.001);  tau, tau.b ~ dgamma(0.001, 0.001)
    Output: mixed-effects-reference.json


JSON OUTPUT FORMAT
------------------

Each JSON file contains one key per monitored parameter, plus a "__meta__"
block.  Parameter entries have the following structure:

    {
      "alpha": {
        "mean":      2.034,      // posterior mean
        "sd":        0.118,      // posterior standard deviation
        "q2_5":      1.802,      // 2.5th percentile  (lower 95% CI bound)
        "q25":       1.955,      // 25th percentile
        "q50":       2.033,      // median
        "q75":       2.113,      // 75th percentile
        "q97_5":     2.265,      // 97.5th percentile (upper 95% CI bound)
        "n_eff":     8432,       // approximate effective sample size
        "n_samples": 30000       // total samples across all chains
      },
      ...
      "__meta__": {
        "model":          "simple linear regression",
        "n_chains":       3,
        "n_samples":      10000,
        "burnin":         2000,
        "generated":      "2024-01-01T00:00:00",
        "nimble_version": "1.2.1",
        "data_file":      "data/example.csv",
        "N":              50,
        "true_dgp":       { "alpha": 2.0, "beta": 1.5, "sigma": 0.7 }
      }
    }

NOTE: dnorm in BUGS/JAGS/NIMBLE parameterises the Normal distribution using
precision (tau = 1/sigma^2), not standard deviation.  The posterior for tau
should have a mean around 1/0.7^2 ≈ 2.04 for the simple linear model.


VALIDATION CRITERIA
-------------------

The FANGS JavaScript sampler is considered correct if, for each parameter:
  - The posterior mean is within ~0.2 SD of the NIMBLE reference mean
  - The 95% credible intervals overlap substantially
  - Rhat < 1.1 (multi-chain convergence) and ESS > 400

These thresholds are generous enough to account for Monte Carlo error across
different random seeds while still catching systematic bugs.


DATA GENERATING PROCESS
-----------------------

The example dataset was generated with:
    y_i = 2 + 1.5*x_i + 0.8*treatment_i + b_{group[i]} + eps_i
    b_group ~ N(0, sigma=0.5),  eps ~ N(0, sigma=0.7)
    N=50, 5 groups, treatment coded 0/1

True parameter values (for reference, not used in fitting):
    alpha  ≈ 2.0  (intercept, absorbs group-mean random effects)
    beta   ≈ 1.5  (slope on x)
    sigma  ≈ 0.7  (residual SD, so tau ≈ 2.04)
