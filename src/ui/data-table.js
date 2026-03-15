/**
 * data-table.js
 * Renders a CSV dataset as a scrollable HTML table for data inspection.
 */

const MAX_ROWS = 200; // cap rows shown to keep rendering fast

/**
 * Render a parsed CSV dataset into a container element.
 *
 * @param {HTMLElement} container - Element to render into
 * @param {Object[]}    rows      - Array of row objects (output of parseCSV)
 */
export function renderDataTable(container, rows) {
  container.innerHTML = '';

  if (!rows || rows.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:12px">No data to display.</p>';
    return;
  }

  const headers = Object.keys(rows[0]);
  const displayRows = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows;
  const truncated   = rows.length > MAX_ROWS;

  // Meta line
  const meta = document.createElement('p');
  meta.className = 'data-preview-meta';
  meta.textContent = `${rows.length} rows × ${headers.length} columns` +
    (truncated ? ` (showing first ${MAX_ROWS})` : '');
  container.appendChild(meta);

  // Table
  const table = document.createElement('table');
  table.className = 'data-preview-table';
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Loaded dataset preview');

  // Header
  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  // Row-number header
  const thNum = document.createElement('th');
  thNum.textContent = '#';
  thNum.style.width = '40px';
  hrow.appendChild(thNum);
  for (const col of headers) {
    const th = document.createElement('th');
    th.textContent = col;
    th.setAttribute('scope', 'col');
    hrow.appendChild(th);
  }

  // Body
  const tbody = table.createTBody();
  for (let i = 0; i < displayRows.length; i++) {
    const row = tbody.insertRow();
    // Row number
    const tdNum = row.insertCell();
    tdNum.textContent = i + 1;
    tdNum.style.color = 'var(--text-muted)';
    for (const col of headers) {
      const td = row.insertCell();
      td.textContent = displayRows[i][col] ?? '';
    }
  }

  container.appendChild(table);
}
