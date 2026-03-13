I want you to make a gibbs sampler for fitting bayesian linear and generalized linear models. It will run in the browser. 

## Mission
Make a simple web app for use in teaching bayesian mixed effects models. Features:
- User writes their model in JAGS/NIMBLE syntax
- user uploaded datasets (in .csv form)
- Support common distributions for data and priors
- Handle linear models, generalized linear models (poisson, binomial), and mixed-effects versions of these (ie a nested hierarchical design with random intercepts).
- Be modular so we can extend it later if need be
- Fit models to small datasets models relatively quickly
- Show a comprehensive dashboard for exploring algorithm convergence, posteriors and model fits 

## Tests
Use red/green TFD to test implementation. 
Verify statistical accuracy of our new algorithms by setting up tests in R: example data and R scripts, fitting models with library(nimble) then comparing those results to results obtained with this web app. 

Nimble help files are here: https://r-nimble.org/examples.html
For reference for building gibbs samplers the NIMBLE source code is here: https://github.com/nimble-dev/nimble. But we want an original implementation as we have a new license for this project. 

## Questions to answer in planning stage
What sampler(s) to use? A basic Gibbs is simple. A block sampler may be more efficient for GLMs. I don't want the user to have to learn about different samplers though, and sampler choice should just default to good choiecs. 
Will be be more efficient to write the sampler in C++ and use WASM (faster adds compile time?), or implement it direclty in JS? 
Efficient sampler implementation including how to initialize chains
Rescaling predictors could help improve sampling efficiency. Should we do that in the app, or pop-up box to suggest user does that? 
Think carefully are there any other big decision you identify? 

## User interface
Dashboard that shows: 
- Space to upload data (drag and drop or select files)
- Text editor where user can type in their model
- Launches with simple default dataset (gaussian response, one predictor, two treatments, one random group effect)
- Text editor is prefilled with simple model to fit to the default data. Two options for simple linear model or mixed-effects model for teh default data.
- Sampler settings include chains, samples, thinning, burnin. 
- Tabs for model fitting:
- Live updating of chains
- Posterior distributions
- Posterior summaries including quantiles and RHat statistic
- Posterior predictive check
- Option to click to download parameter samples to csv
- Option to run model with no inference so we can look at prior predictive check
- Ability to add pop-up boxes later on that can be used in an educational setting. 
