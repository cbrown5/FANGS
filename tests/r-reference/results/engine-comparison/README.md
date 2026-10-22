# Engine comparison raw output

Posterior summaries from `tests/bench/fangs-cli.mjs`, 2026-10-22, branch
`claude/jolly-lovelace-snvdm9`. Analysis and interpretation:
`plans/sampler-engine-benchmarks.md`.

Each CSV carries `elapsed_ms` alongside per-parameter mean/sd/quantiles/rhat/ess.

| file | model | engine | settings | data |
|---|---|---|---|---|
| `{linear,mixed,poisson,bernoulli}-standard.csv` | as named | standard | 5000 / 1000 burn-in / 3 chains | `data/example.csv` (N=50, J=5) |
| `{linear,mixed,poisson,bernoulli}-cpu-blocked.csv` | as named | cpu-blocked | 5000 / 1000 burn-in / 3 chains | `data/example.csv` |
| `mixed-standard-long.csv` | mixed | standard | 40000 / 10000 burn-in / 3 chains | `data/example.csv` |
| `scale-500-{standard,cpu-blocked}.csv` | mixed | as named | 2000 / 500 burn-in / 2 chains | simulated N=500, J=20 |
| `scale-5000-{standard,cpu-blocked}.csv` | mixed | as named | 2000 / 500 burn-in / 2 chains | simulated N=5000, J=100 |

`mixed-standard-long.csv` exists to show that the standard engine's apparent
bias at 5000 draws is Monte Carlo error, not a bug: with 8× more draws its
deviations from NIMBLE collapse to the blocked engine's level.

The scaling datasets were simulated with true values alpha=2, beta=1.5,
sigma=0.7, sigma_b=0.5 (seeded by `Math.random`, so not exactly reproducible;
the fitted values in the CSVs are the record).

No GPU rows: the WebGPU backend could not be benchmarked (see the plan doc).
