/**
 * scatter-plot.js
 * Bivariate scatter plot for MCMC parameter samples.
 *
 * Lets the user pick two parameters from dropdowns, then plots every
 * posterior sample as a point to reveal correlations between parameters.
 */

const CANVAS_HEIGHT = 380;
const MARGIN = { top: 20, right: 20, bottom: 52, left: 60 };
const POINT_COLOR  = 'rgba(189,147,249,0.25)';  // Dracula purple, semi-transparent
const POINT_STROKE = 'rgba(189,147,249,0.6)';
const POINT_RADIUS = 2.5;
const MAX_POINTS   = 2000;  // subsample if more samples to keep rendering fast

export class ScatterPlot {
  /**
   * @param {HTMLElement} containerEl
   */
  constructor(containerEl) {
    if (!containerEl) throw new Error('ScatterPlot: containerEl is required');
    this.container = containerEl;

    /** Map<paramName, number[]> — all posterior samples */
    this._samples = {};

    this._xParam = null;
    this._yParam = null;

    this._built = false;
    this._canvas = null;
    this._ctx    = null;
    this._xSelect = null;
    this._ySelect = null;

    this._build();
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * Provide the full set of posterior samples for all parameters.
   * @param {{ [paramName: string]: number[] }} samplesMap
   */
  setSamplesMap(samplesMap) {
    this._samples = samplesMap;
    this._updateSelects();
    this._draw();
  }

  /**
   * Remove all data and reset to empty state.
   */
  clear() {
    this._samples  = {};
    this._xParam   = null;
    this._yParam   = null;
    if (this._xSelect) {
      this._xSelect.innerHTML = '<option value="">— select —</option>';
      this._ySelect.innerHTML = '<option value="">— select —</option>';
    }
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._drawEmpty();
    }
  }

  /**
   * Re-render (e.g. after a container resize).
   */
  render() {
    this._draw();
  }

  // ------------------------------------------------------------------ //
  // Internal                                                             //
  // ------------------------------------------------------------------ //

  _build() {
    // Title row
    const title = document.createElement('div');
    title.className = 'pane-title';
    title.textContent = 'Joint Parameter Distribution';
    this.container.appendChild(title);

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:0.82rem;color:#6272a4;margin:4px 0 14px;';
    desc.textContent =
      'Plot MCMC samples for two parameters to visualise their joint posterior and correlations.';
    this.container.appendChild(desc);

    // Controls row
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;';

    const makeSelectGroup = (labelText) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      lbl.style.cssText = 'font-size:0.82rem;color:#bd93f9;white-space:nowrap;';
      const sel = document.createElement('select');
      sel.style.cssText = [
        'background:#282a36',
        'color:#f8f8f2',
        'border:1px solid #44475a',
        'border-radius:4px',
        'padding:4px 8px',
        'font-size:0.82rem',
        'font-family:Fira Mono,monospace',
        'cursor:pointer',
        'min-width:110px',
      ].join(';');
      sel.innerHTML = '<option value="">— select —</option>';
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      return { wrap, sel };
    };

    const xGroup = makeSelectGroup('X axis:');
    const yGroup = makeSelectGroup('Y axis:');
    this._xSelect = xGroup.sel;
    this._ySelect = yGroup.sel;

    controls.appendChild(xGroup.wrap);
    controls.appendChild(yGroup.wrap);
    this.container.appendChild(controls);

    // Correlation label
    this._corrLabel = document.createElement('div');
    this._corrLabel.style.cssText =
      'font-size:0.82rem;color:#6272a4;margin-bottom:8px;min-height:1.2em;';
    this.container.appendChild(this._corrLabel);

    // Canvas
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText =
      'background:#12101a;border:1px solid #3a2a5a;border-radius:6px;overflow:hidden;';
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = `display:block;width:100%;height:${CANVAS_HEIGHT}px;`;
    canvasWrap.appendChild(this._canvas);
    this.container.appendChild(canvasWrap);

    this._ctx = this._canvas.getContext('2d');
    this._drawEmpty();

    // Event listeners
    this._xSelect.addEventListener('change', () => {
      this._xParam = this._xSelect.value || null;
      this._draw();
    });
    this._ySelect.addEventListener('change', () => {
      this._yParam = this._ySelect.value || null;
      this._draw();
    });

