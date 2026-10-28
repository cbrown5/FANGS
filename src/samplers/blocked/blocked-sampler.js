/**
 * blocked-sampler.js - Blocked Gibbs sampler for GLMMs
 *
 * One sweep of the blocked sampler is:
 *
 *   1. Linear blocks (backend):  fixed coefficients θ jointly, then every
 *      family of group-level coefficients (b[j], c[j], ...) with all members
 *      updated in parallel. See cpu-backend.js for the update itself.
 *   1b. Translation moves (here): shift an intercept and its random
 *      intercepts in opposite directions (see translate()).
 *   2. Hyperparameters (here, on the CPU): each SD / hyper-mean is slice
 *      sampled from its full conditional. Those conditionals only need a few
 *      sufficient statistics — the residual sum of squares for the residual
 *      SD, and Σb, Σb² for a random-effect SD — so they cost O(#groups), not
 *      O(#observations).
 *
 * The API mirrors runGibbs() in gibbs.js so the worker can use either engine.
 */

import { compileBlockedModel } from './compile-model.js';
import { CpuBlockedBackend } from './cpu-backend.js';
import { initializeChains } from '../initialize.js';
import { sliceSample } from '../slice.js';
import { getParameterBounds, computeSliceWidth } from '../gibbs.js';
import { rnorm } from '../../utils/distributions.js';

/** Upper limit on greedy warm-up sweeps (taken from the start of burn-in). */
export const WARMUP_MAX = 50;

/**
 * Create a backend for a compiled plan.
 *
 * @param {object} plan
 * @returns {Promise<CpuBlockedBackend>}
 */
export async function createBlockedBackend(plan) {
  return new CpuBlockedBackend(plan);
}

/**
 * One-line description of a compiled plan, for status messages.
 * @param {object} plan
 * @returns {string}
 */
export function describePlan(plan) {
  const parts = [`${plan.likelihood} response, N = ${plan.N}`];
  if (plan.fixed.P > 0) parts.push(`${plan.fixed.P} fixed coefficient${plan.fixed.P === 1 ? '' : 's'}`);
  for (const f of plan.families) parts.push(`${f.base}[1:${f.J}] updated in parallel`);
  if (plan.hypers.length > 0) parts.push(`${plan.hypers.length} hyperparameter${plan.hypers.length === 1 ? '' : 's'}`);
  return parts.join('; ');
}

/**
 * Run the blocked sampler across one or more chains.
 *
 * @param {import('../../parser/model-graph.js').ModelGraph} graph - built graph
 * @param {Object} settings - as runGibbs(), plus:
 * @param {object} [settings.plan] - a precompiled plan (else compiled here)
 * @returns {Promise<Object.<string, number[][]>>} samples[param][chain][draw]
 */
export async function runBlocked(graph, settings) {
  const {
    nChains  = 1,
    nSamples = 1000,
    burnin   = 500,
    thin     = 1,
    onSample   = null,
    onProgress = null,
    shouldStop = null,
  } = settings;

  const plan = settings.plan ?? compileBlockedModel(graph);
  const params = graph.parameters;
  const samples = {};
  for (const p of params) samples[p] = Array.from({ length: nChains }, () => []);

  const totalIters = burnin + nSamples * thin;
  const UI_YIELD_INTERVAL = 100;
  // Greedy warm-up sweeps at the start of burn-in (non-normal responses only;
  // see cpu-backend.js). With a normal response every update is exact Gibbs.
  const warmup = plan.likelihood === 'normal' ? 0 : Math.min(WARMUP_MAX, Math.floor(burnin / 4));

  for (let c = 0; c < nChains; c++) {
    const backend = await createBlockedBackend(plan);
    try {
      const chain = new BlockedChainState(graph, plan, initializeChains(graph, 1)[0]);
      await backend.setState(chain.linearState());
      let savedCount = 0;

      for (let iter = 0; iter < totalIters; iter++) {
        if (iter % UI_YIELD_INTERVAL === 0) {
          // The sweep loop never yields on its own, so give the event loop a
          // turn to keep the worker responsive to STOP messages.
          await yieldToUI();
          if (onProgress) onProgress(c, iter, totalIters, chain.paramValues());
        }
        if (shouldStop && shouldStop()) return samples;

        const cfg = chain.blockConfig();
        const result = await backend.sweep({
          ...cfg,
          optimize: iter < warmup,
          resetStep: warmup > 0 && iter === warmup,
          adapt: iter >= warmup && iter < burnin,
        });
        chain.absorbLinear(result);
        if (plan.translations.length > 0) {
          chain.translate(cfg);
          await backend.setState(chain.linearState());
        }
        chain.updateHypers();

        const postBurnin = iter - burnin;
        if (postBurnin >= 0 && postBurnin % thin === 0) {
          const values = chain.paramValues();
          for (const p of params) samples[p][c].push(values[p]);
          if (onSample) onSample(c, savedCount, values);
          savedCount++;
        }
      }
    } finally {
      backend.dispose();
    }
  }

  return samples;
}

