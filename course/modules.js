/**
 * modules.js
 * Single source of truth for the FANGS course: session grouping, module
 * ordering, and per-module challenge wiring.
 *
 * Each module references a `.qmd` source in course/content/<id>.qmd (rendered to
 * HTML by `npm run build:course`). The `challenge` field names a widget in
 * course/challenges/ and `config` is passed to it.
 *
 * Challenge types:
 *   'discrete-bayes' | 'map-slider' | 'mcmc' | 'code-validator' |
 *   'answer-check'   | 'recorder'   | 'quiz' | 'none'
 *
 * NOTE for authors: `answer-check` and `recorder` modules reference datasets the
 * workshop organiser supplies in course/data/. The reference posterior values in
 * each `config.params` are PLACEHOLDERS — fit the real dataset once in FANGS (or
 * via tests/r-reference/) and paste the true mean / 95% CI here.
 */

export const SESSIONS = [
  { id: 's1', title: 'Session 1 · Bayesian thinking from scratch', minutes: 80 },
  { id: 's2', title: 'Session 2 · Your first models in FANGS', minutes: 80 },
  { id: 's3', title: 'Session 3 · Regression & model checking', minutes: 75 },
  { id: 's4', title: 'Session 4 · Factors & design matrices', minutes: 70 },
  { id: 's5', title: 'Session 5 · Generalised linear models', minutes: 90 },
  { id: 's6', title: 'Session 6 · Random effects & bringing it together', minutes: 90 },
];

