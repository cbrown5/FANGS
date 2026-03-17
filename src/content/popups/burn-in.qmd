# Burn-in

**Burn-in** (also called *warm-up*) refers to the early iterations of an MCMC chain that are discarded before analysis.

## Why discard early samples?

MCMC chains start at an arbitrary initial value — typically an overdispersed draw from the prior. It takes some number of iterations for the chain to "forget" where it started and settle into sampling the posterior properly.

The early samples are influenced by the starting point rather than the posterior, so they are biased and should not be included in your posterior summaries.

## Visualising burn-in

In the trace plot, you will often see an initial period where the chain drifts or jumps before stabilising. The burn-in period covers these early iterations.

## How many to discard?

- A common default is **25–50% of total samples** (e.g., 500 out of 2000)
- For well-specified models with good initialisations, burn-in can be short
- For complex or poorly-conditioned models, you may need much more

## Checking whether burn-in was enough

- Trace plots should show no visible trend after burn-in
- R-hat values close to 1.0 suggest the post-burn-in samples are reliable
- If R-hat > 1.1, consider increasing both burn-in and total samples

## Terminology note

Some software (e.g. Stan) uses the term *warm-up* rather than *burn-in*. They mean the same thing.
