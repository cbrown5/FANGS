# Course datasets

Place the workshop's marine datasets here (CSV, one per exercise). The hands-on
modules reference these by filename in `../modules.js`.

## Files and column structure

| File | Used by | Columns |
|------|---------|---------|
| `fish-lengths.csv` | M5, M6, M7, M8, M9, M11 | `Tree_name` (species), `Standard_length`, `Lower_jaw_length`, `Mouth_width` (all continuous, mm) |
| `clownfish-oa.csv` | M12, M13 | `treatment` (factor: "Normal seawater" / "Acidified seawater"), `time` (% of time in predator-cue arm), `is_OA` (0/1 dummy) |
| `fish-counts.csv` | M14, M15 | `site`, `fish` (count), `flow` (factor: Strong/Mild), `logged` (factor), `dist_to_logging_km` (continuous), `fish_pres` (binary) |
| `presence.csv` | M16 | `site`, `pres` (binary response), `logged` (factor), `habitat` (factor), `dist_to_logging_km` (continuous) |
| `habitat-presence.csv` | M17 | `site`, `pres` (binary response), `habitat` (3-level factor: Coral/Rubble/Seagrass), `depth_m` (continuous), `is_rubble`, `is_seagrass` (dummy indicators for the reference-coded model) |
| `random-effects.csv` | M19, M20 | `site` (20 levels), `flow` (factor), `logged` (factor), `dist_to_logging_km` (continuous), `trans` (transect ID), `cover` (benthic cover count) |
| `algal-yield.csv` | M21 | `yield_ps` (continuous response), `light` (3-level factor), `diuron` (5-level factor), `block` (4 levels, random-effect grouping), `light_umol`, `diuron_ugL` (original numeric treatment values) |
| `random-effects-full.csv` | Nimble tutorial (not a course module) | as above with `site` (49 levels), plus `cover_branching` (CB + ACB count) and `n_points` (transect denominator) |

`jaw-length.csv` is also present in this folder but is **not used by any module** —
M8/M9 were reworked onto `fish-lengths.csv`. It is kept for the R-reference
scripts (`tests/r-reference/simulate-course-data.R` generates it) and is excluded
from the student download `course-data.zip`.

Factors may be text columns — FANGS auto-encodes them to 1-based integers and
records the mapping, so no manual design-matrix prep is needed.

After adding a dataset, fit it once and paste the reference posterior values into
the matching `config.params` in `../modules.js` (see `../README.md`).

## Data sources

### Fish morphology (`fish-lengths.csv`)

Morphological measurements of Lophiiformes (anglerfish) from the FishShapes database. Anglerfish are the mascot of this package.

Price, S.A., Friedman, S.T., Corn, K.A., Larouche, O., Brockelsby, K., Lee, A.J., Nagaraj, M., et al. 2022. "FishShapes v1: Functionally Relevant Measurements of Teleost Shape and Size on Three Dimensions." *Ecology* 103(12): e3829. https://doi.org/10.1002/ecy.3829

### Clownfish ocean acidification (`clownfish-oa.csv`)

Based on Munday et al. 2009 (*PNAS*). Clownfish larvae were placed in a Y-shaped choice flume where one arm carried normal seawater and the other carried water with predator chemical cues. The response (`time`, %) is the percentage of time each fish spent in the predator-odour arm. Fish in normal seawater avoided predators (~18% of time in predator arm); fish in acidified seawater appeared attracted to predators (~85%). n = 20 per group.

The dataset is pedagogically interesting because the effect size is enormous and the paper received huge media attention — but a large replication study (Clark et al. 2020, *Nature*) failed to reproduce the result, making it a useful example for discussing prior scepticism and reproducibility.

Munday, P.L., Dixson, D.L., Donelson, J.M., Jones, G.P., Pratchett, M.S., Devitsina, G.V., Døving, K.B. 2009. Ocean acidification impairs olfactory discrimination and homing ability of a marine fish. *PNAS* 106(6): 1848–1852. https://doi.org/10.1073/pnas.0809996106

Clark, T.D., et al. 2020. Ocean acidification does not impair the behaviour of coral reef fishes. *Nature* 577: 370–375. https://doi.org/10.1038/s41586-019-1903-y

### Reef fish and benthic surveys (`fish-counts.csv`, `random-effects.csv`)

Surveys of benthic organisms and juvenile reef fish at 49 sites in Kia Province, Solomon Islands. Sites were surveyed for juvenile bumphead parrotfish (*Bolbometopon muricatum*) counts. Transects were done at each site to get benthic cover (branching *Acropora* coral) using point-intercept transects. Predictors include water flow, logging status, and distance to logging operations.

`random-effects.csv` is a 20-site, 3-transect-per-site subset (60 rows) of the
full survey, chosen to span both flow levels, both logging levels and the whole
distance gradient. Hierarchical models fit roughly nine times faster on it than
on the full 49-site survey, which matters because every site adds a random
intercept for the sampler to update. The original 245-row survey is kept
alongside it as `random-effects-full.csv` (not included in the student zip).

`random-effects-full.csv` carries two extra columns used by the Nimble tutorial
(`tutorial/nimble-hierarchical-glm.qmd`):

- `cover_branching` — point-intercept count of **all** branching coral
  (`CB` + `ACB` codes), as opposed to `cover`, which is branching *Acropora*
  (`ACB`) alone.
- `n_points` — total points sampled on the transect (72–75), the denominator
  that makes a binomial model possible.

The tutorial uses `cover_branching` rather than `cover` because `cover` is 42%
zeros with no clear fixed effect, while `cover_branching` is only 12% zeros and
shows a strong, interpretable logging effect: cover is about twice as high at
unlogged sites (33.8% vs 16.9%). That dataset is for Nimble only — 49 random
intercepts is far too slow for the in-browser FANGS sampler.

