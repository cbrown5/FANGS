/**
 * popups.js
 * Educational pop-up system for FANGS.
 *
 * ## How it works
 * 1. Any HTML element with a `data-popup="<id>"` attribute gets a small "?" button
 *    appended to it automatically when `initPopups()` is called.
 * 2. Clicking the "?" button fetches the pre-rendered HTML fragment from
 *    `src/content/popups/_rendered/<id>.html` (server mode), or falls back to
 *    the inline bundle `src/content/popups-bundle.js` (file:// mode).
 * 3. `attachPopupTrigger(el, id)` can also be called programmatically for
 *    dynamically-created elements (e.g. summary table headers).
 *
 * ## Adding new popups
 * 1. Create `src/content/popups/<your-id>.qmd` with content in Markdown or
 *    Quarto-extended Markdown (LaTeX math with $...$, etc.).
 * 2. Run `npm run build:popups` to render and regenerate the bundle.
 *    (Requires Quarto: https://quarto.org)
 * 3. Add `data-popup="your-id"` to the relevant HTML element, OR call
 *    `attachPopupTrigger(element, 'your-id')` from JavaScript.
 * 4. Commit both the `.qmd` source and the updated `popups-bundle.js`.
 */

import { POPUP_CONTENT } from '../content/popups-bundle.js';

// In-memory cache: popup ID → HTML string (fetched or from bundle)
const _cache = new Map();

// ------------------------------------------------------------------ //
// Public API                                                          //
// ------------------------------------------------------------------ //

/**
 * Scan the document for `[data-popup]` elements and attach trigger buttons.
 * Call once after the DOM is ready.
 */
export function initPopups() {
  _injectStyles();
  document.querySelectorAll('[data-popup]').forEach(el => {
    attachPopupTrigger(el, el.dataset.popup);
  });
}

/**
 * Show a modal error dialog with a title, technical detail, and optional suggestion.
 * Does not require any popup content files — the HTML is generated inline.
 *
 * @param {string} title      - Short human-readable title (e.g. "Model Syntax Error")
 * @param {string} detail     - Technical error message from the thrown error
 * @param {string} [suggestion] - Optional fix suggestion shown below the detail
 */
export function showErrorModal(title, detail, suggestion = '') {
  _injectStyles();

  const escapedDetail = detail
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const suggestionHtml = suggestion
    ? `<p class="fangs-error-suggestion">${suggestion}</p>`
    : '';

  const html = `
    <div class="fangs-error-header">
      <span class="fangs-error-icon">&#9888;</span>
      <h2>${title}</h2>
    </div>
    <pre class="fangs-error-detail">${escapedDetail}</pre>
    ${suggestionHtml}
  `;

  _openModal(html, 'error', true);
}

/**
 * Programmatically attach a "?" trigger button to an existing element.
 * Safe to call multiple times on the same element (idempotent via data attribute).
 *
 * @param {HTMLElement} el       - The element to attach the trigger to
 * @param {string}      popupId  - The popup ID (maps to `<id>.qmd`)
 */
export function attachPopupTrigger(el, popupId) {
  if (!el || !popupId) return;
  // Prevent double-attaching
  if (el.dataset.popupAttached === popupId) return;
  el.dataset.popupAttached = popupId;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fangs-popup-trigger';
  btn.setAttribute('aria-label', 'Learn more');
  btn.setAttribute('title', 'Learn more');
  btn.textContent = '?';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _showPopup(popupId);
  });

  el.appendChild(btn);
}

// ------------------------------------------------------------------ //
// Internal helpers                                                    //
// ------------------------------------------------------------------ //

/**
 * Return the HTML string for a popup ID.
 *
 * Strategy:
 *   1. Return from in-memory cache if already loaded.
 *   2. Try fetch() from the pre-rendered .html file (requires a server).
 *   3. Fall back to the pre-rendered bundle (works with file://).
 *
 * @param {string} popupId
 * @returns {Promise<string>} HTML string
 */
