/**
 * predictions-plot.js
 * Regression predictions plot — focal covariate vs response, posterior mean + 95% CI ribbon.
 */

import { Lexer }      from '../parser/lexer.js';
import { Parser }     from '../parser/parser.js';
import { ModelGraph } from '../parser/model-graph.js';

const CANVAS_HEIGHT   = 320;
const MARGIN          = { top: 24, right: 20, bottom: 50, left: 64 };
const N_GRID          = 100;
const N_GRID_MARGINAL = 40;
const N_THIN          = 200;

const SERIES_COLORS = [
  { line: '#ff4466', ribbon: 'rgba(204,17,51,0.18)',  point: 'rgba(204,17,51,0.5)',  stroke: '#cc1133' },
  { line: '#44aaff', ribbon: 'rgba(17,100,204,0.18)', point: 'rgba(17,100,204,0.5)', stroke: '#1164cc' },
  { line: '#44dd88', ribbon: 'rgba(17,170,85,0.18)',  point: 'rgba(17,170,85,0.5)',  stroke: '#11aa55' },
  { line: '#ffaa44', ribbon: 'rgba(204,130,17,0.18)', point: 'rgba(204,130,17,0.5)', stroke: '#cc8211' },
  { line: '#cc44ff', ribbon: 'rgba(130,17,204,0.18)', point: 'rgba(130,17,204,0.5)', stroke: '#8211cc' },
];

// ── Exported pure helper (used internally + tested via Vitest) ────────────────

/**
 * Compute a continuous-focal prediction grid (posterior mean + 95% CI).
 *
 * @param {object}   opts.ast          Parsed BUGS model AST
 * @param {object}   opts.samples      { paramName: Float64Array | number[] }
 * @param {object}   opts.columns      { colName: Float64Array | number[] }
 * @param {string}   opts.responseVar  Name of the response variable
 * @param {string}   opts.focalName    Covariate to vary on the x-axis
 * @param {object}  [opts.heldVals={}] Fixed values for other covariates (overrides column mean)
 * @param {number}  [opts.dataJ=0]     Number of groups passed to ModelGraph
 * @param {number}  [opts.N=100]       Grid resolution
 * @param {number}  [opts.nThin=200]   Max posterior draws
 * @param {boolean} [opts.marginal]    Average predictions over observed covariate values
 * @param {string}  [opts.linkFn]      Apply forward link to fitted values ('log'|'logit')
 * @returns {{ xs: Float64Array, means: Float64Array, lo: Float64Array, hi: Float64Array }}
 */
