/**
 * predictions-plot.js
 * Model Predictions plot.
 *
 * Displays:
 *   - Observed data as scatter points (y vs. selected predictor x)
 *   - Posterior mean prediction as a line
 *   - 95% credible interval as a shaded ribbon
 *
 * API:
 *   setData(dataColumns)          - call when CSV is loaded; populates x-axis selector
 *   setPredictions(predicted)     - call after sampling; predicted is number[][] (S × N)
 *   clear()                       - reset to empty state
 */

const CANVAS_HEIGHT = 420;
const MARGIN = { top: 24, right: 24, bottom: 52, left: 60 };

const OBS_COLOR   = 'rgba(204,17,51,0.7)';
const OBS_STROKE  = '#cc1133';
const CI_FILL     = 'rgba(100,180,255,0.15)';
const CI_STROKE   = 'rgba(100,180,255,0.35)';
const PRED_COLOR  = 'rgba(100,180,255,0.9)';

export class PredictionsPlot {
  /**
   * @param {HTMLElement} containerEl
   */
  constructor(containerEl) {
    if (!containerEl) throw new Error('PredictionsPlot: containerEl is required');
    this.container    = containerEl;
    this._dataColumns = null;
    this._predicted   = null;
    this._fittedMeans = null;
    this._xVar        = null;
    this._yVar        = 'y';
    this._canvas      = null;
    this._ctx         = null;
    this._xSelect     = null;
    this._build();
    this._attachResizeObserver();
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * Update the available predictor columns from the loaded data.
   * Populates the x-axis selector and redraws (empty) if no predictions yet.
   *
   * @param {Object.<string, Float64Array|number[]>} dataColumns
   */
  setData(dataColumns) {
    this._dataColumns = dataColumns;
    this._populateSelector();
    if (this._predicted) {
      this._render();
    } else {
      this._drawEmpty();
    }
  }

  /**
   * Update the posterior predictive replicates and redraw.
   *
   * @param {number[][]} predicted  Array of S replicate arrays, each of length N.
   *                                 predicted[s][i] is the prediction for obs i in replicate s.
   * @param {number[][]|null} fittedMeans  Optional array of S fitted-mean arrays (mu[i], no noise).
   *                                        When provided, used for the line and CI instead of
   *                                        the noisy predictive draws, giving smoother curves.
   */
  setPredictions(predicted, fittedMeans = null) {
    this._predicted   = predicted && predicted.length > 0 ? predicted : null;
    this._fittedMeans = fittedMeans && fittedMeans.length > 0 ? fittedMeans : null;
    this._render();
  }

  /**
   * Clear predictions and blank the canvas.
   */
  clear() {
    this._predicted   = null;
    this._fittedMeans = null;
    this._drawEmpty();
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  _build() {
    this.container.innerHTML = '';

    // Controls row: x-axis variable selector
    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;';

    const label = document.createElement('label');
    label.textContent = 'X-axis predictor:';
    label.style.cssText = 'font-size:0.85rem; color:#c09098;';
    label.setAttribute('for', 'predictions-x-select');

    const select = document.createElement('select');
    select.id = 'predictions-x-select';
    select.style.cssText = [
      'background:#1a0012',
      'color:#e8d0d8',
      'border:1px solid #5a2030',
      'border-radius:4px',
      'padding:4px 8px',
      'font-size:0.85rem',
      'cursor:pointer',
    ].join(';');
    select.addEventListener('change', () => {
      this._xVar = select.value;
      this._render();
    });

    this._xSelect = select;

    controlsRow.appendChild(label);
    controlsRow.appendChild(select);
    this.container.appendChild(controlsRow);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; gap:16px; margin-bottom:8px; font-size:0.78rem; color:#c09098; flex-wrap:wrap;';
    legend.innerHTML = `
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:12px;height:12px;background:${OBS_COLOR};border:1px solid ${OBS_STROKE};border-radius:50%;"></span>
        Observed data
      </span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:24px;height:3px;background:${PRED_COLOR};border-radius:2px;"></span>
        Predicted mean
      </span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:24px;height:10px;background:${CI_FILL};border:1px solid ${CI_STROKE};border-radius:2px;"></span>
        95% CI
      </span>
    `;
    this.container.appendChild(legend);

    // Canvas
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `display:block; width:100%; height:${CANVAS_HEIGHT}px;`;
    this.container.appendChild(canvas);

    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._drawEmpty();
  }

  _populateSelector() {
    const select = this._xSelect;
    if (!select) return;

    const prevValue = select.value;
    select.innerHTML = '';

    if (!this._dataColumns) return;

    const cols = Object.keys(this._dataColumns).filter(k => k !== this._yVar);
    for (const col of cols) {
      const opt = document.createElement('option');
      opt.value       = col;
      opt.textContent = col;
      select.appendChild(opt);
    }

    // Restore previous selection, or default to 'x' if available
    if (cols.includes(prevValue)) {
      select.value  = prevValue;
      this._xVar    = prevValue;
    } else if (cols.includes('x')) {
      select.value  = 'x';
      this._xVar    = 'x';
    } else if (cols.length > 0) {
      select.value  = cols[0];
      this._xVar    = cols[0];
    } else {
      this._xVar = null;
    }
  }

  _attachResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    this._resizeObserver = new ResizeObserver(() => {
      if (this._predicted && this._dataColumns && this._xVar) {
        this._render();
      } else {
        this._drawEmpty();
      }
    });
    this._resizeObserver.observe(this.container);
  }

  _drawEmpty() {
    const ctx  = this._ctx;
    if (!ctx) return;
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

  _render() {
    if (!this._dataColumns || !this._predicted || !this._xVar) {
      this._drawEmpty();
      return;
    }

    const yCol = this._dataColumns[this._yVar];
    const xCol = this._dataColumns[this._xVar];

    if (!yCol || !xCol) {
      this._drawEmpty();
      return;
    }

    const yObs = Array.from(yCol);
    const xObs = Array.from(xCol);
    const pred = this._predicted; // number[][] — S replicates × N obs

    const n     = yObs.length;
    const nReps = pred.length;

    if (n === 0 || nReps === 0) {
      this._drawEmpty();
      return;
    }

    // Use fitted means (mu[i], no observation noise) for line and CI when available;
    // fall back to noisy posterior predictive draws otherwise.
    const lineSrc = this._fittedMeans && this._fittedMeans.length > 0
      ? this._fittedMeans
      : pred;
    const nLine = lineSrc.length;

    // Per-observation posterior mean, 2.5th and 97.5th percentiles
    const yHat = new Float64Array(n);
    const yLo  = new Float64Array(n);
    const yHi  = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const vals = lineSrc.map(rep => rep[i]).sort((a, b) => a - b);
      let sum = 0;
      for (const v of vals) sum += v;
      yHat[i] = sum / nLine;
      yLo[i]  = vals[Math.max(0, Math.floor(0.025 * nLine))];
      yHi[i]  = vals[Math.min(nLine - 1, Math.ceil(0.975 * nLine) - 1)];
    }

    // Sort indices by x for ribbon/line rendering
    const indices = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => xObs[a] - xObs[b]);

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

    // Axis ranges
    let xMin = Math.min(...xObs);
    let xMax = Math.max(...xObs);
    const xPad = (xMax - xMin) * 0.05 || 1;
    xMin -= xPad;
    xMax += xPad;

    const allY = [...yObs, ...Array.from(yHat), ...Array.from(yLo), ...Array.from(yHi)];
    let yMin = Math.min(...allY);
    let yMax = Math.max(...allY);
    const yPad = (yMax - yMin) * 0.05 || 1;
    yMin -= yPad;
    yMax += yPad;

    const xScale = v => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const yScale = v => MARGIN.top  + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // --- 95% CI ribbon ---
    ctx.beginPath();
    // Upper edge, left to right
    for (let idx = 0; idx < n; idx++) {
      const i  = indices[idx];
      const px = xScale(xObs[i]);
      const py = yScale(yHi[i]);
      if (idx === 0) ctx.moveTo(px, py);
      else           ctx.lineTo(px, py);
    }
    // Lower edge, right to left
    for (let idx = n - 1; idx >= 0; idx--) {
      const i = indices[idx];
      ctx.lineTo(xScale(xObs[i]), yScale(yLo[i]));
    }
    ctx.closePath();
    ctx.fillStyle   = CI_FILL;
    ctx.strokeStyle = CI_STROKE;
    ctx.lineWidth   = 1;
    ctx.fill();
    ctx.stroke();

    // --- Predicted mean line ---
    ctx.beginPath();
    ctx.strokeStyle = PRED_COLOR;
    ctx.lineWidth   = 2.5;
    for (let idx = 0; idx < n; idx++) {
      const i  = indices[idx];
      const px = xScale(xObs[i]);
      const py = yScale(yHat[i]);
      if (idx === 0) ctx.moveTo(px, py);
      else           ctx.lineTo(px, py);
    }
    ctx.stroke();

    // --- Observed data points ---
    ctx.fillStyle   = OBS_COLOR;
    ctx.strokeStyle = OBS_STROKE;
    ctx.lineWidth   = 0.8;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(xScale(xObs[i]), yScale(yObs[i]), 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    // --- Axes ---
    ctx.strokeStyle = '#5a2030';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // X-axis label
    ctx.fillStyle    = '#c09098';
    ctx.font         = '11px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this._xVar, MARGIN.left + plotW / 2, H - 6);

    // Y-axis label
    ctx.save();
    ctx.translate(14, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '11px sans-serif';
    ctx.fillStyle    = '#c09098';
    ctx.fillText(this._yVar, 0, 0);
    ctx.restore();

    // X-axis tick labels
    ctx.fillStyle    = '#c09098';
    ctx.font         = '10px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const nXTicks = 6;
    for (let t = 0; t <= nXTicks; t++) {
      const v = xMin + (t / nXTicks) * (xMax - xMin);
      ctx.fillText(_fmtAxis(v), xScale(v), MARGIN.top + plotH + 5);
    }

    // Y-axis tick labels
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    const nYTicks = 5;
    for (let t = 0; t <= nYTicks; t++) {
      const v = yMin + (t / nYTicks) * (yMax - yMin);
      ctx.fillText(_fmtAxis(v), MARGIN.left - 5, yScale(v));
    }
  }
}

// ------------------------------------------------------------------ //
// Helpers                                                             //
// ------------------------------------------------------------------ //

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
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) {
    return v.toExponential(1);
  }
  return parseFloat(v.toPrecision(3)).toString();
}
