/**
 * mcmc-animation.js  (Module 3)
 * An animated Metropolis sampler walking over the same jaw-length posterior from
 * Module 2. Students watch the chain explore and the histogram of accumulated
 * draws converge to the true posterior. They tune the proposal SD and chain
 * length: too small → the chain crawls (high autocorrelation, low ESS); too big
 * → most proposals are rejected (low ESS). The challenge: tune it until the
 * effective sample size clears the target.
 */

import { mountChallenge } from './challenge-base.js';
import { dnorm } from '../../src/utils/distributions.js';
import { linspace, mean as arrMean } from '../../src/utils/math.js';

const GRID = 300;

export function mount(container, config) {
  const { xMin, xMax, sigmaLik, data, prior, targetEss } = config;
  const grid = linspace(xMin, xMax, GRID);

  const logPost = mu => {
    let lp = dnorm(mu, prior.mu, prior.sd);
    for (const y of data) lp += dnorm(y, mu, sigmaLik);
    return lp;
  };
  const trueCurve = grid.map(mu => Math.exp(logPost(mu)));
  const trueMax = Math.max(...trueCurve);

  mountChallenge(container, {
    id: 'm03-mcmc-sampling',
    submitLabel: 'Check effective sample size',
    render(body, ctx) {
      body.innerHTML = `
        <p class="challenge-prompt">
          Run the sampler and watch the histogram build toward the true posterior
          (purple). Tune the <strong>proposal SD</strong> and number of steps to
          reach an effective sample size (ESS) of at least <strong>${targetEss}</strong>.
        </p>
        <div class="challenge-slider-row">
          <label>Proposal SD <input data-prop type="range" min="0.2" max="20" step="0.2" value="3"></label>
          <output data-propout>3.0</output>
        </div>
        <div class="challenge-slider-row">
          <label>Steps <input data-steps type="range" min="200" max="5000" step="200" value="1500"></label>
          <output data-stepsout>1500</output>
        </div>
        <canvas data-canvas height="200"></canvas>
        <div class="challenge-controls">
          <button data-run class="challenge-submit">Run sampler</button>
          <span class="challenge-attempts" data-stats></span>
        </div>
      `;

      const canvas   = body.querySelector('[data-canvas]');
      const propEl    = body.querySelector('[data-prop]');
      const stepsEl   = body.querySelector('[data-steps]');
      const propOut   = body.querySelector('[data-propout]');
      const stepsOut  = body.querySelector('[data-stepsout]');
      const statsEl   = body.querySelector('[data-stats]');
      const runBtn    = body.querySelector('[data-run]');

      propEl.addEventListener('input', () => propOut.textContent = (+propEl.value).toFixed(1));
      stepsEl.addEventListener('input', () => stepsOut.textContent = stepsEl.value);

      let samples = [];
      let raf = null;

      function reset() {
        samples = [];
        ctx._ess = 0;
        drawHist(canvas, grid, trueCurve, trueMax, samples, xMin, xMax);
        statsEl.textContent = '';
      }
      reset();

      runBtn.addEventListener('click', () => {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        reset();
        const propSd = +propEl.value;
        const nSteps = +stepsEl.value;
        let cur = (xMin + xMax) / 2;
        let curLp = logPost(cur);
        let accepted = 0, done = 0;

        function step() {
          const batch = Math.max(10, Math.floor(nSteps / 60));
          for (let k = 0; k < batch && done < nSteps; k++, done++) {
            const prop = cur + propSd * gaussian();
            const propLp = logPost(prop);
            if (Math.log(Math.random()) < propLp - curLp) {
              cur = prop; curLp = propLp; accepted++;
            }
            samples.push(cur);
          }
          drawHist(canvas, grid, trueCurve, trueMax, samples, xMin, xMax);
          const ess = effectiveSampleSize(samples);
          ctx._ess = ess;
          statsEl.textContent =
            `n=${samples.length}  accept=${(100 * accepted / samples.length).toFixed(0)}%  ESS≈${ess.toFixed(0)}`;
          if (done < nSteps) raf = requestAnimationFrame(step);
        }
        step();
      });

      ctx._ess = 0;
    },
    check(ctx) {
      if (ctx._ess >= targetEss) {
        return { correct: true, feedback: `ESS ≈ ${ctx._ess.toFixed(0)} — well-mixed. Notice how both extreme proposal SDs hurt ESS.` };
      }
      return { correct: false, feedback: `ESS ≈ ${ctx._ess.toFixed(0)} is below ${targetEss}. Try a different proposal SD (mid-range mixes best) and run again.` };
    },
  });
}

/** Standard normal via Box-Muller. */
function gaussian() {
  return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** Simple autocorrelation-based ESS (Geyer initial-positive-sequence, truncated). */
function effectiveSampleSize(x) {
  const n = x.length;
  if (n < 10) return n;
  const m = arrMean(x);
  let v0 = 0;
  for (const xi of x) v0 += (xi - m) ** 2;
  v0 /= n;
  if (v0 === 0) return n;
  let sumRho = 0;
  const maxLag = Math.min(n - 1, 500);
  for (let k = 1; k < maxLag; k++) {
    let c = 0;
    for (let i = 0; i < n - k; i++) c += (x[i] - m) * (x[i + k] - m);
    const rho = c / (n - k) / v0;
    if (rho <= 0) break;
    sumRho += rho;
  }
  return n / (1 + 2 * sumRho);
}

/** Draw the accumulating histogram against the true posterior curve. */
function drawHist(canvas, grid, trueCurve, trueMax, samples, xMin, xMax) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 560;
  const cssH = 200;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 8, padR = 8, padT = 8, padB = 22;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  const xPix = x => padL + ((x - xMin) / (xMax - xMin)) * plotW;

  // histogram
  const NB = 40;
  const counts = new Array(NB).fill(0);
  const bw = (xMax - xMin) / NB;
  for (const s of samples) {
    let b = Math.floor((s - xMin) / bw);
    if (b >= 0 && b < NB) counts[b]++;
  }
  const maxCount = Math.max(1, ...counts);
  ctx.fillStyle = 'rgba(80,250,123,0.35)';
  for (let b = 0; b < NB; b++) {
    const h = (counts[b] / maxCount) * plotH;
    ctx.fillRect(xPix(xMin + b * bw), padT + plotH - h, plotW / NB - 1, h);
  }

  // true posterior
  ctx.strokeStyle = '#bd93f9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < grid.length; i++) {
    const px = xPix(grid[i]);
    const py = padT + plotH - (trueCurve[i] / trueMax) * plotH;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();

  // axis
  ctx.strokeStyle = '#44475a';
  ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
  ctx.fillStyle = '#6272a4';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(xMin), padL, cssH - 6);
  ctx.fillText(String(xMax), padL + plotW, cssH - 6);
}