/**
 * Current values of one chain plus the CPU-side hyperparameter updates.
 */
export class BlockedChainState {
  /**
   * @param {import('../../parser/model-graph.js').ModelGraph} graph
   * @param {object} plan
   * @param {Object.<string, number>} init - initial parameter values
   */
  constructor(graph, plan, init) {
    this.graph = graph;
    this.plan = plan;
    // Full value map (data scalars, parameters, deterministic nodes). The
    // per-observation deterministic nodes go stale as the linear blocks move;
    // nothing below reads them.
    this.vals = graph._mergeValues(init);
    this.ssr = 0;
    this._famStats = plan.families.map(() => null);

    // evaluateExpr against `vals` directly — avoids an O(N) merge per call.
    this._evalGraph = { evaluateExpr: (e, v) => graph.evaluateExprMerged(e, v) };
    this._hyperNodes = plan.hypers.map(h => ({
      ...h,
      node: graph.nodes.get(h.name),
      det: h.detDescendants.map(n => graph.nodes.get(n)),
      children: h.priorChildren.map(n => graph.nodes.get(n)),
    }));
    this._fixedMean = new Float64Array(plan.fixed.P);
    this._fixedPrec = new Float64Array(plan.fixed.P);
  }

  /** Initial θ and b arrays for the backend. */
  linearState() {
    const v = this.vals;
    return {
      theta: Float64Array.from(this.plan.fixed.names, n => v[n]),
      b: this.plan.families.map(f => Float64Array.from(f.names, n => v[n])),
    };
  }

  /** Prior moments and residual precision for the next linear sweep. */
  blockConfig() {
    const { plan, vals } = this;
    const ev = e => this.graph.evaluateExprMerged(e, vals);
    plan.fixed.priorExprs.forEach((exprs, k) => {
      this._fixedMean[k] = ev(exprs[0]);
      this._fixedPrec[k] = precisionFromSd(ev(exprs[1]));
    });
    const families = plan.families.map(f => {
      if (f.identicalPrior) {
        return { mean: ev(f.priorExprs[0][0]), prec: precisionFromSd(ev(f.priorExprs[0][1])) };
      }
      return {
        mean: Float64Array.from(f.priorExprs, e => ev(e[0])),
        prec: Float64Array.from(f.priorExprs, e => precisionFromSd(ev(e[1]))),
      };
    });
    const invVar = plan.likelihood === 'normal' ? precisionFromSd(ev(plan.obsSdExpr)) : 0;
    return { invVar, fixedMean: this._fixedMean, fixedPrec: this._fixedPrec, families };
  }

  /** Copy the backend's new θ, b and residual sum of squares into `vals`. */
  absorbLinear({ theta, b, ssr }) {
    const v = this.vals;
    this.plan.fixed.names.forEach((n, k) => { v[n] = theta[k]; });
    this.plan.families.forEach((f, fi) => {
      const bf = b[fi];
      f.names.forEach((n, j) => { v[n] = bf[j]; });
      this._famStats[fi] = null;
    });
    this.ssr = ssr;
  }

