/**
 * discrete-bayes.js  (Module 1)
 * Students compute a discrete posterior by hand: for each hypothesis they enter
 * the numerator (prior × likelihood), then the shared denominator (the SUM of
 * the numerators), then each posterior (numerator / denominator). Every cell is
 * checked against the true value with tolerance, and the whole thing relights
 * when the prior preset is switched — driving home that the denominator is just
 * the sum of the numerators across models.
 */

import { mountChallenge } from './challenge-base.js';
import { parseNum, withinAbs } from './numeric.js';
import { numerators, denominator } from './bayes-math.js';

export function mount(container, config) {
  const { hypotheses, likelihood, priors, tol } = config;
  const priorNames = Object.keys(priors);
  let activePrior = priorNames[0];

  mountChallenge(container, {
    id: 'm01-discrete-bayes',
    submitLabel: 'Check my calculations',
    render(body, ctx) {
      body.innerHTML = `
        <p class="challenge-prompt">
          A tagged fish was detected. Given the detection likelihoods below,
          work out the posterior probability it came from each reef. Fill in the
          <strong>numerator</strong> (prior × likelihood) for each reef, the
          <strong>denominator</strong> (the sum of those numerators), then each
          <strong>posterior</strong>.
        </p>
        <label class="challenge-inline">Prior:
          <select data-prior>
            ${priorNames.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </label>
        <table class="challenge-table">
          <thead>
            <tr><th>Reef</th><th>Prior</th><th>Likelihood</th>
                <th>Numerator</th><th>Posterior</th></tr>
          </thead>
          <tbody data-rows></tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align:right">Denominator (sum of numerators):</td>
              <td><input data-denom type="text" inputmode="decimal" /></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      `;

      const rowsEl = body.querySelector('[data-rows]');
      const priorSel = body.querySelector('[data-prior]');

      function renderRows() {
        const pr = priors[activePrior];
        rowsEl.innerHTML = hypotheses.map((h, i) => `
          <tr>
            <td>${h}</td>
            <td class="num">${pr[i].toFixed(3)}</td>
            <td class="num">${likelihood[i].toFixed(3)}</td>
            <td><input data-numer="${i}" type="text" inputmode="decimal" /></td>
            <td><input data-post="${i}"  type="text" inputmode="decimal" /></td>
          </tr>
        `).join('');
      }
      renderRows();

      priorSel.addEventListener('change', e => {
        activePrior = e.target.value;
        renderRows();
        ctx.setFeedback('Prior changed — recompute the posterior.', false);
      });

      // expose lookups for check()
      ctx._read = () => {
        const numer = hypotheses.map((_, i) =>
          parseNum(body.querySelector(`[data-numer="${i}"]`).value));
        const post = hypotheses.map((_, i) =>
          parseNum(body.querySelector(`[data-post="${i}"]`).value));
        const denom = parseNum(body.querySelector('[data-denom]').value);
        return { numer, post, denom };
      };
    },
    check(ctx) {
      const pr = priors[activePrior];
      const trueNumer = numerators(pr, likelihood);
      const trueDenom = denominator(trueNumer);
      const truePost = trueNumer.map(n => n / trueDenom);

      const { numer, post, denom } = ctx._read();

      for (let i = 0; i < hypotheses.length; i++) {
        if (!withinAbs(numer[i], trueNumer[i], tol)) {
          return { correct: false, feedback: `Numerator for ${hypotheses[i]} is off. It is prior × likelihood.` };
        }
      }
      if (!withinAbs(denom, trueDenom, tol)) {
        return { correct: false, feedback: 'Denominator is off — it is the sum of all the numerators you just entered.' };
      }
      for (let i = 0; i < hypotheses.length; i++) {
        if (!withinAbs(post[i], truePost[i], tol)) {
          return { correct: false, feedback: `Posterior for ${hypotheses[i]} is off. It is numerator ÷ denominator.` };
        }
      }
      return { correct: true, feedback: `Correct for the "${activePrior}". Now switch the prior and see how the posterior shifts.` };
    },
  });
}
