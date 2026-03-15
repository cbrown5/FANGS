# Thinning

**Thinning** means keeping only every *k*-th sample from the MCMC chain and discarding the rest.

## Why thin?

MCMC samples are **correlated** — consecutive samples are similar because each is derived from the previous. Thinning reduces this autocorrelation so that the kept samples are closer to being independent.

## Example

With thinning = 10 and 2000 samples, only every 10th iteration is kept, giving 200 stored samples from 2000 iterations.

## Is thinning necessary?

**Usually not.** Modern consensus is that thinning wastes information — it is almost always better to keep all samples and accept some correlation. The effective sample size (ESS) already accounts for autocorrelation when summarising uncertainty.

Thinning is mainly useful when:
- **Memory is limited** and you cannot store millions of samples
- **Posterior predictive checks** require expensive computations per sample

## Thinning does not fix poor mixing

If chains mix poorly (high autocorrelation, R-hat > 1.1), thinning makes the stored samples less correlated but does not improve the underlying chain quality. Fix the chain first — run more iterations or reparameterise the model.

## Default

A thinning interval of **1** (no thinning) is the standard recommendation.
