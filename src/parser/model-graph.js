/**
 * model-graph.js - Build a Directed Acyclic Graph (DAG) from a parsed BUGS/JAGS AST.
 *
 * Takes the AST produced by parser.js and a data object, expands for-loops,
 * classifies each variable as stochastic/deterministic/observed/constant,
 * identifies conjugate structure, and exposes methods needed by the Gibbs
 * sampler (log-likelihood, log-prior, log-posterior, deterministic evaluation).
 *
 * Data object shape:
 *   { columns: { varName: number[] }, N: number, J?: number, ... }
 *
 * AST node types consumed:
 *   Model, Block, ForLoop, StochasticAssignment, DeterministicAssignment,
 *   Distribution, BinaryOp, UnaryOp, FunctionCall, IndexExpr, Identifier,
 *   NumberLiteral
 */

import {
  dnorm, dgamma, dbeta, dbinom, dbern, dpois, dunif, dlnorm,
} from '../utils/distributions.js';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ModelGraphError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelGraphError';
  }
}

// ---------------------------------------------------------------------------
// Distribution log-density dispatch
// ---------------------------------------------------------------------------

/**
 * Map from BUGS distribution name → log-density function.
 * Each function receives (x, ...params) where params are already-evaluated
 * numeric values.
 *
 * JAGS/NIMBLE argument orders:
 *   dnorm(mean, precision)
 *   dgamma(shape, rate)
 *   dbeta(a, b)
 *   dbinom(prob, size)   — note: JAGS order is dbinom(p, n) not dbinom(n, p)
 *   dbern(prob)
 *   dpois(lambda)
 *   dunif(lower, upper)
 *   dlnorm(meanlog, preclog)
 */
const LOG_DENSITY = {
  dnorm:  (x, mu, tau)       => dnorm(x, mu, tau),
  dgamma: (x, shape, rate)   => dgamma(x, shape, rate),
  dbeta:  (x, a, b)          => dbeta(x, a, b),
  dbinom: (x, p, n)          => dbinom(x, n, p),   // JAGS: dbinom(p, n)
  dbern:  (x, p)             => dbern(x, p),
  dpois:  (x, lambda)        => dpois(x, lambda),
  dunif:  (x, lower, upper)  => dunif(x, lower, upper),
  dlnorm: (x, meanlog, preclog) => dlnorm(x, meanlog, preclog),
};

// Aliases
LOG_DENSITY.dnormal   = LOG_DENSITY.dnorm;
LOG_DENSITY.dpoisson  = LOG_DENSITY.dpois;
LOG_DENSITY.dbernoulli = LOG_DENSITY.dbern;
LOG_DENSITY.dbinomial = LOG_DENSITY.dbinom;

// ---------------------------------------------------------------------------
// Expression evaluator (pure, no side-effects)
// ---------------------------------------------------------------------------

/**
 * Evaluate a BUGS expression tree to a numeric value.
 *
 * @param {object} expr        - AST expression node
 * @param {object} paramValues - Map of node name → current numeric value
 * @param {object} dataColumns - Map of variable name → number[] (raw data)
 * @returns {number}
 */
