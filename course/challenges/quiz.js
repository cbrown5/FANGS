/**
 * quiz.js  (Modules 7, 9, 10, 17)
 * A short multiple-choice concept check. All questions must be answered
 * correctly to light green. Used for prior/posterior predictive interpretation,
 * diagnostics, and the random-effects concept module.
 */

import { mountChallenge } from './challenge-base.js';

export function mount(container, config) {
  const { questions } = config;

  mountChallenge(container, {
    id: container.dataset.moduleId,
    submitLabel: 'Submit answers',
    render(body, ctx) {
      body.innerHTML = questions.map((q, qi) => `
        <fieldset class="challenge-q">
          <legend>${qi + 1}. ${q.q}</legend>
          ${q.options.map((opt, oi) => `
            <label class="challenge-opt">
              <input type="radio" name="q${qi}" value="${oi}"> ${opt}
            </label>
          `).join('')}
        </fieldset>
      `).join('');
      ctx._answers = () => questions.map((_, qi) => {
        const sel = body.querySelector(`input[name="q${qi}"]:checked`);
        return sel ? +sel.value : -1;
      });
    },
    check(ctx) {
      const ans = ctx._answers();
      if (ans.some(a => a === -1)) {
        return { correct: false, feedback: 'Answer every question first.' };
      }
      const wrong = ans.filter((a, i) => a !== questions[i].answer).length;
      if (wrong === 0) {
        return { correct: true, feedback: 'All correct.' };
      }
      return { correct: false, feedback: `${wrong} answer${wrong > 1 ? 's' : ''} not right — revisit the section above.` };
    },
  });
}
