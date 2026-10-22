/**
 * cpu-backend.js - Typed-array CPU backend for the blocked GLMM sampler
 *
 * Implements one sweep over the linear blocks of a compiled plan (see
 * compile-model.js):
 *
 *   1. Fixed block θ (dense, size P) — one joint update.
 *   2. Each family b_f — every member updated independently (these are the
 *      updates run one group at a time).
 *
 * Both use the same Newton-type Metropolis–Hastings update. At the current
 * value θ the log-likelihood gradient G and negative Hessian A (plus the
 * Gaussian prior) give a local Gaussian approximation N(μ, A⁻¹) with
 * μ = θ + A⁻¹G. The proposal moves part of the way towards it:
 *
 *   θ* = θ + ε(μ − θ) + √(ε(2−ε)) · L⁻ᵀ z,    A = L Lᵀ,  z ~ N(0, I)
 *
 * This autoregressive move leaves N(μ, A⁻¹) exactly invariant for any step
 * size ε ∈ (0, 1]. So:
 *   - For a normal response the approximation *is* the full conditional,
 *     and with ε = 1 the update is an exact conjugate Gibbs draw (always
 *     accepted).
 *   - For Poisson/binomial responses the proposal is accepted or rejected
 *     with the exact Metropolis–Hastings ratio, so the chain targets the
 *     true posterior. ε is tuned during burn-in (towards ~65% acceptance):
 *     far from the mode a full Newton step overshoots and would always be
 *     rejected, so small steps get the chain moving; near the mode ε grows
 *     towards 1 and the update behaves almost like a Gibbs draw.
 *
 * Far from the mode even small steps can be slow (e.g. Poisson coefficients
 * started where exp(η) is huge), so the first few burn-in sweeps for a
 * non-normal response can run in "optimize" mode: the same Newton step
 * without noise, kept only if it increases the log posterior, with the step
 * halved after a failure. That only moves the chain's starting point; it is
 * not part of the saved MCMC output.
 *
 * The work per update is fixed (two passes over the data), which keeps
 * threads in lock-step, unlike slice or rejection samplers whose loop
 * lengths vary from thread to thread.
 *
 * This backend is the implementation behind the "Blocked" sampler engine.
 */

import {
  choleskyInPlace, forwardSolve, backSolveTranspose,
  logDetFromCholesky, quadFormFromCholesky,
} from './linalg.js';
import { rnorm } from '../../utils/distributions.js';

/** Step-size adaptation (burn-in only): starting ε, target acceptance, rate. */
export const STEP_ADAPT = { initial: 0.5, target: 0.65, rate: 0.1, min: 1e-3, max: 0.8 };

/** Multiplicative step-size update after an accept/reject decision. */
export function adaptStep(eps, accepted) {
  const { target, rate, min, max } = STEP_ADAPT;
  const next = eps * Math.exp(rate * ((accepted ? 1 : 0) - target));
  return Math.min(max, Math.max(min, next));
}

/** Warm-up step size: double after an improving step, halve after a failure. */
export function optimizeStep(eps, improved) {
  return improved ? Math.min(1, eps * 2) : Math.max(1e-4, eps / 2);
}

/**
 * Per-observation likelihood terms on the linear-predictor scale.
 *   grad(y, n, eta, iv)     ∂ℓ/∂η
 *   weight(y, n, eta, iv)   −∂²ℓ/∂η²  (≥ 0)
 *   dll(y, n, eta, d, iv)   ℓ(η + d) − ℓ(η), computed without cancellation
 * `n` is the binomial size; `iv` is 1/σ² for the normal response.
 */
