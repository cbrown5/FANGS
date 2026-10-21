/**
 * gpu-backend.js - WebGPU backend for the blocked GLMM sampler
 *
 * Same interface and algorithm as CpuBlockedBackend (cpu-backend.js), with
 * every O(N) or O(#groups) step run as a compute kernel (gpu-shaders.js).
 *
 * One sweep is encoded as a single command buffer: recompute eta, update the
 * fixed block (per-observation derivatives → two-stage parallel reduction →
 * single-thread Cholesky solve → MH decision), update each family with one
 * thread per group, then reduce Σ(y − η)². The only host↔device traffic per
 * sweep is a small uniform write (hyperparameter-dependent prior moments and
 * the residual precision) and one readback of θ, b and Σ(y − η)², which the
 * CPU needs for the hyperparameter updates and for recording draws.
 *
 * Precision: the GPU works in float32. Per-observation log-likelihood
 * *differences* are summed (never two large totals subtracted), eta is
 * recomputed from scratch every sweep so round-off cannot accumulate, and
 * the hyperparameter updates stay in float64 on the CPU.
 */

import { buildShaders, fixedLayout, WG } from './gpu-shaders.js';
import { STEP_ADAPT } from './cpu-backend.js';

const STORAGE = GPUBufferUsageOrZero('STORAGE');
const COPY_SRC = GPUBufferUsageOrZero('COPY_SRC');
const COPY_DST = GPUBufferUsageOrZero('COPY_DST');

/** Largest x-dimension of a dispatch (WebGPU's default limit). */
const MAX_DISPATCH = 65535;
/** Target number of reduction chunks (workgroups) per entry. */
const TARGET_CHUNKS = 1024;

/**
 * Is WebGPU usable in this context? (Does not request a device.)
 * @returns {boolean}
 */
