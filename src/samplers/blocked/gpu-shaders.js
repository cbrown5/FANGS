/**
 * gpu-shaders.js - WGSL compute kernels for the WebGPU blocked sampler
 *
 * Each kernel mirrors a step of CpuBlockedBackend (cpu-backend.js); read that
 * file first. Shaders are generated per model so that the fixed-block size P
 * and the likelihood family are compile-time constants.
 *
 * Kernels (one sweep, in order):
 *   etaFixed   per observation   eta = offset + X θ
 *   etaFamily  per observation   eta += a · b[g]           (one per family)
 *   obsCur     per observation   ∂ℓ/∂η, −∂²ℓ/∂η² at eta
 *   obsProp    per observation   the same at eta + XΔ, plus ℓ(η+XΔ) − ℓ(η)
 *   reduce1    per (chunk, entry) partial sums of Σℓ', Σℓ'x_k, Σw x_k x_l
 *   reduce2    per entry          total over chunks
 *   solve1     one thread         Cholesky, Newton proposal for θ
 *   solve2     one thread         Metropolis–Hastings accept/reject for θ
 *   family     per group member   Newton–MH update of b[j] (one per family)
 *   ssr        per (chunk)        partial Σ(y − η)² for the residual SD
 *
 * Random numbers come from Philox4x32-10 (Salmon et al. 2011), a
 * counter-based generator: every draw is a pure function of
 * (sweep, stream, thread, seed), so threads never share RNG state and results
 * do not depend on thread scheduling.
 */

import { STEP_ADAPT } from './cpu-backend.js';

/** Threads per workgroup for every kernel except the single-thread solves. */
export const WG = 256;

/**
 * Layout of the fixed-block state buffer `fx` (f32), for a block of size P.
 * @param {number} P
 */
export function fixedLayout(P) {
  return {
    theta: 0,          // current θ
    prop: P,           // proposed θ*
    delta: 2 * P,      // θ* − θ
    mean: 3 * P,       // prior means
    prec: 4 * P,       // prior precisions
    eps: 5 * P,        // proposal step size
    logqFwd: 5 * P + 1,
    accepted: 5 * P + 2,
    skip: 5 * P + 3,   // 1 when the forward proposal failed (A not PD)
    size: 5 * P + 4,
  };
}

/** Number of reduction entries for the fixed block: Σℓ, Σℓ'x (P), Σw x xᵀ (lower triangle). */
export function reductionEntries(P) {
  return 1 + P + (P * (P + 1)) / 2;
}

/**
 * Build all WGSL sources for a compiled plan.
 * @param {{ likelihood: string, fixed: { P: number } }} plan
 * @returns {Object.<string, string>}
 */
