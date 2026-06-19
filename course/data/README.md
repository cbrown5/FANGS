# Course datasets

Place the workshop's marine datasets here (CSV, one per exercise). The hands-on
modules reference these by filename in `../modules.js`.

Expected files and column structure (supply real data matching these shapes):

| File | Used by | Expected columns |
|------|---------|------------------|
| `fish-length.csv`     | M5, M6, M7   | `length` (continuous response) |
| `jaw-length.csv`      | M2, M8, M9   | `jaw` (response), `body` (predictor) |
| `oa-study.csv`        | M11, M12     | response, `treatment` (2-level factor) |
| `fish-counts.csv`     | M13, M14     | `count` (response), predictor(s), factor(s) `A`, `B` |
| `presence.csv`        | M15, M16     | `present` (0/1), predictor `x`, 3-level `site` factor |
| `random-effects.csv`  | M18, M20     | response/`count`, predictor(s), factors, `group`/`reef` |

Factors may be text columns — FANGS auto-encodes them to 1-based integers and
records the mapping, so no manual design-matrix prep is needed.

After adding a dataset, fit it once and paste the reference posterior values into
the matching `config.params` in `../modules.js` (see `../README.md`).