export function webgpuAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export class GpuBlockedBackend {
  /**
   * Request a GPU device and build all buffers and pipelines for a plan.
   *
   * @param {object} plan - from compileBlockedModel()
   * @returns {Promise<GpuBlockedBackend>}
   * @throws {Error} when WebGPU or a suitable adapter is unavailable
   */
  static async create(plan) {
    if (!webgpuAvailable()) {
      throw new Error('WebGPU is not available in this browser');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter was found');
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    device.pushErrorScope('validation');
    const backend = new GpuBlockedBackend(device, plan, adapter.info ?? {});
    await backend._checkCompilation();
    const error = await device.popErrorScope();
    if (error) {
      backend.dispose();
      throw new Error(`WebGPU setup failed: ${error.message}`);
    }
    return backend;
  }

  constructor(device, plan, adapterInfo = {}) {
    this.kind = 'gpu';
    this.device = device;
    this.plan = plan;
    this.adapterInfo = adapterInfo;
    this.exact = plan.likelihood === 'normal';
    this.sweepCount = 0;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this._lost = false;
    device.lost.then(() => { this._lost = true; });

    const { N } = plan;
    const P = plan.fixed.P;
    this.P = P;
    this.layout = fixedLayout(P);
    this.shaders = buildShaders(plan);
    this.entries = this.shaders.entries;

    this.items = Math.max(1, Math.ceil(N / (WG * TARGET_CHUNKS)));
    this.nChunks = Math.ceil(N / (WG * this.items));

    // ── Buffers ────────────────────────────────────────────────────────────
    const obs = new Float32Array(2 * N);
    obs.set(plan.y, 0);
    obs.set(plan.nTrials, N);
    this.buf = {
      uniforms: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | COPY_DST }),
      obs: this._upload(obs),
      offset: this._upload(Float32Array.from(plan.offset)),
      X: this._upload(P > 0 ? Float32Array.from(plan.fixed.X) : new Float32Array(1)),
      eta: this._empty(N),
      fx: this._empty(this.layout.size, COPY_DST | COPY_SRC),
      g: this._empty(N),
      w: this._empty(N),
      dll: this._empty(N),
      partials: this._empty(Math.max(this.entries, 1) * this.nChunks),
      totals: this._empty(this.entries + 1, COPY_SRC),
    };
    this.families = plan.families.map(f => {
      const csr = new Uint32Array(f.J + 1 + f.csrObs.length);
      csr.set(f.csrStart, 0);
      csr.set(f.csrObs, f.J + 1);
      const fs = new Float32Array(3 * f.J);
      fs.fill(this.exact ? 1 : STEP_ADAPT.initial, 2 * f.J);
      return {
        J: f.J,
        gidx: this._upload(f.gidx),
        coef: this._upload(Float32Array.from(f.coef)),
        csr: this._upload(csr),
        b: this._empty(f.J, COPY_DST | COPY_SRC),
        fs: this._upload(fs, COPY_DST),
        priorScratch: new Float32Array(2 * f.J),
      };
    });

    // fx: step size starts at 1 for exact (normal) updates.
    const fx0 = new Float32Array(this.layout.size);
    fx0[this.layout.eps] = this.exact ? 1 : STEP_ADAPT.initial;
    device.queue.writeBuffer(this.buf.fx, 0, fx0);

    // Readback: θ and the accepted count (fx), every b, then Σ(y − η)².
    this.readLayout = { fx: 0, fam: [], ssr: 0 };
    let off = this.layout.size * 4;
    for (const f of this.families) {
      this.readLayout.fam.push(off);
      off += f.J * 4;
    }
    this.readLayout.ssr = off;
    off += 4;
    this.staging = device.createBuffer({ size: off, usage: GPUBufferUsage.MAP_READ | COPY_DST });

    this._buildPipelines();
  }

  /**
   * Load a starting state.
   * @param {{ theta: ArrayLike<number>, b: ArrayLike<number>[] }} state
   */
  async setState(state) {
    const fx = new Float32Array(this.P);
    fx.set(Array.from(state.theta));
    if (this.P > 0) this.device.queue.writeBuffer(this.buf.fx, this.layout.theta * 4, fx);
    this.families.forEach((f, i) => {
      this.device.queue.writeBuffer(f.b, 0, Float32Array.from(state.b[i]));
    });
  }

  /**
   * Run one sweep over the linear blocks (see CpuBlockedBackend.sweep).
   * @param {object} cfg
   * @returns {Promise<{ theta: Float64Array, b: Float64Array[], ssr: number }>}
   */
  async sweep(cfg) {
    if (this._lost) throw new Error('the GPU device was lost');
    const { device, plan, P } = this;
    const q = device.queue;

    const flags = (cfg.adapt ? 1 : 0) | (cfg.optimize ? 2 : 0) | (cfg.resetStep ? 4 : 0);
    const u = new ArrayBuffer(32);
    const uu = new Uint32Array(u);
    const uf = new Float32Array(u);
    uu[0] = plan.N;
    uu[1] = this.sweepCount;
    uu[2] = this.seed;
    uu[3] = flags;
    uf[4] = cfg.invVar ?? 0;
    uu[5] = this.items;
    uu[6] = this.nChunks;
    q.writeBuffer(this.buf.uniforms, 0, u);

    if (P > 0) {
      const prior = new Float32Array(2 * P);
      prior.set(cfg.fixedMean, 0);
      prior.set(cfg.fixedPrec, P);
      q.writeBuffer(this.buf.fx, this.layout.mean * 4, prior);
    }
    this.families.forEach((f, i) => {
      const fc = cfg.families[i];
      const s = f.priorScratch;
      if (typeof fc.mean === 'number') s.fill(fc.mean, 0, f.J); else s.set(fc.mean, 0);
      if (typeof fc.prec === 'number') s.fill(fc.prec, f.J); else s.set(fc.prec, f.J);
      q.writeBuffer(f.fs, 0, s);
    });

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    const perObs = this._grid(plan.N);
    const run = (pipe, grid) => {
      pass.setPipeline(pipe.pipeline);
      pass.setBindGroup(0, pipe.bindGroup);
      pass.dispatchWorkgroups(grid[0], grid[1]);
    };
    const computeEta = () => {
      run(this.pipes.etaFixed, perObs);
      for (const f of this.pipes.etaFamily) run(f, perObs);
    };

    computeEta();
    if (P > 0) {
      run(this.pipes.obsCur, perObs);
      run(this.pipes.reduce1, [this.nChunks, this.entries]);
      run(this.pipes.reduce2, [this.entries, 1]);
      run(this.pipes.solve1, [1, 1]);
      if (!this.exact) {
        run(this.pipes.obsProp, perObs);
        run(this.pipes.reduce1, [this.nChunks, this.entries]);
        run(this.pipes.reduce2, [this.entries, 1]);
        run(this.pipes.solve2, [1, 1]);
      }
      computeEta();
    }
    this.pipes.family.forEach((pipe, i) => run(pipe, this._grid(this.families[i].J)));
    if (plan.likelihood === 'normal') {
      run(this.pipes.ssr, [this.nChunks, 1]);
      run(this.pipes.reduceSsr, [1, 1]);
    }
    pass.end();

    enc.copyBufferToBuffer(this.buf.fx, 0, this.staging, 0, this.layout.size * 4);
    this.families.forEach((f, i) => {
      enc.copyBufferToBuffer(f.b, 0, this.staging, this.readLayout.fam[i], f.J * 4);
    });
    enc.copyBufferToBuffer(this.buf.totals, this.entries * 4, this.staging, this.readLayout.ssr, 4);
    q.submit([enc.finish()]);

    await this.staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(this.staging.getMappedRange().slice(0));
    this.staging.unmap();
    this.sweepCount++;

    const theta = Float64Array.from(data.subarray(this.layout.theta, this.layout.theta + P));
    const b = this.families.map((f, i) => {
      const o = this.readLayout.fam[i] / 4;
      return Float64Array.from(data.subarray(o, o + f.J));
    });
    const ssr = plan.likelihood === 'normal' ? data[this.readLayout.ssr / 4] : 0;
    this.acceptedFixed = data[this.layout.accepted];
    return { theta, b, ssr };
  }

  dispose() {
    try {
      this.device.destroy();
    } catch (_) { /* already gone */ }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  _upload(typed, extraUsage = 0) {
    const size = Math.max(4, Math.ceil(typed.byteLength / 4) * 4);
    const buf = this.device.createBuffer({ size, usage: STORAGE | COPY_DST | extraUsage, mappedAtCreation: true });
    new typed.constructor(buf.getMappedRange()).set(typed);
    buf.unmap();
    return buf;
  }

  _empty(nFloats, extraUsage = 0) {
    return this.device.createBuffer({ size: Math.max(4, nFloats * 4), usage: STORAGE | extraUsage });
  }

  /** Workgroup grid covering n threads (2-D when n exceeds one dimension). */
  _grid(n) {
    const groups = Math.max(1, Math.ceil(n / WG));
    if (groups <= MAX_DISPATCH) return [groups, 1];
    const y = Math.ceil(groups / MAX_DISPATCH);
    return [Math.ceil(groups / y), y];
  }

  /**
   * @param {string} code - WGSL source
   * @param {string[]} kinds - per binding: 'uniform' | 'read' | 'rw'
   * @param {GPUBuffer[]} buffers - same order as kinds
   * @param {Object.<string, number>} [constants] - pipeline-overridable constants
   */
  _pipeline(label, code, kinds, buffers, constants) {
    const { device } = this;
    const layout = device.createBindGroupLayout({
      label,
      entries: kinds.map((kind, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: kind === 'uniform' ? 'uniform' : kind === 'read' ? 'read-only-storage' : 'storage' },
      })),
    });
    const module = this._module(label, code);
    const pipeline = device.createComputePipeline({
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'main', constants },
    });
    const bindGroup = device.createBindGroup({
      label,
      layout,
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    return { pipeline, bindGroup };
  }

  _module(label, code) {
    this._modules ??= new Map();
    if (!this._modules.has(code)) {
      this._modules.set(code, { label, module: this.device.createShaderModule({ label, code }) });
    }
    return this._modules.get(code).module;
  }

  _buildPipelines() {
    const s = this.shaders;
    const B = this.buf;
    const U = B.uniforms;
    const pipes = {};

    pipes.etaFixed = this._pipeline('etaFixed', s.etaFixed,
      ['uniform', 'read', 'read', 'read', 'rw'], [U, B.offset, B.X, B.fx, B.eta]);
    pipes.etaFamily = this.families.map((f, i) => this._pipeline(`etaFamily${i}`, s.etaFamily,
      ['uniform', 'read', 'read', 'read', 'rw'], [U, f.gidx, f.coef, f.b, B.eta]));

    if (this.P > 0) {
      const obsKinds = ['uniform', 'read', 'read', 'read', 'read', 'rw', 'rw', 'rw'];
      const obsBufs = [U, B.obs, B.eta, B.X, B.fx, B.g, B.w, B.dll];
      pipes.obsCur = this._pipeline('obsCur', s.obsCur, obsKinds, obsBufs);
      pipes.obsProp = this._pipeline('obsProp', s.obsProp, obsKinds, obsBufs);
      pipes.reduce1 = this._pipeline('reduce1', s.reduce1,
        ['uniform', 'read', 'read', 'read', 'read', 'rw'], [U, B.g, B.w, B.dll, B.X, B.partials]);
      pipes.reduce2 = this._pipeline('reduce2', s.reduce2,
        ['uniform', 'read', 'rw'], [U, B.partials, B.totals], { BASE: 0 });
      pipes.solve1 = this._pipeline('solve1', s.solve1, ['uniform', 'read', 'rw'], [U, B.totals, B.fx]);
      pipes.solve2 = this._pipeline('solve2', s.solve2, ['uniform', 'read', 'rw'], [U, B.totals, B.fx]);
    }

    pipes.family = this.families.map((f, i) => this._pipeline(`family${i}`, s.family,
      ['uniform', 'read', 'rw', 'read', 'read', 'rw', 'rw'],
      [U, B.obs, B.eta, f.coef, f.csr, f.b, f.fs], { J: f.J, FAM: i }));

    pipes.ssr = this._pipeline('ssr', s.ssr, ['uniform', 'read', 'read', 'rw'],
      [U, B.obs, B.eta, B.partials]);
    pipes.reduceSsr = this._pipeline('reduceSsr', s.reduce2,
      ['uniform', 'read', 'rw'], [U, B.partials, B.totals], { BASE: this.entries });

    this.pipes = pipes;
  }

  /** Surface WGSL compile errors as exceptions (instead of silent failures). */
  async _checkCompilation() {
    for (const { label, module } of this._modules.values()) {
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length > 0) {
        throw new Error(`WGSL compile error in ${label}: ` +
          errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
      }
    }
  }
}

/** GPUBufferUsage flag, or 0 outside a WebGPU context (so the module still imports). */
function GPUBufferUsageOrZero(name) {
  return typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage[name] : 0;
}
