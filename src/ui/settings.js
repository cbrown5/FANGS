/**
 * settings.js
 * Thin wrapper around the sampler-settings inputs in index.html.
 *
 * Reads / writes: chains, samples, burnin, thin.
 * Provides validation with clamped defaults.
 * Can disable all inputs during sampling (setEnabled(false)).
 */

/** Validation bounds for each setting. */
const BOUNDS = {
  nChains:  { min: 1,  max: 10,    default: 3    },
  nSamples: { min: 100, max: 50000, default: 2000 },
  burnin:   { min: 0,  max: 10000, default: 500  },
  thin:     { min: 1,  max: 100,   default: 1    },
};

export class SamplerSettings {
  /**
   * @param {HTMLElement} containerEl
   *   The element containing (or equal to) the settings panel.
   *   The inputs are looked up by their IDs (input-chains, input-samples,
   *   input-burnin, input-thin) — they may be descendants of containerEl
   *   or simply in the document.
   */
  constructor(containerEl) {
    // Allow passing null/undefined and fall back to document-level lookup
    this._root = containerEl || document;

    this._inputs = {
      nChains:  this._find('input-chains'),
      nSamples: this._find('input-samples'),
      burnin:   this._find('input-burnin'),
      thin:     this._find('input-thin'),
    };

    // Attach live-validation listeners
    for (const [key, el] of Object.entries(this._inputs)) {
      if (!el) continue;
      el.addEventListener('change', () => this._clamp(key, el));
      el.addEventListener('blur',   () => this._clamp(key, el));
    }
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /**
   * Return the current (validated) sampler settings.
   * @returns {{ nChains: number, nSamples: number, burnin: number, thin: number }}
   */
  getSettings() {
    return {
      nChains:  this._readInt('nChains'),
      nSamples: this._readInt('nSamples'),
      burnin:   this._readInt('burnin'),
      thin:     this._readInt('thin'),
    };
  }

  /**
   * Enable or disable all setting inputs.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    for (const el of Object.values(this._inputs)) {
      if (el) el.disabled = !enabled;
    }
  }

  /**
   * Programmatically update one or more settings.
   * Accepts a partial object; unknown keys are ignored.
   *
   * @param {{ nChains?: number, nSamples?: number, burnin?: number, thin?: number }} values
   */
  setValues(values) {
    for (const [key, val] of Object.entries(values)) {
      const el = this._inputs[key];
      if (!el) continue;
      el.value = val;
      this._clamp(key, el);
    }
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  /**
   * Find an element by ID, searching first within containerEl, then in
   * the whole document (so callers can pass either the panel or document).
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  _find(id) {
    // containerEl.querySelector works when containerEl is an element;
    // when it's the document, getElementById is more direct.
    if (this._root instanceof Document) {
      return this._root.getElementById(id);
    }
    return this._root.querySelector(`#${id}`) ||
           document.getElementById(id);
  }

  /**
   * Read and validate an integer value from a named input.
   * Falls back to the field's default if the value is missing or invalid.
   * @param {string} key
   * @returns {number}
   */
  _readInt(key) {
    const el     = this._inputs[key];
    const bounds = BOUNDS[key];
    if (!el) return bounds.default;

    const raw = parseInt(el.value, 10);
    if (!isFinite(raw)) return bounds.default;
    return Math.min(bounds.max, Math.max(bounds.min, raw));
  }

  /**
   * Clamp an input's displayed value to its valid range.
   * @param {string}          key
   * @param {HTMLInputElement} el
   */
  _clamp(key, el) {
    const bounds = BOUNDS[key];
    const raw    = parseInt(el.value, 10);
    if (!isFinite(raw)) {
      el.value = bounds.default;
      return;
    }
    const clamped = Math.min(bounds.max, Math.max(bounds.min, raw));
    if (clamped !== raw) el.value = clamped;
  }
}