export function computePredictionGrid({
  ast, samples, columns, responseVar, focalName,
  heldVals = {}, dataJ = 0,
  N = N_GRID, nThin = N_THIN,
  marginal = false, linkFn = null,
}) {
  const focalCol = columns[focalName];
  if (!focalCol || focalCol.length === 0) throw new Error(`Column '${focalName}' not found`);

  const focalMin = Math.min(...focalCol);
  const focalMax = Math.max(...focalCol);
  const xs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    xs[i] = focalMin + (i / (N - 1)) * (focalMax - focalMin);
  }

  const J          = Math.max(dataJ, 1);
  const colNames   = Object.keys(columns);
  const paramNames = Object.keys(samples);
  if (paramNames.length === 0) throw new Error('No posterior samples');
  const nDraws = samples[paramNames[0]].length;
  const step   = Math.max(1, Math.floor(nDraws / nThin));

  const perPointDraws = Array.from({ length: N }, () => []);

  if (!marginal) {
    // Conditional: one graph with N rows, focal varies, others fixed
    const sc = {};
    for (const name of colNames) {
      if (name === focalName) {
        sc[name] = xs;
      } else if (name === 'group') {
        const a = new Float64Array(N); a.fill(1); sc[name] = a;
      } else if (name === responseVar) {
        const a = new Float64Array(N); a.fill(0); sc[name] = a;
      } else {
        const val = (name in heldVals) ? heldVals[name] : _colMean(columns[name]);
        const a = new Float64Array(N); a.fill(val); sc[name] = a;
      }
    }
    const graph = new ModelGraph(ast, { columns: sc, N, J });
    graph.build();

    for (let d = 0; d < nDraws; d += step) {
      const pv = {};
      for (const name of paramNames) pv[name] = samples[name][d];
      let fitted;
      try { fitted = graph.computeMarginalFittedMeans(pv); } catch (_) { continue; }
      const fa = fitted[responseVar] ?? fitted[Object.keys(fitted)[0]] ?? [];
      for (let i = 0; i < N && i < fa.length; i++) {
        if (isFinite(fa[i])) perPointDraws[i].push(fa[i]);
      }
    }

  } else {
    // Marginal: one graph per grid point, N_obs rows with actual observed covariates
    const N_obs = focalCol.length;
    const graphs = [];
    for (let g = 0; g < N; g++) {
      const xg = xs[g];
      const sc = {};
      for (const name of colNames) {
        if (name === focalName) {
          const a = new Float64Array(N_obs); a.fill(xg); sc[name] = a;
        } else if (name === responseVar) {
          const a = new Float64Array(N_obs); a.fill(0); sc[name] = a;
        } else {
          sc[name] = columns[name];
        }
      }
      const g_graph = new ModelGraph(ast, { columns: sc, N: N_obs, J });
      g_graph.build();
      graphs.push(g_graph);
    }

    for (let d = 0; d < nDraws; d += step) {
      const pv = {};
      for (const name of paramNames) pv[name] = samples[name][d];
      for (let g = 0; g < N; g++) {
        let fitted;
        try { fitted = graphs[g].computeMarginalFittedMeans(pv); } catch (_) { continue; }
        const fa = fitted[responseVar] ?? fitted[Object.keys(fitted)[0]] ?? [];
        let sum = 0, cnt = 0;
        for (const v of fa) { if (isFinite(v)) { sum += v; cnt++; } }
        if (cnt > 0) perPointDraws[g].push(sum / cnt);
      }
    }
  }

  // Reduce to posterior mean + 2.5/97.5 quantiles
  const means = new Float64Array(N);
  const lo    = new Float64Array(N);
  const hi    = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const vals = perPointDraws[i].sort((a, b) => a - b);
    if (vals.length === 0) { means[i] = NaN; lo[i] = NaN; hi[i] = NaN; continue; }
    let sum = 0; for (const v of vals) sum += v;
    means[i] = sum / vals.length;
    lo[i]    = vals[Math.floor(0.025 * vals.length)];
    hi[i]    = vals[Math.min(Math.ceil(0.975 * vals.length), vals.length - 1)];
  }

  // Optionally apply forward link transform (response → link scale)
  if (linkFn) {
    const applyLink = linkFn === 'log'   ? Math.log
      : linkFn === 'logit' ? v => Math.log(v / (1 - v))
      : null;
    if (applyLink) {
      for (let i = 0; i < N; i++) {
        means[i] = isFinite(means[i]) ? applyLink(means[i]) : NaN;
        lo[i]    = isFinite(lo[i])    ? applyLink(lo[i])    : NaN;
        hi[i]    = isFinite(hi[i])    ? applyLink(hi[i])    : NaN;
      }
    }
  }

  return { xs, means, lo, hi };
}

// ── PredictionsPlot class ─────────────────────────────────────────────────────

