/**
 * challenge-base.js
 * Shared framework for course challenge widgets.
 *
 * Every challenge mounts into a container element and follows the same
 * lifecycle so the workshop feels consistent and emphasises *doing*:
 *   - the widget renders its own interactive body via `render(bodyEl, ctx)`
 *   - a Submit / Check button calls `check(ctx) -> { correct, feedback }`
 *   - the status indicator "lights up green" on success
 *   - pass/attempt state persists to localStorage keyed by the module id
 *
 * Widgets either pass a `check` function (button-driven) or call
 * `ctx.markCorrect()` / `ctx.markIncorrect()` themselves for live checking.
 */

const LS_PREFIX = 'fangs-course:';

/** Read persisted state for a module ({ passed, attempts }). */
export function loadState(id) {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFIX + id)) || { passed: false, attempts: 0 };
  } catch (_) {
    return { passed: false, attempts: 0 };
  }
}

/** Persist state for a module. */
export function saveState(id, state) {
  try {
    localStorage.setItem(LS_PREFIX + id, JSON.stringify(state));
  } catch (_) { /* storage unavailable — non-fatal */ }
}

/**
 * Mount a challenge.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string}   opts.id                 - module id (storage key)
 * @param {string}   [opts.submitLabel]      - button text (default "Check answer")
 * @param {boolean}  [opts.autoButton=true]  - render the Submit button
 * @param {(bodyEl: HTMLElement, ctx: object) => void} opts.render
 * @param {(ctx: object) => {correct: boolean, feedback?: string}} [opts.check]
 * @returns {object} ctx
 */
export function mountChallenge(container, opts) {
  const { id, render, check, submitLabel = 'Check answer', autoButton = true } = opts;

  container.classList.add('challenge');
  container.innerHTML = `
    <div class="challenge-header">
      <span class="challenge-title">Challenge</span>
      <span class="challenge-status" data-status></span>
    </div>
    <div class="challenge-body" data-body></div>
    <div class="challenge-controls">
      ${autoButton ? `<button class="challenge-submit" data-submit>${submitLabel}</button>` : ''}
      <span class="challenge-attempts" data-attempts></span>
    </div>
    <div class="challenge-feedback" data-feedback></div>
  `;

  const bodyEl     = container.querySelector('[data-body]');
  const statusEl   = container.querySelector('[data-status]');
  const attemptsEl = container.querySelector('[data-attempts]');
  const feedbackEl = container.querySelector('[data-feedback]');
  const submitBtn  = container.querySelector('[data-submit]');

  let state = loadState(id);

  function paintStatus() {
    statusEl.textContent = state.passed ? '✓ Solved' : '';
    statusEl.className = 'challenge-status' + (state.passed ? ' solved' : '');
    attemptsEl.textContent = state.attempts ? `Attempts: ${state.attempts}` : '';
    container.classList.toggle('solved', state.passed);
  }

  function setFeedback(msg, ok) {
    feedbackEl.textContent = msg || '';
    feedbackEl.className = 'challenge-feedback' + (msg ? (ok ? ' ok' : ' bad') : '');
  }

  const ctx = {
    id,
    bodyEl,
    state,
    /** Mark the challenge solved (for live-checking widgets). */
    markCorrect(msg = 'Correct!') {
      state.passed = true;
      saveState(id, state);
      paintStatus();
      setFeedback(msg, true);
    },
    /** Mark a failed attempt. */
    markIncorrect(msg = 'Not quite — try again.') {
      paintStatus();
      setFeedback(msg, false);
    },
    setFeedback,
  };

  function runCheck() {
    if (!check) return;
    state.attempts += 1;
    const result = check(ctx) || {};
    if (result.correct) {
      state.passed = true;
      ctx.markCorrect(result.feedback || 'Correct!');
    } else {
      saveState(id, state);
      ctx.markIncorrect(result.feedback || 'Not quite — try again.');
    }
  }

  if (submitBtn) submitBtn.addEventListener('click', runCheck);

  render(bodyEl, ctx);
  paintStatus();
  if (state.passed) setFeedback('You solved this earlier.', true);

  return ctx;
}

/** Build an element from an HTML string (returns the first child). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
