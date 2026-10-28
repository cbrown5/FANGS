/**
 * compile-model.js - Compile a ModelGraph into a "blocked" GLMM sampling plan
 *
 * The blocked sampler does not walk the model graph on
 * every update. Instead, it compiles the model once into dense numeric arrays
 * that describe a generalised linear mixed model:
 *
 *   y[i] ~ F(g⁻¹(eta[i]))
 *   eta[i] = offset[i] + Σ_k X[i,k] θ_k + Σ_f a_f[i] · b_f[g_f[i]]
 *
 * where
 *   - F is dnorm (identity link), dpois (log link) or dbern/dbin (logit link)
 *   - θ is a small dense block of "fixed" coefficients with dnorm priors
 *   - each b_f is a "family" of coefficients (e.g. random intercepts b[j] or
 *     random slopes c[j]) whose design columns are disjoint: every observation
 *     touches at most one member of the family. Given everything else, the
 *     members are conditionally independent, so they can be updated in
 *     parallel (independently, given everything else).
 *   - every other parameter is a "hyperparameter" (SDs, hyper-means, the
 *     residual SD, ...). Hyperparameters do not enter eta; they are slice
 *     sampled on the CPU using cheap sufficient statistics.
 *   - "translations" pair a fixed coefficient with a family it is confounded
 *     with (an intercept and random intercepts, a slope and random slopes),
 *     enabling an exact joint shift move (see BlockedChainState.translate).
 *
 * Nothing here pattern-matches the model text. The structure is discovered
 * numerically from the graph: each parameter is perturbed and the change in
 * eta is recorded. A parameter whose effect is exactly linear becomes a
 * design-matrix column; joint random perturbations then verify that eta is
 * linear in all such parameters together (catching products such as
 * `sigma.b * z[j]`). Models outside this class raise UnsupportedModelError
 * with a human-readable reason, and the caller falls back to the standard
 * component-wise Gibbs sampler.
 */

import { initializeChains } from '../initialize.js';

/** Largest dense fixed-effects block (the dense Cholesky is O(P³)). */
export const MAX_FIXED = 32;

/** Map of response distribution → likelihood family. */
const LIKELIHOOD_OF = {
  dnorm:  'normal',
  dpois:  'poisson',
  dbern:  'binomial',
  dbin:   'binomial',
  dbinom: 'binomial',
};

/** Canonical link for each likelihood family. */
const CANONICAL_LINK = { normal: null, poisson: 'log', binomial: 'logit' };

/** Inverse-link function names that may wrap the linear predictor directly. */
const INVERSE_LINK_FNS = { normal: [], poisson: ['exp'], binomial: ['ilogit', 'expit'] };

/** Thrown when a model is outside the class the blocked sampler supports. */
export class UnsupportedModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedModelError';
  }
}

/**
 * Check whether the blocked sampler can run a model, without throwing.
 *
 * @param {import('../../parser/model-graph.js').ModelGraph} graph - built graph
 * @returns {{ supported: boolean, reason?: string, plan?: object }}
 */
export function analyzeBlockedModel(graph) {
  try {
    return { supported: true, plan: compileBlockedModel(graph) };
  } catch (err) {
    if (err instanceof UnsupportedModelError) {
      return { supported: false, reason: err.message };
    }
    throw err;
  }
}

/**
 * Compile a built ModelGraph into a blocked GLMM plan.
 *
 * @param {import('../../parser/model-graph.js').ModelGraph} graph - built graph
 * @returns {object} plan (see the module docstring and the return statement below)
 * @throws {UnsupportedModelError}
 */