export function buildShaders(plan) {
  const P = plan.fixed.P;
  const exact = plan.likelihood === 'normal';
  const L = fixedLayout(P);
  const E = reductionEntries(P);

  const common = /* wgsl */`
struct Uniforms {
  N: u32,
  sweep: u32,
  seed: u32,
  flags: u32,     // bit 0 adapt, bit 1 optimize, bit 2 reset step size
  invVar: f32,
  items: u32,     // observations per thread in reductions
  nChunks: u32,   // reduction chunks (= workgroups along x)
  pad: u32,
}

const P: u32 = ${P}u;
const EXACT: bool = ${exact};
const EPS0: f32 = ${STEP_ADAPT.initial};
const ADAPT_TARGET: f32 = ${STEP_ADAPT.target};
const ADAPT_RATE: f32 = ${STEP_ADAPT.rate};
const EPS_MIN: f32 = ${STEP_ADAPT.min};
const EPS_MAX: f32 = ${STEP_ADAPT.max};

fn flatIndex(wid: vec3<u32>, nwg: vec3<u32>, lid: u32) -> u32 {
  return (wid.y * nwg.x + wid.x) * ${WG}u + lid;
}

fn adaptStep(eps: f32, accepted: bool) -> f32 {
  let a = select(0.0, 1.0, accepted);
  return clamp(eps * exp(ADAPT_RATE * (a - ADAPT_TARGET)), EPS_MIN, EPS_MAX);
}

fn optimizeStep(eps: f32, improved: bool) -> f32 {
  return select(max(1e-4, eps * 0.5), min(1.0, eps * 2.0), improved);
}

// ── Philox4x32-10 ───────────────────────────────────────────────────────────
fn mulhilo(a: u32, b: u32) -> vec2<u32> {
  let a0 = a & 0xffffu; let a1 = a >> 16u;
  let b0 = b & 0xffffu; let b1 = b >> 16u;
  let p00 = a0 * b0; let p01 = a0 * b1; let p10 = a1 * b0; let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  let hi = p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u);
  return vec2<u32>(hi, a * b);
}

fn philox(ctr: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  var c = ctr;
  var k = key;
  for (var r = 0u; r < 10u; r++) {
    let p0 = mulhilo(0xD2511F53u, c.x);
    let p1 = mulhilo(0xCD9E8D57u, c.z);
    c = vec4<u32>(p1.x ^ c.y ^ k.x, p1.y, p0.x ^ c.w ^ k.y, p0.y);
    k = k + vec2<u32>(0x9E3779B9u, 0xBB67AE85u);
  }
  return c;
}

fn rng(sweep: u32, stream: u32, thread: u32, k: u32, seed: u32) -> vec4<u32> {
  return philox(vec4<u32>(sweep, stream, thread, k), vec2<u32>(seed, 0xA511E9B3u));
}

fn u01(x: u32) -> f32 {
  return (f32(x >> 8u) + 0.5) * (1.0 / 16777216.0);
}

fn stdNormal(a: u32, b: u32) -> f32 {
  return sqrt(-2.0 * log(u01(a))) * cos(6.283185307179586 * u01(b));
}

// ── Likelihood terms on the linear-predictor scale (see cpu-backend.js) ────
fn safeExp(x: f32) -> f32 { return exp(min(x, 80.0)); }

fn expm1f(x: f32) -> f32 {
  if (abs(x) < 1e-3) { return x * (1.0 + x * (0.5 + x / 6.0)); }
  return safeExp(x) - 1.0;
}

fn log1pExpNeg(x: f32) -> f32 { return log(1.0 + exp(-abs(x))); }

fn softplus(x: f32) -> f32 { return max(x, 0.0) + log1pExpNeg(x); }

// softplus(e + d) − softplus(e) without cancelling the large linear part.
fn softplusDiff(e: f32, d: f32) -> f32 {
  return (max(e + d, 0.0) - max(e, 0.0)) + (log1pExpNeg(e + d) - log1pExpNeg(e));
}

fn invLogit(x: f32) -> f32 {
  let t = exp(-abs(x));
  return select(t / (1.0 + t), 1.0 / (1.0 + t), x >= 0.0);
}

${likelihoodWGSL(plan.likelihood)}
`;

  const fx = (name) => `${L[name]}u`;

  const etaFixed = common + /* wgsl */`
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> offset: array<f32>;
@group(0) @binding(2) var<storage, read> X: array<f32>;
@group(0) @binding(3) var<storage, read> fx: array<f32>;
@group(0) @binding(4) var<storage, read_write> eta: array<f32>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  let i = flatIndex(wid, nwg, lid);
  if (i >= U.N) { return; }
  var e = offset[i];
  for (var k = 0u; k < P; k++) { e += X[i * P + k] * fx[${fx('theta')} + k]; }
  eta[i] = e;
}
`;

  const etaFamily = common + /* wgsl */`
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> gidx: array<i32>;
@group(0) @binding(2) var<storage, read> coef: array<f32>;
@group(0) @binding(3) var<storage, read> b: array<f32>;
@group(0) @binding(4) var<storage, read_write> eta: array<f32>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  let i = flatIndex(wid, nwg, lid);
  if (i >= U.N) { return; }
  let g = gidx[i];
  if (g >= 0) { eta[i] += coef[i] * b[u32(g)]; }
}
`;

  const obsKernel = (withDelta) => common + /* wgsl */`
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> obs: array<f32>;   // y[0..N), size[N..2N)
@group(0) @binding(2) var<storage, read> eta: array<f32>;
@group(0) @binding(3) var<storage, read> X: array<f32>;
@group(0) @binding(4) var<storage, read> fx: array<f32>;
@group(0) @binding(5) var<storage, read_write> gbuf: array<f32>;
@group(0) @binding(6) var<storage, read_write> wbuf: array<f32>;
@group(0) @binding(7) var<storage, read_write> dllbuf: array<f32>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  let i = flatIndex(wid, nwg, lid);
  if (i >= U.N) { return; }
  let y = obs[i];
  let n = obs[U.N + i];
  let e0 = eta[i];
  var d = 0.0;
  ${withDelta ? `for (var k = 0u; k < P; k++) { d += X[i * P + k] * fx[${fx('delta')} + k]; }` : ''}
  let e = e0 + d;
  gbuf[i] = llGrad(y, n, e, U.invVar);
  wbuf[i] = llWeight(y, n, e, U.invVar);
  dllbuf[i] = ${withDelta ? 'llDiff(y, n, e0, d, U.invVar)' : '0.0'};
}
`;

  const reduce1 = common + /* wgsl */`
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> gbuf: array<f32>;
@group(0) @binding(2) var<storage, read> wbuf: array<f32>;
@group(0) @binding(3) var<storage, read> dllbuf: array<f32>;
@group(0) @binding(4) var<storage, read> X: array<f32>;
@group(0) @binding(5) var<storage, read_write> partials: array<f32>;

var<workgroup> sh: array<f32, ${WG}>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let chunk = wid.x;
  let entry = wid.y;
  // Decode the entry: 0 → Σ dll, 1..P → Σ g x_k, then the packed lower triangle.
  var kind = 0u;
  var k = 0u;
  var l = 0u;
  if (entry > 0u && entry <= P) {
    kind = 1u;
    k = entry - 1u;
  } else if (entry > P) {
    kind = 2u;
    let t = entry - P - 1u;
    while ((k + 1u) * (k + 2u) / 2u <= t) { k++; }
    l = t - k * (k + 1u) / 2u;
  }
  var acc = 0.0;
  let start = chunk * ${WG}u * U.items;
  for (var s = 0u; s < U.items; s++) {
    let i = start + s * ${WG}u + lid;
    if (i < U.N) {
      if (kind == 0u) {
        acc += dllbuf[i];
      } else if (kind == 1u) {
        acc += gbuf[i] * X[i * P + k];
      } else {
        acc += wbuf[i] * X[i * P + k] * X[i * P + l];
      }
    }
  }
  sh[lid] = acc;
  workgroupBarrier();
  for (var s = ${WG / 2}u; s > 0u; s >>= 1u) {
    if (lid < s) { sh[lid] += sh[lid + s]; }
    workgroupBarrier();
  }
  if (lid == 0u) { partials[entry * U.nChunks + chunk] = sh[0]; }
}
`;

  const ssr = common + /* wgsl */`
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> obs: array<f32>;
@group(0) @binding(2) var<storage, read> eta: array<f32>;
@group(0) @binding(3) var<storage, read_write> partials: array<f32>;

var<workgroup> sh: array<f32, ${WG}>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  var acc = 0.0;
  let start = wid.x * ${WG}u * U.items;
  for (var s = 0u; s < U.items; s++) {
    let i = start + s * ${WG}u + lid;
    if (i < U.N) {
      let r = obs[i] - eta[i];
      acc += r * r;
    }
  }
  sh[lid] = acc;
  workgroupBarrier();
  for (var s = ${WG / 2}u; s > 0u; s >>= 1u) {
    if (lid < s) { sh[lid] += sh[lid + s]; }
    workgroupBarrier();
  }
  if (lid == 0u) { partials[wid.x] = sh[0]; }
}
`;

  const reduce2 = common + /* wgsl */`
override BASE: u32 = 0u;

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> partials: array<f32>;
@group(0) @binding(2) var<storage, read_write> totals: array<f32>;

var<workgroup> sh: array<f32, ${WG}>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let entry = wid.x;
  var acc = 0.0;
  for (var c = lid; c < U.nChunks; c += ${WG}u) { acc += partials[entry * U.nChunks + c]; }
  sh[lid] = acc;
  workgroupBarrier();
  for (var s = ${WG / 2}u; s > 0u; s >>= 1u) {
    if (lid < s) { sh[lid] += sh[lid + s]; }
    workgroupBarrier();
  }
  if (lid == 0u) { totals[BASE + entry] = sh[0]; }
}
`;

  // Shared by solve1/solve2: build A = Σ w x xᵀ + diag(prec) and
  // G = Σ g x − prec·(θ − m) from the reduction totals, then factorise A.
  const PP = Math.max(P * P, 1);
  const PV = Math.max(P, 1);
  const solveCommon = common + /* wgsl */`
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> totals: array<f32>;
@group(0) @binding(2) var<storage, read_write> fx: array<f32>;

var<private> A: array<f32, ${PP}>;
var<private> G: array<f32, ${PV}>;
var<private> v: array<f32, ${PV}>;

fn tri(k: u32, l: u32) -> u32 { return 1u + P + k * (k + 1u) / 2u + l; }

// Build A and G at the point stored at fx[at..at+P); returns false if A is not PD.
fn buildAndFactor(at: u32) -> bool {
  for (var k = 0u; k < P; k++) {
    let q = fx[${fx('prec')} + k];
    G[k] = totals[1u + k] - q * (fx[at + k] - fx[${fx('mean')} + k]);
    for (var l = 0u; l <= k; l++) {
      let h = totals[tri(k, l)];
      A[k * P + l] = h;
      A[l * P + k] = h;
    }
    A[k * P + k] += q;
  }
  // In-place Cholesky (lower triangle).
  for (var j = 0u; j < P; j++) {
    var d = A[j * P + j];
    for (var k = 0u; k < j; k++) { d -= A[j * P + k] * A[j * P + k]; }
    if (!(d > 0.0)) { return false; }
    let ljj = sqrt(d);
    A[j * P + j] = ljj;
    for (var i = j + 1u; i < P; i++) {
      var s = A[i * P + j];
      for (var k = 0u; k < j; k++) { s -= A[i * P + k] * A[j * P + k]; }
      A[i * P + j] = s / ljj;
    }
  }
  return true;
}

// v ← A⁻¹ v using the factor in A.
fn cholSolve() {
  for (var i = 0u; i < P; i++) {
    var s = v[i];
    for (var k = 0u; k < i; k++) { s -= A[i * P + k] * v[k]; }
    v[i] = s / A[i * P + i];
  }
  backSolveT();
}

// v ← L⁻ᵀ v.
fn backSolveT() {
  for (var ii = 0u; ii < P; ii++) {
    let i = P - 1u - ii;
    var s = v[i];
    for (var k = i + 1u; k < P; k++) { s -= A[k * P + i] * v[k]; }
    v[i] = s / A[i * P + i];
  }
}

fn halfLogDet() -> f32 {
  var s = 0.0;
  for (var i = 0u; i < P; i++) { s += log(A[i * P + i]); }
  return s;
}
`;

  const solve1 = solveCommon + /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  let optimize = ((U.flags & 2u) != 0u) && !EXACT;
  var eps = fx[${fx('eps')}];
  if ((U.flags & 4u) != 0u && !EXACT) { eps = EPS0; }
  fx[${fx('eps')}] = eps;
  fx[${fx('skip')}] = 1.0;
  for (var k = 0u; k < P; k++) { fx[${fx('delta')} + k] = 0.0; }
  if (!buildAndFactor(${fx('theta')})) { return; }

  for (var k = 0u; k < P; k++) { v[k] = G[k]; }
  cholSolve();
  var mean: array<f32, ${PV}>;
  for (var k = 0u; k < P; k++) { mean[k] = fx[${fx('theta')} + k] + eps * v[k]; }

  // z ~ N(0, I); noise = L⁻ᵀ z.
  var zz = 0.0;
  for (var k = 0u; k < P; k++) {
    let r = rng(U.sweep, 1u, 0u, k, U.seed);
    let z = stdNormal(r.x, r.y);
    v[k] = z;
    zz += z * z;
  }
  backSolveT();
  let scale = select(sqrt(eps * (2.0 - eps)), 0.0, optimize);
  for (var k = 0u; k < P; k++) {
    let p = mean[k] + scale * v[k];
    fx[${fx('prop')} + k] = p;
    fx[${fx('delta')} + k] = p - fx[${fx('theta')} + k];
  }
  fx[${fx('logqFwd')}] = halfLogDet() - 0.5 * zz;
  fx[${fx('skip')}] = 0.0;
  if (EXACT) {
    for (var k = 0u; k < P; k++) { fx[${fx('theta')} + k] = fx[${fx('prop')} + k]; }
    fx[${fx('accepted')}] += 1.0;
  }
}
`;

  const solve2 = solveCommon + /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  if (fx[${fx('skip')}] != 0.0) { return; }
  let optimize = (U.flags & 2u) != 0u;
  let adapt = (U.flags & 1u) != 0u;
  let eps = fx[${fx('eps')}];
  var dPrior = 0.0;
  for (var k = 0u; k < P; k++) {
    let q = fx[${fx('prec')} + k];
    let m = fx[${fx('mean')} + k];
    let a = fx[${fx('prop')} + k] - m;
    let b = fx[${fx('theta')} + k] - m;
    dPrior -= 0.5 * q * (a * a - b * b);
  }
  let dll = totals[0];
  var accept = false;
  if (optimize) {
    accept = dll + dPrior > 0.0;
    fx[${fx('eps')}] = optimizeStep(eps, accept);
  } else {
    if (buildAndFactor(${fx('prop')})) {
      for (var k = 0u; k < P; k++) { v[k] = G[k]; }
      cholSolve();
      let scale2 = eps * (2.0 - eps);
      // diff = θ − (θ* + ε A*⁻¹ G*);  logq(θ|θ*) = ½log|A*| − ½‖L*ᵀ diff‖²/scale²
      for (var k = 0u; k < P; k++) {
        v[k] = fx[${fx('theta')} + k] - (fx[${fx('prop')} + k] + eps * v[k]);
      }
      var quad = 0.0;
      for (var j = 0u; j < P; j++) {
        var s = 0.0;
        for (var i = j; i < P; i++) { s += A[i * P + j] * v[i]; }
        quad += s * s;
      }
      let logqRev = halfLogDet() - 0.5 * quad / scale2;
      let r = rng(U.sweep, 2u, 0u, 0u, U.seed);
      accept = log(u01(r.x)) < dll + dPrior + logqRev - fx[${fx('logqFwd')}];
    }
    if (adapt) { fx[${fx('eps')}] = adaptStep(eps, accept); }
  }
  if (accept) {
    for (var k = 0u; k < P; k++) { fx[${fx('theta')} + k] = fx[${fx('prop')} + k]; }
    fx[${fx('accepted')}] += 1.0;
  }
}
`;

  const family = common + /* wgsl */`
override J: u32 = 1u;
override FAM: u32 = 0u;

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> obs: array<f32>;
@group(0) @binding(2) var<storage, read_write> eta: array<f32>;
@group(0) @binding(3) var<storage, read> coef: array<f32>;
@group(0) @binding(4) var<storage, read> csr: array<u32>;   // start[0..J], then observation ids
@group(0) @binding(5) var<storage, read_write> b: array<f32>;
@group(0) @binding(6) var<storage, read_write> fs: array<f32>; // mean[J], prec[J], eps[J]

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  let j = flatIndex(wid, nwg, lid);
  if (j >= J) { return; }
  let optimize = ((U.flags & 2u) != 0u) && !EXACT;
  let adapt = (U.flags & 1u) != 0u;
  let m = fs[j];
  let q = fs[J + j];
  var eps = fs[2u * J + j];
  if ((U.flags & 4u) != 0u && !EXACT) { eps = EPS0; }
  let bj = b[j];
  let lo = csr[j];
  let hi = csr[j + 1u];
  let base = J + 1u;
  let n0 = U.N;

  var G = -(bj - m) * q;
  var A = q;
  for (var t = lo; t < hi; t++) {
    let i = csr[base + t];
    let a = coef[i];
    let e = eta[i];
    G += llGrad(obs[i], obs[n0 + i], e, U.invVar) * a;
    A += llWeight(obs[i], obs[n0 + i], e, U.invVar) * a * a;
  }
  let r = rng(U.sweep, 16u + FAM, j, 0u, U.seed);
  let z = select(stdNormal(r.x, r.y), 0.0, optimize);
  let scale2 = select(eps * (2.0 - eps), 0.0, optimize);
  let prop = bj + eps * G / A + sqrt(scale2 / A) * z;
  let delta = prop - bj;

  var accept = true;
  if (!EXACT) {
    var dll = 0.0;
    var G2 = -(prop - m) * q;
    var A2 = q;
    for (var t = lo; t < hi; t++) {
      let i = csr[base + t];
      let a = coef[i];
      let e = eta[i];
      let d = a * delta;
      dll += llDiff(obs[i], obs[n0 + i], e, d, U.invVar);
      G2 += llGrad(obs[i], obs[n0 + i], e + d, U.invVar) * a;
      A2 += llWeight(obs[i], obs[n0 + i], e + d, U.invVar) * a * a;
    }
    let dPrior = -0.5 * q * ((prop - m) * (prop - m) - (bj - m) * (bj - m));
    if (optimize) {
      accept = dll + dPrior > 0.0;
      eps = optimizeStep(eps, accept);
    } else {
      let mRev = prop + eps * G2 / A2;
      let logqFwd = 0.5 * log(A) - 0.5 * z * z;
      let logqRev = 0.5 * log(A2) - 0.5 * A2 * (bj - mRev) * (bj - mRev) / scale2;
      accept = log(u01(r.z)) < dll + dPrior + logqRev - logqFwd;
      if (adapt) { eps = adaptStep(eps, accept); }
    }
  }
  fs[2u * J + j] = eps;
  if (accept) {
    b[j] = prop;
    for (var t = lo; t < hi; t++) {
      let i = csr[base + t];
      eta[i] += coef[i] * delta;
    }
  }
}
`;

  return {
    etaFixed,
    etaFamily,
    obsCur: obsKernel(false),
    obsProp: obsKernel(true),
    reduce1,
    reduce2,
    ssr,
    solve1,
    solve2,
    family,
    entries: E,
  };
}