export const MODULES = [
  // ── Session 1 ────────────────────────────────────────────────────────────
  {
    id: 'm01-discrete-bayes', session: 's1', num: 1,
    title: "Bayes' theorem with discrete models", mode: 'embedded',
    challenge: 'discrete-bayes',
    config: {
      // Which of three reefs did a tagged fish most likely come from?
      hypotheses: ['North reef', 'Mid reef', 'South reef'],
      likelihood: [0.6, 0.3, 0.1], // P(detection pattern | reef)
      priors: {
        'Equal prior': [1 / 3, 1 / 3, 1 / 3],
        'Survey-weighted prior': [0.2, 0.5, 0.3],
      },
      tol: 0.01,
    },
  },
  {
    id: 'm02-continuous-bayes', session: 's1', num: 2,
    title: 'Bayes for a continuous parameter (MAP)', mode: 'embedded',
    challenge: 'map-slider',
    config: {
      param: 'μ', units: 'mm', xLabel: 'Mean jaw length μ (mm)',
      xMin: 20, xMax: 60, sliderStep: 0.1,
      sigmaLik: 4,          // fixed measurement SD
      data: [38, 41, 43, 39, 45, 40, 42],  // observed jaw lengths
      priors: {
        'Vague prior  N(40, 15)': { mu: 40, sd: 15 },
        'Tight prior  N(30, 3)':  { mu: 30, sd: 3 },
      },
      tol: 0.5,             // mm tolerance on the MAP guess
    },
  },
  {
    id: 'm03-mcmc-sampling', session: 's1', num: 3,
    title: 'Sampling the posterior with MCMC', mode: 'embedded',
    challenge: 'mcmc',
    config: {
      // Reuses the M2 jaw-length posterior as the sampling target.
      xMin: 20, xMax: 60, sigmaLik: 4,
      data: [38, 41, 43, 39, 45, 40, 42],
      prior: { mu: 40, sd: 15 },
      targetEss: 200,
    },
  },

  // ── Session 2 ────────────────────────────────────────────────────────────
  {
    id: 'm04-model-syntax', session: 's2', num: 4,
    title: 'Writing models in BUGS/JAGS syntax', mode: 'embedded',
    challenge: 'code-validator',
    config: {
      // Seeded with a deliberate bug for students to fix (missing ')').
      seed: `model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu, sigma
    mu <- alpha
  }
  alpha ~ dnorm(0, 50)
  sigma ~ dunif(0, 100)
}`,
      hint: 'A distribution call is missing its closing parenthesis. FANGS uses dnorm(mean, SD).',
    },
  },
  {
    id: 'm05-first-fit', session: 's2', num: 5,
    title: 'Fit your first model in FANGS', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      // fish-lengths.csv columns: Tree_name, Standard_length, Lower_jaw_length,
      // Mouth_width. Intercept-only model on Standard_length.
      dataset: 'fish-lengths.csv',
      params: [
        { name: 'alpha', label: 'Mean length α (mm)', mean: 32.6, ci: [26.44, 38.78], tol: 1.0 },
        { name: 'sigma', label: 'SD σ (mm)',          mean: 20.4, ci: [16.43, 25.77], tol: 1.0 },
      ],
    },
  },
  {
    id: 'm06-sigma-priors', session: 's2', num: 6,
    title: 'Choosing a prior for σ', mode: 'fangs',
    challenge: 'recorder',
    config: {
      storeKey: 'm06-sigma-priors',
      columns: ['Prior for sigma', 'Posterior mean σ', '95% CI low', '95% CI high'],
    },
  },
  {
    id: 'm07-prior-predictive', session: 's2', num: 7,
    title: 'Prior predictive checks', mode: 'fangs',
    challenge: 'quiz',
    config: {
      questions: [
        {
          q: 'You simulate fish lengths from the prior alone and get values from −400 to 600 mm. What does this tell you?',
          options: [
            'The prior is far too vague — it implies impossible fish lengths.',
            'The model has converged well.',
            'The likelihood dominates the prior.',
          ],
          answer: 0,
        },
        {
          q: 'A prior predictive check uses…',
          options: [
            'Samples drawn from the posterior after seeing the data.',
            'Samples drawn from the priors only, with the likelihood switched off.',
            'The observed data to calibrate the priors.',
          ],
          answer: 1,
        },
        {
          q: 'You try a vague prior dnorm(0, 1000) for mean jaw length. The prior predictive check shows simulated lengths spanning −5000 to 5000 mm. What should you do?',
          options: [
            'Accept it — vague priors are always better.',
            'Tighten the prior so simulated lengths are in a biologically plausible range.',
            'Increase the number of MCMC samples.',
          ],
          answer: 1,
        },
        {
          q: 'Compared with the vague prior dnorm(0, 100), a more informative prior dnorm(100, 5) for alpha produces prior predictive simulations that are…',
          options: [
            'More spread out and include impossible values.',
            'Concentrated near realistic jaw lengths.',
            'Identical — the prior has no effect on simulations.',
          ],
          answer: 1,
        },
        {
          q: 'You notice the prior predictive density plot in FANGS dips slightly below zero for a parameter that must be positive. What is the most likely explanation?',
          options: [
            'The sampler has a bug.',
            'The prior places real probability mass on negative values.',
            'The kernel smoother used to draw the density curve extends beyond the actual samples.'
          ],
          answer: 2,
        },
      ],
    },
  },

  // ── Session 3 ────────────────────────────────────────────────────────────
  {
    id: 'm08-gaussian-glm', session: 's3', num: 8,
    title: 'Gaussian regression: jaw length ~ body length', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      // fish-lengths.csv: regress Lower_jaw_length on Standard_length.
      dataset: 'fish-lengths.csv',
      params: [
        { name: 'alpha', label: 'Intercept α (mm)',           mean: 2.5, ci: [-6.9, 12.1], tol: 1.0 },
        { name: 'beta',  label: 'Slope β (jaw per body mm)',  mean: 13.6, ci: [10.9, 17.1], tol: 0.1 },
      ],
    },
  },
  {
    id: 'm09-posterior-predictive', session: 's3', num: 9,
    title: 'Posterior predictive checks', mode: 'fangs',
    challenge: 'quiz',
    config: {
      questions: [
        {
          q: 'In the PPC plot for the first model, the simulated datasets bracket the observed data well. What do you conclude?',
          options: [
            'The model reproduces the key features of the data — a good sign.',
            'The chains have not converged.',
            'The prior is too informative.',
          ],
          answer: 0,
        },
        {
          q: 'In the PPC plot for the second model with fixed SD, the simulated datasets had much broader spread than the histogram of the real data. What do you conclude?',
          options: [
            'The model reproduces the key features of the data — a good sign.',
            'The chains have not converged.',
            'We need to change how we model the spread of the data',
          ],
          answer: 2,
        },
        {
          q: 'If the observed data sat in the far tail of every simulated dataset. This would suggest…',
          options: [
            'Excellent fit.',
            'Nothing — PPC cannot detect misfit.',
            'Model misfit — the model cannot reproduce the data.'
          ],
          answer: 2,
        },
      ],
    },
  },
  {
    id: 'm10-diagnostics', session: 's3', num: 10,
    title: 'MCMC diagnostics: R-hat & ESS', mode: 'fangs',
    challenge: 'quiz',
    config: {
      questions: [
        {
          q: 'A parameter has R-hat = 1.45. What should you do?',
          options: [
            'Accept it — anything above 1 is fine.',
            'Discard the parameter from the model.',
            'Do not trust it — the chains disagree; run longer / reparameterise.'
          ],
          answer: 2,
        },
        {
          q: 'ESS = 35 for 4000 saved samples means…',
          options: [
            'High autocorrelation — only ~35 effectively independent draws.',
            'The model is wrong.',
            'You have 4000 independent samples.',
          ],
          answer: 0,
        },
      ],
    },
  },

  {
    id: 'm11-identifiability-priors', session: 's3', num: 11,
    title: 'Identifiability & bad ESS/R-hat: a case study', mode: 'fangs',
    challenge: 'recorder',
    config: {
      storeKey: 'm11-identifiability-priors',
      columns: ['Prior SD on alpha2', 'Worst R-hat (alpha/alpha2)', 'Min ESS', 'Posterior shape (ridge/bimodal/peak)'],
    },
  },

  // ── Session 4 ────────────────────────────────────────────────────────────
  {
    id: 'm12-single-factor', session: 's4', num: 12,
    title: 'Single-factor linear model & the design matrix', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      // clownfish-oa.csv columns: group (Normal seawater / Acidified), time.
      dataset: 'clownfish-oa.csv',
      params: [
        { name: 'alpha',     label: 'Control mean α',        mean: 0, ci: [0, 0], tol: 0.5 },
        { name: 'beta_trt',  label: 'Acidification effect',  mean: 0, ci: [0, 0], tol: 0.5 },
      ],
    },
  },
  {
    id: 'm13-prior-comparison', session: 's4', num: 13,
    title: 'Comparing priors with the OA study', mode: 'fangs',
    challenge: 'recorder',
    config: {
      storeKey: 'm13-prior-comparison',
      columns: ['Prior on treatment effect', 'Posterior mean', '95% CI low', '95% CI high'],
    },
  },

  // ── Session 5 ────────────────────────────────────────────────────────────
  {
    id: 'm14-poisson', session: 's5', num: 14,
    title: 'Poisson regression with a log link', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      dataset: 'fish-counts.csv',
      params: [
        { name: 'alpha', label: 'Intercept α (log scale)', mean: 0, ci: [0, 0], tol: 0.3 },
        { name: 'beta',  label: 'Slope β (log scale)',     mean: 0, ci: [0, 0], tol: 0.2 },
      ],
    },
  },
  {
    id: 'm15-poisson-two-factor', session: 's5', num: 15,
    title: 'Poisson with two factors', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      dataset: 'fish-counts.csv',
      params: [
        { name: 'alpha',    label: 'Intercept α',  mean: 0, ci: [0, 0], tol: 0.3 },
        { name: 'beta_a',   label: 'Factor A effect', mean: 0, ci: [0, 0], tol: 0.3 },
        { name: 'beta_b',   label: 'Factor B effect', mean: 0, ci: [0, 0], tol: 0.3 },
      ],
    },
  },
  {
    id: 'm16-binomial', session: 's5', num: 16,
    title: 'Binomial regression with a logit link', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      dataset: 'presence.csv',
      params: [
        { name: 'alpha', label: 'Intercept α (logit scale)', mean: 0, ci: [0, 0], tol: 0.4 },
        { name: 'beta',  label: 'Slope β (logit scale)',     mean: 0, ci: [0, 0], tol: 0.3 },
      ],
    },
  },
  {
    id: 'm17-binomial-three-level', session: 's5', num: 17,
    title: 'Binomial with a 3-level factor', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      dataset: 'presence.csv',
      params: [
        { name: 'alpha',  label: 'Reference level α',    mean: 0, ci: [0, 0], tol: 0.4 },
        { name: 'beta_2', label: 'Level 2 vs reference', mean: 0, ci: [0, 0], tol: 0.4 },
        { name: 'beta_3', label: 'Level 3 vs reference', mean: 0, ci: [0, 0], tol: 0.4 },
      ],
    },
  },

  // ── Session 6 ────────────────────────────────────────────────────────────
  {
    id: 'm18-random-effects-concept', session: 's6', num: 18,
    title: 'The idea of random effects', mode: 'embedded',
    challenge: 'quiz',
    config: {
      questions: [
        {
          q: 'You sampled fish at 12 reefs and want reef-level intercepts that share information. You should use…',
          options: [
            'Random effects (partial pooling across reefs).',
            'A separate, independent intercept per reef (no pooling).',
            'A single intercept for all reefs (complete pooling).',
          ],
          answer: 0,
        },
        {
          q: 'Partial pooling shrinks group estimates toward…',
          options: [
            'The overall mean, most strongly for groups with little data.',
            'Zero, always.',
            "The largest group's estimate.",
          ],
          answer: 0,
        },
      ],
    },
  },
  {
    id: 'm19-random-effects-fit', session: 's6', num: 19,
    title: 'Fit a random-effects model', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      dataset: 'random-effects.csv',
      params: [
        { name: 'alpha',   label: 'Grand mean α',       mean: 0, ci: [0, 0], tol: 0.5 },
        { name: 'beta',    label: 'Slope β',            mean: 0, ci: [0, 0], tol: 0.3 },
        { name: 'sigma.b', label: 'Group SD σ_b',       mean: 0, ci: [0, 0], tol: 0.5 },
      ],
    },
  },
  {
    id: 'm20-improving-sampling', session: 's6', num: 20,
    title: 'Improving sampling: priors & reparameterisation', mode: 'fangs',
    challenge: 'recorder',
    config: {
      storeKey: 'm20-improving-sampling',
      columns: ['Parameterisation', 'Worst R-hat', 'Min ESS', 'Notes'],
    },
  },
  {
    id: 'm21-summative', session: 's6', num: 21,
    title: 'Summative challenge: multi-factor Poisson with random effects', mode: 'fangs',
    challenge: 'answer-check',
    config: {
      dataset: 'random-effects.csv',
      params: [
        { name: 'alpha',   label: 'Intercept α',     mean: 0, ci: [0, 0], tol: 0.4 },
        { name: 'beta_a',  label: 'Factor A effect', mean: 0, ci: [0, 0], tol: 0.4 },
        { name: 'beta_b',  label: 'Factor B effect', mean: 0, ci: [0, 0], tol: 0.4 },
        { name: 'sigma.b', label: 'Group SD σ_b',    mean: 0, ci: [0, 0], tol: 0.5 },
      ],
    },
  },
];