For reef fish data:

Hamilton, R.J., Almany, G.R., Brown, C.J., Pita, J., Peterson, N.A., Choat, J.H. 2017. Logging degrades nursery habitat for an iconic coral reef fish. *Biological Conservation* 210: 273–280. https://doi.org/10.1016/j.biocon.2017.04.025

For benthic cover data:

Brown, C.J., Hamilton, R.J. 2018. Estimating the footprint of pollution on coral reefs with models of species turnover. *Conservation Biology*. https://doi.org/10.1111/cobi.13079

### Habitat presence (`habitat-presence.csv`) — simulated

**This dataset is simulated, not observed.** It is modelled on the Kia Province
reef surveys above (juvenile parrotfish presence/absence against a habitat
class), but M17 needs a 3-level factor with balanced levels, and no such
variable exists in the real survey data: `presence.csv` has only 2 of 49 sites
in its third `habitat` level ("Mixed"), which leaves that level's coefficient
effectively unidentified.

Simulated from known cell-means log-odds with 24 sites per level (n = 72):

| Habitat | True log-odds | Implied P(present) | Realised |
|---------|---------------|--------------------|----------|
| Coral    | 1.20  | 0.77 | 19/24 |
| Rubble   | −0.90 | 0.29 | 7/24  |
| Seagrass | 0.10  | 0.52 | 12/24 |

Levels appear in the order Coral, Rubble, Seagrass, so FANGS's
order-of-first-appearance encoding gives Coral = 1 (the reference level the
module text assumes). `depth_m` is a continuous nuisance covariate, not used by
the M17 model, available for extension exercises.

Reference posteriors in `../modules.js` were produced with the FANGS engine
itself (4 chains, 2000 burn-in, 4000 samples, `dnorm(0, 2)` priors) via
`tests/bench/fangs-cli.mjs`; all R-hat = 1.00.

### Algal multi-stressor experiment (`algal-yield.csv`)

A factorial laboratory experiment on the marine diatom *Phaeodactylum
tricornutum*, used for the M21 summative challenge. Flasks were grown at three
light levels (5, 20, 80 µmol photons m⁻² s⁻¹) crossed with five diuron
concentrations (0, 0.11, 0.33, 1, 3 µg L⁻¹) — 15 treatment cells — and the whole
experiment was repeated on four separate occasions, each using an independent
algal culture. Those occasions are the `block` variable, and they are the
random-effects grouping factor.

The course file is the **72-hour time slice of the diuron experiment**, with the
photosynthetic yield response (`yield_ps`, i.e. $Y(II)$ by chlorophyll-a
fluorescence). Both treatments are recoded as 1-based factor levels because
neither effect is linear in its numeric value — yield falls sharply from 5 to 20
µmol and then changes little from 20 to 80. The original numeric values are kept
as `light_umol` and `diuron_ugL`; the model uses `diuron_ugL` for the
interaction term only.

Regenerate it from the raw data with:

```bash
node scripts/prep-algal-stressors.js
```

which reads `tutorial/data/algal-stressors/diuron_data72hrs.csv` (the raw King
et al. file, kept in the repo for the Nimble tutorial).

**Why yield and not growth.** The same experiment measured cell density, from
which a growth ratio (`celld_ratio`, final over initial density) can be formed,
and that response shows a more striking *crossover* interaction — diuron only
harms growth at the lowest light level. It was not chosen for the summative
module because cell density was **not measured in block 1**, so it drops to 45
rows and 3 blocks, and with n = 3 per cell only 1 of its 6 main effects has a
credible interval excluding zero. Yield gives a far clearer result: 8 of 9 fixed
effects are credibly non-zero with a clean monotone dose–response. The growth
response is a good extension exercise, and the contrast between the two
responses on the same design is the actual point of the King et al. paper.

**Sampling note.** With only four blocks, $\alpha$ and the block offsets $b_j$
are weakly identified (the Module 20 ridge), and two things are needed to fit it
well. First, the prior on `sigma.b` must be on the scale of the response:
`dunif(0, 10)` gives R-hat in the tens for the intercept, `dunif(0, 0.2)` is the
right scale for a response spanning 0.24–0.59. Second, even with that prior the
free-intercept version still fails at the app's default sampler settings
(3 chains x 1000, burn-in 500): R-hat for `alpha` above 5, ESS around 4, with one
chain stuck at the top of the `sigma.b` range. Constraining the block effects to
sum to zero —

```
  b[1] ~ dnorm(0, sigma.b)
  b[2] ~ dnorm(0, sigma.b)
  b[3] ~ dnorm(0, sigma.b)
  b[4] <- -(b[1] + b[2] + b[3])
```

— removes the redundancy and fixes it outright: worst R-hat 1.01 at the default
settings, `sigma.b` ESS over 800, and identical posterior means. At the reference
settings (4 chains, 4000 samples, burn-in 2000) every R-hat is 1.000. The module
text makes both points teaching moments, since Module 20 covers exactly this
failure mode.

Reference posteriors in `../modules.js` were produced with the FANGS engine
itself (4 chains, 2000 burn-in, 4000 samples) via `tests/bench/fangs-cli.mjs`,
using the priors the module recommends.

King, O.C., van de Merwe, J.P., Campbell, M.D., Smith, R.A., Warne, M.St.J.,
Brown, C.J. 2022. Interactions among multiple stressors vary with exposure
duration and biological response. *Proceedings of the Royal Society B* 289:
20220348. https://doi.org/10.1098/rspb.2022.0348