function evaluateExpr(expr, paramValues, dataColumns) {
  if (expr === null || expr === undefined) {
    throw new ModelGraphError('evaluateExpr: received null/undefined expression');
  }

  switch (expr.type) {
    case 'NumberLiteral':
      return expr.value;

    case 'Identifier': {
      const name = expr.name;
      if (name in paramValues) return paramValues[name];
      // Scalar data constant (e.g. N, J)
      if (name in dataColumns) {
        const col = dataColumns[name];
        // If it resolves to a scalar-shaped column treat its first element
        if (typeof col === 'number') return col;
        if (Array.isArray(col) && col.length === 1) return col[0];
      }
      throw new ModelGraphError(`evaluateExpr: unknown identifier '${name}'`);
    }

    case 'IndexExpr': {
      // e.g. y[i], group[i], beta[j]
      const base = expr.object?.name ?? expr.name; // variable name string
      const indices = expr.indices.map(idx => Math.round(evaluateExpr(idx, paramValues, dataColumns)));
      const key = indices.length === 1
        ? `${base}[${indices[0]}]`
        : `${base}[${indices.join(',')}]`;
      if (key in paramValues) return paramValues[key];
      // Look up in data columns (1-based indexing as in BUGS)
      if (base in dataColumns) {
        const col = dataColumns[base];
        if (Array.isArray(col)) {
          const idx = indices[0] - 1; // convert 1-based → 0-based
          if (idx >= 0 && idx < col.length) return col[idx];
        }
      }
      throw new ModelGraphError(`evaluateExpr: cannot resolve index expression '${key}'`);
    }

    case 'BinaryOp': {
      const left  = evaluateExpr(expr.left,  paramValues, dataColumns);
      const right = evaluateExpr(expr.right, paramValues, dataColumns);
      switch (expr.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right === 0 ? (left >= 0 ? Infinity : -Infinity) : left / right;
        case '^': return Math.pow(left, right);
        default:
          throw new ModelGraphError(`evaluateExpr: unknown binary operator '${expr.op}'`);
      }
    }

    case 'UnaryOp': {
      const operand = evaluateExpr(expr.operand, paramValues, dataColumns);
      switch (expr.op) {
        case '-': return -operand;
        case '+': return +operand;
        default:
          throw new ModelGraphError(`evaluateExpr: unknown unary operator '${expr.op}'`);
      }
    }

    case 'FunctionCall': {
      const fnName = expr.name;
      const args   = expr.args.map(a => evaluateExpr(a, paramValues, dataColumns));
      switch (fnName) {
        case 'exp':     return Math.exp(args[0]);
        case 'log':     return Math.log(args[0]);
        case 'sqrt':    return Math.sqrt(args[0]);
        case 'abs':     return Math.abs(args[0]);
        case 'pow':     return Math.pow(args[0], args[1]);
        case 'inverse': return 1 / args[0];
        case 'logit':   {
          const p = args[0];
          return Math.log(p / (1 - p));
        }
        case 'ilogit':
        case 'expit': {
          const x = args[0];
          return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
        }
        case 'phi':
        case 'probit': {
          // Standard normal CDF approximation (Abramowitz & Stegun)
          const x = args[0];
          return 0.5 * (1 + erf(x / Math.SQRT2));
        }
        case 'max': return Math.max(...args);
        case 'min': return Math.min(...args);
        case 'round': return Math.round(args[0]);
        case 'trunc':
        case 'floor': return Math.floor(args[0]);
        case 'ceil':  return Math.ceil(args[0]);
        case 'sin':   return Math.sin(args[0]);
        case 'cos':   return Math.cos(args[0]);
        case 'tan':   return Math.tan(args[0]);
        default:
          throw new ModelGraphError(`evaluateExpr: unknown function '${fnName}'`);
      }
    }

    default:
      throw new ModelGraphError(`evaluateExpr: unknown expression type '${expr.type}'`);
  }
}

/**
 * Error function approximation (for probit/phi).
 * @param {number} x
 * @returns {number}
 */