    // Resize observer
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this._draw());
      ro.observe(this.container);
    }

    this._built = true;
  }

  _updateSelects() {
    const params = Object.keys(this._samples).sort();
    const prevX  = this._xParam;
    const prevY  = this._yParam;

    const populate = (sel, prev) => {
      sel.innerHTML = '<option value="">— select —</option>';
      for (const p of params) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === prev) opt.selected = true;
        sel.appendChild(opt);
      }
    };
    populate(this._xSelect, prevX);
    populate(this._ySelect, prevY);

    // Auto-select first two params if nothing chosen yet
    if (!this._xParam && params.length >= 1) {
      this._xParam = params[0];
      this._xSelect.value = params[0];
    }
    if (!this._yParam && params.length >= 2) {
      this._yParam = params[1];
      this._ySelect.value = params[1];
    }
  }

  _drawEmpty() {
    const canvas = this._canvas;
    const ctx    = this._ctx;
    const dpr    = window.devicePixelRatio || 1;
    const cssW   = canvas.clientWidth  || canvas.parentElement?.clientWidth || 400;
    const cssH   = CANVAS_HEIGHT;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#12101a';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#6272a4';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select two parameters to plot their joint distribution.', cssW / 2, cssH / 2);
    this._corrLabel.textContent = '';
  }

  _draw() {
    if (!this._canvas) return;
    const xName = this._xParam;
    const yName = this._yParam;

    if (!xName || !yName || !this._samples[xName] || !this._samples[yName]) {
      this._drawEmpty();
      return;
    }

    const xAll = this._samples[xName];
    const yAll = this._samples[yName];
    const n    = Math.min(xAll.length, yAll.length);

    if (n < 2) {
      this._drawEmpty();
      return;
    }

    // Subsample if needed
    let xs, ys;
    if (n > MAX_POINTS) {
      const step = n / MAX_POINTS;
      xs = [];
      ys = [];
      for (let i = 0; i < MAX_POINTS; i++) {
        const idx = Math.floor(i * step);
        xs.push(xAll[idx]);
        ys.push(yAll[idx]);
      }
    } else {
      xs = xAll.slice(0, n);
      ys = yAll.slice(0, n);
    }

    const canvas = this._canvas;
    const ctx    = this._ctx;
    const dpr    = window.devicePixelRatio || 1;
    const cssW   = canvas.clientWidth || canvas.parentElement?.clientWidth || 400;
    const cssH   = CANVAS_HEIGHT;

    if (canvas.width  !== Math.round(cssW * dpr) ||
        canvas.height !== Math.round(cssH * dpr)) {
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W     = cssW;
    const H     = cssH;
    const plotW = W - MARGIN.left - MARGIN.right;
    const plotH = H - MARGIN.top  - MARGIN.bottom;

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#12101a';
    ctx.fillRect(0, 0, W, H);

    // Data ranges with a small padding
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xPad = (xMax - xMin || 1) * 0.05;
    const yPad = (yMax - yMin || 1) * 0.05;
    const xLo = xMin - xPad, xHi = xMax + xPad;
    const yLo = yMin - yPad, yHi = yMax + yPad;

    const xScale = (v) => MARGIN.left  + ((v - xLo) / (xHi - xLo)) * plotW;
    const yScale = (v) => MARGIN.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

    // Grid lines
    const { ticks: xTicks, step: xStep } = _niceTicks(xLo, xHi, 5);
    const { ticks: yTicks, step: yStep } = _niceTicks(yLo, yHi, 5);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 0.5;
    for (const tv of xTicks) {
      const px = xScale(tv);
      if (px < MARGIN.left || px > MARGIN.left + plotW) continue;
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.top);
      ctx.lineTo(px, MARGIN.top + plotH);
      ctx.stroke();
    }
    for (const tv of yTicks) {
      const py = yScale(tv);
      if (py < MARGIN.top || py > MARGIN.top + plotH) continue;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, py);
      ctx.lineTo(MARGIN.left + plotW, py);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#3a2a5a';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // Tick labels
    ctx.fillStyle    = '#8877aa';
    ctx.font         = '10px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    for (const tv of xTicks) {
      const px = xScale(tv);
      if (px < MARGIN.left || px > MARGIN.left + plotW) continue;
      ctx.fillText(_fmt(tv, xStep), px, MARGIN.top + plotH + 5);
    }
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    for (const tv of yTicks) {
      const py = yScale(tv);
      if (py < MARGIN.top || py > MARGIN.top + plotH) continue;
      ctx.fillText(_fmt(tv, yStep), MARGIN.left - 5, py);
    }

    // Axis labels
    ctx.fillStyle    = '#bd93f9';
    ctx.font         = 'bold 11px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(xName, MARGIN.left + plotW / 2, H - 4);

    ctx.save();
    ctx.translate(13, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText(yName, 0, 0);
    ctx.restore();

    // Points
    ctx.fillStyle   = POINT_COLOR;
    ctx.strokeStyle = POINT_STROKE;
    ctx.lineWidth   = 0.5;
    const m = xs.length;
    for (let i = 0; i < m; i++) {
      const px = xScale(xs[i]);
      const py = yScale(ys[i]);
      // clip to plot area
      if (px < MARGIN.left || px > MARGIN.left + plotW ||
          py < MARGIN.top  || py > MARGIN.top  + plotH) continue;
      ctx.beginPath();
      ctx.arc(px, py, POINT_RADIUS, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Pearson correlation
    const r = _pearson(xs, ys);
    this._corrLabel.textContent =
      `Pearson r = ${r.toFixed(3)}  (n = ${n.toLocaleString()} samples` +
      (n > MAX_POINTS ? `, showing ${MAX_POINTS.toLocaleString()} subsampled` : '') +
      ')';
    this._corrLabel.style.color = Math.abs(r) > 0.5 ? '#ffb86c' : '#6272a4';
  }
}

// ------------------------------------------------------------------ //
// Helpers                                                             //
// ------------------------------------------------------------------ //

function _pearson(xs, ys) {
  const n   = xs.length;
  let sumX  = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
  const mx = sumX / n, my = sumY / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function _niceTicks(lo, hi, n) {
  const range = hi - lo || 1;
  const roughStep = range / n;
  const mag  = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const step = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.001; v += step) {
    ticks.push(parseFloat(v.toPrecision(10)));
  }
  return { ticks, step };
}

function _fmt(v, step) {
  if (!isFinite(v)) return '';
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(1);
  if (step !== undefined && step > 0) {
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return v.toFixed(decimals);
  }
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return parseFloat(v.toPrecision(3)).toString();
}
