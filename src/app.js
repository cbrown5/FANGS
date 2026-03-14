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
  });
  btn2.addEventListener('click', () => {
    editor.setValue(defaultModel2);
    btn2.classList.add('active');
    btn1.classList.remove('active');
  });

  // -- Data upload --
  const dropZone   = document.getElementById('drop-zone');
  const fileInput  = document.getElementById('data-file-input');
  const dataStatus = document.getElementById('data-status');
  const btnBrowse  = document.getElementById('btn-browse');
  const btnExample = document.getElementById('btn-load-example');

  let loadedData = null;

  function loadCSVText(text, filename) {
    try {
      // Basic validation: check we have at least a header + one row
      const rows = text.trim().split('\n');
      if (rows.length < 2) throw new Error('CSV appears to have no data rows');
      loadedData = text;
      dataStatus.textContent = `Loaded: ${filename} (${rows.length - 1} rows)`;
      dataStatus.className   = 'ok';
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

    // TODO: replace this stub with a real Web Worker once the sampler module exists.
    // For now, show a "not yet implemented" status.
    setStatus('Sampler not yet implemented — UI scaffolding complete.', '');
    settings.setEnabled(true);
    btnRun.disabled  = false;
    btnStop.disabled = true;
  });

  btnStop.addEventListener('click', () => {
    if (samplerWorker) {
      samplerWorker.terminate();
      samplerWorker = null;
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
  const btnPriorCheck = document.getElementById('btn-prior-check');
  if (btnPriorCheck) {
    btnPriorCheck.addEventListener('click', () => {
      setStatus('Prior predictive check not yet implemented.', '');
    });
  }

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