  /**
   * Translation move for each (fixed coefficient, family) pair in
   * plan.translations: θ_k ← θ_k + c, b_j ← b_j − c·w_j for every member
   * (w_j = 1 for an intercept; a group-level covariate's value otherwise).
   *
   * The likelihood is unchanged by the shift, so the conditional of c only
   * involves the Gaussian priors of θ_k and the b_j and is itself Gaussian:
   *   precision Q = q_θ + Σ q_j w_j²
   *   mean      = [q_θ (m_θ − θ_k) + Σ q_j w_j (b_j − m_j)] / Q
   * This is a Gibbs update along a translation group (Liu & Sabatti 2000),
   * so it leaves the posterior invariant. Without it the chain can sit for
   * thousands of iterations at, e.g., α = 11 with every b_j ≈ −10 (the data
   * only see α + b_j), especially with few groups and a vague SD prior.
   *
   * @param {object} cfg - prior moments from blockConfig() (hypers unchanged since)
   */
  translate(cfg) {
    const v = this.vals;
    for (const { fixedIndex: k, family: fi, weights: w } of this.plan.translations) {
      const name = this.plan.fixed.names[k];
      const fam = this.plan.families[fi];
      const famCfg = cfg.families[fi];
      const qa = cfg.fixedPrec[k];
      let Q = qa;
      let S = qa * (cfg.fixedMean[k] - v[name]);
      fam.names.forEach((n, j) => {
        const qj = typeof famCfg.prec === 'number' ? famCfg.prec : famCfg.prec[j];
        const mj = typeof famCfg.mean === 'number' ? famCfg.mean : famCfg.mean[j];
        Q += qj * w[j] * w[j];
        S += qj * w[j] * (v[n] - mj);
      });
      const c = S / Q + rnorm(0, 1) / Math.sqrt(Q);
      v[name] += c;
      fam.names.forEach((n, j) => { v[n] -= c * w[j]; });
      this._famStats[fi] = null;
    }
  }

  /** Slice-sample every hyperparameter once, in model order. */
  updateHypers() {
    for (const h of this._hyperNodes) {
      const logFC = x => this._logFullConditional(h, x);
      const current = this.vals[h.name];
      const { lower, upper } = getParameterBounds(h.node, this._evalGraph, this.vals);
      const next = sliceSample(h.name, current, logFC, {
        w: computeSliceWidth(h.node, this.vals, this._evalGraph),
        maxSteps: 20,
        lower,
        upper,
      });
      this._setHyper(h, next);
    }
  }

  /** Snapshot of all parameter values (a fresh object, safe to keep). */
  paramValues() {
    const out = {};
    for (const p of this.plan.paramNames) out[p] = this.vals[p];
    return out;
  }

  _setHyper(h, value) {
    const v = this.vals;
    v[h.name] = value;
    for (const n of h.det) {
      const x = this.graph.evaluateExprMerged(n.deterministicExpr, v);
      v[n.name] = n.linkFn ? this.graph._applyInverseLink(n.linkFn, x) : x;
    }
  }

  _logFullConditional(h, value) {
    this._setHyper(h, value);
    const { graph, vals, plan } = this;
    let lp = graph._logDensityNode(h.node, vals);
    if (!Number.isFinite(lp)) return -Infinity;
    for (const c of h.children) lp += graph._logDensityNode(c, vals);
    for (const fi of h.familyTerms) lp += this._familyLogPrior(fi);
    if (h.obsSd) {
      const sd = graph.evaluateExprMerged(plan.obsSdExpr, vals);
      if (!(sd > 0)) return -Infinity;
      lp += -plan.N * Math.log(sd) - this.ssr / (2 * sd * sd);
    }
    return Number.isFinite(lp) ? lp : -Infinity;
  }

  /** Σ_j log N(b_j | m, s) for a family with one shared prior, via Σb and Σb². */
  _familyLogPrior(fi) {
    const f = this.plan.families[fi];
    if (!this._famStats[fi]) {
      let s1 = 0;
      let s2 = 0;
      for (const n of f.names) {
        const x = this.vals[n];
        s1 += x;
        s2 += x * x;
      }
      this._famStats[fi] = { s1, s2 };
    }
    const { s1, s2 } = this._famStats[fi];
    const m = this.graph.evaluateExprMerged(f.priorExprs[0][0], this.vals);
    const s = this.graph.evaluateExprMerged(f.priorExprs[0][1], this.vals);
    if (!(s > 0)) return -Infinity;
    const J = f.J;
    const ss = Math.max(s2 - 2 * m * s1 + J * m * m, 0);
    return -J * Math.log(s) - ss / (2 * s * s) - 0.5 * J * Math.log(2 * Math.PI);
  }
}

function precisionFromSd(sd) {
  const s = Math.max(sd, 1e-10);
  return 1 / (s * s);
}

function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
