/**
 * End-to-end test of the WebGPU blocked sampler in headless Chromium.
 *
 * Serves the repository, opens tests/gpu-harness.html with WebGPU enabled
 * (SwiftShader's software Vulkan adapter, so no physical GPU is needed), and
 * checks that the GPU backend's posterior summaries agree with the CPU
 * backend's for every built-in model. SwiftShader runs the kernels on the
 * CPU, so this checks correctness, not speed.
 *
 * Run with: node tests/gpu-e2e.mjs [--bench]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
});
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });

const bench = process.argv.includes('--bench') ? '&bench=1' : '';
await page.goto(`http://127.0.0.1:${port}/tests/gpu-harness.html?samples=2000&burnin=500&chains=2${bench}`);
await page.waitForFunction(() => window.__gpuResult, null, { timeout: 30 * 60 * 1000 });
const result = await page.evaluate(() => window.__gpuResult);
await browser.close();
server.close();

let passed = 0;
let failed = 0;
const check = (ok, msg) => {
  if (ok) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
};

if (result.fatal) {
  console.error('Harness failed:', result.fatal);
  process.exit(1);
}
check(result.webgpu, 'WebGPU is available in headless Chromium');
for (const e of result.errors ?? []) check(false, e);

// GPU and CPU runs are independent chains, so compare with a tolerance based
// on the posterior SD (Monte Carlo error of ~2000×2 draws is well below this).
for (const [model, r] of Object.entries(result.models ?? {})) {
  for (const [param, cpu] of Object.entries(r.cpu)) {
    if (param.includes('[') && !param.endsWith('[1]')) continue;
    const gpu = r.gpu[param];
    const tol = 0.25 * cpu.sd + 1e-3;
    check(Math.abs(gpu.mean - cpu.mean) < tol,
      `${model} ${param}: gpu mean ${gpu.mean.toFixed(3)} vs cpu ${cpu.mean.toFixed(3)} (±${tol.toFixed(3)})`);
    check(gpu.sd > 0.6 * cpu.sd && gpu.sd < 1.6 * cpu.sd,
      `${model} ${param}: gpu sd ${gpu.sd.toFixed(3)} vs cpu ${cpu.sd.toFixed(3)}`);
  }
  console.log(`  ${model}: gpu ${r.gpuMs.toFixed(0)} ms, cpu ${r.cpuMs.toFixed(0)} ms`);
}
if (result.bench) console.log('bench', JSON.stringify(result.bench));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
