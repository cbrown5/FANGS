/**
 * results-recorder.js  (Modules 6, 12, 19)
 * A browser-only results log so students can record and compare runs (e.g. the
 * same model under different priors). Rows persist in localStorage and can be
 * exported as CSV — no backend, no account, survives a page reload.
 */

import { mountChallenge, loadState, saveState } from './challenge-base.js';

export function mount(container, config) {
  const { storeKey, columns } = config;
  const LS = `fangs-course:recorder:${storeKey}`;

  function loadRows() {
    try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (_) { return []; }
  }
  function saveRows(rows) {
    try { localStorage.setItem(LS, JSON.stringify(rows)); } catch (_) {}
  }

  mountChallenge(container, {
    id: container.dataset.moduleId,
    autoButton: false,
    render(body, ctx) {
      body.innerHTML = `
        <p class="challenge-prompt">
          Record each run below. Rows are saved in your browser and can be
          downloaded as CSV to compare results across the room.
        </p>
        <table class="challenge-table">
          <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead>
          <tbody data-rows></tbody>
          <tfoot><tr>
            ${columns.map((c, i) => `<td><input data-in="${i}" type="text" placeholder="${c}"></td>`).join('')}
            <td><button data-add class="challenge-submit">Add</button></td>
          </tr></tfoot>
        </table>
        <div class="challenge-controls">
          <button data-csv>Download CSV</button>
          <button data-clear>Clear all</button>
        </div>
      `;

      const rowsEl = body.querySelector('[data-rows]');
      const addBtn = body.querySelector('[data-add]');

      function renderRows() {
        const rows = loadRows();
        rowsEl.innerHTML = rows.map((r, ri) => `
          <tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}
          <td><button data-del="${ri}" class="challenge-del">✕</button></td></tr>
        `).join('');
        rowsEl.querySelectorAll('[data-del]').forEach(b =>
          b.addEventListener('click', () => {
            const rows2 = loadRows();
            rows2.splice(+b.dataset.del, 1);
            saveRows(rows2);
            renderRows();
          }));
        // Mark solved once at least two runs are recorded (comparison is the point).
        if (rows.length >= 2) {
          const st = loadState(container.dataset.moduleId);
          if (!st.passed) { st.passed = true; saveState(container.dataset.moduleId, st); }
          ctx.markCorrect(`${rows.length} runs recorded — compare them.`);
        }
      }

      addBtn.addEventListener('click', () => {
        const vals = columns.map((_, i) => body.querySelector(`[data-in="${i}"]`).value.trim());
        if (vals.every(v => v === '')) return;
        const rows = loadRows();
        rows.push(vals);
        saveRows(rows);
        columns.forEach((_, i) => { body.querySelector(`[data-in="${i}"]`).value = ''; });
        renderRows();
      });

      body.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(storeKey, columns, loadRows()));
      body.querySelector('[data-clear]').addEventListener('click', () => {
        if (confirm('Clear all recorded runs?')) { saveRows([]); renderRows(); }
      });

      renderRows();
    },
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function downloadCsv(name, columns, rows) {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
