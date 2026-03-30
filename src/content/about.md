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

FANGS is designed as a teaching tool. The goal is to give students hands-on experience with Bayesian inference and MCMC without requiring any software installation or much programming knowledge. The BUGS/JAGS syntax is widely used in Bayesian statistics courses, and models written for FANGS are directly transferable to NIMBLE or JAGS for production use.

## Technical details

The sampler is implemented entirely in JavaScript and runs in the browser. Each MCMC chain runs in a separate Web Worker for true parallelism. The parser accepts standard BUGS/JAGS syntax and automatically detects conjugate relationships to use exact conjugate updates where possible, falling back to slice sampling for non-conjugate nodes.

If you want to use Bayesian modelling in your real research, I recommend checking out [NIMBLE](https://r-nimble.org/), [Stan](https://mc-stan.org/), [INLA](https://www.r-inla.org/), or [brms](https://paul-buerkner.github.io/brms/) (R), or [PyMC](https://www.pymc.io/) (Python) for more powerful and flexible tools. These will be much faster and more accurate than this simple browser tool.

## Authors & links

Developed by [Chris Brown](https://www.seascapemodels.org). The development workflow made heavy use of [Claude Code](https://claude.ai/code). Tests of accuracy of Bayesian inference were made against NIMBLE reference models. For more details on tests and caveats see the source code. 

Source code: [github.com/cbrown5/FANGS](https://github.com/cbrown5/FANGS)

## Citation

If you use FANGS in teaching, please cite the GitHub repository or the associated paper (forthcoming).

## Statistical references

- McElreath, R. (2020). [*Statistical Rethinking: A Bayesian Course with Examples in R and Stan*](https://xcelab.net/rm/statistical-rethinking/) (2nd ed.). CRC Press.
- de Valpine, P., Turek, D., Paciorek, C. J., Anderson-Bergman, C., Temple Lang, D., & Bodik, R. (2017). Programming with models: writing statistical algorithms for general model structures with NIMBLE. *Journal of Computational and Graphical Statistics*, 26(2), 403–413. [doi:10.1080/10618600.2016.1172487](https://doi.org/10.1080/10618600.2016.1172487)
- [NIMBLE documentation](https://r-nimble.org/)