async function fetchPopupContent(popupId) {
  if (_cache.has(popupId)) return _cache.get(popupId);

  // Attempt live fetch (server mode — requires npx serve . or similar)
  try {
    const url = `src/content/popups/_rendered/${popupId}.html`;
    const resp = await fetch(url);
    if (resp.ok) {
      const html = await resp.text();
      _cache.set(popupId, html);
      return html;
    }
  } catch (_) {
    // fetch() throws on file:// — fall through to bundle
  }

  // Bundle fallback (pre-rendered HTML strings, works everywhere)
  const html = POPUP_CONTENT[popupId]
    ?? `<p><em>No popup content found for <code>${popupId}</code>.</em></p>`;
  _cache.set(popupId, html);
  return html;
}

/**
 * Fetch HTML for a popup ID and open the modal.
 * Shows a loading placeholder immediately while the fetch is in flight.
 *
 * @param {string} popupId
 */
async function _showPopup(popupId) {
  // Show loading state immediately so the UI feels responsive
  _openModal('<p class="fangs-popup-loading">Loading\u2026</p>', popupId);

  const html = await fetchPopupContent(popupId);

  // Replace the body content once loaded
  const body = document.querySelector('#fangs-popup-modal .fangs-popup-body');
  if (body) body.innerHTML = html;
}

/**
 * Create and show the modal overlay.
 *
 * @param {string}  html     - HTML content to display
 * @param {string}  popupId  - Used for aria-label
 * @param {boolean} [isError] - If true, applies error styling to the dialog
 */
function _openModal(html, popupId, isError = false) {
  // Remove any existing modal first
  document.getElementById('fangs-popup-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fangs-popup-modal';
  overlay.className = 'fangs-popup-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', isError ? 'Error' : 'Educational popup');

  const dialogClass = isError ? 'fangs-popup-dialog fangs-error-dialog' : 'fangs-popup-dialog';

  overlay.innerHTML = `
    <div class="${dialogClass}">
      <button class="fangs-popup-close" aria-label="Close">&times;</button>
      <div class="fangs-popup-body">${html}</div>
    </div>
  `;

  // Close on overlay click (outside dialog)
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  // Close button
  overlay.querySelector('.fangs-popup-close').addEventListener('click', () => {
    overlay.remove();
  });

  // Close on Escape
  const handleEsc = e => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);

  document.body.appendChild(overlay);

  // Focus the dialog for accessibility
  overlay.querySelector('.fangs-popup-dialog').setAttribute('tabindex', '-1');
  overlay.querySelector('.fangs-popup-dialog').focus();
}

// ------------------------------------------------------------------ //
// Styles                                                              //
// ------------------------------------------------------------------ //

