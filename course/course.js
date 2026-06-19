/**
 * course.js
 * Loads module prose (rendered from .qmd) and mounts the module's challenge
 * widget. Navigation and challenge wiring come from modules.js.
 *
 * Module HTML is loaded the same way popups are: fetch the pre-rendered fragment
 * (server mode), falling back to the generated course-bundle.js (file:// mode).
 */

import { SESSIONS, MODULES } from './modules.js';

// challenge type → dynamic import of its module
const CHALLENGE_LOADERS = {
  'discrete-bayes': () => import('./challenges/discrete-bayes.js'),
  'map-slider':     () => import('./challenges/map-slider.js'),
  'mcmc':           () => import('./challenges/mcmc-animation.js'),
  'code-validator': () => import('./challenges/code-validator.js'),
  'answer-check':   () => import('./challenges/answer-check.js'),
  'recorder':       () => import('./challenges/results-recorder.js'),
  'quiz':           () => import('./challenges/quiz.js'),
};

const _contentCache = new Map();
let _bundle = null;

async function loadBundle() {
  if (_bundle) return _bundle;
  try {
    const mod = await import('./content/course-bundle.js');
    _bundle = mod.COURSE_CONTENT || {};
  } catch (_) {
    _bundle = {};
  }
  return _bundle;
}

async function fetchModuleHtml(id) {
  if (_contentCache.has(id)) return _contentCache.get(id);
  try {
    const resp = await fetch(`content/_rendered/${id}.html`);
    if (resp.ok) {
      const html = await resp.text();
      _contentCache.set(id, html);
      return html;
    }
  } catch (_) { /* file:// — fall through to bundle */ }
  const bundle = await loadBundle();
  const html = bundle[id] ?? `<p><em>No content rendered for <code>${id}</code>. Run <code>npm run build:course</code>.</em></p>`;
  _contentCache.set(id, html);
  return html;
}

const KATEX_VER = '0.16.11';
let _katexReady = null;

/** Load KaTeX CSS + JS + auto-render once. Resolves when renderMathInElement exists. */
function loadKatex() {
  if (_katexReady) return _katexReady;
  _katexReady = new Promise(resolve => {
    if (!document.getElementById('course-katex-css')) {
      const link = document.createElement('link');
      link.id = 'course-katex-css';
      link.rel = 'stylesheet';
      link.href = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.css`;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
    const addScript = (src, onload) => {
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous'; s.onload = onload;
      s.onerror = () => resolve(); // offline / blocked — degrade gracefully
      document.head.appendChild(s);
    };
    if (window.renderMathInElement) { resolve(); return; }
    addScript(`https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.js`, () => {
      addScript(`https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/contrib/auto-render.min.js`, () => resolve());
    });
  });
  return _katexReady;
}

/** Render LaTeX delimiters inside an element (no-op if KaTeX unavailable). */
async function renderMath(el) {
  await loadKatex();
  if (!window.renderMathInElement) return;
  try {
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
    });
  } catch (_) { /* leave raw delimiters */ }
}

function progressKey(id) {
  try {
    return JSON.parse(localStorage.getItem('fangs-course:' + id))?.passed || false;
  } catch (_) { return false; }
}

function buildNav() {
  const nav = document.getElementById('course-nav');
  nav.innerHTML = SESSIONS.map(s => {
    const mods = MODULES.filter(m => m.session === s.id);
    return `
      <div class="nav-session">
        <div class="nav-session-title">${s.title}<span class="nav-mins">${s.minutes} min</span></div>
        ${mods.map(m => `
          <a class="nav-module" href="#${m.id}" data-id="${m.id}">
            <span class="nav-check" data-check="${m.id}">${progressKey(m.id) ? '✓' : ''}</span>
            <span class="nav-num">${m.num}</span>
            <span class="nav-name">${m.title}</span>
            <span class="nav-mode ${m.mode}">${m.mode === 'fangs' ? 'in FANGS' : 'interactive'}</span>
          </a>
        `).join('')}
      </div>`;
  }).join('');
}

function refreshChecks() {
  document.querySelectorAll('[data-check]').forEach(el => {
    el.textContent = progressKey(el.dataset.check) ? '✓' : '';
  });
}

async function showModule(id) {
  const module = MODULES.find(m => m.id === id) || MODULES[0];
  const main = document.getElementById('course-main');

  document.querySelectorAll('.nav-module').forEach(a =>
    a.classList.toggle('active', a.dataset.id === module.id));

  main.innerHTML = `
    <article class="module-prose" data-prose>Loading…</article>
    <section class="module-challenge" data-challenge-host></section>
  `;

  const html = await fetchModuleHtml(module.id);
  const proseEl = main.querySelector('[data-prose]');
  proseEl.innerHTML = html;
  main.scrollTop = 0;
  renderMath(proseEl);

  // Mount challenge
  const host = main.querySelector('[data-challenge-host]');
  const loader = CHALLENGE_LOADERS[module.challenge];
  if (loader) {
    const container = document.createElement('div');
    container.dataset.moduleId = module.id;
    host.appendChild(container);
    try {
      const widget = await loader();
      widget.mount(container, module.config || {});
    } catch (err) {
      container.innerHTML = `<p class="challenge-feedback bad">Could not load challenge: ${err.message}</p>`;
    }
    // Reflect any state change in the nav checkmarks (poll briefly after interaction)
    container.addEventListener('click', () => setTimeout(refreshChecks, 50), true);
  }
  refreshChecks();
}

function currentId() {
  const hash = location.hash.replace(/^#/, '');
  return MODULES.some(m => m.id === hash) ? hash : MODULES[0].id;
}

function init() {
  loadKatex();
  buildNav();
  showModule(currentId());
  window.addEventListener('hashchange', () => showModule(currentId()));
}

document.addEventListener('DOMContentLoaded', init);