export const LIKELIHOOD_TERMS = {
  normal: {
    exact:  true,
    grad:   (y, n, eta, iv) => (y - eta) * iv,
    weight: (y, n, eta, iv) => iv,
    dll:    (y, n, eta, d, iv) => d * (y - eta - 0.5 * d) * iv,
  },
  poisson: {
    exact:  false,
    grad:   (y, n, eta) => y - Math.exp(eta),
    weight: (y, n, eta) => Math.exp(eta),
    dll:    (y, n, eta, d) => y * d - Math.exp(eta) * Math.expm1(d),
  },
  binomial: {
    exact:  false,
    grad:   (y, n, eta) => y - n * invLogit(eta),
    weight: (y, n, eta) => { const p = invLogit(eta); return n * p * (1 - p); },
    dll:    (y, n, eta, d) => y * d - n * (softplus(eta + d) - softplus(eta)),
  },
};

function invLogit(x) {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

function softplus(x) {
  return x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x));
}

export class CpuBlockedBackend {
  /**
   * @param {object} plan - from compileBlockedModel()
   */
  constructor(plan) {
    this.kind = 'cpu';
    this.plan = plan;
    this.terms = LIKELIHOOD_TERMS[plan.likelihood];
    const { N } = plan;
    const P = plan.fixed.P;
    this.eta = new Float64Array(N);
    this.theta = new Float64Array(P);
    this.b = plan.families.map(f => new Float64Array(f.J));
    // Proposal step sizes: one for the fixed block, one per family member.
    const eps0 = this.terms.exact ? 1 : STEP_ADAPT.initial;
    this.epsFixed = eps0;
    this.epsFamily = plan.families.map(f => new Float64Array(f.J).fill(eps0));
    // Scratch for the fixed block.
    this._A = new Float64Array(P * P);
    this._A2 = new Float64Array(P * P);
    this._G = new Float64Array(P);
    this._G2 = new Float64Array(P);
    this._d = new Float64Array(N);
    this.accepted = { fixed: 0, families: plan.families.map(() => 0) };
  }

  /**
   * Load a starting state.
   * @param {{ theta: ArrayLike<number>, b: ArrayLike<number>[] }} state
   */
  async setState(state) {
    this.theta.set(state.theta);
    state.b.forEach((bf, f) => this.b[f].set(bf));
  }

  /**
   * Run one sweep over the linear blocks.
   *
   * @param {object} cfg
   * @param {number} cfg.invVar          - 1/σ² for a normal response (else unused)
   * @param {Float64Array} cfg.fixedMean - prior means of the fixed coefficients
   * @param {Float64Array} cfg.fixedPrec - prior precisions of the fixed coefficients
   * @param {{mean: number|Float64Array, prec: number|Float64Array}[]} cfg.families
   * @param {boolean} [cfg.adapt=false]  - tune proposal step sizes (burn-in only)
   * @param {boolean} [cfg.optimize=false] - greedy Newton steps instead of MH (warm-up only)
   * @param {boolean} [cfg.resetStep=false] - reset step sizes first (end of warm-up)
   * @returns {Promise<{ theta: Float64Array, b: Float64Array[], ssr: number }>}
   */
  async sweep(cfg) {
    if (cfg.resetStep && !this.terms.exact) {
      this.epsFixed = STEP_ADAPT.initial;
      this.epsFamily.forEach(e => e.fill(STEP_ADAPT.initial));
    }
    this._computeEta();
    if (this.plan.fixed.P > 0) this._updateFixed(cfg);
    this.plan.families.forEach((fam, f) => this._updateFamily(fam, f, cfg));
    return { theta: this.theta, b: this.b, ssr: this._ssr() };
  }

  dispose() {}

  // ── Internals ────────────────────────────────────────────────────────────

  _computeEta() {
    const { N, offset, fixed, families } = this.plan;
    const { P, X } = fixed;
    const eta = this.eta;
    for (let i = 0; i < N; i++) {
      let e = offset[i];
      for (let k = 0; k < P; k++) e += X[i * P + k] * this.theta[k];
      eta[i] = e;
    }
    families.forEach((fam, f) => {
      const bf = this.b[f];
      for (let i = 0; i < N; i++) {
        const g = fam.gidx[i];
        if (g >= 0) eta[i] += fam.coef[i] * bf[g];
      }
    });
  }

