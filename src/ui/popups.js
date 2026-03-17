/**
 * popups.js
 * Educational pop-up system for FANGS.
 *
 * ## How it works
 * 1. Any HTML element with a `data-popup="<id>"` attribute gets a small "?" button
 *    appended to it automatically when `initPopups()` is called.
 * 2. Clicking the "?" button looks up content from the inline bundle
 *    (src/content/popups-bundle.js), converts it to HTML, and displays a modal overlay.
 * 3. `attachPopupTrigger(el, id)` can also be called programmatically for
 *    dynamically-created elements (e.g. summary table headers).
 *
 * ## Adding new popups
 * 1. Create/edit `src/content/popups/<your-id>.md` with the content.
 * 2. Run `node src/content/build-popups-bundle.js` to regenerate the bundle, OR
 *    manually add the content to `src/content/popups-bundle.js`.
 * 3. Add `data-popup="your-id"` to the relevant HTML element, OR call
 *    `attachPopupTrigger(element, 'your-id')` from JavaScript.
 */

import { POPUP_CONTENT } from '../content/popups-bundle.js';

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
 * Programmatically attach a "?" trigger button to an existing element.
 * Safe to call multiple times on the same element (idempotent via data attribute).
 *
 * @param {HTMLElement} el       - The element to attach the trigger to
 * @param {string}      popupId  - The popup ID (maps to `<id>.md`)
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
 * Look up the Markdown for a popup ID from the inline bundle, parse it to
 * HTML, and open the modal.
 *
 * @param {string} popupId
 */
function _showPopup(popupId) {
  const markdown = POPUP_CONTENT[popupId]
    ?? `# Not found\n\nNo popup content registered for **${popupId}**.`;
  _openModal(_parseMarkdown(markdown), popupId);
}

/**
 * Create and show the modal overlay.
 *
 * @param {string} html     - Rendered HTML content
 * @param {string} popupId  - Used for aria-labelledby
 */
function _openModal(html, popupId) {
  // Remove any existing modal first
  document.getElementById('fangs-popup-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fangs-popup-modal';
  overlay.className = 'fangs-popup-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Educational popup');

  overlay.innerHTML = `
    <div class="fangs-popup-dialog">
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
// Markdown parser                                                     //
// ------------------------------------------------------------------ //

/**
 * Convert a subset of Markdown to HTML.
 *
 * Supported syntax:
 *   # H1, ## H2, ### H3
 *   **bold**, *italic*, `inline code`
 *   - unordered list items
 *   Blank-line-delimited paragraphs
 *   Fenced code blocks (``` ... ```)
 *   | table | rows |
 *
 * @param {string} md - Raw Markdown text
 * @returns {string}  - HTML string
 */
function _parseMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ---
    if (line.trimStart().startsWith('```')) {
      const fence = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        fence.push(_esc(lines[i]));
        i++;
      }
      i++; // skip closing ```
      out.push(`<pre class="fangs-popup-pre"><code>${fence.join('\n')}</code></pre>`);
      continue;
    }

    // --- Table ---
    if (line.includes('|') && lines[i + 1] && lines[i + 1].includes('---')) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(_parseTable(tableLines));
      continue;
    }

    // --- Headings ---
    const h3 = line.match(/^###\s+(.*)/);
    if (h3) { out.push(`<h3>${_inline(h3[1])}</h3>`); i++; continue; }

    const h2 = line.match(/^##\s+(.*)/);
    if (h2) { out.push(`<h2>${_inline(h2[1])}</h2>`); i++; continue; }

    const h1 = line.match(/^#\s+(.*)/);
    if (h1) { out.push(`<h1>${_inline(h1[1])}</h1>`); i++; continue; }

    // --- Unordered list ---
    if (line.match(/^[-*]\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(`<li>${_inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // --- Blank line ---
    if (line.trim() === '') { i++; continue; }

    // --- Paragraph ---
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].match(/^[#\-*]/) && !lines[i].includes('|') &&
           !lines[i].trimStart().startsWith('```')) {
      para.push(_inline(lines[i]));
      i++;
    }
    if (para.length) out.push(`<p>${para.join(' ')}</p>`);
  }

  return out.join('\n');
}

/**
 * Parse a Markdown table block (array of raw lines) into an HTML table.
 */
function _parseTable(tableLines) {
  const rows = tableLines.filter(l => !l.match(/^\|[-| :]+\|?\s*$/));
  const html = ['<table class="fangs-popup-table">'];
  rows.forEach((row, idx) => {
    const cells = row.split('|').map(c => c.trim()).filter((_, i, a) =>
      i > 0 && i < a.length - 1 || (i === 0 && c !== '') || (i === a.length - 1 && c !== ''));
    const tag = idx === 0 ? 'th' : 'td';
    html.push('<tr>' + cells.map(c => `<${tag}>${_inline(c)}</${tag}>`).join('') + '</tr>');
  });
  html.push('</table>');
  return html.join('');
}

/**
 * Apply inline formatting: bold, italic, inline code, HTML escaping.
 *
 * @param {string} text
 * @returns {string}
 */
function _inline(text) {
  return _esc(text)
    // Bold **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic *text* (not preceded or followed by *)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    // Inline code `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Escape HTML special characters.
 *
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------ //
// Styles                                                              //
// ------------------------------------------------------------------ //

function _injectStyles() {
  if (document.getElementById('fangs-popup-styles')) return;
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
    .fangs-popup-pre {
      background: #0e2030;
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .fangs-popup-pre code {
      background: none;
      border: none;
      padding: 0;
      color: #c8e8ff;
      font-size: 0.82rem;
      line-height: 1.5;
    }
    .fangs-popup-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.85rem;
      margin: 10px 0;
    }
    .fangs-popup-table th {
      background: #1a3a5c;
      color: #e8f4fd;
      padding: 6px 10px;
      text-align: left;
      font-weight: 600;
    }
    .fangs-popup-table td {
      padding: 5px 10px;
      border-bottom: 1px solid #e0e6ed;
    }
    .fangs-popup-table tr:nth-child(even) td {
      background: #f7f9fc;
    }
    .fangs-popup-body strong {
      font-weight: 700;
      color: #1a3a5c;
    }
  `;
  document.head.appendChild(style);
}
