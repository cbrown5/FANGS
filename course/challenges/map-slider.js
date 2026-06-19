/**
 * map-slider.js  (Module 2)
 * Students drag a slider over the parameter μ (mean jaw length) to find the
 * maximum a posteriori (MAP) value. The canvas shows the prior and the
 * likelihood (and the resulting unnormalised posterior) so they can see how the
 * two combine. Submitting lights green when the slider is within tolerance of
 * the true MAP. Switching prior presets moves the MAP, reinforcing prior
 * influence.
 *
 * Reuses FANGS' own dnorm / linspace so the maths matches the sampler exactly.
 */

import { mountChallenge } from './challenge-base.js';
import { withinAbs } from './numeric.js';
import { dnorm } from '../../src/utils/distributions.js';
import { linspace } from '../../src/utils/math.js';

const GRID = 400;

export function mount(container, config) {
  const { xMin, xMax, sigmaLik, data, priors, sliderStep, tol, xLabel } = config;
  const priorNames = Object.keys(priors);
  let activePrior = priorNames[0];

  const grid = linspace(xMin, xMax, GRID);

  /** log prior + log likelihood over the grid for the active prior. */
  function logPostGrid() {
    const pr = priors[activePrior];
    return grid.map(mu => {
      let lp = dnorm(mu, pr.mu, pr.sd);
      for (const y of data) lp += dnorm(y, mu, sigmaLik);
      return lp;
    });
  }

  /** Index of the MAP on the grid. */
  function mapValue() {
    const lp = logPostGrid();
    let bi = 0;
    for (let i = 1; i < lp.length; i++) if (lp[i] > lp[bi]) bi = i;
    return grid[bi];
  }

  mountChallenge(container, {
    id: 'm02-continuous-bayes',
    submitLabel: 'Submit MAP estimate',
    render(body, ctx) {
      body.innerHTML = `
        <p class="challenge-prompt">
          Drag the slider to the most probable value of μ given the data (the MAP).
          The posterior ∝ prior × likelihood — its peak is what you are hunting.
        </p>
        <label class="challenge-inline">Prior:
          <select data-prior>
            ${priorNames.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </label>
        <canvas data-canvas height="220"></canvas>
        <div class="challenge-slider-row">
          <input data-slider type="range" min="${xMin}" max="${xMax}" step="${sliderStep}" value="${(xMin + xMax) / 2}" />
          <output data-out></output>
        </div>
        <div class="challenge-legend">
          <span class="lg lg-prior">prior</span>
          <span class="lg lg-lik">likelihood</span>
          <span class="lg lg-post">posterior</span>
          <span class="lg lg-guess">your guess</span>
        </div>
      `;

      const canvas = body.querySelector('[data-canvas]');
      const slider = body.querySelector('[data-slider]');
      const out = body.querySelector('[data-out]');
      const priorSel = body.querySelector('[data-prior]');

      function draw() {
        const guess = parseFloat(slider.value);
        out.textContent = `μ = ${guess.toFixed(1)} ${config.units || ''}`;

        const pr = priors[activePrior];
        const priorY = grid.map(mu => Math.exp(dnorm(mu, pr.mu, pr.sd)));
        const likY = grid.map(mu => {
          let ll = 0; for (const y of data) ll += dnorm(y, mu, sigmaLik); return Math.exp(ll);
        });
        const lp = logPostGrid();
        const maxLp = Math.max(...lp);
        const postY = lp.map(v => Math.exp(v - maxLp));

        drawCurves(canvas, grid, [
          { ys: priorY, cls: 'prior', color: '#8be9fd' },
          { ys: likY,   cls: 'lik',   color: '#ffb86c' },
          { ys: postY,  cls: 'post',  color: '#bd93f9' },
        ], { xMin, xMax, guess, xLabel });
      }

      slider.addEventListener('input', draw);
      priorSel.addEventListener('change', e => {
        activePrior = e.target.value;
        ctx.setFeedback('Prior changed — find the new MAP.', false);
        draw();
      });

      ctx._guess = () => parseFloat(slider.value);
      draw();
    },
    check(ctx) {
      const target = mapValue();
      if (withinAbs(ctx._guess(), target, tol)) {
        return { correct: true, feedback: `MAP ≈ ${target.toFixed(1)}. Try another prior to see the peak move.` };
      }
      const dir = ctx._guess() < target ? 'higher' : 'lower';
      return { correct: false, feedback: `Not yet — try a ${dir} value. Look for the peak of the purple posterior.` };
    },
  });
}

/** Draw a set of curves (each pre-scaled to its own max) on a canvas. */
function drawCurves(canvas, xs, curves, { xMin, xMax, guess, xLabel }) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 560;
  const cssH = 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 8, padR = 8, padT = 10, padB = 28;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  const xPix = x => padL + ((x - xMin) / (xMax - xMin)) * plotW;

  // axis line
  ctx.strokeStyle = '#44475a';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();

  for (const c of curves) {
    const maxY = Math.max(...c.ys) || 1;
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const px = xPix(xs[i]);
      const py = padT + plotH - (c.ys[i] / maxY) * plotH;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // guess marker
  const gx = xPix(guess);
  ctx.strokeStyle = '#50fa7b';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + plotH); ctx.stroke();
  ctx.setLineDash([]);

  // x label + ticks
  ctx.fillStyle = '#6272a4';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(xMin), padL, cssH - 10);
  ctx.fillText(String(xMax), padL + plotW, cssH - 10);
  if (xLabel) ctx.fillText(xLabel, padL + plotW / 2, cssH - 10);
}
