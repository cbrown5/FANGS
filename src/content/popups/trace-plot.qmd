# Reading Trace Plots

A **trace plot** shows the sampled parameter value at each MCMC iteration, one line per chain. It is the most important diagnostic tool for checking whether your sampler is working.

## What a good trace looks like

A healthy trace plot looks like a "hairy caterpillar" — a dense, horizontal band of noisy variation with no long-term trend.

**Signs of a good chain:**
- Rapidly oscillates up and down (fast mixing)
- All chains overlap each other and cannot be distinguished
- No visible upward or downward drift
- Consistent width throughout

## Warning signs

**Slow mixing (high autocorrelation)**
- The chain moves slowly, producing smooth wave-like patterns
- Consecutive values are very similar
- Fix: run more iterations, reparameterise, or adjust the sampler

**Stuck chains**
- A chain is flat or barely moving for long stretches
- Often indicates a highly constrained parameter or a near-degenerate distribution
- Fix: check the model specification and priors

**Chains not overlapping**
- Different chains are exploring different regions
- The chains have not converged to the same distribution
- Fix: increase burn-in, run longer, or reconsider the model

**Drift / trend**
- The chain has not yet settled — burn-in may be too short
- Fix: increase burn-in

## Vertical axis

The y-axis shows the parameter value on its natural scale. The range reflects the posterior spread — wide traces mean high posterior uncertainty.

## Burn-in

The period before the chain stabilises is the burn-in. It is normal for chains to start far apart and then converge. Only the post-burn-in samples are used for inference.
