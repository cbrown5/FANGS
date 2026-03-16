/**
 * density-plot.js
 * Posterior density plots drawn on HTML5 Canvas elements.
 *
 * For each parameter the class:
 *   1. Runs kernel density estimation (Gaussian kernel, Silverman bandwidth).
 *   2. Draws a filled density curve.
 *   3. Shades the 95% credible interval.
 *   4. Draws a vertical line at the posterior mean.
 */

const CANVAS_HEIGHT = 150;
const MARGIN = { top: 16, right: 16, bottom: 32, left: 52 };
const DENSITY_FILL   = 'rgba(33,150,243,0.18)';
const DENSITY_STROKE = '#1565c0';
const CI_FILL        = 'rgba(33,150,243,0.35)';
const MEAN_COLOR     = '#c62828';
const KDE_POINTS     = 256; // evaluation grid points

export class DensityPlot {
  /**
   * @param {HTMLElement} containerEl
   */
  constructor(containerEl) {
    if (!containerEl) throw new Error('DensityPlot: containerEl is required');
    this.container = containerEl;

    /** Map<paramName, { wrapper, canvas, ctx, samples }> */
    this._params = new Map();
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * Provide (or replace) samples for one parameter.
   * @param {string}   paramName
   * @param {number[]} samples   - Post-burn-in, all-chains combined
   */
  setSamples(paramName, samples) {
    let entry = this._params.get(paramName);
    if (!entry) {
      entry = this._createCanvas(paramName);
      this._params.set(paramName, entry);
      this.container.appendChild(entry.wrapper);
    }
    entry.samples = samples;
    this._drawParam(paramName);
  }

  /**
   * Re-render all density canvases (e.g. after a container resize).
   */
  render() {
    for (const name of this._params.keys()) {
      this._drawParam(name);
    }
  }

  /**
   * Remove all canvases and reset state.
   */
  clear() {
    this.container.innerHTML = '';
    this._params.clear();
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  _createCanvas(paramName) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: inline-block;
      vertical-align: top;
      width: calc(50% - 10px);
      margin: 0 5px 16px;
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      overflow: hidden;
      box-sizing: border-box;
    `;

    const label = document.createElement('div');
    label.textContent = paramName;
    label.style.cssText = `
      font-size: 0.78rem;
      font-weight: 700;
      color: #1a3a5c;
      padding: 5px 10px 0;
      font-family: 'Fira Mono', monospace;
    `;
    wrapper.appendChild(label);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = `display:block; width:100%; height:${CANVAS_HEIGHT}px;`;
    wrapper.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    return { wrapper, canvas, ctx, samples: [] };
  }

  _drawParam(paramName) {
    const entry = this._params.get(paramName);
    if (!entry) return;

    const { canvas, ctx, samples } = entry;

    if (!samples || samples.length < 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#aaa';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No samples', (canvas.width || 200) / 2, (canvas.height || 150) / 2);
      return;
    }

    const dpr  = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth  || canvas.parentElement.clientWidth || 300;
    const cssH = CANVAS_HEIGHT;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const W     = cssW;
    const H     = cssH;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // --- Statistics ---
    const n    = samples.length;
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const sd   = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));

    const sorted = [...samples].sort((a, b) => a - b);
    const q025   = _quantile(sorted, 0.025);
    const q975   = _quantile(sorted, 0.975);

    // --- KDE ---
    const bw = _silverman(sd, n);
    const xMin = sorted[0]   - 3 * bw;
    const xMax = sorted[n-1] + 3 * bw;
    const { xs, ys } = _kde(samples, xMin, xMax, KDE_POINTS, bw);
    const yMax = Math.max(...ys);

    const xScale = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const yScale = (v) => MARGIN.top  + plotH - (v / (yMax || 1)) * plotH;

    // --- Shaded 95% CI ---
    ctx.beginPath();
    ctx.fillStyle = CI_FILL;
    let started = false;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < q025 || xs[i] > q975) continue;
      const px = xScale(xs[i]);
      const py = yScale(ys[i]);
      if (!started) { ctx.moveTo(px, yScale(0)); ctx.lineTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    if (started) {
      ctx.lineTo(xScale(q975), yScale(0));
      ctx.closePath();
      ctx.fill();
    }

    // --- Density curve ---
    ctx.beginPath();
    ctx.strokeStyle = DENSITY_STROKE;
    ctx.lineWidth   = 2;
    ctx.fillStyle   = DENSITY_FILL;
    ctx.moveTo(xScale(xs[0]), yScale(0));
    ctx.lineTo(xScale(xs[0]), yScale(ys[0]));
    for (let i = 1; i < xs.length; i++) {
      ctx.lineTo(xScale(xs[i]), yScale(ys[i]));
    }
    ctx.lineTo(xScale(xs[xs.length - 1]), yScale(0));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // --- Mean line ---
    ctx.strokeStyle = MEAN_COLOR;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xScale(mean), MARGIN.top);
    ctx.lineTo(xScale(mean), MARGIN.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Axis ---
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.stroke();

    // --- X-axis ticks / labels (nice round numbers) ---
    ctx.fillStyle    = '#555';
    ctx.font         = '10px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const { ticks: xTicks, step: xStep } = _niceTicks(xMin, xMax, 5);
    for (const tv of xTicks) {
      const px = xScale(tv);
      if (px < MARGIN.left || px > MARGIN.left + plotW) continue;
      ctx.fillStyle = '#555';
      ctx.fillText(_fmt(tv, xStep), px, MARGIN.top + plotH + 4);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.top);
      ctx.lineTo(px, MARGIN.top + plotH);
      ctx.stroke();
    }

    // --- Legend text: mean and 95% CI ---
    ctx.fillStyle    = '#333';
    ctx.font         = '9.5px sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `mean=${_fmt(mean)}  95% CI [${_fmt(q025)}, ${_fmt(q975)}]`,
      MARGIN.left + plotW - 2,
      MARGIN.top + 2
    );
  }
}

// ------------------------------------------------------------------ //
// Statistical helpers                                                  //
// ------------------------------------------------------------------ //

/**
 * Silverman's rule of thumb bandwidth.
 * @param {number} sd - Sample standard deviation
 * @param {number} n  - Sample size
 */
function _silverman(sd, n) {
  return 1.06 * sd * Math.pow(n, -0.2);
}

/**
 * Evaluate Gaussian KDE on an evenly-spaced grid.
 * @param {number[]} samples
 * @param {number}   xMin
 * @param {number}   xMax
 * @param {number}   nPts
 * @param {number}   bw
 * @returns {{ xs: number[], ys: number[] }}
 */
function _kde(samples, xMin, xMax, nPts, bw) {
  const xs = new Array(nPts);
  const ys = new Float64Array(nPts);
  const invBw  = 1 / bw;
  const invN   = 1 / (samples.length * bw);
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
    ys[i] = invN * sum / sqrt2pi;
  }

  return { xs, ys };
}

/**
 * Linear-interpolation quantile of a pre-sorted array.
 * @param {number[]} sorted
 * @param {number}   p       - Probability in [0,1]
 */
function _quantile(sorted, p) {
  const n  = sorted.length;
  const h  = p * (n - 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Generate nice round tick values for an axis range.
 * @param {number} lo - axis minimum
 * @param {number} hi - axis maximum
 * @param {number} n  - approximate number of ticks desired
 * @returns {{ ticks: number[], step: number }}
 */
function _niceTicks(lo, hi, n) {
  const range = hi - lo || 1;
  const roughStep = range / n;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const step = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.001; v += step) {
    ticks.push(parseFloat(v.toPrecision(10)));
  }
  return { ticks, step };
}

/**
 * Format a number as a nice axis label (whole numbers preferred).
 * @param {number} v
 * @param {number} [step]
 * @returns {string}
 */
function _fmt(v, step) {
  if (!isFinite(v)) return '';
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(1);
  }
  if (step !== undefined && step > 0) {
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return v.toFixed(decimals);
  }
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return parseFloat(v.toPrecision(3)).toString();
}