  /**
   * Accumulate G = Σ ∂ℓ·x and A = Σ w·x xᵀ at eta + d (d may be null), and
   * return Σ [ℓ(η + d) − ℓ(η)].
   */
  _accumulate(G, A, d, iv) {
    const { N, y, nTrials, fixed } = this.plan;
    const { P, X } = fixed;
    const t = this.terms;
    G.fill(0);
    A.fill(0);
    let dll = 0;
    for (let i = 0; i < N; i++) {
      const e0 = this.eta[i];
      const di = d ? d[i] : 0;
      const e = e0 + di;
      const g = t.grad(y[i], nTrials[i], e, iv);
      const w = t.weight(y[i], nTrials[i], e, iv);
      if (d) dll += t.dll(y[i], nTrials[i], e0, di, iv);
      const row = i * P;
      for (let k = 0; k < P; k++) {
        const xk = X[row + k];
        if (xk === 0) continue;
        G[k] += g * xk;
        const wxk = w * xk;
        for (let l = 0; l <= k; l++) A[k * P + l] += wxk * X[row + l];
      }
    }
    for (let k = 0; k < P; k++) for (let l = 0; l < k; l++) A[l * P + k] = A[k * P + l];
    return dll;
  }

  /**
   * Add the Gaussian prior to (G, A) at θ, factorise A in place, and return
   * the proposal mean θ + ε A⁻¹G (null if A is not positive definite).
   */
  _proposalMean(theta, G, A, mean, prec, eps) {
    const P = this.plan.fixed.P;
    for (let k = 0; k < P; k++) {
      G[k] -= (theta[k] - mean[k]) * prec[k];
      A[k * P + k] += prec[k];
    }
    if (!choleskyInPlace(A, P)) return null;
    const step = backSolveTranspose(A, P, forwardSolve(A, P, Float64Array.from(G)));
    const m = new Float64Array(P);
    for (let k = 0; k < P; k++) m[k] = theta[k] + eps * step[k];
    return m;
  }