function erf(x) {
  // Abramowitz & Stegun 7.1.26, max error 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = 1 - poly * Math.exp(-(x * x));
  return x >= 0 ? result : -result;
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

/**
 * Produce the canonical string key for a variable reference.
 * Scalars: "alpha"
 * Indexed: "mu[1]", "b[3]", "y[2,1]"
 *
 * @param {string}   baseName
 * @param {number[]} indices  - empty for scalars
 * @returns {string}
 */
function makeNodeName(baseName, indices) {
  if (!indices || indices.length === 0) return baseName;
  return `${baseName}[${indices.join(',')}]`;
}

/**
 * Extract the base variable name from a node name.
 * "mu[1]" → "mu", "alpha" → "alpha"
 * @param {string} nodeName
 * @returns {string}
 */
function baseName(nodeName) {
  const bracket = nodeName.indexOf('[');
  return bracket === -1 ? nodeName : nodeName.slice(0, bracket);
}

/**
 * Collect all Identifier / IndexExpr names referenced in an expression tree.
 * Returns an array of canonical node-name strings.
 *
 * @param {object} expr
 * @param {Map<string, object>} nodes - current node registry (for lookup)
 * @param {object} dataColumns
 * @param {object} loopVars - current loop-variable bindings (name → value)
 * @returns {string[]}
 */
function collectDeps(expr, nodes, dataColumns, loopVars) {
  const deps = new Set();
  _walkDeps(expr, nodes, dataColumns, loopVars, deps);
  return [...deps];
}

function _walkDeps(expr, nodes, dataColumns, loopVars, deps) {
  if (!expr) return;
  switch (expr.type) {
    case 'NumberLiteral':
      break;

    case 'Identifier': {
      const name = expr.name;
      // Loop variables are not graph nodes
      if (name in loopVars) break;
      // Data scalars (N, J, …) are constants, not graph nodes
      if (name in dataColumns && typeof dataColumns[name] === 'number') break;
      if (nodes.has(name)) deps.add(name);
      break;
    }

    case 'IndexExpr': {
      const base = expr.name;
      // Evaluate indices substituting loop variables
      const indices = expr.indices.map(idx => {
        try {
          return Math.round(evaluateExpr(idx, loopVars, dataColumns));
        } catch (_) {
          return null;
        }
      });
      if (indices.every(v => v !== null)) {
        const key = makeNodeName(base, indices);
        if (nodes.has(key)) deps.add(key);
        // Also check the base name (scalar)
        if (nodes.has(base)) deps.add(base);
      }
      // Recurse into index sub-expressions (they may reference loop vars only)
      for (const idx of expr.indices) _walkDeps(idx, nodes, dataColumns, loopVars, deps);
      break;
    }

    case 'BinaryOp':
      _walkDeps(expr.left,  nodes, dataColumns, loopVars, deps);
      _walkDeps(expr.right, nodes, dataColumns, loopVars, deps);
      break;

    case 'UnaryOp':
      _walkDeps(expr.operand, nodes, dataColumns, loopVars, deps);
      break;

    case 'FunctionCall':
      for (const arg of expr.args) _walkDeps(arg, nodes, dataColumns, loopVars, deps);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// LHS target extraction
// ---------------------------------------------------------------------------

/**
 * Given the LHS expression of a `~` or `<-` statement, return:
 *   { baseName: string, indices: number[] }
 * after substituting current loop-variable bindings.
 *
 * Handles:
 *   - Identifier  →  { baseName: 'alpha', indices: [] }
 *   - IndexExpr   →  { baseName: 'mu', indices: [3] }
 *   - FunctionCall (link fn)  →  unwrap the inner target
 *
 * @param {object} lhsExpr
 * @param {object} loopVars
 * @param {object} dataColumns
 * @returns {{ baseName: string, indices: number[] }}
 */
function resolveLHS(lhsExpr, loopVars, dataColumns) {
  if (lhsExpr.type === 'Identifier') {
    return { baseName: lhsExpr.name, indices: [] };
  }

  if (lhsExpr.type === 'IndexExpr') {
    const indices = lhsExpr.indices.map(idx =>
      Math.round(evaluateExpr(idx, loopVars, dataColumns))
    );
    return { baseName: lhsExpr.object.name, indices };
  }

  // Link-function on LHS: log(mu[i]) <- ..., logit(p[i]) <- ...
  if (lhsExpr.type === 'FunctionCall') {
    if (lhsExpr.args.length !== 1) {
      throw new ModelGraphError(
        `resolveLHS: link function '${lhsExpr.name}' must have exactly one argument`
      );
    }
    // The actual target is the argument; the link is recorded separately
    const inner = resolveLHS(lhsExpr.args[0], loopVars, dataColumns);
    inner.linkFn = lhsExpr.name;
    return inner;
  }

  throw new ModelGraphError(
    `resolveLHS: unsupported LHS expression type '${lhsExpr.type}'`
  );
}

// ---------------------------------------------------------------------------
// Conjugate-structure detector
// ---------------------------------------------------------------------------

/**
 * Collect all stochastic descendants of a node, traversing through deterministic
 * intermediaries.  Returns a Set of node objects.
 *
 * @param {object} node
 * @param {Map}    nodeMap
 * @param {Set}    [visited] - internal cycle guard
 * @returns {Set<object>}
 */
function stochasticDescendants(node, nodeMap, visited = new Set()) {
  const result = new Set();
  if (visited.has(node.name)) return result;
  visited.add(node.name);

  for (const childName of node.children) {
    const child = nodeMap.get(childName);
    if (!child) continue;
    if (child.type === 'stochastic' || child.type === 'observed') {
      result.add(child);
    } else if (child.type === 'deterministic') {
      // Traverse through deterministic nodes
      for (const desc of stochasticDescendants(child, nodeMap, visited)) {
        result.add(desc);
      }
    }
  }
  return result;
}

/**
 * Given an unobserved stochastic node and the full node registry, determine
 * the conjugate update type (or null if none applies).
 *
 * Conjugate pairs (prior → likelihood):
 *   Normal prior   + Normal stochastic descendants using this as mean param → 'normal-normal'
 *   Gamma prior    + Normal descendants where this node is precision         → 'gamma-normal'
 *   Gamma prior    + Poisson descendants where this is lambda                → 'gamma-poisson'
 *   Beta prior     + Bernoulli / Binomial descendants                        → 'beta-binomial'
 *
 * Traverses through deterministic intermediaries so that patterns like:
 *   alpha -> mu[i] (det) -> y[i] (dnorm)  are correctly classified.
 *
 * @param {object} node      - the stochastic node being classified
 * @param {Map}    nodeMap   - full node registry
 * @returns {string|null}
 */
function detectConjugateType(node, nodeMap) {
  const priorDist = node.distribution?.name;
  if (!priorDist) return null;

  const isNormalPrior = priorDist === 'dnorm';
  const isGammaPrior  = priorDist === 'dgamma';
  const isBetaPrior   = priorDist === 'dbeta';

  if (!isNormalPrior && !isGammaPrior && !isBetaPrior) return null;

  // Collect stochastic descendants (through deterministic intermediaries)
  const descStochastic = stochasticDescendants(node, nodeMap);

  if (descStochastic.size === 0) return null;

  // Determine what distributions the stochastic descendants follow
  const descDists = new Set(
    [...descStochastic].map(c => c.distribution?.name).filter(Boolean)
  );

  if (isGammaPrior) {
    if (descDists.has('dpois')) return 'gamma-poisson';
    if (descDists.has('dnorm')) {
      // Gamma prior → precision for Normal descendants → gamma-normal
      // Check that this node appears (directly) in the second (precision) parameter
      // of at least one dnorm descendant.
      const appearsAsPrecision = [...descStochastic].some(c => {
        if (c.distribution?.name !== 'dnorm') return false;
        const paramNodes = c.distribution?.paramNodes ?? [];
        return paramNodes.length >= 2 && paramNodes[1] === node.name;
      });
      if (appearsAsPrecision) return 'gamma-normal';
    }
    return null;
  }

  if (isNormalPrior) {
    if (descDists.has('dnorm')) return 'normal-normal';
    return null;
  }

  if (isBetaPrior) {
    if (descDists.has('dbern') || descDists.has('dbinom')) return 'beta-binomial';
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// ModelGraph class
// ---------------------------------------------------------------------------

export class ModelGraph {
  /**
   * @param {object} ast  - Root AST node produced by parser.js (type: 'Model')
   * @param {object} data - Data object: { columns: {name: number[]}, N, J?, ... }
   */
  constructor(ast, data) {
    if (!ast || ast.type !== 'Model') {
      throw new ModelGraphError("ModelGraph: expected AST root node of type 'Model'");
    }
    if (!data || typeof data !== 'object') {
      throw new ModelGraphError('ModelGraph: data must be a non-null object');
    }

    this._ast  = ast;
    this._data = data;

    // Flatten data: combine columns + top-level scalars (N, J, …)
    // dataColumns maps name → number[] (arrays) or number (scalars)
    this._dataColumns = Object.assign({}, data.columns ?? {});
    for (const [key, val] of Object.entries(data)) {
      if (key !== 'columns' && typeof val === 'number') {
        this._dataColumns[key] = val;
      }
    }

    /** @type {Map<string, object>} - Node registry keyed by canonical name */
    this.nodes = new Map();

    /** @type {string[]} - Names of unobserved stochastic nodes (parameters) */
    this.parameters = [];

    this._built = false;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Build the full DAG: expand loops, classify nodes, wire edges, detect conjugacy.
   * Must be called before using any other methods.
   */
  build() {
    if (this._built) return this;

    // Walk the model block and process statements
    const block = this._ast.body; // Block node
    this._processBlock(block, {});

    // Second pass: resolve parent/child edges using collected node set
    this._resolveEdges();

    // Third pass: tag stochastic nodes with conjugate type
    for (const node of this.nodes.values()) {
      if (node.type === 'stochastic' && !node.observed) {
        node.conjugateType = detectConjugateType(node, this.nodes);
      }
    }

    // Collect parameter list (unobserved stochastic nodes)
    this.parameters = [];
    for (const [name, node] of this.nodes) {
      if (node.type === 'stochastic' && !node.observed) {
        this.parameters.push(name);
      }
    }

    this._built = true;
    return this;
  }

  /**
   * Get all unobserved stochastic nodes (parameters to sample).
   * @returns {object[]}
   */
  getParameters() {
    this._requireBuilt();
    return this.parameters.map(name => this.nodes.get(name));
  }

  /**
   * Compute total log-likelihood: sum of log-densities for all observed nodes.
   *
   * @param {object} paramValues - Map of param name → current value
   * @returns {number}
   */
  logLikelihood(paramValues) {
    this._requireBuilt();
    const allValues = this._mergeValues(paramValues);
    let logL = 0;
    for (const node of this.nodes.values()) {
      if (node.type !== 'observed') continue;
      const contrib = this._logDensityNode(node, allValues);
      if (!isFinite(contrib)) return -Infinity;
      logL += contrib;
    }
    return logL;
  }

  /**
   * Compute log prior for a single parameter at a given value.
   *
   * @param {string} paramName
   * @param {number} value
   * @param {object} paramValues - other current parameter values (for evaluating hyperparams)
   * @returns {number}
   */
  logPrior(paramName, value, paramValues) {
    this._requireBuilt();
    const node = this.nodes.get(paramName);
    if (!node) {
      throw new ModelGraphError(`logPrior: unknown parameter '${paramName}'`);
    }
    if (node.type !== 'stochastic') {
      throw new ModelGraphError(`logPrior: '${paramName}' is not a stochastic node`);
    }
    const allValues = this._mergeValues(paramValues);
    allValues[paramName] = value;
    return this._logDensityNode(node, allValues);
  }

  /**
   * Compute log prior only (sum of prior log-densities for unobserved nodes).
   * Used for prior predictive checks.
   *
   * @param {object} paramValues - Map of param name → current value
   * @returns {number}
   */
  logPriorOnly(paramValues) {
    this._requireBuilt();
    const allValues = this._mergeValues(paramValues);
    let logP = 0;
    for (const node of this.nodes.values()) {
      if (node.type === 'stochastic' && !node.observed) {
        const lp = this._logDensityNode(node, allValues);
        if (!isFinite(lp)) return -Infinity;
        logP += lp;
      }
    }
    return logP;
  }

  /**
   * Compute full (unnormalized) log posterior.
   *
   * @param {object} paramValues - Map of param name → current value
   * @returns {number}
   */
  logPosterior(paramValues) {
    this._requireBuilt();
    const allValues = this._mergeValues(paramValues);

    let logPost = 0;

    for (const node of this.nodes.values()) {
      if (node.type === 'stochastic' && !node.observed) {
        // Prior contribution
        const lp = this._logDensityNode(node, allValues);
        if (!isFinite(lp)) return -Infinity;
        logPost += lp;
      } else if (node.type === 'observed') {
        // Likelihood contribution
        const ll = this._logDensityNode(node, allValues);
        if (!isFinite(ll)) return -Infinity;
        logPost += ll;
      }
      // deterministic and constant nodes don't contribute to log-posterior directly
    }

    return logPost;
  }

  /**
   * Evaluate a deterministic node to a numeric value given current param values.
   *
   * @param {string} nodeName
   * @param {object} paramValues
   * @returns {number}
   */
  evalDeterministic(nodeName, paramValues) {
    this._requireBuilt();
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new ModelGraphError(`evalDeterministic: unknown node '${nodeName}'`);
    }
    if (node.type !== 'deterministic') {
      throw new ModelGraphError(`evalDeterministic: '${nodeName}' is not deterministic`);
    }
    const allValues = this._mergeValues(paramValues);
    return this.evaluateExpr(node.deterministicExpr, allValues);
  }

  /**
   * Evaluate an expression tree using the provided parameter values.
   * Merges parameter values with observed data before evaluating.
   *
   * @param {object} expr
   * @param {object} paramValues
   * @returns {number}
   */
  evaluateExpr(expr, paramValues) {
    const allValues = this._mergeValues(paramValues);
    return evaluateExpr(expr, allValues, this._dataColumns);
  }

  // ── Private: graph construction ───────────────────────────────────────────

  /**
   * Process a Block node, iterating over its statements.
   * @param {object} block
   * @param {object} loopVars - current loop-variable bindings
   */
  _processBlock(block, loopVars) {
    if (!block || block.type !== 'Block') {
      throw new ModelGraphError(`_processBlock: expected Block node, got '${block?.type}'`);
    }
    for (const stmt of block.statements ?? block.body ?? []) {
      this._processStatement(stmt, loopVars);
    }
  }

  /**
   * Dispatch on statement type.
   * @param {object} stmt
   * @param {object} loopVars
   */
  _processStatement(stmt, loopVars) {
    switch (stmt.type) {
      case 'ForLoop':
        this._processForLoop(stmt, loopVars);
        break;
      case 'StochasticAssignment':
        this._processStochastic(stmt, loopVars);
        break;
      case 'DeterministicAssignment':
        this._processDeterministic(stmt, loopVars);
        break;
      case 'Block':
        this._processBlock(stmt, loopVars);
        break;
      default:
        throw new ModelGraphError(`_processStatement: unknown statement type '${stmt.type}'`);
    }
  }

  /**
   * Unroll a ForLoop over its concrete integer range, recursively processing
   * the body for each value of the loop variable.
   * @param {object} stmt
   * @param {object} loopVars
   */
  _processForLoop(stmt, loopVars) {
    const varName = stmt.variable; // e.g. 'i'

    // Evaluate range bounds in the context of the current loop variables + data
    const allCtx = Object.assign({}, loopVars);
    const from = Math.round(evaluateExpr(stmt.from, allCtx, this._dataColumns));
    const to   = Math.round(evaluateExpr(stmt.to,   allCtx, this._dataColumns));

    if (!isFinite(from) || !isFinite(to)) {
      throw new ModelGraphError(
        `ForLoop: could not evaluate range bounds for loop variable '${varName}'`
      );
    }

    for (let i = from; i <= to; i++) {
      const innerVars = Object.assign({}, loopVars, { [varName]: i });
      this._processBlock(stmt.body, innerVars);
    }
  }

  /**
   * Process a stochastic assignment: y[i] ~ dnorm(mu[i], tau)
   * @param {object} stmt
   * @param {object} loopVars
   */
  _processStochastic(stmt, loopVars) {
    const lhs = resolveLHS(stmt.lhs, loopVars, this._dataColumns);
    const nodeName = makeNodeName(lhs.baseName, lhs.indices);

    // Determine if this node's value is observed in the data
    const isObserved = this._isObserved(lhs.baseName, lhs.indices);
    const observedValue = isObserved
      ? this._lookupData(lhs.baseName, lhs.indices)
      : undefined;

    // Collect expression-level dependencies in distribution params
    // (will be properly resolved in _resolveEdges; store raw exprs for now)
    const dist = stmt.distribution; // Distribution AST node
    if (!dist || dist.type !== 'Distribution') {
      throw new ModelGraphError(
        `StochasticAssignment: expected Distribution node for '${nodeName}'`
      );
    }

    // Snapshot current loop vars into the param expressions by deep-cloning
    // the expressions and substituting numeric literals for loop variables
    const paramExprs = dist.params.map(p => this._substituteLoopVars(p, loopVars));

    // Register or update the node
    const existingNode = this.nodes.get(nodeName);
    if (existingNode) {
      // Duplicate definition — warn but keep first definition (BUGS semantics:
      // multiple stochastic uses of the same variable are not valid, but array
      // elements defined at different loop iterations are fine since they get
      // different names)
      return;
    }

    const node = {
      name:          nodeName,
      type:          isObserved ? 'observed' : 'stochastic',
      distribution:  {
        name:       dist.name,
        paramExprs, // Array of substituted expression ASTs
        paramNodes: [], // filled in during _resolveEdges
      },
      deterministicExpr: null,
      parents:  [],
      children: [],
      observed: isObserved,
      value:    observedValue,
      conjugateType: null,
      linkFn:   lhs.linkFn ?? null,
    };

    this.nodes.set(nodeName, node);
  }

  /**
   * Process a deterministic assignment: mu[i] <- alpha + beta * x[i]
   * Also handles link-function LHS: log(mu[i]) <- ...
   * @param {object} stmt
   * @param {object} loopVars
   */
  _processDeterministic(stmt, loopVars) {
    const lhs = resolveLHS(stmt.lhs, loopVars, this._dataColumns);
    const nodeName = makeNodeName(lhs.baseName, lhs.indices);

    // Substitute loop variables into the RHS expression
    const rhs = this._substituteLoopVars(stmt.rhs, loopVars);

    // If there is a link function on the LHS, we need to wrap the RHS
    // in the inverse link, or more precisely, we store the link and let
    // the sampler handle it.  For now we record the expression as-is and
    // note the link.
    const existingNode = this.nodes.get(nodeName);
    if (existingNode) {
      // Deterministic node may be re-defined in multiple loop iterations;
      // each iteration produces a uniquely-named node, so a true collision
      // here is a genuine error.
      throw new ModelGraphError(
        `Duplicate deterministic definition for node '${nodeName}'`
      );
    }

    const node = {
      name:             nodeName,
      type:             'deterministic',
      distribution:     null,
      deterministicExpr: rhs,
      parents:          [],
      children:         [],
      observed:         false,
      value:            undefined,
      conjugateType:    null,
      linkFn:           lhs.linkFn ?? null,
    };

    this.nodes.set(nodeName, node);
  }

  // ── Private: edge resolution ──────────────────────────────────────────────

  /**
   * Second-pass: for every node, evaluate which other nodes it depends on,
   * and wire parent → child edges bidirectionally.
   */
  _resolveEdges() {
    for (const node of this.nodes.values()) {
      const deps = this._depsForNode(node);
      for (const dep of deps) {
        if (!node.parents.includes(dep)) node.parents.push(dep);
        const parentNode = this.nodes.get(dep);
        if (parentNode && !parentNode.children.includes(node.name)) {
          parentNode.children.push(node.name);
        }
      }

      // Also fill paramNodes for stochastic/observed nodes
      if (node.distribution) {
        node.distribution.paramNodes = node.distribution.paramExprs.map(expr => {
          // Try to find the primary identifier in the expression (best-effort)
          return this._primaryNodeOfExpr(expr);
        });
      }
    }
  }

  /**
   * Collect dependency node names for a given node based on its expressions.
   * @param {object} node
   * @returns {string[]}
   */
  _depsForNode(node) {
    const emptyLoopVars = {}; // loop vars already substituted
    if (node.type === 'deterministic' && node.deterministicExpr) {
      return collectDeps(node.deterministicExpr, this.nodes, this._dataColumns, emptyLoopVars);
    }
    if (node.distribution) {
      const allDeps = new Set();
      for (const expr of node.distribution.paramExprs) {
        for (const dep of collectDeps(expr, this.nodes, this._dataColumns, emptyLoopVars)) {
          allDeps.add(dep);
        }
      }
      return [...allDeps];
    }
    return [];
  }

  /**
   * Try to identify the "primary" node name referenced in a simple expression
   * (used for populating paramNodes to support conjugacy detection).
   * For compound expressions returns null.
   *
   * @param {object} expr
   * @returns {string|null}
   */
  _primaryNodeOfExpr(expr) {
    if (!expr) return null;
    if (expr.type === 'Identifier') {
      return this.nodes.has(expr.name) ? expr.name : null;
    }
    if (expr.type === 'IndexExpr') {
      // Try to build the concrete name from already-substituted (numeric-literal) indices
      try {
        const indices = expr.indices.map(idx => {
          if (idx.type === 'NumberLiteral') return idx.value;
          return null;
        });
        if (indices.every(v => v !== null)) {
          const key = makeNodeName(expr.name, indices);
          return this.nodes.has(key) ? key : null;
        }
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  // ── Private: loop-variable substitution ───────────────────────────────────

  /**
   * Deep-clone an expression AST, replacing Identifier nodes whose name
   * matches a current loop variable with NumberLiteral nodes.
   * This "freezes" the loop index into the expression so the stored expression
   * is self-contained (no free loop variables).
   *
   * @param {object} expr
   * @param {object} loopVars
   * @returns {object}
   */
  _substituteLoopVars(expr, loopVars) {
    if (!expr) return expr;

    switch (expr.type) {
      case 'NumberLiteral':
        return { ...expr };

      case 'Identifier': {
        if (expr.name in loopVars) {
          return { type: 'NumberLiteral', value: loopVars[expr.name] };
        }
        return { ...expr };
      }

      case 'IndexExpr': {
        return {
          ...expr,
          indices: expr.indices.map(idx => this._substituteLoopVars(idx, loopVars)),
        };
      }

      case 'BinaryOp':
        return {
          ...expr,
          left:  this._substituteLoopVars(expr.left,  loopVars),
          right: this._substituteLoopVars(expr.right, loopVars),
        };

      case 'UnaryOp':
        return {
          ...expr,
          operand: this._substituteLoopVars(expr.operand, loopVars),
        };

      case 'FunctionCall':
        return {
          ...expr,
          args: expr.args.map(a => this._substituteLoopVars(a, loopVars)),
        };

      case 'Distribution':
        return {
          ...expr,
          params: expr.params.map(p => this._substituteLoopVars(p, loopVars)),
        };

      default:
        return { ...expr };
    }
  }

  // ── Private: data lookups ─────────────────────────────────────────────────

  /**
   * Check whether a variable/index combination has an observed value in data.
   * @param {string}   varName
   * @param {number[]} indices
   * @returns {boolean}
   */
  _isObserved(varName, indices) {
    if (!(varName in this._dataColumns)) return false;
    const col = this._dataColumns[varName];
    if (typeof col === 'number') return indices.length === 0;
    if (Array.isArray(col)) {
      if (indices.length === 0) return false; // whole array, not a scalar
      const i = indices[0] - 1; // 1-based → 0-based
      return i >= 0 && i < col.length && col[i] !== null && col[i] !== undefined && !Number.isNaN(col[i]);
    }
    return false;
  }

  /**
   * Look up a numeric value from data.
   * @param {string}   varName
   * @param {number[]} indices
   * @returns {number|undefined}
   */
  _lookupData(varName, indices) {
    const col = this._dataColumns[varName];
    if (typeof col === 'number') return col;
    if (Array.isArray(col) && indices.length > 0) {
      return col[indices[0] - 1]; // 1-based → 0-based
    }
    return undefined;
  }

  // ── Private: log-density computation ─────────────────────────────────────

  /**
   * Compute the log-density contribution of a single node given a complete
   * map of all current values (observed + parameters + deterministic).
   *
   * @param {object} node
   * @param {object} allValues - merged paramValues + observed values
   * @returns {number}
   */
  _logDensityNode(node, allValues) {
    if (!node.distribution) return 0;

    const distName = node.distribution.name;
    const logDensityFn = LOG_DENSITY[distName];
    if (!logDensityFn) {
      throw new ModelGraphError(`_logDensityNode: unknown distribution '${distName}'`);
    }

    // Value of this node
    let x = allValues[node.name];
    if (x === undefined || x === null) {
      // Might be a deterministic intermediate — shouldn't happen for stochastic nodes
      throw new ModelGraphError(
        `_logDensityNode: no value for node '${node.name}'`
      );
    }

    // Apply inverse link if needed (value stored on the natural scale;
    // distribution is on the transformed scale)
    if (node.linkFn) {
      x = this._applyLink(node.linkFn, x);
    }

    // Evaluate parameter expressions
    const params = node.distribution.paramExprs.map(expr => {
      try {
        return evaluateExpr(expr, allValues, this._dataColumns);
      } catch (err) {
        throw new ModelGraphError(
          `_logDensityNode: error evaluating parameter for '${node.name}': ${err.message}`
        );
      }
    });

    return logDensityFn(x, ...params);
  }

  /**
   * Apply a link function to transform a value from the natural scale to the
   * link scale (for use when the link appears on the LHS of <-).
   * @param {string} linkFn
   * @param {number} x
   * @returns {number}
   */
  _applyLink(linkFn, x) {
    switch (linkFn) {
      case 'log':    return Math.log(x);
      case 'logit':  return Math.log(x / (1 - x));
      case 'probit': return _probitApprox(x);
      case 'sqrt':   return Math.sqrt(x);
      case 'cloglog': return Math.log(-Math.log(1 - x));
      default:
        throw new ModelGraphError(`_applyLink: unknown link function '${linkFn}'`);
    }
  }

  /**
   * Apply the inverse of a link function to convert link-scale → natural scale.
   * Used when a deterministic node has a link on its LHS:
   *   log(mu[i]) <- eta   =>   mu[i] = exp(eta)
   *
   * @param {string} linkFn
   * @param {number} eta - Value on the link scale
   * @returns {number} Value on the natural scale
   */
  _applyInverseLink(linkFn, eta) {
    switch (linkFn) {
      case 'log':    return Math.exp(eta);
      case 'logit':  return eta >= 0
        ? 1 / (1 + Math.exp(-eta))
        : Math.exp(eta) / (1 + Math.exp(eta));
      case 'probit': {
        // Φ(eta): standard normal CDF
        return 0.5 * (1 + erf(eta / Math.SQRT2));
      }
      case 'sqrt':   return eta * eta;
      case 'cloglog': return 1 - Math.exp(-Math.exp(eta));
      default:
        throw new ModelGraphError(`_applyInverseLink: unknown link function '${linkFn}'`);
    }
  }

  // ── Private: utilities ────────────────────────────────────────────────────

  /**
   * Merge paramValues with all observed node values and evaluate all
   * deterministic nodes to build a complete value map.
   *
   * Deterministic nodes are evaluated in topological order (parents before
   * children) using a simple repeated-pass approach.
   *
   * @param {object} paramValues
   * @returns {object} combined map
   */
  _mergeValues(paramValues) {
    const allValues = Object.assign({}, paramValues);

    // Inject observed values
    for (const node of this.nodes.values()) {
      if (node.observed && node.value !== undefined) {
        allValues[node.name] = node.value;
      }
    }

    // Inject data scalars (N, J, …)
    for (const [key, val] of Object.entries(this._dataColumns)) {
      if (typeof val === 'number' && !(key in allValues)) {
        allValues[key] = val;
      }
    }

    // Evaluate deterministic nodes (topological order via repeated passes)
    const detNodes = [...this.nodes.values()].filter(n => n.type === 'deterministic');
    let remaining = detNodes.length;
    const maxPasses = detNodes.length + 1;
    let pass = 0;

    while (remaining > 0 && pass < maxPasses) {
      pass++;
      let resolved = 0;
      for (const node of detNodes) {
        if (node.name in allValues) continue; // already evaluated
        try {
          const linkScaleVal = evaluateExpr(node.deterministicExpr, allValues, this._dataColumns);
          // If the deterministic node has a link function on its LHS (e.g. log(mu[i]) <- ...),
          // the expression gives the link-scale value. The node name (mu[i], p[i], etc.)
          // represents the natural-scale value, so we apply the inverse link here.
          allValues[node.name] = node.linkFn
            ? this._applyInverseLink(node.linkFn, linkScaleVal)
            : linkScaleVal;
          resolved++;
        } catch (_) {
          // Dependencies not yet available — will retry in a later pass
        }
      }
      remaining -= resolved;
      if (resolved === 0) break; // no progress; probably a cycle or missing dependency
    }

    return allValues;
  }

  _requireBuilt() {
    if (!this._built) {
      throw new ModelGraphError('ModelGraph: call build() before using this method');
    }
  }
}

// ---------------------------------------------------------------------------
// Probit approximation (used for probit link)
// ---------------------------------------------------------------------------

/**
 * Rational approximation to the standard normal quantile (probit) function.
 * Beasley-Springer-Moro algorithm.  Valid for p in (0,1).
 * @param {number} p
 * @returns {number}
 */
function _probitApprox(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.47351093090,  23.08336743743, -21.06224101826,  3.13082909833];
  const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
             0.0276438810333863, 0.0038405729373609, 0.0003951896511349,
             0.0000321767881768, 0.0000002888167364, 0.0000003960315187];

  const y = p - 0.5;
  if (Math.abs(y) < 0.42) {
    const r = y * y;
    return y * (((a[3]*r + a[2])*r + a[1])*r + a[0]) /
               ((((b[3]*r + b[2])*r + b[1])*r + b[0])*r + 1);
  }
  let r = p < 0.5 ? p : 1 - p;
  r = Math.log(-Math.log(r));
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] * Math.pow(r, i);
  return p < 0.5 ? -x : x;
}
