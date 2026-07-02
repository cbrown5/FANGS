/**
 * answer-check.js  (Modules 5, 8, 11, 13–16, 18, 20)
 * The recurring "fit it in FANGS, then check your answer" challenge. Students
 * fit the named dataset in the live FANGS app, read the posterior summary, and
 * type the posterior mean for each key parameter here. The widget compares to
 * reference values (mean ± tol) supplied by the workshop author in modules.js.
 *
 * If the author has not yet filled in reference values (placeholders are all
 * zero), the widget falls back to self-report mode: it records the entered
 * values and marks the module done once every box is filled.
 */

import { mountChallenge } from './challenge-base.js';
import { parseNum, withinAbs } from './numeric.js';

function isConfigured(p) {
  return !(p.mean === 0 && p.ci[0] === 0 && p.ci[1] === 0);
}

export function mount(container, config) {
  const { dataset } = config;

  // Normalise config: flat `params` array or `sections` array of { label, params }
  const sections = config.sections
    ? config.sections
    : [{ label: null, params: config.params }];

  const allParams = sections.flatMap(s => s.params);
  const anyConfigured = allParams.some(isConfigured);

  // Assign a global index to each param for stable input keying
  let globalIdx = 0;
  const indexedSections = sections.map(s => ({
    label: s.label,
    params: s.params.map(p => ({ ...p, _idx: globalIdx++ })),
  }));

  mountChallenge(container, {
    id: container.dataset.moduleId,
    submitLabel: 'Check my answers',
    render(body, ctx) {
      const tableRows = sec => sec.params.map(p => `
        <tr><td>${p.label}</td>
        <td><input data-p="${p._idx}" type="text" inputmode="decimal" placeholder="mean"></td></tr>
      `).join('');

      const tables = indexedSections.map(sec => `
        ${sec.label ? `<h4 class="challenge-section-label">${sec.label}</h4>` : ''}
        <table class="challenge-table">
          <thead><tr><th>Parameter</th><th>Your posterior mean</th></tr></thead>
          <tbody>${tableRows(sec)}</tbody>
        </table>
      `).join('');

      body.innerHTML = `
        <p class="challenge-prompt">
          Open <a href="../index.html" target="_blank">FANGS</a>, load
          <code>${dataset}</code>, fit the model, then read the
          <em>Summary</em> tab and enter your posterior means below.
        </p>
        ${tables}
        ${anyConfigured ? '' : `<p class="challenge-hint">Self-check mode: the
          instructor has not pinned reference values for this dataset, so this
          records your answer once every box is filled.</p>`}
      `;
      ctx._vals = () => allParams.map((_, i) =>
        parseNum(body.querySelector(`[data-p="${i}"]`).value)
      );
    },
    check(ctx) {
      const vals = ctx._vals();
      if (vals.some(v => !Number.isFinite(v))) {
        return { correct: false, feedback: 'Enter a number for every parameter.' };
      }
      if (!anyConfigured) {
        return { correct: true, feedback: 'Recorded. Compare with a neighbour and discuss any differences.' };
      }
      for (let i = 0; i < allParams.length; i++) {
        const p = allParams[i];
        if (isConfigured(p) && !withinAbs(vals[i], p.mean, p.tol)) {
          return { correct: false, feedback: `${p.label} looks off. Check your model, priors, and that the chains converged (R-hat ≈ 1).` };
        }
      }
      return { correct: true, feedback: 'All parameters within tolerance of the reference fit. Nicely done.' };
    },
  });
}