/** WGSL for llGrad / llWeight / llDiff (mirrors LIKELIHOOD_TERMS). */
function likelihoodWGSL(likelihood) {
  switch (likelihood) {
    case 'normal':
      return /* wgsl */`
fn llGrad(y: f32, n: f32, e: f32, iv: f32) -> f32 { return (y - e) * iv; }
fn llWeight(y: f32, n: f32, e: f32, iv: f32) -> f32 { return iv; }
fn llDiff(y: f32, n: f32, e: f32, d: f32, iv: f32) -> f32 { return d * (y - e - 0.5 * d) * iv; }
`;
    case 'poisson':
      return /* wgsl */`
fn llGrad(y: f32, n: f32, e: f32, iv: f32) -> f32 { return y - safeExp(e); }
fn llWeight(y: f32, n: f32, e: f32, iv: f32) -> f32 { return safeExp(e); }
fn llDiff(y: f32, n: f32, e: f32, d: f32, iv: f32) -> f32 { return y * d - safeExp(e) * expm1f(d); }
`;
    case 'binomial':
      return /* wgsl */`
fn llGrad(y: f32, n: f32, e: f32, iv: f32) -> f32 { return y - n * invLogit(e); }
fn llWeight(y: f32, n: f32, e: f32, iv: f32) -> f32 { let p = invLogit(e); return n * p * (1.0 - p); }
fn llDiff(y: f32, n: f32, e: f32, d: f32, iv: f32) -> f32 { return y * d - n * softplusDiff(e, d); }
`;
    default:
      throw new Error(`no WGSL likelihood for '${likelihood}'`);
  }
}
