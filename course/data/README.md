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
| `random-effects.csv` | M19, M20, M21 | `site`, `flow` (factor), `logged` (factor), `dist_to_logging_km` (continuous), `trans` (transect ID), `cover` (benthic cover count) |

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

Surveys of benthic organisms and juvenile reef fish at 49 sites in Kia Province, Solomon Islands. Sites were surveyed for juvenile bumphead parrotfish (*Bolbometopon muricatum*) counts. Four transects were done at each site to get benthic cover (branching *Acropora* coral) using point-intercept transects. Predictors include water flow, logging status, and distance to logging operations.

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
