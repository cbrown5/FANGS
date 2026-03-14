/**
 * editor.js
 * Thin wrapper around the model textarea that adds syntax-error annotation.
 *
 * The textarea itself lives in index.html; this class receives a reference to
 * it and to an error-display element so it stays decoupled from DOM queries.
 */

export class ModelEditor {
  /**
   * @param {HTMLTextAreaElement} textareaEl  - The <textarea id="model-editor"> element
   * @param {HTMLElement}         errorEl     - Element used to show error messages (optional)
   */
  constructor(textareaEl, errorEl = null) {
    if (!textareaEl) throw new Error('ModelEditor: textareaEl is required');
    this.el = textareaEl;
    this.errorEl = errorEl;

    // Track per-line error state: Map<lineNumber(1-based), message>
    this._errors = new Map();

    // Style applied to lines with errors is simulated via a background gradient
    // on the textarea (true per-line highlighting needs a code-mirror approach;
    // here we use an overlay div that sits behind the transparent textarea).
    this._overlay = this._buildOverlay();

    // Sync overlay position on scroll / resize
    this.el.addEventListener('scroll', () => this._syncOverlay());
    this.el.addEventListener('input',  () => this._syncOverlay());

    const ro = new ResizeObserver(() => this._syncOverlay());
    ro.observe(this.el);
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /** Return the current text in the editor. */
  getValue() {
    return this.el.value;
  }

  /** Replace the entire editor content. Clears errors. */
  setValue(text) {
    this.el.value = text;
    this.clearErrors();
  }

  /**
   * Mark a specific line with an error.
   * @param {number} line     - 1-based line number
   * @param {string} message  - Human-readable error description
   */
  showError(line, message) {
    this._errors.set(line, message);
    this._renderErrors();
  }

  /** Remove all error annotations. */
  clearErrors() {
    this._errors.clear();
    this._renderErrors();
  }

  // ------------------------------------------------------------------ //
  // Internal helpers                                                     //
  // ------------------------------------------------------------------ //

  /**
   * Build an absolutely-positioned overlay div that sits behind the textarea.
   * The textarea background is made transparent so the overlay shows through.
   */
  _buildOverlay() {
    // Make textarea background transparent so overlay shows
    this.el.style.background = 'transparent';
    this.el.style.position   = 'relative';
    this.el.style.zIndex     = '1';

    const wrap = this.el.parentElement;
    // Wrapper needs relative positioning for overlay alignment
    if (getComputedStyle(wrap).position === 'static') {
      wrap.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'editor-error-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 0;
      font-family: ${getComputedStyle(this.el).fontFamily};
      font-size: ${getComputedStyle(this.el).fontSize};
      line-height: ${getComputedStyle(this.el).lineHeight};
      padding: ${getComputedStyle(this.el).padding};
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid transparent;
    `;
    wrap.insertBefore(overlay, this.el);
    return overlay;
  }

  _syncOverlay() {
    // Match size and scroll to the textarea
    const style = getComputedStyle(this.el);
    this._overlay.style.width  = this.el.offsetWidth  + 'px';
    this._overlay.style.height = this.el.offsetHeight + 'px';
    this._overlay.scrollTop    = this.el.scrollTop;
    this._overlay.scrollLeft   = this.el.scrollLeft;
  }

  _renderErrors() {
    // Update the inline error message element (if provided)
    if (this.errorEl) {
      if (this._errors.size === 0) {
        this.errorEl.textContent = '';
      } else {
        const msgs = [];
        for (const [line, msg] of this._errors) {
          msgs.push(`Line ${line}: ${msg}`);
        }
        this.errorEl.textContent = msgs.join(' | ');
      }
    }

    // Build overlay content: wrap error lines in a highlighted span
    if (this._errors.size === 0) {
      this._overlay.innerHTML = '';
      this._syncOverlay();
      return;
    }

    const lines = this.el.value.split('\n');
    const fragment = document.createDocumentFragment();

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1; // 1-based
      const span = document.createElement('span');
      span.textContent = lineText + '\n';

      if (this._errors.has(lineNum)) {
        span.style.cssText = `
          display: block;
          background: rgba(239,83,80,0.18);
          border-left: 2px solid #ef5350;
          margin-left: -2px;
        `;
        span.title = this._errors.get(lineNum);
      }
      fragment.appendChild(span);
    });

    this._overlay.innerHTML = '';
    this._overlay.appendChild(fragment);
    this._syncOverlay();
  }
}