export function compileBlockedModel(graph) {
  const nodes = graph.nodes;

  // ── 1. Response ──────────────────────────────────────────────────────────
  const obsNodes = [...nodes.values()].filter(n => n.type === 'observed');
  if (obsNodes.length === 0) {
    throw new UnsupportedModelError('the model has no observed data');
  }
  const responseBase = baseName(obsNodes[0].name);
  const distName = obsNodes[0].distribution.name;
  const likelihood = LIKELIHOOD_OF[distName];
  if (!likelihood) {
    throw new UnsupportedModelError(
      `the response distribution '${distName}' is not supported (use dnorm, dpois, dbern or dbin)`
    );
  }
  for (const obs of obsNodes) {
    if (baseName(obs.name) !== responseBase) {
      throw new UnsupportedModelError(
        `the model has more than one observed variable ('${responseBase}' and '${baseName(obs.name)}')`
      );
    }
    if (LIKELIHOOD_OF[obs.distribution.name] !== likelihood) {
      throw new UnsupportedModelError('all observations must share one response distribution');
    }
    if (obs.linkFn) {
      throw new UnsupportedModelError('link functions on the left of `~` are not supported');
    }
  }
  const N = obsNodes.length;
  const obsIndex = new Map(obsNodes.map((n, i) => [n.name, i]));

  // ── 2. Baseline values ───────────────────────────────────────────────────
  const params = graph.parameters.slice();
  const theta0 = initializeChains(graph, 1)[0];
  const all = graph._mergeValues(theta0);
  const etaOf = makeEtaFn(graph, likelihood);
  const extraArgsOf = (obs, vals) =>
    obs.distribution.paramExprs.slice(1).map(e => graph.evaluateExprMerged(e, vals));

  const eta0 = new Float64Array(N);
  const extra0 = new Array(N);
  for (let i = 0; i < N; i++) {
    eta0[i] = safeEval(() => etaOf(obsNodes[i], all), 'the linear predictor');
    extra0[i] = safeEval(() => extraArgsOf(obsNodes[i], all), 'the response distribution');
    if (!Number.isFinite(eta0[i])) {
      throw new UnsupportedModelError(
        `the linear predictor for ${obsNodes[i].name} is not finite at the initial values`
      );
    }
  }

  // ── 3. Probe each parameter's effect on eta ──────────────────────────────
  const detOrder = new Map(graph._detNodesSorted.map((n, k) => [n.name, k]));
  const desc = new Map(params.map(p => [p, descendants(graph, p, detOrder)]));

  const evalDet = (n, vals) => {
    const v = graph.evaluateExprMerged(n.deterministicExpr, vals);
    return n.linkFn ? graph._applyInverseLink(n.linkFn, v) : v;
  };

  /** eta and extra args for obsDesc(p) with param p set to `value`. */
  const probe = (p, value) => {
    const d = desc.get(p);
    const old = all[p];
    const saved = d.det.map(n => all[n.name]);
    all[p] = value;
    try {
      for (const n of d.det) all[n.name] = evalDet(n, all);
      return d.obs.map(obs => ({ eta: etaOf(obs, all), extra: extraArgsOf(obs, all) }));
    } finally {
      all[p] = old;
      d.det.forEach((n, k) => { all[n.name] = saved[k]; });
    }
  };

  const linear = [];       // params with a non-zero, linear effect on eta
  const hyper = [];        // everything else
  const columns = new Map(); // linear param → { idx: Int32Array, val: Float64Array }
  const obsSdParams = new Set(); // hypers that enter the dnorm SD

  for (const p of params) {
    const d = desc.get(p);
    if (d.obs.length === 0) { hyper.push(p); continue; }

    const up   = safeEval(() => probe(p, theta0[p] + 1), `the effect of '${p}'`);
    const down = safeEval(() => probe(p, theta0[p] - 1.5), `the effect of '${p}'`);

    const idx = [];
    const val = [];
    let extraChanged = false;
    for (let k = 0; k < d.obs.length; k++) {
      const i = obsIndex.get(d.obs[k].name);
      const c = up[k].eta - eta0[i];
      const cDown = down[k].eta - eta0[i];
      if (!Number.isFinite(c) || !Number.isFinite(cDown)) {
        throw new UnsupportedModelError(`'${p}' does not enter the linear predictor linearly`);
      }
      const tol = 1e-7 * (1 + Math.abs(eta0[i]) + Math.abs(c));
      if (Math.abs(cDown + 1.5 * c) > tol * 2) {
        throw new UnsupportedModelError(
          `'${p}' does not enter the ${linkDescription(likelihood)} linearly`
        );
      }
      if (Math.abs(c) > 1e-12) { idx.push(i); val.push(c); }
      if (!arraysEqual(up[k].extra, extra0[i])) extraChanged = true;
    }

    if (idx.length === 0) {
      // Not in eta. It may still reach the observations through the
      // distribution's other arguments (e.g. the residual SD of a normal
      // response); a column of zeros (e.g. a random slope whose group has
      // x = 0 throughout) leaves it with no likelihood contribution at all.
      if (extraChanged) {
        if (likelihood !== 'normal') {
          throw new UnsupportedModelError(
            `'${p}' affects the response in a way the blocked sampler cannot handle`
          );
        }
        obsSdParams.add(p);
      }
      hyper.push(p);
      continue;
    }

    if (extraChanged) {
      throw new UnsupportedModelError(
        `'${p}' enters both the linear predictor and another argument of ${distName}()`
      );
    }
    const node = nodes.get(p);
    if (node.distribution.name !== 'dnorm') {
      throw new UnsupportedModelError(
        `'${p}' is in the linear predictor but has a ${node.distribution.name}() prior (only dnorm priors are supported)`
      );
    }
    const otherPrior = d.stoch.find(n => !n.observed);
    if (otherPrior) {
      throw new UnsupportedModelError(
        `'${p}' is in the linear predictor and also in the prior of '${otherPrior.name}'`
      );
    }
    linear.push(p);
    columns.set(p, { idx: Int32Array.from(idx), val: Float64Array.from(val) });
  }

  if (linear.length === 0) {
    throw new UnsupportedModelError('no parameters enter the linear predictor');
  }

  // ── 4. Joint linearity check (catches products of parameters) ────────────
  for (let rep = 0; rep < 2; rep++) {
    const pert = { ...theta0 };
    const expected = Float64Array.from(eta0);
    const scale = new Float64Array(N);
    for (const p of linear) {
      const delta = (rep === 0 ? 0.7 : -1.3) * (1 + ((hashString(p) % 97) / 97));
      pert[p] = theta0[p] + delta;
      const col = columns.get(p);
      for (let k = 0; k < col.idx.length; k++) {
        expected[col.idx[k]] += col.val[k] * delta;
        scale[col.idx[k]] += Math.abs(col.val[k] * delta);
      }
    }
    const allPert = graph._mergeValues(pert);
    for (let i = 0; i < N; i++) {
      const e = safeEval(() => etaOf(obsNodes[i], allPert), 'the linear predictor');
      const tol = 1e-7 * (1 + Math.abs(expected[i]) + scale[i]);
      if (!(Math.abs(e - expected[i]) <= tol * 4)) {
        throw new UnsupportedModelError(
          `the ${linkDescription(likelihood)} is not linear in its coefficients ` +
          '(e.g. a product of two parameters such as a non-centred random effect)'
        );
      }
    }
  }

  // ── 5. Offset (eta with every linear parameter at zero) ──────────────────
  const offset = Float64Array.from(eta0);
  for (const p of linear) {
    const col = columns.get(p);
    for (let k = 0; k < col.idx.length; k++) offset[col.idx[k]] -= col.val[k] * theta0[p];
  }

  // ── 6. Split linear params into the dense fixed block and families ───────
  const byBase = new Map();
  for (const p of linear) {
    const b = baseName(p);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(p);
  }

  const families = [];
  const fixedNames = [];
  for (const [base, members] of byBase) {
    if (members.length < 2 || !members.every(m => m.includes('['))) {
      fixedNames.push(...members);
      continue;
    }
    const gidx = new Int32Array(N).fill(-1);
    const coef = new Float64Array(N);
    let disjoint = true;
    members.forEach((m, j) => {
      const col = columns.get(m);
      for (let k = 0; k < col.idx.length; k++) {
        const i = col.idx[k];
        if (gidx[i] !== -1) disjoint = false;
        gidx[i] = j;
        coef[i] = col.val[k];
      }
    });
    if (!disjoint) { fixedNames.push(...members); continue; }

    const priorExprs = members.map(m => nodes.get(m).distribution.paramExprs);
    const key0 = JSON.stringify(priorExprs[0]);
    const identicalPrior = priorExprs.every(e => JSON.stringify(e) === key0);

    // CSR layout: observations sorted by member, so one thread can walk its group.
    const J = members.length;
    const counts = new Uint32Array(J);
    for (let i = 0; i < N; i++) if (gidx[i] >= 0) counts[gidx[i]]++;
    const csrStart = new Uint32Array(J + 1);
    for (let j = 0; j < J; j++) csrStart[j + 1] = csrStart[j] + counts[j];
    const fill = csrStart.slice(0, J);
    const csrObs = new Uint32Array(csrStart[J]);
    for (let i = 0; i < N; i++) if (gidx[i] >= 0) csrObs[fill[gidx[i]]++] = i;

    families.push({ base, names: members, J, gidx, coef, csrStart, csrObs, identicalPrior });
  }

  if (fixedNames.length > MAX_FIXED) {
    throw new UnsupportedModelError(
      `the model has ${fixedNames.length} fixed coefficients (the blocked sampler supports up to ${MAX_FIXED})`
    );
  }

  const P = fixedNames.length;
  const X = new Float64Array(N * P);
  fixedNames.forEach((p, k) => {
    const col = columns.get(p);
    for (let m = 0; m < col.idx.length; m++) X[col.idx[m] * P + k] = col.val[m];
  });

  // ── 7. Translation moves (intercept ↔ random intercepts, etc.) ───────────
  // When a fixed column is a per-member multiple w_j of a family's
  // coefficients wherever the family applies (and is zero elsewhere), adding
  // c to θ_k and subtracting c·w_j from each member leaves eta unchanged.
  // w_j = 1 is the intercept ↔ random-intercept case; a group-level covariate
  // (e.g. a site-level treatment beside site random intercepts) gives w_j =
  // that group's covariate value. Sampling c from its (Gaussian) conditional
  // mixes along the ridge that component-wise updates crawl along.
  const translations = [];
  families.forEach((f, fi) => {
    for (let k = 0; k < P; k++) {
      const weights = new Float64Array(f.J);
      const seen = new Uint8Array(f.J);
      let ok = f.csrObs.length > 0;
      for (let i = 0; i < N && ok; i++) {
        const xk = X[i * P + k];
        const j = f.gidx[i];
        if (j < 0 || f.coef[i] === 0) { ok = xk === 0; continue; }
        const w = xk / f.coef[i];
        if (!seen[j]) { seen[j] = 1; weights[j] = w; continue; }
        ok = Math.abs(w - weights[j]) <= 1e-9 * (1 + Math.abs(w));
      }
      if (ok && weights.some(w => w !== 0)) {
        translations.push({ fixedIndex: k, family: fi, weights });
      }
    }
  });

  // ── 8. Response data ─────────────────────────────────────────────────────
  const y = new Float64Array(N);
  const nTrials = new Float64Array(N).fill(1);
  for (let i = 0; i < N; i++) {
    y[i] = obsNodes[i].value;
    if (!Number.isFinite(y[i])) {
      throw new UnsupportedModelError(`observed value ${obsNodes[i].name} is not a number`);
    }
  }
  if (likelihood === 'binomial' && distName !== 'dbern') {
    // dbin(p, n): the size must be data, not a parameter.
    const pertAll = graph._mergeValues(perturbAll(theta0));
    for (let i = 0; i < N; i++) {
      const n0 = extra0[i][0];
      const n1 = graph.evaluateExprMerged(obsNodes[i].distribution.paramExprs[1], pertAll);
      if (n0 !== n1 || !Number.isInteger(n0) || n0 < 0) {
        throw new UnsupportedModelError('the binomial size must be a fixed non-negative integer');
      }
      nTrials[i] = n0;
    }
  }
  if (likelihood !== 'normal') {
    for (let i = 0; i < N; i++) {
      if (!Number.isInteger(y[i]) || y[i] < 0 || (likelihood === 'binomial' && y[i] > nTrials[i])) {
        throw new UnsupportedModelError(
          `observed value ${obsNodes[i].name} = ${y[i]} is not valid for ${distName}()`
        );
      }
    }
  }

  // Residual SD: one shared expression of hyperparameters.
  let obsSdExpr = null;
  if (likelihood === 'normal') {
    obsSdExpr = obsNodes[0].distribution.paramExprs[1];
    const key = JSON.stringify(obsSdExpr);
    if (!obsNodes.every(o => JSON.stringify(o.distribution.paramExprs[1]) === key)) {
      throw new UnsupportedModelError('the residual SD must be the same for every observation');
    }
  }

  // ── 9. Hyperparameter bookkeeping ────────────────────────────────────────
  const familyOf = new Map();
  families.forEach((f, fi) => f.names.forEach(m => familyOf.set(m, fi)));

  const hyperInfo = hyper.map(h => {
    const d = desc.get(h);
    const priorChildren = [];   // non-family stochastic children (generic density)
    const familyTerms = new Set();
    for (const c of d.stoch) {
      if (c.observed) continue;
      const fi = familyOf.get(c.name);
      if (fi !== undefined && families[fi].identicalPrior) familyTerms.add(fi);
      else priorChildren.push(c.name);
    }
    return {
      name: h,
      detDescendants: d.det.map(n => n.name),
      priorChildren,
      familyTerms: [...familyTerms],
      obsSd: obsSdParams.has(h),
    };
  });

  return {
    likelihood,
    distName,
    responseBase,
    N,
    y,
    nTrials,
    offset,
    fixed: {
      names: fixedNames,
      P,
      X,
      priorExprs: fixedNames.map(p => nodes.get(p).distribution.paramExprs),
    },
    families: families.map(f => ({
      ...f,
      priorExprs: f.names.map(m => nodes.get(m).distribution.paramExprs),
    })),
    hypers: hyperInfo,
    translations,
    obsSdExpr,
    paramNames: params,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseName(nodeName) {
  const k = nodeName.indexOf('[');
  return k === -1 ? nodeName : nodeName.slice(0, k);
}

function linkDescription(likelihood) {
  return likelihood === 'normal' ? 'mean'
    : likelihood === 'poisson' ? 'log-mean (log link)'
    : 'log-odds (logit link)';
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (!Object.is(a[k], b[k])) return false;
  return true;
}

function safeEval(fn, what) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof UnsupportedModelError) throw err;
    throw new UnsupportedModelError(`could not evaluate ${what}: ${err.message}`);
  }
}