  _updateFixed(cfg) {
    const { N, fixed } = this.plan;
    const { P, X } = fixed;
    const { fixedMean: m, fixedPrec: q, invVar: iv } = cfg;
    const theta = this.theta;
    const optimize = cfg.optimize && !this.terms.exact;
    const eps = this.epsFixed;
    const scale = optimize ? 0 : Math.sqrt(eps * (2 - eps));

    const A = this._A;
    const G = this._G;
    this._accumulate(G, A, null, iv);
    const mFwd = this._proposalMean(theta, G, A, m, q, eps);
    if (!mFwd) return;

    // θ* = m + √(ε(2−ε)) L⁻ᵀ z
    const z = new Float64Array(P);
    for (let k = 0; k < P; k++) z[k] = rnorm(0, 1);
    const noise = backSolveTranspose(A, P, Float64Array.from(z));
    const prop = new Float64Array(P);
    for (let k = 0; k < P; k++) prop[k] = mFwd[k] + scale * noise[k];

    const d = this._d;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = 0; k < P; k++) s += X[i * P + k] * (prop[k] - theta[k]);
      d[i] = s;
    }

    if (!this.terms.exact) {
      // log q(θ*|θ) and log q(θ|θ*), dropping the shared −(P/2)·log(ε(2−ε)).
      const logqFwd = 0.5 * logDetFromCholesky(A, P) - 0.5 * dotSelf(z);
      const A2 = this._A2;
      const G2 = this._G2;
      const dll = this._accumulate(G2, A2, d, iv);
      let dPrior = 0;
      for (let k = 0; k < P; k++) {
        dPrior -= 0.5 * q[k] * ((prop[k] - m[k]) ** 2 - (theta[k] - m[k]) ** 2);
      }
      let accept;
      if (optimize) {
        accept = dll + dPrior > 0;
        this.epsFixed = optimizeStep(eps, accept);
      } else {
        const mRev = this._proposalMean(prop, G2, A2, m, q, eps);
        accept = false;
        if (mRev) {
          const diff = new Float64Array(P);
          for (let k = 0; k < P; k++) diff[k] = theta[k] - mRev[k];
          const logqRev = 0.5 * logDetFromCholesky(A2, P)
            - 0.5 * quadFormFromCholesky(A2, P, diff) / (scale * scale);
          accept = Math.log(Math.random()) < dll + dPrior + logqRev - logqFwd;
        }
        if (cfg.adapt) this.epsFixed = adaptStep(eps, accept);
      }
      if (!accept) return;
    }

    theta.set(prop);
    for (let i = 0; i < N; i++) this.eta[i] += d[i];
    this.accepted.fixed++;
  }

  _updateFamily(fam, f, cfg) {
    const { y, nTrials } = this.plan;
    const t = this.terms;
    const iv = cfg.invVar;
    const famCfg = cfg.families[f];
    const bf = this.b[f];
    const epsArr = this.epsFamily[f];
    const eta = this.eta;
    const optimize = cfg.optimize && !t.exact;
    const { csrStart, csrObs, coef } = fam;

    for (let j = 0; j < fam.J; j++) {
      const m = typeof famCfg.mean === 'number' ? famCfg.mean : famCfg.mean[j];
      const q = typeof famCfg.prec === 'number' ? famCfg.prec : famCfg.prec[j];
      const eps = epsArr[j];
      const scale2 = optimize ? 0 : eps * (2 - eps);
      const b = bf[j];
      const lo = csrStart[j];
      const hi = csrStart[j + 1];

      let G = -(b - m) * q;
      let A = q;
      for (let k = lo; k < hi; k++) {
        const i = csrObs[k];
        const a = coef[i];
        G += t.grad(y[i], nTrials[i], eta[i], iv) * a;
        A += t.weight(y[i], nTrials[i], eta[i], iv) * a * a;
      }
      const z = optimize ? 0 : rnorm(0, 1);
      const prop = b + eps * G / A + Math.sqrt(scale2 / A) * z;
      const delta = prop - b;

      if (!t.exact) {
        let dll = 0;
        let G2 = -(prop - m) * q;
        let A2 = q;
        for (let k = lo; k < hi; k++) {
          const i = csrObs[k];
          const a = coef[i];
          const d = a * delta;
          dll += t.dll(y[i], nTrials[i], eta[i], d, iv);
          G2 += t.grad(y[i], nTrials[i], eta[i] + d, iv) * a;
          A2 += t.weight(y[i], nTrials[i], eta[i] + d, iv) * a * a;
        }
        const dPrior = -0.5 * q * ((prop - m) ** 2 - (b - m) ** 2);
        let accept;
        if (optimize) {
          accept = dll + dPrior > 0;
          epsArr[j] = optimizeStep(eps, accept);
        } else {
          const mRev = prop + eps * G2 / A2;
          const logqFwd = 0.5 * Math.log(A) - 0.5 * z * z;
          const logqRev = 0.5 * Math.log(A2) - 0.5 * A2 * (b - mRev) ** 2 / scale2;
          accept = Math.log(Math.random()) < dll + dPrior + logqRev - logqFwd;
          if (cfg.adapt) epsArr[j] = adaptStep(eps, accept);
        }
        if (!accept) continue;
      }

      bf[j] = prop;
      for (let k = lo; k < hi; k++) {
        const i = csrObs[k];
        eta[i] += coef[i] * delta;
      }
      this.accepted.families[f]++;
    }
  }

  _ssr() {
    if (this.plan.likelihood !== 'normal') return 0;
    const { N, y } = this.plan;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const r = y[i] - this.eta[i];
      s += r * r;
    }
    return s;
  }
}

function dotSelf(v) {
  let s = 0;
  for (let k = 0; k < v.length; k++) s += v[k] * v[k];
  return s;
}
