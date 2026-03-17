# R-hat (Potential Scale Reduction Factor)

**R-hat** (written $\hat{R}$, pronounced "R-hat") is the standard MCMC convergence diagnostic. It compares variation *between* chains to variation *within* chains.

## The idea

If all chains have converged to the same distribution, within-chain variation and between-chain variation should be similar. R-hat measures their ratio.

- **R-hat ≈ 1.00** → chains agree; convergence is likely
- **R-hat > 1.1** → chains disagree; do not trust the results yet
- **R-hat > 1.5** → serious convergence failure

## How it is calculated

R-hat is approximately the square root of the ratio:

```
R-hat ≈ sqrt( (between-chain variance + within-chain variance) / within-chain variance )
```

When chains have fully mixed, this ratio approaches 1.

## What to do if R-hat > 1.1

1. **Run more iterations** — chains may just need more time to mix
2. **Increase burn-in** — discard more early samples
3. **Check trace plots** — look for chains stuck in different regions
4. **Reparameterise** — some models mix better with different parameterisations
5. **Check the model** — identifiability issues cause non-convergence

## Colour coding in the summary table

- **Red** background → R-hat > 1.1 (convergence warning)
- No highlight → R-hat ≤ 1.1 (acceptable)

## Limitations

R-hat requires at least 2 chains. With a single chain it cannot be computed. It also cannot detect multimodality if all chains are stuck in the same mode.
