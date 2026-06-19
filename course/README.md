# FANGS Course

A one-day, hands-on workshop teaching Bayesian inference for mixed-effects models
with marine-ecology examples, built on top of the FANGS app.

## Running it

```bash
# from the repo root — build popups + course content, then serve
npm start

# or build the course content only, then serve
npm run build:course
npx serve .
```

Then open <http://localhost:3000/course/> (port may vary).

The course works in `file://` mode too: the build emits
`course/content/course-bundle.js` as a fallback when `fetch()` is unavailable.

## Structure

- `index.html` / `course.css` / `course.js` — the course shell and module loader.
- `modules.js` — **single source of truth**: session grouping, module order, and
  per-module challenge wiring. Edit here to add/reorder modules or tune challenge
  config.
- `content/*.qmd` — module prose (Markdown + LaTeX), rendered by
  `npm run build:course` via the shared pipeline in `scripts/lib/render-content.js`.
- `challenges/*.js` — interactive challenge widgets (ES modules). They reuse the
  app's own `distributions.js`, `math.js`, and parser so the maths matches the
  sampler exactly.
- `data/` — datasets for the hands-on modules (**you supply these** — see below).

## Authoring datasets and reference answers

The hands-on modules expect real marine datasets in `course/data/`. For each
`answer-check` module in `modules.js`:

1. Put the CSV in `course/data/` (e.g. `jaw-length.csv`).
2. Fit it once in FANGS (or via `tests/r-reference/`).
3. Paste the true posterior **mean** and **95% CI** into that module's
   `config.params` in `modules.js`, replacing the `0` placeholders.

Until reference values are filled in, `answer-check` modules run in
**self-report** mode (they record the student's entry and mark the module done
once every box is filled).

## Adding a module

1. Add an entry to `MODULES` in `modules.js` (with its `challenge` type + config).
2. Create `content/<id>.qmd`.
3. Run `npm run build:course`.
4. Commit the `.qmd` source and the updated `course-bundle.js`.
