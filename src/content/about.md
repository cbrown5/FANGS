# About FANGS

FANGS (**Fast Accessible Numeric Gibbs Sampler**) is a browser-based Bayesian inference tool designed for teaching mixed-effects models. It requires no software installation — everything runs client-side in your browser using JavaScript.

## Features

- Component-wise Gibbs sampler with conjugate updates where possible
- Slice sampler fallback for non-conjugate full conditionals
- Support for linear models, GLMs (Poisson, Binomial/Bernoulli), and mixed-effects models
- BUGS/JAGS model syntax (compatible with NIMBLE)
- Live trace plots, posterior densities, and posterior predictive checks
- Educational pop-up system with explanations of MCMC concepts
- Parallel chains using Web Workers for faster sampling
- Export posterior samples as CSV

## Design philosophy

FANGS is designed as a teaching tool. The goal is to give students hands-on experience with Bayesian inference and MCMC without requiring any software installation or programming knowledge. The BUGS/JAGS syntax is widely used in Bayesian statistics courses, and models written for FANGS are directly transferable to NIMBLE or JAGS for production use.

## Technical details

The sampler is implemented entirely in JavaScript and runs in the browser. Each MCMC chain runs in a separate Web Worker for true parallelism. The parser accepts standard BUGS/JAGS syntax and automatically detects conjugate relationships to use exact conjugate updates where possible, falling back to slice sampling for non-conjugate nodes.

## Authors & links

Developed by [seascapemodels.org](https://www.seascapemodels.org).

Source code: [github.com/cbrown5/FANGS](https://github.com/cbrown5/FANGS)

## Citation

If you use FANGS in teaching or research, please cite the GitHub repository or the associated paper (forthcoming).

## Statistical references

- Gelman, A., et al. (2013). *Bayesian Data Analysis* (3rd ed.). CRC Press.
- Lunn, D., et al. (2012). *The BUGS Book*. CRC Press.
- de Valpine, P., et al. (2017). Programming with models: writing statistical algorithms for general model structures with NIMBLE. *Journal of Computational and Graphical Statistics*, 26(2), 403–413.
