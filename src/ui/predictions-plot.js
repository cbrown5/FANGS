/**
 * predictions-plot.js
 * Regression predictions plot — focal covariate vs response, posterior mean + 95% CI ribbon.
 *
 * Builds a synthetic covariate grid, runs it through the model graph forward
 * for each thinned posterior draw, then reduces to mean and 2.5/97.5 quantiles.
 */

import { Lexer }       from '../parser/lexer.js';
import { Parser }      from '../parser/parser.js';
import { ModelGraph }  from '../parser/model-graph.js';

const CANVAS_HEIGHT = 320;
const MARGIN        = { top: 24, right: 20, bottom: 50, left: 64 };
const N_GRID        = 100;
const N_THIN        = 200;   // max posterior draws to evaluate

const RIBBON_COLOR  = 'rgba(204,17,51,0.18)';
const LINE_COLOR    = '#ff4466';
const POINT_COLOR   = 'rgba(204,17,51,0.5)';
const POINT_STROKE  = '#cc1133';

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

    this._ast        = null;   // cached parsed AST
    this._gridResult = null;   // { xs, means, lo, hi, focalName }

    this._canvas      = null;
    this._ctx         = null;
    this._focalGroup  = null;  // wrapper div for focal select
    this._focalSelect = null;
    this._holdControls = null;
    this._notRunMsg   = null;
    this._plotWrap    = null;
    this._noContMsg   = null;

    this._build();
    this._attachResizeObserver();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * @param {{ samples: object, modelSource: string, columns: object,
   *           factorMaps: object, dataJ: number, responseVar: string }} opts
   */
  update({ samples, modelSource, columns, factorMaps, dataJ, responseVar }) {
    this._samples     = samples;
    this._modelSource = modelSource;
    this._columns     = columns;
    this._factorMaps  = factorMaps ?? {};
    this._dataJ       = dataJ ?? 0;
    this._responseVar = responseVar ?? 'y';
    this._ast         = null;   // invalidate on new model
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

  /** Re-render after tab switch (canvas may have been resized). */
  render() {
    if (this._gridResult) this._draw();
    else this._drawEmpty();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _build() {
    this.container.innerHTML = '';

    this._notRunMsg = document.createElement('p');
    this._notRunMsg.style.cssText = 'font-size:0.9rem;color:#9a6878;margin:18px 0;';
    this._notRunMsg.textContent   = 'Run the model to see regression predictions.';
    this.container.appendChild(this._notRunMsg);

    this._plotWrap = document.createElement('div');
    this._plotWrap.style.display = 'none';
    this.container.appendChild(this._plotWrap);

    // No-continuous-covariate message
    this._noContMsg = document.createElement('p');
    this._noContMsg.style.cssText = 'font-size:0.9rem;color:#9a6878;margin:18px 0;display:none;';
    this._noContMsg.textContent   =
      'No continuous predictor found in the model — the Predictions tab requires a continuous covariate.';
    this._plotWrap.appendChild(this._noContMsg);

    // Controls row
    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:14px;';
    this._plotWrap.appendChild(controlsRow);

    // Focal covariate selector
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
    this._focalSelect.addEventListener('change', () => {
      this._buildHoldControls();
      this._recompute();
    });
    this._focalGroup.appendChild(focalLabel);
    this._focalGroup.appendChild(this._focalSelect);
    controlsRow.appendChild(this._focalGroup);

    // Separator label
    this._holdLabel = document.createElement('span');
    this._holdLabel.textContent = 'Hold others at:';
    this._holdLabel.style.cssText = 'font-size:0.82rem;color:#9a6878;white-space:nowrap;display:none;';
    controlsRow.appendChild(this._holdLabel);

    // Hold-others-at controls
    this._holdControls = document.createElement('div');
    this._holdControls.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;';
    controlsRow.appendChild(this._holdControls);

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
    const factorSet = new Set(Object.keys(this._factorMaps ?? {}));
    const continuous  = [];
    const categorical = [];
    for (const name of Object.keys(this._columns)) {
      if (name === this._responseVar) continue;
      if (name === 'group') continue;
      if (!new RegExp(`\\b${name}\\s*\\[`).test(this._modelSource)) continue;
      if (factorSet.has(name)) categorical.push(name);
      else continuous.push(name);
    }
    return { continuous, categorical };
  }

  _populateControls() {
    if (!this._focalSelect) return;
    const { continuous } = this._getModelCovariates();
    const prevFocal = this._focalSelect.value;

    this._focalSelect.innerHTML = '';

    if (continuous.length === 0) {
      this._noContMsg.style.display    = '';
      this._focalGroup.style.display   = 'none';
      this._holdLabel.style.display    = 'none';
      this._holdControls.innerHTML     = '';
      return;
    }

    this._noContMsg.style.display  = 'none';
    this._focalGroup.style.display = '';

    for (const name of continuous) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      if (name === prevFocal) opt.selected = true;
      this._focalSelect.appendChild(opt);
    }

    this._buildHoldControls();
  }

  _buildHoldControls() {
    this._holdControls.innerHTML = '';
    const focal = this._focalSelect.value;
    if (!focal) { this._holdLabel.style.display = 'none'; return; }

    const { continuous, categorical } = this._getModelCovariates();
    const others = [...continuous.filter(n => n !== focal), ...categorical];
    this._holdLabel.style.display = others.length > 0 ? '' : 'none';

    for (const name of continuous) {
      if (name === focal) continue;
      const col  = this._columns?.[name];
      const mean = col ? _colMean(col) : 0;
      this._holdControls.appendChild(
        _makeInputControl(name, mean, () => this._recompute()),
      );
    }

    for (const name of categorical) {
      const levelMap = (this._factorMaps ?? {})[name] ?? {};
      this._holdControls.appendChild(
        _makeSelectControl(name, levelMap, () => this._recompute()),
      );
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
    const tokens  = new Lexer(this._modelSource).tokenize();
    this._ast     = new Parser(tokens).parse();
    return this._ast;
  }

  _recompute() {
    const focal = this._focalSelect?.value;
    if (!focal || !this._samples || !this._columns) {
      this._gridResult = null;
      this._drawEmpty();
      return;
    }

    try {
      const ast      = this._getOrParseAST();
      const focalCol = this._columns[focal];
      if (!focalCol || focalCol.length === 0) {
        this._gridResult = null;
        this._drawEmpty();
        return;
      }

      const focalMin = Math.min(...focalCol);
      const focalMax = Math.max(...focalCol);

      // Build focal covariate grid
      const gridXs = new Float64Array(N_GRID);
      for (let i = 0; i < N_GRID; i++) {
        gridXs[i] = focalMin + (i / (N_GRID - 1)) * (focalMax - focalMin);
      }

      const heldVals = this._getHeldValues();

      // Build synthetic columns for the graph
      const synthColumns = {};
      for (const name of Object.keys(this._columns)) {
        if (name === focal) {
          synthColumns[name] = gridXs;
        } else if (name === 'group') {
          const arr = new Float64Array(N_GRID); arr.fill(1);
          synthColumns[name] = arr;
        } else if (name === this._responseVar) {
          // Dummy observed response (non-NaN so nodes classify as observed)
          const arr = new Float64Array(N_GRID); arr.fill(0);
          synthColumns[name] = arr;
        } else {
          const val = (name in heldVals)
            ? heldVals[name]
            : (this._columns[name] ? _colMean(this._columns[name]) : 0);
          const arr = new Float64Array(N_GRID); arr.fill(val);
          synthColumns[name] = arr;
        }
      }

      const J = Math.max(this._dataJ ?? 0, 1);
      const graph = new ModelGraph(ast, { columns: synthColumns, N: N_GRID, J });
      graph.build();

      // Thin posterior draws to at most N_THIN
      const paramNames = Object.keys(this._samples);
      if (paramNames.length === 0) {
        this._gridResult = null;
        this._drawEmpty();
        return;
      }
      const nDraws = this._samples[paramNames[0]].length;
      const step   = Math.max(1, Math.floor(nDraws / N_THIN));

      // perPointDraws[i] = array of fitted mean values at grid point i across draws
      const perPointDraws = Array.from({ length: N_GRID }, () => []);

      for (let d = 0; d < nDraws; d += step) {
        const paramValues = {};
        for (const name of paramNames) {
          paramValues[name] = this._samples[name][d];
        }
        let fitted;
        try {
          fitted = graph.computeMarginalFittedMeans(paramValues);
        } catch (_) {
          continue;
        }
        const fittedArr = fitted[this._responseVar]
          ?? fitted[Object.keys(fitted)[0]]
          ?? [];
        for (let i = 0; i < N_GRID && i < fittedArr.length; i++) {
          const v = fittedArr[i];
          if (isFinite(v)) perPointDraws[i].push(v);
        }
      }

      // Reduce to mean + 2.5/97.5 quantiles per grid point
      const means = new Float64Array(N_GRID);
      const lo    = new Float64Array(N_GRID);
      const hi    = new Float64Array(N_GRID);
      for (let i = 0; i < N_GRID; i++) {
        const vals = perPointDraws[i].sort((a, b) => a - b);
        if (vals.length === 0) { means[i] = NaN; lo[i] = NaN; hi[i] = NaN; continue; }
        let sum = 0;
        for (const v of vals) sum += v;
        means[i] = sum / vals.length;
        lo[i]    = vals[Math.floor(0.025 * vals.length)];
        hi[i]    = vals[Math.min(Math.ceil(0.975 * vals.length), vals.length - 1)];
      }

      this._gridResult = { xs: gridXs, means, lo, hi, focalName: focal };
      this._draw();

    } catch (e) {
      console.error('PredictionsPlot._recompute:', e);
      this._gridResult = null;
      this._drawEmpty();
    }
  }

  _draw() {
    if (!this._gridResult || !this._ctx) { this._drawEmpty(); return; }
    const { xs, means, lo, hi, focalName } = this._gridResult;

    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || this.container.clientWidth || 500;
    const cssH = CANVAS_HEIGHT;
    _resizeCanvas(this._canvas, ctx, cssW, cssH);

    const W     = cssW;
    const H     = cssH;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0008';
    ctx.fillRect(0, 0, W, H);

    // X range
    const focalObs   = this._columns?.[focalName];
    const responseObs = this._columns?.[this._responseVar];

    const xMin = xs[0], xMax = xs[N_GRID - 1];
    const xPad = (xMax - xMin || 1) * 0.04;
    const xLo  = xMin - xPad, xHi = xMax + xPad;

    // Y range: cover ribbon + observed points
    const allY = [
      ...Array.from(lo).filter(isFinite),
      ...Array.from(hi).filter(isFinite),
    ];
    if (responseObs) for (const v of responseObs) if (isFinite(v)) allY.push(v);
    let yMin = Math.min(...allY), yMax = Math.max(...allY);
    const yPad = (yMax - yMin || 1) * 0.08;
    const yLo  = yMin - yPad, yHi = yMax + yPad;

    const xScale = v => MARGIN.left + ((v - xLo) / (xHi - xLo)) * plotW;
    const yScale = v => MARGIN.top  + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

    // 95% credible ribbon
    ctx.beginPath();
    ctx.fillStyle = RIBBON_COLOR;
    let firstLo = true;
    for (let i = 0; i < N_GRID; i++) {
      if (!isFinite(lo[i])) continue;
      if (firstLo) { ctx.moveTo(xScale(xs[i]), yScale(lo[i])); firstLo = false; }
      else ctx.lineTo(xScale(xs[i]), yScale(lo[i]));
    }
    for (let i = N_GRID - 1; i >= 0; i--) {
      if (isFinite(hi[i])) ctx.lineTo(xScale(xs[i]), yScale(hi[i]));
    }
    ctx.closePath();
    ctx.fill();

    // Mean line
    ctx.beginPath();
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth   = 2.5;
    let started = false;
    for (let i = 0; i < N_GRID; i++) {
      if (!isFinite(means[i])) { started = false; continue; }
      if (!started) { ctx.moveTo(xScale(xs[i]), yScale(means[i])); started = true; }
      else ctx.lineTo(xScale(xs[i]), yScale(means[i]));
    }
    ctx.stroke();

    // Observed data scatter
    if (focalObs && responseObs) {
      const n = Math.min(focalObs.length, responseObs.length);
      for (let i = 0; i < n; i++) {
        if (!isFinite(focalObs[i]) || !isFinite(responseObs[i])) continue;
        const px = xScale(focalObs[i]);
        const py = yScale(responseObs[i]);
        ctx.beginPath();
        ctx.fillStyle   = POINT_COLOR;
        ctx.strokeStyle = POINT_STROKE;
        ctx.lineWidth   = 0.8;
        ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Axes
    ctx.strokeStyle = '#5a2030';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    ctx.fillStyle    = '#c09098';
    ctx.font         = '10px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const nXTicks = 6;
    for (let t = 0; t <= nXTicks; t++) {
      const v = xLo + (t / nXTicks) * (xHi - xLo);
      ctx.fillText(_fmtAxis(v), xScale(v), MARGIN.top + plotH + 5);
    }

    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    const nYTicks = 4;
    for (let t = 0; t <= nYTicks; t++) {
      const v = yLo + (t / nYTicks) * (yHi - yLo);
      ctx.fillText(_fmtAxis(v), MARGIN.left - 4, yScale(v));
    }

    // Axis labels
    ctx.fillStyle    = '#c09098';
    ctx.font         = '11px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(focalName, MARGIN.left + plotW / 2, H - 4);

    ctx.save();
    ctx.translate(14, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '11px sans-serif';
    ctx.fillStyle    = '#c09098';
    ctx.fillText(this._responseVar, 0, 0);
    ctx.restore();

    // Inline legend (top-right area)
    const lx = MARGIN.left + plotW - 110;
    let   ly = MARGIN.top + 8;
    ctx.font = '9px sans-serif';

    ctx.fillStyle = LINE_COLOR;
    ctx.fillRect(lx, ly - 1, 18, 2.5);
    ctx.fillStyle    = '#c09098';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Posterior mean', lx + 22, ly);
    ly += 14;

    ctx.fillStyle = RIBBON_COLOR.replace('0.18', '0.55');
    ctx.fillRect(lx, ly - 4, 18, 8);
    ctx.fillStyle = '#c09098';
    ctx.fillText('95% CI', lx + 22, ly);
  }

  _drawEmpty() {
    if (!this._ctx || !this._canvas) return;
    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || this.container.clientWidth || 500;
    const cssH = CANVAS_HEIGHT;
    _resizeCanvas(this._canvas, ctx, cssW, cssH);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#0d0008';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle    = '#9a6878';
    ctx.font         = '13px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Run the model to see predictions.', cssW / 2, cssH / 2);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _resizeCanvas(canvas, ctx, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const pw  = Math.round(cssW * dpr);
  const ph  = Math.round(cssH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width  = pw;
    canvas.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function _fmtAxis(v) {
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(1);
  return parseFloat(v.toPrecision(3)).toString();
}

function _colMean(col) {
  if (!col || col.length === 0) return 0;
  let sum = 0;
  for (const v of col) sum += v;
  return sum / col.length;
}

function _makeInputControl(colName, defaultVal, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const lbl = document.createElement('label');
  lbl.textContent = `${colName}:`;
  lbl.style.cssText = 'font-size:0.78rem;color:#c09098;white-space:nowrap;';
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = 'any';
  inp.dataset.col = colName;
  inp.value = parseFloat(defaultVal.toPrecision(4));
  inp.style.cssText = [
    'background:#1a0010', 'color:#f8f0f4', 'border:1px solid #5a2030',
    'border-radius:4px', 'padding:3px 6px', 'font-size:0.78rem', 'width:80px',
  ].join(';');
  inp.addEventListener('change', onChange);
  wrap.appendChild(lbl);
  wrap.appendChild(inp);
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
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = level;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', onChange);
  wrap.appendChild(lbl);
  wrap.appendChild(sel);
  return wrap;
}
