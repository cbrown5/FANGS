/**
 * ppc-plot.js
 * Posterior Predictive Check (PPC) plot.
 *
 * Displays:
 *   - A histogram of the observed data (solid bars, semi-transparent).
 *   - A "fan" of simulated-data densities: multiple KDE curves drawn from
 *     random replicated datasets, layered with low opacity to show the
 *     predictive distribution.
 *   - A bold KDE curve for the mean simulated density.
 *   - A vertical line at the observed mean.
 *
 * API mirrors the other UI classes: update() / clear().
 */

import { DensityPlot as _DP } from './density-plot.js'; // reuse KDE helpers internally

const CANVAS_HEIGHT = 280;
const MARGIN = { top: 20, right: 20, bottom: 40, left: 56 };
const KDE_POINTS   = 256;
const FAN_CURVES   = 50;   // number of replicate KDE curves in the fan
const OBS_COLOR    = 'rgba(33,150,243,0.55)';
const OBS_STROKE   = '#1565c0';
const FAN_COLOR    = 'rgba(239,108,0,0.06)';
const FAN_STROKE   = 'rgba(239,108,0,0.15)';
const MEAN_SIM     = 'rgba(239,108,0,0.9)';
const MEAN_OBS     = '#1a3a5c';

export class PPCPlot {
  /**
   * @param {HTMLElement} containerEl
   */
  constructor(containerEl) {
    if (!containerEl) throw new Error('PPCPlot: containerEl is required');
    this.container = containerEl;
    this._canvas   = null;
    this._ctx      = null;
    this._build();
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * Update and redraw the PPC plot.
   *
   * @param {number[]}   observed   - Array of n observed values
   * @param {number[][]} predicted  - Array of S replicate arrays, each length n
   *                                  (a random subset of FAN_CURVES are drawn)
   */
  update(observed, predicted) {
    if (!observed || observed.length === 0) return;

    this._observed  = observed;
    this._predicted = predicted || [];
    this._draw();
  }

  /**
   * Clear all data and blank the canvas.
   */
  clear() {
    this._observed  = null;
    this._predicted = null;
    if (this._ctx) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._drawEmpty();
    }
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  _build() {
    // Title
    const title = document.createElement('div');
    title.textContent = 'Observed vs. Posterior Predictive Distribution';
    title.style.cssText = `
      font-size: 0.8rem;
      color: #555;
      margin-bottom: 8px;
      font-style: italic;
    `;
    this.container.innerHTML = '';
    this.container.appendChild(title);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; gap:16px; margin-bottom:8px; font-size:0.78rem; color:#444;';
    legend.innerHTML = `
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:14px;height:14px;background:${OBS_COLOR};border:1px solid ${OBS_STROKE};border-radius:2px;"></span>
        Observed
      </span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:24px;height:3px;background:${MEAN_SIM};border-radius:2px;"></span>
        Predicted (mean)
      </span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:24px;height:3px;background:rgba(239,108,0,0.4);border-radius:2px;"></span>
        Predicted (fan)
      </span>
    `;
    this.container.appendChild(legend);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = `display:block; width:100%; height:${CANVAS_HEIGHT}px;`;
    this.container.appendChild(canvas);

    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._drawEmpty();
  }

  _drawEmpty() {
    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || 500;
    const cssH = CANVAS_HEIGHT;
    _resizeCanvas(this._canvas, ctx, cssW, cssH);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#f7f9fc';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#aaa';
    ctx.font      = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Run the model to see posterior predictive checks.', cssW / 2, cssH / 2);
  }

  _draw() {
    const obs  = this._observed;
    const pred = this._predicted;

    const ctx  = this._ctx;
    const cssW = this._canvas.clientWidth || 500;
    const cssH = CANVAS_HEIGHT;
    _resizeCanvas(this._canvas, ctx, cssW, cssH);

    const W     = cssW;
    const H     = cssH;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // --- Determine x range from obs + pred ---
    const obsSorted = [...obs].sort((a, b) => a - b);
    const n         = obs.length;
    const obsMean   = obs.reduce((a, b) => a + b, 0) / n;
    const obsSd     = Math.sqrt(obs.reduce((a, b) => a + (b - obsMean) ** 2, 0) / (n - 1));
    const obsBw     = _silverman(obsSd, n);

    // Global x range
    let xMin = obsSorted[0]   - 3 * obsBw;
    let xMax = obsSorted[n-1] + 3 * obsBw;

    // Expand to cover predictive range
    for (const rep of pred) {
      const rMin = Math.min(...rep);
      const rMax = Math.max(...rep);
      if (rMin < xMin) xMin = rMin;
      if (rMax > xMax) xMax = rMax;
    }

    // --- Histogram of observed ---
    const nBins  = Math.max(8, Math.round(Math.sqrt(n)));
    const binW   = (xMax - xMin) / nBins;
    const counts = new Array(nBins).fill(0);
    for (const v of obs) {
      const bi = Math.min(Math.floor((v - xMin) / binW), nBins - 1);
      if (bi >= 0) counts[bi]++;
    }
    const maxCount  = Math.max(...counts);
    // Convert to density: density = count / (n * binWidth)
    const densities = counts.map(c => c / (n * binW));
    const maxDens   = maxCount / (n * binW);

    // --- KDE of simulated replicates (fan) ---
    // Pick a random subset if too many
    const repSubset = _sampleSubset(pred, FAN_CURVES);
    const repKdes   = repSubset.map(rep => {
      const rn   = rep.length;
      const rMean = rep.reduce((a, b) => a + b, 0) / rn;
      const rSd   = Math.sqrt(rep.reduce((a, b) => a + (b - rMean) ** 2, 0) / (rn - 1));
      const bw    = _silverman(rSd || obsSd * 0.1, rn);
      return _kde(rep, xMin, xMax, KDE_POINTS, bw);
    });

    // Mean KDE across replicates
    const meanKdeY = new Float64Array(KDE_POINTS);
    for (const { ys } of repKdes) {
      for (let i = 0; i < KDE_POINTS; i++) {
        meanKdeY[i] += ys[i];
      }
    }
    const nRep = repKdes.length || 1;
    for (let i = 0; i < KDE_POINTS; i++) meanKdeY[i] /= nRep;

    // KDE of observed
    const { xs: obsXs, ys: obsYs } = _kde(obs, xMin, xMax, KDE_POINTS, obsBw);

    // --- Unified Y scale: max of hist density + max KDE densities ---
    let yMax = maxDens;
    for (const { ys } of repKdes) {
      const m = Math.max(...ys);
      if (m > yMax) yMax = m;
    }
    yMax *= 1.1; // 10% headroom

    const xScale = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const yScale = (v) => MARGIN.top  + plotH - (v / (yMax || 1)) * plotH;

    // --- Draw histogram ---
    ctx.fillStyle   = OBS_COLOR;
    ctx.strokeStyle = OBS_STROKE;
    ctx.lineWidth   = 0.8;
    for (let b = 0; b < nBins; b++) {
      const bxMin = xScale(xMin + b * binW);
      const bxMax = xScale(xMin + (b + 1) * binW);
      const by    = yScale(densities[b]);
      const bh    = yScale(0) - by;
      ctx.fillRect(bxMin, by, bxMax - bxMin - 1, bh);
      ctx.strokeRect(bxMin, by, bxMax - bxMin - 1, bh);
    }

    // --- Draw fan curves ---
    for (const { xs, ys } of repKdes) {
      ctx.beginPath();
      ctx.strokeStyle = FAN_STROKE;
      ctx.fillStyle   = FAN_COLOR;
      ctx.lineWidth   = 0.8;
      ctx.moveTo(xScale(xs[0]), yScale(0));
      ctx.lineTo(xScale(xs[0]), yScale(ys[0]));
      for (let i = 1; i < xs.length; i++) {
        ctx.lineTo(xScale(xs[i]), yScale(ys[i]));
      }
      ctx.lineTo(xScale(xs[xs.length - 1]), yScale(0));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // --- Draw mean predictive KDE ---
    ctx.beginPath();
    ctx.strokeStyle = MEAN_SIM;
    ctx.lineWidth   = 2.5;
    for (let i = 0; i < KDE_POINTS; i++) {
      const px = xScale(obsXs[i]);
      const py = yScale(meanKdeY[i]);
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.stroke();

    // --- Draw observed KDE ---
    ctx.beginPath();
    ctx.strokeStyle = OBS_STROKE;
    ctx.lineWidth   = 2;
    ctx.setLineDash([5, 3]);
    for (let i = 0; i < KDE_POINTS; i++) {
      const px = xScale(obsXs[i]);
      const py = yScale(obsYs[i]);
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Observed mean line ---
    ctx.strokeStyle = MEAN_OBS;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xScale(obsMean), MARGIN.top);
    ctx.lineTo(xScale(obsMean), MARGIN.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Axes ---
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // X-axis labels
    ctx.fillStyle    = '#555';
    ctx.font         = '10px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const nXTicks = 6;
    for (let t = 0; t <= nXTicks; t++) {
      const v = xMin + (t / nXTicks) * (xMax - xMin);
      ctx.fillText(_fmtAxis(v), xScale(v), MARGIN.top + plotH + 5);
    }

    // Y-axis label "Density"
    ctx.save();
    ctx.translate(12, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '10px sans-serif';
    ctx.fillStyle    = '#555';
    ctx.fillText('Density', 0, 0);
    ctx.restore();

    // Y-axis ticks
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    const nYTicks = 4;
    for (let t = 0; t <= nYTicks; t++) {
      const v = (t / nYTicks) * yMax;
      ctx.fillText(_fmtAxis(v), MARGIN.left - 4, yScale(v));
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

function _silverman(sd, n) {
  return 1.06 * sd * Math.pow(n, -0.2);
}

function _kde(samples, xMin, xMax, nPts, bw) {
  const xs      = new Array(nPts);
  const ys      = new Float64Array(nPts);
  const invBw   = 1 / bw;
  const invN    = 1 / (samples.length * bw);
  const sqrt2pi = Math.sqrt(2 * Math.PI);

  for (let i = 0; i < nPts; i++) {
    xs[i] = xMin + (i / (nPts - 1)) * (xMax - xMin);
  }
  for (let i = 0; i < nPts; i++) {
    let sum = 0;
    for (const s of samples) {
      const u = (xs[i] - s) * invBw;
      sum += Math.exp(-0.5 * u * u);
    }
    ys[i] = (invN * sum) / sqrt2pi;
  }
  return { xs, ys };
}

/**
 * Draw a random subset of at most `k` items from an array (no replacement).
 * Returns the whole array if its length <= k.
 */
function _sampleSubset(arr, k) {
  if (arr.length <= k) return arr;
  const out = [];
  const copy = arr.slice();
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

function _fmtAxis(v) {
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) {
    return v.toExponential(1);
  }
  return parseFloat(v.toPrecision(3)).toString();
}
