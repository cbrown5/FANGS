/**
 * code-validator.js  (Module 4)
 * Students write (or fix) a FANGS model and the real parser checks it. The
 * textarea is seeded with a model containing a deliberate bug; "Check syntax"
 * runs the same Lexer → Parser pipeline the sampler uses, so error messages
 * carry the real line/column. Lights green once the model parses cleanly.
 */

import { mountChallenge } from './challenge-base.js';
import { Lexer } from '../../src/parser/lexer.js';
import { Parser } from '../../src/parser/parser.js';

export function mount(container, config) {
  const { seed, hint } = config;

  mountChallenge(container, {
    id: 'm04-model-syntax',
    submitLabel: 'Check syntax',
    render(body, ctx) {
      body.innerHTML = `
        <p class="challenge-prompt">
          The model below has a syntax error. Fix it so the parser accepts it.
          Remember: FANGS' <code>dnorm</code> takes the <strong>mean and the
          standard deviation</strong>.
        </p>
        <textarea data-code class="challenge-code" spellcheck="false" rows="11"></textarea>
        ${hint ? `<p class="challenge-hint">Hint: ${hint}</p>` : ''}
      `;
      body.querySelector('[data-code]').value = seed;
      ctx._code = () => body.querySelector('[data-code]').value;
    },
    check(ctx) {
      const src = ctx._code();
      try {
        const tokens = new Lexer(src).tokenize();
        new Parser(tokens).parse();
        return { correct: true, feedback: 'Parsed cleanly — this is a valid FANGS model.' };
      } catch (err) {
        const loc = (err.token && err.token.line)
          ? ` (line ${err.token.line}, col ${err.token.col})`
          : (err.line ? ` (line ${err.line}, col ${err.col ?? '?'})` : '');
        return { correct: false, feedback: `${err.message}${loc}` };
      }
    },
  });
}
