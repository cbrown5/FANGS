/**
 * trace-plot.js
 * Live chain trace plots drawn on HTML5 Canvas elements.
 *
 * One canvas is created per parameter. Each chain is drawn in a distinct
 * colour. The x-axis is fixed from 1 to maxSamples so the scale stays
 * constant as sampling progresses. Redraws are batched every 100 new
 * samples to keep the UI responsive.
 */

/** Chain colours (up to 5 chains; cycles if more). */
const CHAIN_COLORS = ['#ff4466', '#4fc3f7', '#69f060', '#ffb74d', '#ce93d8'];

/** Canvas dimensions (CSS pixels; HiDPI handled via devicePixelRatio). */
const CANVAS_HEIGHT = 120;
const MARGIN = { top: 10, right: 16, bottom: 28, left: 52 };

/** Redraw after this many new samples have accumulated (across all chains). */
const REDRAW_BATCH = 100;

export class TracePlot {
  /**
   * @param {HTMLElement} containerEl  - Element to inject canvases into
   */
  constructor(containerEl) {
    if (!containerEl) throw new Error('TracePlot: containerEl is required');
    this.container = containerEl;

    /** Map<paramName, { canvas, ctx, chains: Map<chainIdx, number[]> }> */
    this._params = new Map();
    this._nChains = 0;
    this._maxSamples = 2000; // fixed x-axis upper bound
    this._dirty = new Set(); // params that need redrawing
    this._pendingCounts = new Map(); // paramName -> samples since last redraw
    this._rafId = null;
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * (Re-)initialise the component for a new run.
   * @param {string[]} paramNames  - Parameter names (one canvas each)
   * @param {number}   nChains     - Number of chains
   * @param {number}   [maxSamples=2000] - Total post-burn-in samples expected (fixes x-axis)
   */
  init(paramNames, nChains, maxSamples = 2000) {
    this.clear();
    this._nChains = nChains;
    this._maxSamples = Math.max(1, maxSamples);

    for (const name of paramNames) {
      const entry = this._createCanvas(name, nChains);
      this._params.set(name, entry);
      this._pendingCounts.set(name, 0);
      this.container.appendChild(entry.wrapper);
    }
  }

  /**
   * Append one new sample for a (parameter, chain) pair.
   * Schedules a redraw after every REDRAW_BATCH new samples for that parameter.
   * @param {string} paramName
   * @param {number} chainIdx   - 0-based
   * @param {number} value
   */
  addSample(paramName, chainIdx, value) {
    const entry = this._params.get(paramName);
    if (!entry) return;

    let chain = entry.chains.get(chainIdx);
    if (!chain) {
      chain = [];
      entry.chains.set(chainIdx, chain);
    }
    chain.push(value);

    const pending = (this._pendingCounts.get(paramName) || 0) + 1;
    this._pendingCounts.set(paramName, pending);

    if (pending >= REDRAW_BATCH) {
      this._pendingCounts.set(paramName, 0);
      this._dirty.add(paramName);
      this._scheduleRender();
    }
  }

  /**
   * Force a full redraw of all parameter canvases.
   */
  render() {
    for (const name of this._params.keys()) {
      this._drawParam(name);
    }
    this._dirty.clear();
  }

  /**
   * Remove all canvases and reset internal state.
   */
  clear() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.container.innerHTML = '';
    this._params.clear();
    this._dirty.clear();
    this._pendingCounts.clear();
    this._nChains = 0;
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  _scheduleRender() {
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      for (const name of this._dirty) {
        this._drawParam(name);
      }
      this._dirty.clear();
    });
  }

  /**
   * Create the wrapper div + canvas for one parameter.
   * @returns {{ wrapper, canvas, ctx, chains }}
   */
  _createCanvas(paramName, nChains) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      margin-bottom: 14px;
      background: #0d0008;
      border: 1px solid #3d0f25;
      border-radius: 6px;
      overflow: hidden;
    `;

    const label = document.createElement('div');
    label.textContent = paramName;
    label.style.cssText = `
      font-size: 0.78rem;
      font-weight: 700;
      color: #f0dce8;
      padding: 5px 10px 0;
      font-family: 'Fira Mono', monospace;
    `;
    wrapper.appendChild(label);

    // Legend (chain colour swatches)
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; gap:10px; padding: 2px 10px 4px; flex-wrap:wrap;';
    for (let c = 0; c < nChains; c++) {
      const swatch = document.createElement('span');
      swatch.style.cssText = `
        font-size:0.7rem; color:#c09098;
        display:flex; align-items:center; gap:4px;
      `;
      const dot = document.createElement('span');
      dot.style.cssText = `
        display:inline-block; width:10px; height:10px; border-radius:50%;
        background:${CHAIN_COLORS[c % CHAIN_COLORS.length]};
      `;
      swatch.appendChild(dot);
      swatch.appendChild(document.createTextNode(`Chain ${c + 1}`));
      legend.appendChild(swatch);
    }
    wrapper.appendChild(legend);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = `display:block; width:100%; height:${CANVAS_HEIGHT}px;`;
    wrapper.appendChild(canvas);

    // HiDPI scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.dataset.dpr = dpr;

    const ctx = canvas.getContext('2d');

    const chains = new Map();

    return { wrapper, canvas, ctx, chains };
  }

  /**
   * Draw (or redraw) the canvas for the given parameter.
   * @param {string} paramName
   */
  _drawParam(paramName) {
    const entry = this._params.get(paramName);
    if (!entry) return;

    const { canvas, ctx, chains } = entry;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth  || canvas.parentElement.clientWidth || 400;
    const cssH = CANVAS_HEIGHT;

    // Resize backing buffer if needed
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const W = cssW;
    const H = cssH;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    // --- Background ---
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0008';
    ctx.fillRect(0, 0, W, H);

    // --- Collect all values for Y-axis range ---
    let yMin = Infinity, yMax = -Infinity, maxLen = 0;
    for (const pts of chains.values()) {
      for (const v of pts) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
      if (pts.length > maxLen) maxLen = pts.length;
    }

    if (maxLen === 0) {
      ctx.fillStyle = '#9a6878';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for samples…', W / 2, H / 2);
      return;
    }

    // Add 5% padding to Y range
    const yRange = yMax - yMin || 1;
    const yPad   = yRange * 0.05;
    const yLo    = yMin - yPad;
    const yHi    = yMax + yPad;

    // Fixed x-axis: always 1 to maxSamples
    const xMax = this._maxSamples;

    // Scales
    const xScale = (sampleIdx) => MARGIN.left + (sampleIdx / (xMax - 1)) * plotW;
    const yScale = (v) => MARGIN.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

    // Compute nice tick step for y
    const { ticks: yTicks, step: yStep } = _niceTicks(yLo, yHi, 4);

    // --- Grid lines ---
    ctx.strokeStyle = 'rgba(255,200,220,0.1)';
    ctx.lineWidth   = 0.5;
    for (const tv of yTicks) {
      const y = yScale(tv);
      if (y < MARGIN.top || y > MARGIN.top + plotH) continue;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + plotW, y);
      ctx.stroke();
    }

    // --- Y axis labels ---
    ctx.fillStyle  = '#c09098';
    ctx.font       = '10px sans-serif';
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';
    for (const tv of yTicks) {
      const y = yScale(tv);
      if (y < MARGIN.top || y > MARGIN.top + plotH) continue;
      ctx.fillText(_fmt(tv, yStep), MARGIN.left - 4, y);
    }

    // --- X axis labels (fixed 1 to maxSamples) ---
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#c09098';
    const nXTicks = 4;
    for (let t = 0; t <= nXTicks; t++) {
      const frac  = t / nXTicks;
      const x     = MARGIN.left + frac * plotW;
      const label = Math.round(1 + frac * (xMax - 1));
      ctx.fillText(label, x, MARGIN.top + plotH + 4);
    }

    // --- Axis lines ---
    ctx.strokeStyle = '#5a2030';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // --- Chain traces ---
    for (const [chainIdx, pts] of chains) {
      if (pts.length < 2) continue;
      const color = CHAIN_COLORS[chainIdx % CHAIN_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();

      pts.forEach((v, i) => {
        const xi = xScale(i);
        const yi = yScale(v);
        if (i === 0) ctx.moveTo(xi, yi);
        else         ctx.lineTo(xi, yi);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ //
// Utility                                                             //
// ------------------------------------------------------------------ //

/**
 * Generate nice round tick values for an axis range.
 * @param {number} lo  - axis minimum
 * @param {number} hi  - axis maximum
 * @param {number} n   - approximate number of ticks desired
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
    ticks.push(parseFloat(v.toPrecision(10))); // avoid float drift
  }
  return { ticks, step };
}

/**
 * Format a number as a nice axis label (whole numbers preferred).
 * @param {number} v
 * @param {number} [step] - the tick step size, used to choose decimal places
 * @returns {string}
 */
function _fmt(v, step) {
  if (!isFinite(v)) return '';
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(1);
  }
  // Determine decimal places from step size
  if (step !== undefined && step > 0) {
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return v.toFixed(decimals);
  }
  // Fallback: whole number if close to integer
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return parseFloat(v.toPrecision(3)).toString();
}