export class PredictionsPlot {
  /** @param {HTMLElement} containerEl */
  constructor(containerEl) {
    if (!containerEl) throw new Error('PredictionsPlot: containerEl is required');
    this.container = containerEl;

    this._samples     = null;
    this._modelSource = null;
    this._columns     = null;
    this._factorMaps  = null;
    this._dataJ       = 0;
    this._responseVar = 'y';

    this._ast        = null;
    this._gridResult = null;

    this._canvas         = null;
    this._ctx            = null;
    this._focalGroup     = null;
    this._focalSelect    = null;
    this._holdControls   = null;
    this._holdLabel      = null;
    this._notRunMsg      = null;
    this._plotWrap       = null;
    this._noContMsg      = null;
    this._colorByGroup   = null;
    this._colorBySelect  = null;
    this._linkGroup      = null;
    this._linkCheck      = null;
    this._marginalSelect = null;

    this._build();
    this._attachResizeObserver();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  update({ samples, modelSource, columns, factorMaps, dataJ, responseVar }) {
    this._samples     = samples;
    this._modelSource = modelSource;
    this._columns     = columns;
    this._factorMaps  = factorMaps ?? {};
    this._dataJ       = dataJ ?? 0;
    this._responseVar = responseVar ?? 'y';
    this._ast         = null;
    this._gridResult  = null;
    this._updateVisibility();
    this._populateControls();
    this._recompute();
  }

  clear() {
    this._samples     = null;
    this._modelSource = null;
    this._columns     = null;
    this._factorMaps  = null;
    this._gridResult  = null;
    this._ast         = null;
    this._updateVisibility();
    this._drawEmpty();
  }

  render() {
    if (this._gridResult) this._draw(); else this._drawEmpty();
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    this.container.innerHTML = '';

    this._notRunMsg = document.createElement('p');
    this._notRunMsg.style.cssText = 'font-size:0.9rem;color:#9a6878;margin:18px 0;';
    this._notRunMsg.textContent   = 'Run the model to see regression predictions.';
    this.container.appendChild(this._notRunMsg);

    this._plotWrap = document.createElement('div');
    this._plotWrap.style.display = 'none';
    this.container.appendChild(this._plotWrap);

    this._noContMsg = document.createElement('p');
    this._noContMsg.style.cssText = 'font-size:0.9rem;color:#9a6878;margin:18px 0;display:none;';
    this._noContMsg.textContent   =
      'No predictor found in the model — add a covariate to see Predictions.';
    this._plotWrap.appendChild(this._noContMsg);

    // ── Row 1: focal covariate + hold-others-at ─────────────────────────────
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:10px;';
    this._plotWrap.appendChild(row1);

    this._focalGroup = document.createElement('div');
    this._focalGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const focalLabel = document.createElement('label');
    focalLabel.textContent = 'Focal covariate:';
    focalLabel.style.cssText = 'font-size:0.82rem;color:#c09098;white-space:nowrap;';
    this._focalSelect = document.createElement('select');
    Object.assign(this._focalSelect.style, {
      background: '#1a0010', color: '#f8f0f4', border: '1px solid #5a2030',
      borderRadius: '4px', padding: '4px 8px', fontSize: '0.82rem', cursor: 'pointer',
    });
    this._focalSelect.addEventListener('change', () => { this._buildHoldControls(); this._recompute(); });
    this._focalGroup.appendChild(focalLabel);
    this._focalGroup.appendChild(this._focalSelect);
    row1.appendChild(this._focalGroup);

    this._holdLabel = document.createElement('span');
    this._holdLabel.textContent = 'Hold others at:';
    this._holdLabel.style.cssText = 'font-size:0.82rem;color:#9a6878;white-space:nowrap;display:none;';
    row1.appendChild(this._holdLabel);

    this._holdControls = document.createElement('div');
    this._holdControls.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;';
    row1.appendChild(this._holdControls);

    // ── Row 2: colour-by + prediction type + link scale ─────────────────────
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:12px;';
    this._plotWrap.appendChild(row2);

    // Colour-by dropdown (hidden for categorical focal or no other categoricals)
    this._colorByGroup = document.createElement('div');
    this._colorByGroup.style.cssText = 'display:none;align-items:center;gap:6px;';
    const colorByLabel = document.createElement('label');
    colorByLabel.textContent = 'Colour by:';
    colorByLabel.style.cssText = 'font-size:0.82rem;color:#c09098;white-space:nowrap;';
    this._colorBySelect = document.createElement('select');
    Object.assign(this._colorBySelect.style, {
      background: '#1a0010', color: '#f8f0f4', border: '1px solid #5a2030',
      borderRadius: '4px', padding: '4px 8px', fontSize: '0.82rem', cursor: 'pointer',
    });
    this._colorBySelect.addEventListener('change', () => this._recompute());
    this._colorByGroup.appendChild(colorByLabel);
    this._colorByGroup.appendChild(this._colorBySelect);
    row2.appendChild(this._colorByGroup);

    // Prediction type: conditional vs marginal
    const margGroup = document.createElement('div');
    margGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const margLabel = document.createElement('label');
    margLabel.textContent = 'Predictions:';
    margLabel.style.cssText = 'font-size:0.82rem;color:#c09098;white-space:nowrap;';
    this._marginalSelect = document.createElement('select');
    Object.assign(this._marginalSelect.style, {
      background: '#1a0010', color: '#f8f0f4', border: '1px solid #5a2030',
      borderRadius: '4px', padding: '4px 8px', fontSize: '0.82rem', cursor: 'pointer',
    });
    [['conditional', 'Conditional (hold at mean)'], ['marginal', 'Marginal (average over data)']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = t;
      this._marginalSelect.appendChild(o);
    });
    this._marginalSelect.addEventListener('change', () => this._recompute());
    margGroup.appendChild(margLabel);
    margGroup.appendChild(this._marginalSelect);
    row2.appendChild(margGroup);

    // Link scale toggle (hidden unless link function detected)
    this._linkGroup = document.createElement('div');
    this._linkGroup.style.cssText = 'display:none;align-items:center;gap:5px;';
    this._linkCheck = document.createElement('input');
    this._linkCheck.type = 'checkbox';
    this._linkCheck.id   = 'predictions-link-check';
    this._linkCheck.style.cssText = 'accent-color:#ff4466;cursor:pointer;';
    const linkLbl = document.createElement('label');
    linkLbl.htmlFor     = 'predictions-link-check';
    linkLbl.textContent = 'Show link scale';
    linkLbl.style.cssText = 'font-size:0.82rem;color:#c09098;cursor:pointer;white-space:nowrap;';
    this._linkCheck.addEventListener('change', () => this._recompute());
    this._linkGroup.appendChild(this._linkCheck);
    this._linkGroup.appendChild(linkLbl);
    row2.appendChild(this._linkGroup);

    // Canvas
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText =
      'background:#0d0008;border:1px solid #3d0f25;border-radius:6px;overflow:hidden;';
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = `display:block;width:100%;height:${CANVAS_HEIGHT}px;`;
    canvasWrap.appendChild(this._canvas);
    this._plotWrap.appendChild(canvasWrap);
    this._ctx = this._canvas.getContext('2d');
    this._drawEmpty();
  }

