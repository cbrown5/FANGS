/**
 * csv-loader.js
 * CSV parsing and validation for browser-based use.
 * All functions are pure (no DOM/fetch dependencies) so they can run
 * in the main thread or inside a Web Worker.
 */

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

/**
 * Parse a CSV text string into an array of plain objects.
 *
 * Features:
 *  - Handles quoted fields (including fields that contain commas or newlines).
 *  - Trims leading/trailing whitespace from unquoted field values.
 *  - Skips completely blank lines.
 *  - Uses the first non-blank line as the header row.
 *
 * @param {string} text - Raw CSV text.
 * @returns {Object[]} Array of row objects keyed by column header strings.
 *   All values are strings; numeric conversion is done by prepareDataColumns.
 */
export function parseCSV(text) {
  const lines = splitCSVIntoLines(text);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCSVRow(lines[0]).map(h => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseCSVRow(line);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j] !== undefined ? values[j] : '';
    }
    rows.push(obj);
  }

  return rows;
}

/**
 * Split raw CSV text into logical lines, respecting quoted newlines.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitCSVIntoLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        // Escaped double-quote inside a quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // Handle \r\n as a single newline
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current !== '') {
    lines.push(current);
  }

  return lines;
}

/**
 * Parse a single CSV row string into an array of field values.
 * Quoted fields are unquoted; embedded double-quotes are unescaped.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVRow(line) {
  const fields = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma case — push empty string and stop
      if (line[line.length - 1] === ',') {
        fields.push('');
      }
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      // Advance past the comma separator (if present)
      if (line[i] === ',') i++;
    } else {
      // Unquoted field — read until next comma
      const start = i;
      while (i < line.length && line[i] !== ',') {
        i++;
      }
      fields.push(line.slice(start, i).trim());
      if (line[i] === ',') i++;
    }
  }

  return fields;
}

// ---------------------------------------------------------------------------
// validateData
// ---------------------------------------------------------------------------

/**
 * Validate a parsed dataset against the variable names referenced by the model.
 *
 * Checks performed:
 *  - Dataset is non-empty.
 *  - All rows have the same set of keys.
 *  - Every model variable (except special uppercase constants like N, J) is
 *    present as a column in the dataset.
 *  - Numeric columns contain only finite numbers (no NaN after parsing).
 *  - At least one row is present.
 *
 * @param {Object[]} data       - Parsed CSV rows (array of plain objects).
 * @param {string[]} modelVars  - Variable names referenced in the model AST.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateData(data, modelVars) {
  const errors = [];
  const warnings = [];

  // --- Basic shape checks ---------------------------------------------------

  if (!Array.isArray(data) || data.length === 0) {
    errors.push('Dataset is empty or could not be parsed.');
    return { valid: false, errors, warnings };
  }

  const headers = Object.keys(data[0]);

  if (headers.length === 0) {
    errors.push('Dataset has no columns.');
    return { valid: false, errors, warnings };
  }

  // Check all rows have identical keys
  for (let i = 1; i < data.length; i++) {
    const rowKeys = Object.keys(data[i]);
    if (rowKeys.length !== headers.length) {
      errors.push(
        `Row ${i + 1} has ${rowKeys.length} field(s) but header has ${headers.length}.`
      );
    }
  }

  // --- Model variable coverage ----------------------------------------------

  if (Array.isArray(modelVars) && modelVars.length > 0) {
    // Convention: single-letter uppercase names (N, J, K, …) are scalar
    // constants that the user passes via the settings panel, not CSV columns.
    const scalarConstantPattern = /^[A-Z]$/;

    for (const varName of modelVars) {
      if (scalarConstantPattern.test(varName)) continue; // e.g. N, J
      if (!headers.includes(varName)) {
        errors.push(
          `Model references variable '${varName}' which is not a column in the dataset.`
        );
      }
    }
  }

  // --- Value quality checks -------------------------------------------------

  const headerSet = new Set(headers);

  for (const header of headerSet) {
    const values = data.map(row => row[header]);
    const nonEmpty = values.filter(v => v !== '' && v !== undefined && v !== null);

    if (nonEmpty.length < values.length) {
      warnings.push(
        `Column '${header}' has ${values.length - nonEmpty.length} missing value(s).`
      );
    }

    // Check if column appears numeric
    const numericValues = nonEmpty.filter(v => v !== '' && !isNaN(Number(v)));
    if (numericValues.length > 0 && numericValues.length < nonEmpty.length) {
      warnings.push(
        `Column '${header}' mixes numeric and non-numeric values; it will be treated as a factor.`
      );
    }

    if (numericValues.length === nonEmpty.length && numericValues.length > 0) {
      const nums = numericValues.map(Number);
      const hasInfinite = nums.some(v => !isFinite(v));
      if (hasInfinite) {
        errors.push(`Column '${header}' contains infinite values.`);
      }
    }
  }

  // --- Row count advisory ---------------------------------------------------

  if (data.length < 5) {
    warnings.push(
      `Dataset has only ${data.length} row(s). MCMC may not converge reliably.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// prepareDataColumns
// ---------------------------------------------------------------------------

/**
 * Convert an array of parsed CSV row objects into numeric column arrays.
 *
 * String columns are automatically detected and encoded as integers starting
 * from 1 (BUGS/JAGS convention for factor levels). The mapping from string
 * levels to integers is returned in `factorMaps`.
 *
 * Numeric columns are stored as Float64Array for efficient typed access.
 * Factor-encoded columns are also stored as Float64Array (integer values).
 *
 * @param {Object[]} data - Parsed CSV rows (output of parseCSV).
 * @returns {{
 *   columns: Object.<string, Float64Array>,
 *   factorMaps: Object.<string, Object.<string, number>>
 * }}
 *   - `columns`:    keyed by column name, value is a Float64Array of length N.
 *   - `factorMaps`: keyed by factor column name; each value maps level string
 *                   -> integer code (1-based).
 */
export function prepareDataColumns(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return { columns: {}, factorMaps: {} };
  }

  const N = data.length;
  const headers = Object.keys(data[0]);
  const columns = {};
  const factorMaps = {};

  for (const header of headers) {
    const rawValues = data.map(row => row[header]);

    // Determine whether this column is numeric
    const isNumeric = rawValues.every(v => v !== '' && !isNaN(Number(v)));

    if (isNumeric) {
      // Numeric column — parse directly into Float64Array
      columns[header] = new Float64Array(rawValues.map(Number));
    } else {
      // Factor column — assign integer codes in order of first appearance
      const levelMap = {}; // level string -> integer code (1-based)
      let nextCode = 1;

      const coded = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const level = String(rawValues[i]).trim();
        if (!(level in levelMap)) {
          levelMap[level] = nextCode++;
        }
        coded[i] = levelMap[level];
      }

      columns[header] = coded;
      factorMaps[header] = levelMap;
    }
  }

  return { columns, factorMaps };
}