function hashString(s) {
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
  return h;
}

function perturbAll(theta0) {
  const out = {};
  for (const [k, v] of Object.entries(theta0)) out[k] = v * 1.25 + 0.5;
  return out;
}

/** If `expr` names a single node (x or x[3]), return that node's name. */
function singleNodeRef(expr) {
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'IndexExpr' && expr.indices.every(i => i.type === 'NumberLiteral')) {
    const base = expr.object?.name ?? expr.name;
    return `${base}[${expr.indices.map(i => i.value).join(',')}]`;
  }
  return null;
}

/**
 * Build a function returning the linear predictor eta for an observed node.
 *
 * Where possible eta is read *before* the inverse link is applied (e.g. the
 * right-hand side of `log(lambda[i]) <- ...`), which avoids the round-off of
 * computing logit(ilogit(x)) for large |x|.
 */
function makeEtaFn(graph, likelihood) {
  const link = CANONICAL_LINK[likelihood];
  const invFns = INVERSE_LINK_FNS[likelihood];
  return (obs, vals) => {
    const meanExpr = obs.distribution.paramExprs[0];
    const ref = singleNodeRef(meanExpr);
    if (ref) {
      const det = graph.nodes.get(ref);
      if (det && det.type === 'deterministic' && link && det.linkFn === link) {
        return graph.evaluateExprMerged(det.deterministicExpr, vals);
      }
    }
    if (meanExpr.type === 'FunctionCall' && invFns.includes(meanExpr.name)) {
      return graph.evaluateExprMerged(meanExpr.args[0], vals);
    }
    const m = graph.evaluateExprMerged(meanExpr, vals);
    if (link === 'log') return Math.log(m);
    if (link === 'logit') return Math.log(m / (1 - m));
    return m;
  };
}

/**
 * Deterministic descendants (topologically ordered) and stochastic
 * descendants (observed + unobserved, reached through deterministic nodes)
 * of a parameter.
 */
function descendants(graph, name, detOrder) {
  const det = [];
  const obs = [];
  const stoch = [];
  const seen = new Set([name]);
  const stack = [name];
  while (stack.length > 0) {
    const n = graph.nodes.get(stack.pop());
    for (const c of n.children) {
      if (seen.has(c)) continue;
      seen.add(c);
      const cn = graph.nodes.get(c);
      if (!cn) continue;
      if (cn.type === 'deterministic') {
        det.push(cn);
        stack.push(c);
      } else {
        stoch.push(cn);
        if (cn.type === 'observed') obs.push(cn);
      }
    }
  }
  det.sort((a, b) => detOrder.get(a.name) - detOrder.get(b.name));
  return { det, obs, stoch };
}