  _attachResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(() => {
      if (this._gridResult) this._draw(); else this._drawEmpty();
    }).observe(this.container);
  }

  _updateVisibility() {
    const hasData = this._samples !== null;
    this._notRunMsg.style.display = hasData ? 'none' : '';
    this._plotWrap.style.display  = hasData ? ''     : 'none';
  }

  /** Covariates referenced with indexing in the model, excluding response + group. */
  _getModelCovariates() {
    if (!this._columns || !this._modelSource) return { continuous: [], categorical: [] };
    const factorSet  = new Set(Object.keys(this._factorMaps ?? {}));
    const continuous = [], categorical = [];
    for (const name of Object.keys(this._columns)) {
      if (name === this._responseVar || name === 'group') continue;
      if (!new RegExp(`\\b${name}\\s*\\[`).test(this._modelSource)) continue;
      if (factorSet.has(name)) categorical.push(name);
      else continuous.push(name);
    }
    return { continuous, categorical };
  }

  /** Detect link function from model source. */
  _detectLinkFn() {
    if (!this._modelSource) return { linkFn: null, yLabel: this._responseVar };
    if (/\blogit\s*\(\s*\w+\s*\[/.test(this._modelSource)) return { linkFn: 'logit', yLabel: 'logit(p)' };
    if (/\blog\s*\(\s*\w+\s*\[/.test(this._modelSource))   return { linkFn: 'log',   yLabel: 'log(μ)'   };
    return { linkFn: null, yLabel: this._responseVar };
  }

  _populateControls() {
    if (!this._focalSelect) return;
    const { continuous, categorical } = this._getModelCovariates();
    const prevFocal = this._focalSelect.value;
    this._focalSelect.innerHTML = '';

    if (continuous.length === 0 && categorical.length === 0) {
      this._noContMsg.style.display    = '';
      this._focalGroup.style.display   = 'none';
      this._holdLabel.style.display    = 'none';
      this._holdControls.innerHTML     = '';
      this._colorByGroup.style.display = 'none';
      this._linkGroup.style.display    = 'none';
      return;
    }

    this._noContMsg.style.display  = 'none';
    this._focalGroup.style.display = '';

    for (const name of continuous) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      if (name === prevFocal) o.selected = true;
      this._focalSelect.appendChild(o);
    }
    for (const name of categorical) {
      const o = document.createElement('option');
      o.value = name; o.textContent = `${name} (factor)`;
      if (name === prevFocal) o.selected = true;
      this._focalSelect.appendChild(o);
    }

    const { linkFn } = this._detectLinkFn();
    this._linkGroup.style.display = linkFn ? 'flex' : 'none';

    this._buildHoldControls();
  }

  _buildHoldControls() {
    this._holdControls.innerHTML = '';
    const focal = this._focalSelect.value;
    if (!focal) {
      this._holdLabel.style.display    = 'none';
      this._colorByGroup.style.display = 'none';
      return;
    }

    const { continuous, categorical } = this._getModelCovariates();
    const isCatFocal = categorical.includes(focal);
    const otherConts = continuous.filter(n => n !== focal);
    const otherCats  = categorical.filter(n => n !== focal);
    const others = isCatFocal ? [...otherConts, ...otherCats] : [...otherConts, ...otherCats];
    this._holdLabel.style.display = others.length > 0 ? '' : 'none';

    for (const name of otherConts) {
      const mean = _colMean(this._columns?.[name] ?? []);
      this._holdControls.appendChild(_makeInputControl(name, mean, () => this._recompute()));
    }
    for (const name of otherCats) {
      const levelMap = (this._factorMaps ?? {})[name] ?? {};
      this._holdControls.appendChild(_makeSelectControl(name, levelMap, () => this._recompute()));
    }

    // Colour-by: only for continuous focal when there are other categoricals
    if (!isCatFocal && categorical.length > 0) {
      this._colorByGroup.style.display = 'flex';
      const prevCB = this._colorBySelect.value;
      this._colorBySelect.innerHTML = '';
      const none = document.createElement('option');
      none.value = ''; none.textContent = '(none)';
      this._colorBySelect.appendChild(none);
      for (const name of categorical) {
        const o = document.createElement('option');
        o.value = name; o.textContent = name;
        if (name === prevCB) o.selected = true;
        this._colorBySelect.appendChild(o);
      }
    } else {
      this._colorByGroup.style.display = 'none';
      this._colorBySelect.value = '';
    }
  }

  _getHeldValues() {
    const vals = {};
    this._holdControls.querySelectorAll('input[type=number][data-col]').forEach(inp => {
      vals[inp.dataset.col] = parseFloat(inp.value) || 0;
    });
    this._holdControls.querySelectorAll('select[data-col]').forEach(sel => {
      vals[sel.dataset.col] = parseFloat(sel.value) || 1;
    });
    return vals;
  }

  _getOrParseAST() {
    if (this._ast) return this._ast;
    const tokens = new Lexer(this._modelSource).tokenize();
    this._ast    = new Parser(tokens).parse();
    return this._ast;
  }

  _recompute() {
    const focal = this._focalSelect?.value;
    if (!focal || !this._samples || !this._columns) {
      this._gridResult = null; this._drawEmpty(); return;
    }
    const { categorical } = this._getModelCovariates();
    try {
      if (categorical.includes(focal)) this._recomputeCategorical(focal);
      else this._recomputeContinuous(focal);
    } catch (e) {
      console.error('PredictionsPlot._recompute:', e);
      this._gridResult = null; this._drawEmpty();
    }
  }

  _recomputeContinuous(focalName) {
    const ast      = this._getOrParseAST();
    const heldVals = this._getHeldValues();
    const marginal = this._marginalSelect?.value === 'marginal';
    const { linkFn, yLabel } = this._detectLinkFn();
    const useLinkScale = !!(this._linkCheck?.checked && linkFn);

    const colorByName    = this._colorBySelect?.value || null;
    const colorByEntries = colorByName
      ? Object.entries(this._factorMaps?.[colorByName] ?? {})
      : null;

    const N      = marginal ? N_GRID_MARGINAL : N_GRID;
    const toLoop = colorByEntries ?? [['', null]];
    const series = [];

    for (let si = 0; si < toLoop.length; si++) {
      const [levelLabel, levelCode] = toLoop[si];
      const colors = SERIES_COLORS[si % SERIES_COLORS.length];
      const hv = { ...heldVals };
      if (colorByName && levelCode != null) hv[colorByName] = Number(levelCode);

      const { xs, means, lo, hi } = computePredictionGrid({
        ast,
        samples:     this._samples,
        columns:     this._columns,
        responseVar: this._responseVar,
        focalName,
        heldVals:    hv,
        dataJ:       this._dataJ,
        N,
        nThin:       N_THIN,
        marginal,
        linkFn:      useLinkScale ? linkFn : null,
      });

      series.push({ label: colorByName ? levelLabel : '', colors, xs, means, lo, hi });
    }

    this._gridResult = {
      type: 'continuous',
      xs:   series[0].xs,
      series,
      focalName,
      yLabel: useLinkScale ? yLabel : this._responseVar,
    };
    this._draw();
  }

  _recomputeCategorical(focalName) {
    const ast      = this._getOrParseAST();
    const heldVals = this._getHeldValues();
    const { linkFn, yLabel } = this._detectLinkFn();
    const useLinkScale = !!(this._linkCheck?.checked && linkFn);
    const levelMap = this._factorMaps?.[focalName] ?? {};

    const levels = [], means = [], los = [], his = [];

    for (const [label, code] of Object.entries(levelMap)) {
      const sc = {};
      for (const name of Object.keys(this._columns)) {
        if (name === this._responseVar) {
          sc[name] = new Float64Array([0]);
        } else if (name === focalName) {
          sc[name] = new Float64Array([Number(code)]);
        } else if (name === 'group') {
          sc[name] = new Float64Array([1]);
        } else {
          const val = (name in heldVals) ? heldVals[name] : _colMean(this._columns[name] ?? []);
          sc[name] = new Float64Array([val]);
        }
      }

      const J     = Math.max(this._dataJ, 1);
      const graph = new ModelGraph(ast, { columns: sc, N: 1, J });
      graph.build();

      const paramNames = Object.keys(this._samples);
      const nDraws = this._samples[paramNames[0]].length;
      const step   = Math.max(1, Math.floor(nDraws / N_THIN));
      const draws  = [];

      for (let d = 0; d < nDraws; d += step) {
        const pv = {};
        for (const name of paramNames) pv[name] = this._samples[name][d];
        let fitted;
        try { fitted = graph.computeFittedMeans(pv); } catch (_) { continue; }
        const fa = fitted[this._responseVar] ?? fitted[Object.keys(fitted)[0]] ?? [];
        if (fa.length > 0 && isFinite(fa[0])) draws.push(fa[0]);
      }

      draws.sort((a, b) => a - b);
      let sum = 0; for (const v of draws) sum += v;
      let mn = draws.length > 0 ? sum / draws.length : NaN;
      let lo = draws.length > 0 ? draws[Math.floor(0.025 * draws.length)] : NaN;
      let hi = draws.length > 0 ? draws[Math.min(Math.ceil(0.975 * draws.length), draws.length - 1)] : NaN;

      if (useLinkScale && linkFn) {
        const applyLink = linkFn === 'log' ? Math.log
          : linkFn === 'logit' ? v => Math.log(v / (1 - v))
          : null;
        if (applyLink) { mn = applyLink(mn); lo = applyLink(lo); hi = applyLink(hi); }
      }

      levels.push(label); means.push(mn); los.push(lo); his.push(hi);
    }

    this._gridResult = {
      type: 'categorical', levels, means, lo: los, hi: his, focalName,
      yLabel: useLinkScale ? yLabel : this._responseVar,
    };
    this._draw();
  }

  _draw() {
    if (!this._gridResult) { this._drawEmpty(); return; }
    if (this._gridResult.type === 'categorical') this._drawCategorical();
    else this._drawContinuous();
  }

  _drawContinuous() {
    const { xs, series, focalName, yLabel } = this._gridResult;
    if (!this._ctx || !series?.length) { this._drawEmpty(); return; }

    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || this.container.clientWidth || 500;
    _resizeCanvas(this._canvas, ctx, cssW, CANVAS_HEIGHT);
    const W = cssW, H = CANVAS_HEIGHT;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0008'; ctx.fillRect(0, 0, W, H);

    const n     = xs.length;
    const xMin  = xs[0], xMax = xs[n - 1];
    const xPad  = (xMax - xMin || 1) * 0.04;
    const xLo   = xMin - xPad, xHi = xMax + xPad;

    const allY = [];
    for (const s of series) {
      for (const v of s.lo) if (isFinite(v)) allY.push(v);
      for (const v of s.hi) if (isFinite(v)) allY.push(v);
    }
    const responseObs = this._columns?.[this._responseVar];
    if (responseObs) for (const v of responseObs) if (isFinite(v)) allY.push(v);
    let yMin = Math.min(...allY), yMax = Math.max(...allY);
    const yPad = (yMax - yMin || 1) * 0.08;
    const yLo  = yMin - yPad, yHi = yMax + yPad;

    const xScale = v => MARGIN.left + ((v - xLo) / (xHi - xLo)) * plotW;
    const yScale = v => MARGIN.top  + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

    // Ribbons
    for (const s of series) {
      ctx.beginPath(); ctx.fillStyle = s.colors.ribbon;
      let first = true;
      for (let i = 0; i < n; i++) {
        if (!isFinite(s.lo[i])) continue;
        if (first) { ctx.moveTo(xScale(xs[i]), yScale(s.lo[i])); first = false; }
        else ctx.lineTo(xScale(xs[i]), yScale(s.lo[i]));
      }
      for (let i = n - 1; i >= 0; i--) {
        if (isFinite(s.hi[i])) ctx.lineTo(xScale(xs[i]), yScale(s.hi[i]));
      }
      ctx.closePath(); ctx.fill();
    }

    // Mean lines
    for (const s of series) {
      ctx.beginPath(); ctx.strokeStyle = s.colors.line; ctx.lineWidth = 2.5;
      let started = false;
      for (let i = 0; i < n; i++) {
        if (!isFinite(s.means[i])) { started = false; continue; }
        if (!started) { ctx.moveTo(xScale(xs[i]), yScale(s.means[i])); started = true; }
        else ctx.lineTo(xScale(xs[i]), yScale(s.means[i]));
      }
      ctx.stroke();
    }

    // Observed scatter (colour-matched when colour-by active)
    const focalObs   = this._columns?.[focalName];
    const colorByName = this._colorBySelect?.value || null;
    if (focalObs && responseObs) {
      const nObs = Math.min(focalObs.length, responseObs.length);
      const colorByCol     = colorByName ? this._columns[colorByName] : null;
      const colorByEntries = colorByName ? Object.entries(this._factorMaps?.[colorByName] ?? {}) : null;

      for (let i = 0; i < nObs; i++) {
        if (!isFinite(focalObs[i]) || !isFinite(responseObs[i])) continue;
        let ptC = series[0].colors.point, ptS = series[0].colors.stroke;
        if (colorByCol && colorByEntries) {
          const code = colorByCol[i];
          for (let si = 0; si < colorByEntries.length; si++) {
            if (Number(colorByEntries[si][1]) === code) {
              ptC = series[si % SERIES_COLORS.length].colors.point;
              ptS = series[si % SERIES_COLORS.length].colors.stroke;
              break;
            }
          }
        }
        ctx.beginPath();
        ctx.fillStyle = ptC; ctx.strokeStyle = ptS; ctx.lineWidth = 0.8;
        ctx.arc(xScale(focalObs[i]), yScale(responseObs[i]), 3.5, 0, 2 * Math.PI);
        ctx.fill(); ctx.stroke();
      }
    }

    // Axes
    ctx.strokeStyle = '#5a2030'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    ctx.fillStyle = '#c09098'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = 0; t <= 6; t++) {
      const v = xLo + (t / 6) * (xHi - xLo);
      ctx.fillText(_fmtAxis(v), xScale(v), MARGIN.top + plotH + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let t = 0; t <= 4; t++) {
      const v = yLo + (t / 4) * (yHi - yLo);
      ctx.fillText(_fmtAxis(v), MARGIN.left - 4, yScale(v));
    }

    // Axis labels
    ctx.fillStyle = '#c09098'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(focalName, MARGIN.left + plotW / 2, H - 4);
    ctx.save();
    ctx.translate(14, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Legend
    const lx = MARGIN.left + plotW - 120;
    let   ly = MARGIN.top + 8;
    ctx.font = '9px sans-serif';
    if (series.length > 1) {
      for (const s of series) {
        ctx.fillStyle = s.colors.line; ctx.fillRect(lx, ly - 1, 18, 2.5);
        ctx.fillStyle = '#c09098'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(s.label || 'Series', lx + 22, ly); ly += 13;
      }
      ctx.fillStyle = _opaquer(series[0].colors.ribbon); ctx.fillRect(lx, ly - 4, 18, 8);
      ctx.fillStyle = '#c09098'; ctx.fillText('95% CI', lx + 22, ly);
    } else {
      ctx.fillStyle = series[0].colors.line; ctx.fillRect(lx, ly - 1, 18, 2.5);
      ctx.fillStyle = '#c09098'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('Posterior mean', lx + 22, ly); ly += 14;
      ctx.fillStyle = _opaquer(series[0].colors.ribbon); ctx.fillRect(lx, ly - 4, 18, 8);
      ctx.fillStyle = '#c09098'; ctx.fillText('95% CI', lx + 22, ly);
    }
  }

  _drawCategorical() {
    const { levels, means, lo, hi, focalName, yLabel } = this._gridResult;
    if (!this._ctx || !levels?.length) { this._drawEmpty(); return; }

    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || this.container.clientWidth || 500;
    _resizeCanvas(this._canvas, ctx, cssW, CANVAS_HEIGHT);
    const W = cssW, H = CANVAS_HEIGHT;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0008'; ctx.fillRect(0, 0, W, H);

    const responseObs = this._columns?.[this._responseVar];
    const allY = [...means.filter(isFinite), ...lo.filter(isFinite), ...hi.filter(isFinite)];
    if (responseObs) for (const v of responseObs) if (isFinite(v)) allY.push(v);
    let yMin = Math.min(...allY), yMax = Math.max(...allY);
    const yPad = (yMax - yMin || 1) * 0.12;
    const yLo  = yMin - yPad, yHi = yMax + yPad;
    const yScale = v => MARGIN.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

    const n      = levels.length;
    const xStep  = plotW / (n + 1);
    const levelX = levels.map((_, i) => MARGIN.left + xStep * (i + 1));

    // Axes
    ctx.strokeStyle = '#5a2030'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // Y ticks
    ctx.fillStyle = '#c09098'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let t = 0; t <= 4; t++) {
      const v = yLo + (t / 4) * (yHi - yLo);
      ctx.fillText(_fmtAxis(v), MARGIN.left - 4, yScale(v));
    }

    // X labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < n; i++) {
      ctx.fillText(levels[i], levelX[i], MARGIN.top + plotH + 5);
    }

    const colors = SERIES_COLORS[0];

    // Jittered observed points
    const focalObs = this._columns?.[focalName];
    if (focalObs && responseObs) {
      const nObs    = Math.min(focalObs.length, responseObs.length);
      const lMap    = this._factorMaps?.[focalName] ?? {};
      const codeToX = {};
      for (let i = 0; i < n; i++) {
        const c = lMap[levels[i]];
        if (c != null) codeToX[Number(c)] = levelX[i];
      }
      for (let i = 0; i < nObs; i++) {
        if (!isFinite(focalObs[i]) || !isFinite(responseObs[i])) continue;
        const lx = codeToX[focalObs[i]];
        if (lx == null) continue;
        const jitter = Math.sin(i * 73.1) * xStep * 0.12;
        ctx.beginPath();
        ctx.fillStyle = colors.point; ctx.strokeStyle = colors.stroke; ctx.lineWidth = 0.8;
        ctx.arc(lx + jitter, yScale(responseObs[i]), 3.5, 0, 2 * Math.PI);
        ctx.fill(); ctx.stroke();
      }
    }

    // Dots + error bars per level
    for (let i = 0; i < n; i++) {
      if (!isFinite(means[i])) continue;
      const px  = levelX[i];
      const py  = yScale(means[i]);
      const plo = isFinite(lo[i]) ? yScale(lo[i]) : py;
      const phi = isFinite(hi[i]) ? yScale(hi[i]) : py;

      ctx.strokeStyle = colors.line; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, plo); ctx.lineTo(px, phi); ctx.stroke();

      const capW = 6;
      ctx.beginPath();
      ctx.moveTo(px - capW, plo); ctx.lineTo(px + capW, plo);
      ctx.moveTo(px - capW, phi); ctx.lineTo(px + capW, phi);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = colors.line; ctx.strokeStyle = '#0d0008'; ctx.lineWidth = 1.5;
      ctx.arc(px, py, 5, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#c09098'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(focalName, MARGIN.left + plotW / 2, H - 4);
    ctx.save();
    ctx.translate(14, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Legend
    const lx = MARGIN.left + plotW - 140, ly = MARGIN.top + 8;
    ctx.font = '9px sans-serif';
    ctx.fillStyle = colors.line; ctx.strokeStyle = '#0d0008'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(lx + 5, ly, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c09098'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Posterior mean ± 95% CI', lx + 14, ly);
  }

  _drawEmpty() {
    if (!this._ctx || !this._canvas) return;
    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || this.container.clientWidth || 500;
    _resizeCanvas(this._canvas, ctx, cssW, CANVAS_HEIGHT);
    ctx.clearRect(0, 0, cssW, CANVAS_HEIGHT);
    ctx.fillStyle = '#0d0008'; ctx.fillRect(0, 0, cssW, CANVAS_HEIGHT);
    ctx.fillStyle = '#9a6878'; ctx.font = '13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Run the model to see predictions.', cssW / 2, CANVAS_HEIGHT / 2);
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function _resizeCanvas(canvas, ctx, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const pw  = Math.round(cssW * dpr);
  const ph  = Math.round(cssH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw; canvas.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function _fmtAxis(v) {
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(1);
  return parseFloat(v.toPrecision(3)).toString();
}

function _colMean(col) {
  if (!col || col.length === 0) return 0;
  let sum = 0; for (const v of col) sum += v;
  return sum / col.length;
}

/** Increase alpha of an rgba() string for legend swatches. */
function _opaquer(rgba) {
  return rgba.replace(/[\d.]+\)$/, '0.55)');
}

function _makeInputControl(colName, defaultVal, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const lbl = document.createElement('label');
  lbl.textContent = `${colName}:`;
  lbl.style.cssText = 'font-size:0.78rem;color:#c09098;white-space:nowrap;';
  const inp = document.createElement('input');
  inp.type = 'number'; inp.step = 'any'; inp.dataset.col = colName;
  inp.value = parseFloat(defaultVal.toPrecision(4));
  inp.style.cssText = [
    'background:#1a0010', 'color:#f8f0f4', 'border:1px solid #5a2030',
    'border-radius:4px', 'padding:3px 6px', 'font-size:0.78rem', 'width:80px',
  ].join(';');
  inp.addEventListener('change', onChange);
  wrap.appendChild(lbl); wrap.appendChild(inp);
  return wrap;
}

function _makeSelectControl(colName, levelMap, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const lbl = document.createElement('label');
  lbl.textContent = `${colName}:`;
  lbl.style.cssText = 'font-size:0.78rem;color:#c09098;white-space:nowrap;';
  const sel = document.createElement('select');
  sel.dataset.col = colName;
  sel.style.cssText = [
    'background:#1a0010', 'color:#f8f0f4', 'border:1px solid #5a2030',
    'border-radius:4px', 'padding:3px 6px', 'font-size:0.78rem',
  ].join(';');
  for (const [level, code] of Object.entries(levelMap)) {
    const o = document.createElement('option'); o.value = code; o.textContent = level;
    sel.appendChild(o);
  }
  sel.addEventListener('change', onChange);
  wrap.appendChild(lbl); wrap.appendChild(sel);
  return wrap;
}
