/**
 * trace-plot.js
 * Live chain trace plots drawn on HTML5 Canvas elements.
 *
 * One canvas is created per parameter. Each chain is drawn in a distinct
 * colour. The last MAX_POINTS samples per chain are retained in a circular
 * buffer to bound memory use. The Y-axis auto-scales to visible data.
 */

/** Maximum samples retained per chain per parameter. */
const MAX_POINTS = 500;

/** Chain colours (up to 5 chains; cycles if more). */
const CHAIN_COLORS = ['#2196f3', '#e53935', '#43a047', '#fb8c00', '#8e24aa'];

/** Canvas dimensions (CSS pixels; HiDPI handled via devicePixelRatio). */
const CANVAS_HEIGHT = 120;
const MARGIN = { top: 10, right: 16, bottom: 28, left: 52 };

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
    this._dirty = new Set(); // params that need redrawing
    this._rafId = null;
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * (Re-)initialise the component for a new run.
   * @param {string[]} paramNames  - Parameter names (one canvas each)
   * @param {number}   nChains     - Number of chains
   */
  init(paramNames, nChains) {
    this.clear();
    this._nChains = nChains;

    for (const name of paramNames) {
      const entry = this._createCanvas(name, nChains);
      this._params.set(name, entry);
      this.container.appendChild(entry.wrapper);
    }
  }

  /**
   * Append one new sample for a (parameter, chain) pair.
   * Schedules a rAF redraw if not already scheduled.
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

    // Sliding window: drop the oldest point when at capacity
    if (chain.length >= MAX_POINTS) {
      chain.shift();
    }
    chain.push(value);

    this._dirty.add(paramName);
    this._scheduleRender();
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
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      overflow: hidden;
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

    // Legend (chain colour swatches)
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; gap:10px; padding: 2px 10px 4px; flex-wrap:wrap;';
    for (let c = 0; c < nChains; c++) {
      const swatch = document.createElement('span');
      swatch.style.cssText = `
        font-size:0.7rem; color:#555;
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
    // Width will be measured after insertion; use a default and resize in draw
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
    ctx.fillStyle = '#ffffff';
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
      // Nothing to draw yet
      ctx.fillStyle = '#aaa';
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

    const xScale = (i) => MARGIN.left + (i / (MAX_POINTS - 1)) * plotW;
    const yScale = (v) => MARGIN.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

    // --- Grid lines ---
    ctx.strokeStyle = '#e8edf2';
    ctx.lineWidth   = 0.5;
    const nYTicks = 4;
    for (let t = 0; t <= nYTicks; t++) {
      const y = MARGIN.top + (t / nYTicks) * plotH;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + plotW, y);
      ctx.stroke();
    }

    // --- Y axis labels ---
    ctx.fillStyle  = '#666';
    ctx.font       = '10px sans-serif';
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';
    for (let t = 0; t <= nYTicks; t++) {
      const v = yLo + ((nYTicks - t) / nYTicks) * (yHi - yLo);
      const y = MARGIN.top + (t / nYTicks) * plotH;
      ctx.fillText(_fmt(v), MARGIN.left - 4, y);
    }

    // --- X axis labels (iteration numbers) ---
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#666';
    const nXTicks = 4;
    for (let t = 0; t <= nXTicks; t++) {
      const fracI = t / nXTicks; // fraction of MAX_POINTS window
      const x     = MARGIN.left + fracI * plotW;
      // Approximate iteration shown (based on longest chain)
      const iterLabel = Math.round(fracI * (maxLen - 1)) + 1;
      ctx.fillText(iterLabel, x, MARGIN.top + plotH + 4);
    }

    // --- Axis lines ---
    ctx.strokeStyle = '#aaa';
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

      // Map each point index onto the X axis relative to the buffer
      const offset = MAX_POINTS - pts.length; // left shift when buffer not yet full
      pts.forEach((v, i) => {
        const xi = xScale(offset + i);
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
 * Format a number compactly for axis labels.
 * @param {number} v
 * @returns {string}
 */
function _fmt(v) {
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) {
    return v.toExponential(1);
  }
  return v.toPrecision(3).replace(/\.?0+$/, '');
}
