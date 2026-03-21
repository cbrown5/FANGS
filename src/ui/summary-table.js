/**
 * summary-table.js
 * Renders a posterior summary as a styled HTML table.
 *
 * Colour coding:
 *   - Rhat > 1.1  → red background (convergence warning)
 *   - ESS  < 100  → orange background (low effective sample size)
 */

export class SummaryTable {
  /**
   * @param {HTMLElement} containerEl - Element that will contain the table
   * @param {Function}    [attachPopupTrigger] - Optional fn(el, id) from popups.js
   */
  constructor(containerEl, attachPopupTrigger) {
    if (!containerEl) throw new Error('SummaryTable: containerEl is required');
    this.container = containerEl;
    this._tableEl  = null;
    this._attachPopup = attachPopupTrigger || null;
    this._injectStyles();
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * Build or rebuild the table from a summary object.
   *
   * @param {Object} summary
   *   Keys are parameter names; values are objects with:
   *   { mean, sd, q2_5, q50, q97_5, rhat, ess }
   *   All values are numbers.  rhat / ess may be NaN if not yet computed.
   */
  update(summary) {
    // Remove old table
    if (this._tableEl) {
      this._tableEl.remove();
      this._tableEl = null;
    }

    const paramNames = Object.keys(summary);
    if (paramNames.length === 0) {
      this.container.innerHTML = '<p class="fangs-summary-empty">No parameters to display.</p>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'fangs-summary-table';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Posterior summary statistics');

    // --- Header ---
    const thead = table.createTHead();
    const hrow  = thead.insertRow();
    const cols  = ['Parameter', 'Mean', 'SD', '2.5%', 'Median', '97.5%', 'Rhat', 'ESS'];
    const colPopups = { 'Rhat': 'rhat', 'ESS': 'ess', 'Mean': 'posterior', '2.5%': 'credible-interval', '97.5%': 'credible-interval' };
    for (const col of cols) {
      const th = document.createElement('th');
      th.textContent = col;
      th.setAttribute('scope', 'col');
      hrow.appendChild(th);
      if (this._attachPopup && colPopups[col]) {
        this._attachPopup(th, colPopups[col]);
      }
    }

    // --- Body ---
    const tbody = table.createTBody();
    for (const name of paramNames) {
      const s   = summary[name];
      const row = tbody.insertRow();
      row.setAttribute('data-param', name);

      // Parameter name (monospace, left-aligned)
      const tdName = row.insertCell();
      tdName.textContent = name;
      tdName.className   = 'fangs-param-name';

      // Numeric cells
      _addCell(row, s.mean,  4);
      _addCell(row, s.sd,    4);
      _addCell(row, s.q2_5,  4);
      _addCell(row, s.q50,   4);
      _addCell(row, s.q97_5, 4);

      // Rhat
      const tdRhat = _addCell(row, s.rhat, 3);
      if (!isNaN(s.rhat) && s.rhat > 1.1) {
        tdRhat.classList.add('fangs-warn-red');
        tdRhat.title = 'Rhat > 1.1 — chain may not have converged';
      }

      // ESS
      const tdEss = row.insertCell();
      tdEss.textContent = isNaN(s.ess) ? '—' : Math.round(s.ess).toLocaleString();
      tdEss.className   = 'fangs-num';
      if (!isNaN(s.ess) && s.ess < 100) {
        tdEss.classList.add('fangs-warn-orange');
        tdEss.title = 'ESS < 100 — consider more samples';
      }
    }

    this.container.innerHTML = '';
    this.container.appendChild(table);
    this._tableEl = table;
  }

  /**
   * Remove the table and reset the container.
   */
  clear() {
    this.container.innerHTML = '';
    this._tableEl = null;
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  _injectStyles() {
    if (document.getElementById('fangs-summary-styles')) return;
    const style = document.createElement('style');
    style.id = 'fangs-summary-styles';
    style.textContent = `
      .fangs-summary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
        font-variant-numeric: tabular-nums;
      }
      .fangs-summary-table th {
        background: #1a1b26;
        color: #bd93f9;
        padding: 7px 10px;
        text-align: right;
        font-weight: 600;
        letter-spacing: 0.03em;
        white-space: nowrap;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .fangs-summary-table th:first-child {
        text-align: left;
      }
      .fangs-summary-table td {
        padding: 6px 10px;
        border-bottom: 1px solid #44475a;
        text-align: right;
        white-space: nowrap;
        color: #f8f8f2;
      }
      .fangs-summary-table tbody tr {
        background: #21222c;
      }
      .fangs-summary-table tbody tr:hover {
        background: #2d2f3f;
      }
      .fangs-summary-table tbody tr:nth-child(even) {
        background: #282a36;
      }
      .fangs-summary-table tbody tr:nth-child(even):hover {
        background: #2d2f3f;
      }
      .fangs-param-name {
        text-align: left !important;
        font-family: 'Fira Mono', 'Consolas', monospace;
        font-size: 0.8rem;
        font-weight: 600;
        color: #bd93f9;
      }
      .fangs-num {
        font-family: 'Fira Mono', 'Consolas', monospace;
      }
      .fangs-warn-red {
        background: #3a1f1f !important;
        color: #ff5555;
        font-weight: 700;
      }
      .fangs-warn-orange {
        background: #2d1e0a !important;
        color: #ffb86c;
        font-weight: 700;
      }
      .fangs-summary-empty {
        color: #888;
        font-style: italic;
        padding: 12px 0;
      }
    `;
    document.head.appendChild(style);
  }
}

// ------------------------------------------------------------------ //
// Helpers                                                             //
// ------------------------------------------------------------------ //

/**
 * Insert a numeric cell with a fixed number of significant digits.
 * Returns the created <td> so callers can add classes/titles.
 *
 * @param {HTMLTableRowElement} row
 * @param {number}              value
 * @param {number}              [sigFigs=4]
 * @returns {HTMLTableCellElement}
 */
function _addCell(row, value, sigFigs = 4) {
  const td = row.insertCell();
  td.className = 'fangs-num';
  if (value === null || value === undefined || isNaN(value)) {
    td.textContent = '—';
  } else {
    td.textContent = _fmt(value, sigFigs);
  }
  return td;
}

/**
 * Format a number to a fixed number of significant figures,
 * switching to exponential notation for very large or very small values.
 *
 * @param {number} v
 * @param {number} sig
 */
function _fmt(v, sig) {
  if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0)) {
    return v.toExponential(sig - 1);
  }
  // toPrecision can produce e.g. "1.000"; strip trailing zeros after decimal
  const s = v.toPrecision(sig);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
