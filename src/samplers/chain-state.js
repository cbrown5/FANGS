/**
 * chain-state.js - Persistent per-chain value state for the standard sampler
 *
 * Holds one merged value map (parameters + observed data + deterministic
 * nodes) for the lifetime of a chain. Changing a parameter refreshes only the
 * deterministic nodes downstream of it, and the log full conditional sums only
 * the parameter's Markov blanket (its own prior plus the nodes that depend on
 * it). Both come from ModelGraph.getBlanket(), precomputed at build time.
 *
 * Before this, every slice-sampler evaluation rebuilt the whole value map and
 * summed the log-density of every node in the model, so one sweep cost about
 * O(P · N · slice steps). With blankets it costs about O(Σ blanket sizes ·
 * slice steps), which for a typical regression is O(N · slice steps).
 *
 * See plans/compiled-standard-sampler.md (phase 1).
 */

export class ChainState {
  /**
   * @param {import('../parser/model-graph.js').ModelGraph} graph - built graph
   * @param {Object} initialValues - { paramName: value } for every parameter
   * @param {Object} [options]
   * @param {boolean} [options.priorOnly=false] - drop the likelihood: conditionals
   *   then include only unobserved children (matches graph.logPriorOnly)
   */
  constructor(graph, initialValues, { priorOnly = false } = {}) {
    this.graph = graph;
    this.priorOnly = priorOnly;
    this._values = graph._mergeValues(initialValues);
  }

  /**
   * The merged value map. Treat as read-only: write parameters through set()
   * so that deterministic nodes stay consistent.
   * @returns {Object}
   */
  get values() {
    return this._values;
  }

  /**
   * Set a parameter and refresh the deterministic nodes that depend on it.
   * @param {string} paramName
   * @param {number} value
   */
  set(paramName, value) {
    const values = this._values;
    values[paramName] = value;
    const { detPath } = this.graph.getBlanket(paramName);
    for (let i = 0; i < detPath.length; i++) {
      this.graph._evalDetNode(detPath[i], values);
    }
  }

  /**
   * Log full conditional of a parameter at its current value, up to an
   * additive constant: its own log prior plus the log-densities of its blanket
   * children. Returns -Infinity if any term is non-finite, like logPosterior.
   *
   * @param {string} paramName
   * @returns {number}
   */
  logConditional(paramName) {
    const graph = this.graph;
    const values = this._values;
    const blanket = graph.getBlanket(paramName);

    let logP = graph._logDensityNode(graph.nodes.get(paramName), values);
    if (!isFinite(logP)) return -Infinity;

    const children = this.priorOnly ? blanket.priorChildren : blanket.children;
    for (let i = 0; i < children.length; i++) {
      const contrib = graph._logDensityNode(children[i], values);
      if (!isFinite(contrib)) return -Infinity;
      logP += contrib;
    }
    return logP;
  }

  /**
   * Current parameter values as a fresh plain object (safe to store).
   * @returns {Object.<string, number>}
   */
  snapshot() {
    const out = {};
    for (const name of this.graph.parameters) out[name] = this._values[name];
    return out;
  }

  /**
   * Test helper: compare every deterministic node against a fresh
   * graph._mergeValues() of the current parameters.
   *
   * @param {number} [tol=1e-12] - relative tolerance
   * @returns {{ ok: boolean, maxRelDiff: number, mismatches: string[] }}
   */
  checkConsistency(tol = 1e-12) {
    const fresh = this.graph._mergeValues(this.snapshot());
    let maxRelDiff = 0;
    const mismatches = [];
    for (const node of this.graph._detNodesSorted) {
      const a = this._values[node.name];
      const b = fresh[node.name];
      if (Object.is(a, b)) continue;
      const diff = Math.abs(a - b) / Math.max(1, Math.abs(b));
      if (!(diff <= tol)) mismatches.push(node.name);
      if (diff > maxRelDiff || Number.isNaN(diff)) maxRelDiff = Number.isNaN(diff) ? Infinity : diff;
    }
    return { ok: mismatches.length === 0, maxRelDiff, mismatches };
  }
}
