/**
 * app.js
 * Application entry point — wires together the UI components.
 *
 * This module is intentionally a thin orchestration layer. Heavy logic lives
 * in the parser/, samplers/, data/, and ui/ modules.
 *
 * Current state: initialises the UI with the default model and example data.
 * Sampler integration is added as those modules are implemented.
 */

import { ModelEditor }    from './ui/editor.js';
import { TracePlot }      from './ui/trace-plot.js';
import { DensityPlot }    from './ui/density-plot.js';
import { SummaryTable }   from './ui/summary-table.js';
import { PPCPlot }        from './ui/ppc-plot.js';
import { SamplerSettings} from './ui/settings.js';
import { defaultCSV, defaultModel1, defaultModel2 } from './data/default-data.js';
import { parseCSV, prepareDataColumns } from './data/csv-loader.js';
import { renderDataTable } from './ui/data-table.js';

// ------------------------------------------------------------------ //
// Bootstrap                                                            //
// ------------------------------------------------------------------ //

document.addEventListener('DOMContentLoaded', () => {
  // -- UI component instances --
  const editor   = new ModelEditor(
    document.getElementById('model-editor'),
    document.getElementById('editor-error'),
  );
  const trace    = new TracePlot(document.getElementById('trace-container'));
  const density  = new DensityPlot(document.getElementById('density-container'));
  const summary  = new SummaryTable(document.getElementById('summary-container'));
  const ppc      = new PPCPlot(document.getElementById('ppc-container'));
  const settings = new SamplerSettings(document.getElementById('settings-panel'));

  // -- Pre-fill model 1 --
  editor.setValue(defaultModel1);

  // -- Model selector buttons --
  const btn1 = document.getElementById('btn-model-1');
  const btn2 = document.getElementById('btn-model-2');

  btn1.addEventListener('click', () => {
    editor.setValue(defaultModel1);
    btn1.classList.add('active');
    btn2.classList.remove('active');
    updateConstantsPanel();
  });
  btn2.addEventListener('click', () => {
    editor.setValue(defaultModel2);
    btn2.classList.add('active');
    btn1.classList.remove('active');
    updateConstantsPanel();
  });

  // Update constants panel whenever the model text changes (debounced)
  {
    let _debounce = null;
    document.getElementById('model-editor').addEventListener('input', () => {
      clearTimeout(_debounce);
      _debounce = setTimeout(updateConstantsPanel, 400);
    });
  }

  // -- Data upload --
  const dropZone   = document.getElementById('drop-zone');
  const fileInput  = document.getElementById('data-file-input');
  const dataStatus = document.getElementById('data-status');
  const btnBrowse  = document.getElementById('btn-browse');
  const btnExample = document.getElementById('btn-load-example');

  let loadedData = null;

  const dataTableContainer = document.getElementById('data-table-container');

  // -- Model constants panel --
  const constantsPanel = document.getElementById('model-constants-panel');

  /**
   * Scan BUGS model text for scalar identifiers used as for-loop upper bounds.
   * Matches patterns like "1:N", "1:J", "1:K".
   * @param {string} modelText
   * @returns {string[]} Array of unique scalar names
   */
  function extractRequiredScalars(modelText) {
    const scalars = new Set();
    const re = /\b1\s*:\s*([A-Za-z][A-Za-z0-9._]*)\b/g;
    let m;
    while ((m = re.exec(modelText)) !== null) {
      scalars.add(m[1]);
    }
    return [...scalars];
  }

  /**
   * Render (or hide) the Model constants panel based on the current model text
   * and loaded data. N is always shown as read-only; other scalars not in the
   * CSV are shown as editable inputs.
   */
  function updateConstantsPanel() {
    if (!constantsPanel) return;

    const modelText = editor.getValue();
    const scalars = extractRequiredScalars(modelText);

    // Parse current data columns for inference
    let csvColumns = {};
    let dataN = null;
    if (loadedData) {
      try {
        const parsedRows = parseCSV(loadedData);
        const { columns } = prepareDataColumns(parsedRows);
        csvColumns = columns;
        dataN = parsedRows.length;
      } catch (_) {}
    }

    // Filter to scalars that are not CSV data columns (except N which is special)
    const panelScalars = scalars.filter(name => name === 'N' || !(name in csvColumns));

    if (panelScalars.length === 0) {
      constantsPanel.style.display = 'none';
      return;
    }

    constantsPanel.style.display = '';

    let html = '';
    for (const name of panelScalars) {
      if (name === 'N') {
        const val = dataN !== null ? dataN : '';
        const hint = dataN !== null ? `inferred from ${dataN} data rows` : 'load data to infer';
        html += `
          <div class="constant-item">
            <label for="const-${name}">${name}</label>
            <div class="constant-value-wrap">
              <input type="number" id="const-${name}" class="constant-input"
                     data-constant="${name}" value="${val}" readonly />
              <span class="constant-hint">${hint}</span>
            </div>
          </div>`;
      } else {
        // Try to infer from a matching column (e.g. J from unique group values)
        let inferredVal = null;
        let inferHint = 'required — enter value';

        // Heuristic: J is often the number of unique levels of 'group'
        if (name === 'J' && 'group' in csvColumns) {
          inferredVal = new Set(Array.from(csvColumns.group)).size;
          inferHint = `inferred: ${inferredVal} groups`;
        }

        const val = inferredVal !== null ? inferredVal : '';
        const readonlyAttr = inferredVal !== null ? 'readonly' : '';
        html += `
          <div class="constant-item">
            <label for="const-${name}">${name}</label>
            <div class="constant-value-wrap">
              <input type="number" id="const-${name}" class="constant-input"
                     data-constant="${name}" value="${val}" ${readonlyAttr}
                     step="1" min="1" />
              <span class="constant-hint">${inferHint}</span>
            </div>
          </div>`;
      }
    }

    constantsPanel.innerHTML = `
      <div class="section-label">Model constants</div>
      <div class="constants-grid">${html}</div>`;
  }

  /**
   * Read the current values from the Model constants panel inputs.
   * Returns an object mapping constant name → numeric value.
   * @returns {Object.<string, number>}
   */
  function getModelConstants() {
    const constants = {};
    if (!constantsPanel) return constants;
    const inputs = constantsPanel.querySelectorAll('.constant-input');
    for (const input of inputs) {
      const name = input.dataset.constant;
      const val = parseFloat(input.value);
      if (name && !isNaN(val)) {
        constants[name] = val;
      }
    }
    return constants;
  }

  function loadCSVText(text, filename) {
    try {
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error('CSV appears to have no data rows');
      loadedData = text;
      dataStatus.textContent = `Loaded: ${filename} (${rows.length} rows)`;
      dataStatus.className   = 'ok';
      // Render data table
      if (dataTableContainer) {
        renderDataTable(dataTableContainer, rows);
      }
      // Refresh constants panel with new data
      updateConstantsPanel();
    } catch (e) {
      dataStatus.textContent = `Error: ${e.message}`;
      dataStatus.className   = 'err';
    }
  }

  btnExample.addEventListener('click', () => {
    loadCSVText(defaultCSV, 'example.csv');
    dropZone.querySelector('.drop-icon').textContent = '✔';
  });

  btnBrowse.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadCSVText(ev.target.result, file.name);
    reader.readAsText(file);
  });

  // Drag-and-drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadCSVText(ev.target.result, file.name);
    reader.readAsText(file);
  });
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  dropZone.addEventListener('click', () => fileInput.click());

  // -- Tab switching --
  const tabBtns  = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b  => { b.classList.remove('active');  b.setAttribute('aria-selected', 'false'); });
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const pane = document.getElementById(`pane-${btn.dataset.tab}`);
      if (pane) pane.classList.add('active');

      // Trigger density re-render when switching to Posteriors (canvas size may have changed)
      if (btn.dataset.tab === 'posteriors') density.render();
    });
  });

  // -- Status helpers --
  const statusBar  = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const progressBar = document.getElementById('progress-bar');

  function setStatus(message, state = '') {
    statusText.textContent = message;
    statusBar.className    = state;
  }

  function setProgress(fraction) {
    progressBar.style.width = `${Math.round(fraction * 100)}%`;
  }

  // -- Run / Stop --
  const btnRun     = document.getElementById('btn-run');
  const btnStop    = document.getElementById('btn-stop');
  const btnDownload = document.getElementById('btn-download');

  let samplerWorker = null;
  let posteriorSamples = {}; // { paramName: number[] }

  btnRun.addEventListener('click', () => {
    // Validate: require data
    if (!loadedData) {
      setStatus('Please load data before running.', 'error');
      return;
    }

    editor.clearErrors();
    const modelCode = editor.getValue().trim();
    if (!modelCode) {
      setStatus('Model editor is empty.', 'error');
      return;
    }

    // Reset plots
    trace.clear();
    density.clear();
    summary.clear();
    posteriorSamples = {};
    setProgress(0);
    setStatus('Starting sampler…', 'running');

    settings.setEnabled(false);
    btnRun.disabled  = true;
    btnStop.disabled = false;

    const cfg = settings.getSettings();

    // Terminate any previous worker
    if (samplerWorker) samplerWorker.terminate();

    // Initialise trace plot with placeholder param names from model text
    // (real names come from the parser; here we extract a rough set)
    const guessedParams = _guessParams(modelCode);
    trace.init(guessedParams, cfg.nChains);

    // Switch to trace tab automatically
    tabBtns.forEach(b  => { b.classList.remove('active');  b.setAttribute('aria-selected', 'false'); });
    tabPanes.forEach(p => p.classList.remove('active'));
    const traceBtn  = document.querySelector('[data-tab="trace"]');
    const tracePane = document.getElementById('pane-trace');
    if (traceBtn)  { traceBtn.classList.add('active');  traceBtn.setAttribute('aria-selected', 'true'); }
    if (tracePane) tracePane.classList.add('active');

    // Parse the CSV data
    let dataColumns, dataN, dataJ;
    try {
      const parsedRows = parseCSV(loadedData);
      if (parsedRows.length === 0) throw new Error('Dataset is empty');
      const { columns } = prepareDataColumns(parsedRows);
      dataN = parsedRows.length;
      dataColumns = columns;
      // Count unique group levels if a 'group' column is present
      dataJ = columns.group
        ? new Set(Array.from(columns.group)).size
        : 0;
    } catch (e) {
      setStatus(`Data error: ${e.message}`, 'error');
      settings.setEnabled(true);
      btnRun.disabled  = false;
      btnStop.disabled = true;
      return;
    }

    // Create Web Worker
    samplerWorker = new Worker(
      new URL('./samplers/sampler-worker.js', import.meta.url),
      { type: 'module' }
    );

    samplerWorker.onmessage = (event) => {
      const msg = event.data;

      if (msg.type === 'PROGRESS') {
        // Only use chain 0 progress for the overall bar to avoid jumps
        if (msg.chainIdx === 0) {
          setProgress(msg.iter / msg.total);
        }
        // Feed each param value into the live trace plot
        for (const [name, value] of Object.entries(msg.paramValues)) {
          trace.addSample(name, msg.chainIdx, value);
        }

      } else if (msg.type === 'SAMPLES') {
        // Accumulate all-chain samples for download and density plots
        if (!posteriorSamples[msg.paramName]) {
          posteriorSamples[msg.paramName] = [];
        }
        for (const v of msg.values) {
          posteriorSamples[msg.paramName].push(v);
        }
        density.setSamples(msg.paramName, posteriorSamples[msg.paramName]);

      } else if (msg.type === 'DONE') {
        setProgress(1);
        setStatus('Sampling complete.', 'done');
        density.render();
        summary.update(msg.summary);

        // Basic PPC: use observed y and show without predictions for now
        const yObs = dataColumns.y ? Array.from(dataColumns.y) : [];
        if (yObs.length > 0) {
          ppc.update(yObs, []);
        }

        btnDownload.disabled = false;
        settings.setEnabled(true);
        btnRun.disabled  = false;
        btnStop.disabled = true;
        samplerWorker = null;

      } else if (msg.type === 'ERROR') {
        setStatus(`Error: ${msg.message}`, 'error');
        editor.showError(1, msg.message);
        settings.setEnabled(true);
        btnRun.disabled  = false;
        btnStop.disabled = true;
        samplerWorker = null;
      }
    };

    samplerWorker.onerror = (err) => {
      setStatus(`Worker error: ${err.message}`, 'error');
      settings.setEnabled(true);
      btnRun.disabled  = false;
      btnStop.disabled = true;
      samplerWorker = null;
    };

    // Start sampling
    samplerWorker.postMessage({
      type: 'START',
      modelSource: modelCode,
      dataColumns,
      dataN,
      dataJ,
      dataConstants: getModelConstants(),
      settings: cfg,
    });
  });

  btnStop.addEventListener('click', () => {
    if (samplerWorker) {
      samplerWorker.postMessage({ type: 'STOP' });
      // Give the worker a moment to flush then terminate
      setTimeout(() => {
        if (samplerWorker) {
          samplerWorker.terminate();
          samplerWorker = null;
        }
      }, 500);
    }
    setStatus('Stopped by user.', '');
    setProgress(0);
    settings.setEnabled(true);
    btnRun.disabled  = false;
    btnStop.disabled = true;
  });

  // -- Download CSV --
  btnDownload.addEventListener('click', () => {
    const params = Object.keys(posteriorSamples);
    if (params.length === 0) return;

    const nRows = posteriorSamples[params[0]].length;
    const header = params.join(',');
    const rows   = [];
    for (let i = 0; i < nRows; i++) {
      rows.push(params.map(p => posteriorSamples[p][i]).join(','));
    }
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'fangs-posterior-samples.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // -- Prior check button --
  const priorDensity  = new DensityPlot(document.getElementById('prior-density-container') || document.createElement('div'));
  const priorSummary  = new SummaryTable(document.getElementById('prior-summary-container') || document.createElement('div'));

  const btnPriorCheck = document.getElementById('btn-prior-check');
  if (btnPriorCheck) {
    btnPriorCheck.addEventListener('click', () => {
      if (!loadedData) {
        setStatus('Please load data before running prior check.', 'error');
        return;
      }
      const modelCode = editor.getValue().trim();
      if (!modelCode) {
        setStatus('Model editor is empty.', 'error');
        return;
      }

      let dataColumns, dataN, dataJ;
      try {
        const parsedRows = parseCSV(loadedData);
        const { columns } = prepareDataColumns(parsedRows);
        dataN = parsedRows.length;
        dataColumns = columns;
        dataJ = columns.group ? new Set(Array.from(columns.group)).size : 0;
      } catch (e) {
        setStatus(`Data error: ${e.message}`, 'error');
        return;
      }

      const cfg = settings.getSettings();

      if (samplerWorker) samplerWorker.terminate();

      let priorSamples = {};

      samplerWorker = new Worker(
        new URL('./samplers/sampler-worker.js', import.meta.url),
        { type: 'module' }
      );

      setStatus('Running prior predictive check…', 'running');

      samplerWorker.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === 'SAMPLES') {
          if (!priorSamples[msg.paramName]) priorSamples[msg.paramName] = [];
          for (const v of msg.values) priorSamples[msg.paramName].push(v);
          priorDensity.setSamples(msg.paramName, priorSamples[msg.paramName]);
        } else if (msg.type === 'DONE') {
          setStatus('Prior check complete.', 'done');
          priorDensity.render();
          priorSummary.update(msg.summary);
          samplerWorker = null;
          // Switch to prior-check tab
          tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
          tabPanes.forEach(p => p.classList.remove('active'));
          const pcBtn  = document.querySelector('[data-tab="prior-check"]');
          const pcPane = document.getElementById('pane-prior-check');
          if (pcBtn)  { pcBtn.classList.add('active');  pcBtn.setAttribute('aria-selected', 'true'); }
          if (pcPane) pcPane.classList.add('active');
        } else if (msg.type === 'ERROR') {
          setStatus(`Prior check error: ${msg.message}`, 'error');
          samplerWorker = null;
        }
      };

      samplerWorker.onerror = (err) => {
        setStatus(`Worker error: ${err.message}`, 'error');
        samplerWorker = null;
      };

      samplerWorker.postMessage({
        type: 'START',
        modelSource: modelCode,
        dataColumns,
        dataN,
        dataJ,
        dataConstants: getModelConstants(),
        settings: { ...cfg, nSamples: Math.min(cfg.nSamples, 500) },
        priorOnly: true,
      });
    });
  }

  // Initial constants panel render (must be after all declarations)
  updateConstantsPanel();

  // Initial status
  setStatus('Ready. Load data and press Run to begin.');
});

// ------------------------------------------------------------------ //
// Utilities                                                            //
// ------------------------------------------------------------------ //

/**
 * Crudely extract scalar parameter names from BUGS model text.
 * Used only to initialise the trace plot before the real parser runs.
 * Returns names that appear with "~ d" (stochastic nodes without indexing).
 *
 * @param {string} model
 * @returns {string[]}
 */
function _guessParams(model) {
  const names = new Set();
  // Match bare names (no brackets) followed by ~ d
  const re = /^\s*([A-Za-z][A-Za-z0-9._]*)\s*~/gm;
  let m;
  while ((m = re.exec(model)) !== null) {
    names.add(m[1]);
  }
  return names.size > 0 ? [...names] : ['alpha', 'beta', 'tau'];
}