function _injectStyles() {
  if (document.getElementById('fangs-popup-styles')) return;

  // KaTeX CSS — required to render math spans pre-rendered by Quarto at build time.
  // Math is already converted to HTML by Quarto; this CSS handles the visual styling.
  if (!document.getElementById('fangs-katex-css')) {
    const katexLink = document.createElement('link');
    katexLink.id = 'fangs-katex-css';
    katexLink.rel = 'stylesheet';
    katexLink.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    katexLink.crossOrigin = 'anonymous';
    document.head.appendChild(katexLink);
  }

  const style = document.createElement('style');
  style.id = 'fangs-popup-styles';
  style.textContent = `
    /* ---- Trigger button ---- */
    .fangs-popup-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 1px solid currentColor;
      background: transparent;
      color: inherit;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      opacity: 0.6;
      margin-left: 5px;
      flex-shrink: 0;
      vertical-align: middle;
      padding: 0;
      transition: opacity 0.15s, background 0.15s;
    }
    .fangs-popup-trigger:hover {
      opacity: 1;
      background: rgba(255,255,255,0.15);
    }

    /* ---- Overlay ---- */
    .fangs-popup-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      backdrop-filter: blur(2px);
    }

    /* ---- Dialog ---- */
    .fangs-popup-dialog {
      background: #ffffff;
      border-radius: 10px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.3);
      max-width: 620px;
      width: 100%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      position: relative;
      outline: none;
    }

    /* ---- Close button ---- */
    .fangs-popup-close {
      position: absolute;
      top: 12px;
      right: 14px;
      background: none;
      border: none;
      font-size: 1.4rem;
      line-height: 1;
      color: #666;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .fangs-popup-close:hover {
      background: #f0f0f0;
      color: #222;
    }

    /* ---- Body ---- */
    .fangs-popup-body {
      overflow-y: auto;
      padding: 28px 30px 26px 30px;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.65;
      color: #1c2b3a;
    }

    /* ---- Loading placeholder ---- */
    .fangs-popup-loading {
      color: #888;
      font-style: italic;
    }

    /* ---- Typography inside popup ---- */
    .fangs-popup-body h1 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #1a3a5c;
      margin: 0 0 16px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #d0d7de;
    }
    .fangs-popup-body h2 {
      font-size: 1rem;
      font-weight: 700;
      color: #24527a;
      margin: 20px 0 8px 0;
    }
    .fangs-popup-body h3 {
      font-size: 0.9rem;
      font-weight: 700;
      color: #24527a;
      margin: 16px 0 6px 0;
    }
    .fangs-popup-body p {
      margin: 0 0 10px 0;
    }
    .fangs-popup-body ul {
      margin: 4px 0 10px 0;
      padding-left: 20px;
    }
    .fangs-popup-body li {
      margin-bottom: 4px;
    }
    .fangs-popup-body code {
      background: #f0f4f8;
      border: 1px solid #d0d7de;
      border-radius: 3px;
      padding: 1px 5px;
      font-family: 'Fira Mono', 'Consolas', 'Menlo', monospace;
      font-size: 0.85em;
      color: #1a3a5c;
    }

    /* ---- Code blocks (plain <pre><code>) ---- */
    .fangs-popup-body pre {
      background: #0e2030;
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .fangs-popup-body pre code {
      background: none;
      border: none;
      padding: 0;
      color: #c8e8ff;
      font-size: 0.82rem;
      line-height: 1.5;
    }

    /* ---- Code blocks from Quarto (div.sourceCode > pre) ---- */
    .fangs-popup-body div.sourceCode {
      margin: 10px 0;
    }
    .fangs-popup-body div.sourceCode pre {
      background: #0e2030;
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
      margin: 0;
    }
    .fangs-popup-body div.sourceCode pre code {
      background: none;
      border: none;
      padding: 0;
      color: #c8e8ff;
      font-size: 0.82rem;
      line-height: 1.5;
    }

    /* ---- Tables ---- */
    .fangs-popup-body table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.85rem;
      margin: 10px 0;
    }
    .fangs-popup-body th {
      background: #1a3a5c;
      color: #e8f4fd;
      padding: 6px 10px;
      text-align: left;
      font-weight: 600;
    }
    .fangs-popup-body td {
      padding: 5px 10px;
      border-bottom: 1px solid #e0e6ed;
    }
    .fangs-popup-body tr:nth-child(even) td {
      background: #f7f9fc;
    }
    .fangs-popup-body strong {
      font-weight: 700;
      color: #1a3a5c;
    }

    /* ---- Error dialog variant ---- */
    .fangs-error-dialog {
      border-top: 4px solid #ef5350;
    }
    .fangs-error-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .fangs-error-icon {
      font-size: 1.4rem;
      color: #ef5350;
      flex-shrink: 0;
    }
    .fangs-error-header h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #c62828;
      border: none;
      padding: 0;
    }
    .fangs-error-detail {
      background: #1a0a0a;
      color: #ff8a80;
      border-radius: 6px;
      padding: 12px 16px;
      font-family: 'Fira Mono', 'Consolas', 'Menlo', monospace;
      font-size: 0.82rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0 0 12px 0;
    }
    .fangs-error-suggestion {
      background: #fff8e1;
      border-left: 3px solid #ffb300;
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 0.85rem;
      color: #4a3800;
      margin: 0;
    }
  `;
  document.head.appendChild(style);
}
