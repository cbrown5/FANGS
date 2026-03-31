#!/usr/bin/env node
/**
 * fangs-cli.mjs
 *
 * Command-line interface for running the FANGS Gibbs sampler outside the browser.
 * Fits a Bayesian model and writes posterior summaries + timing to CSV.
 *
 * Usage:
 *   node tests/bench/fangs-cli.mjs \
 *     --model linear \
 *     --n-samples 1000 \
 *     --chains 3 \
 *     --burnin 500 \
 *     --thin 1 \
 *     --data data/example.csv \
 *     --output /tmp/fangs-results.csv
 *
 * Built-in model names: linear, mixed, poisson, bernoulli
 * Custom model: pass a file path to --model instead of a name.
 *
 * Options:
 *   --model         Model name or path to .bugs/.txt file  [linear]
 *   --n-samples     Post-burn-in samples per chain         [1000]
 *   --chains        Number of parallel chains              [3]
 *   --burnin        Burn-in iterations (discarded)         [500]
 *   --thin          Thinning interval                      [1]
 *   --data          Path to data CSV                       [data/example.csv]
 *   --response-col  CSV column to use as response y        [y]
 *                   (auto-mapped: poisson→y_count, bernoulli→y_bin if y absent)
 *   --output        Path to write posterior summaries CSV  [required]
 *
 * Output CSV columns:
 *   model, N_data, n_samples, n_chains, burnin, thin, elapsed_ms,
 *   param, mean, sd, q2_5, q50, q97_5, rhat, ess
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname }  from 'path';
import { fileURLToPath }     from 'url';
import { performance }       from 'perf_hooks';

// ---------------------------------------------------------------------------
// Resolve project root (two directories up from tests/bench/)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Built-in model texts
// ---------------------------------------------------------------------------
const BUILTIN_MODELS = {
  linear: `model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu[i], tau)
    mu[i] <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.04)
  beta  ~ dnorm(0, 0.04)
  tau   ~ dgamma(1, 0.1)
}`,

  mixed: `model {
  for (i in 1:N) {
    y[i]  ~ dnorm(mu[i], tau)
    mu[i] <- alpha + beta * x[i] + b[group[i]]
  }
  for (j in 1:J) {
    b[j] ~ dnorm(0, tau.b)
  }
  alpha ~ dnorm(0, 0.04)
  beta  ~ dnorm(0, 0.04)
  tau   ~ dgamma(1, 0.1)
  tau.b ~ dgamma(1, 0.1)
}`,

  poisson: `model {
  for (i in 1:N) {
    y[i] ~ dpois(lambda[i])
    log(lambda[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.04)
  beta  ~ dnorm(0, 0.04)
}`,

  bernoulli: `model {
  for (i in 1:N) {
    y[i] ~ dbern(p[i])
    logit(p[i]) <- alpha + beta * x[i]
  }
  alpha ~ dnorm(0, 0.04)
  beta  ~ dnorm(0, 0.04)
}`,
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Basic summary statistics (implemented inline to avoid circular imports)
// ---------------------------------------------------------------------------
function sampleMean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function sampleSd(arr) {
  const m = sampleMean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) ** 2;
  return Math.sqrt(s / (arr.length - 1));
}

function quantile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

function summarize(samples) {
  return {
    mean: sampleMean(samples),
    sd:   sampleSd(samples),
    q2_5: quantile(samples, 0.025),
    q50:  quantile(samples, 0.50),
    q97_5: quantile(samples, 0.975),
  };
}

// ---------------------------------------------------------------------------
// CSV writer
// ---------------------------------------------------------------------------
function writeCSV(rows, outputPath) {
  if (rows.length === 0) return;
  const header = Object.keys(rows[0]).join(',');
  const body   = rows.map(r => Object.values(r).map(v =>
    (typeof v === 'string' && v.includes(',')) ? `"${v}"` : String(v)
  ).join(',')).join('\n');
  const dir = dirname(resolve(outputPath));
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, header + '\n' + body + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const modelArg    = args['model']        ?? 'linear';
  const nSamples    = parseInt(args['n-samples'] ?? '1000', 10);
  const nChains     = parseInt(args['chains']    ?? '3',    10);
  const burnin      = parseInt(args['burnin']    ?? '500',  10);
  const thin        = parseInt(args['thin']      ?? '1',    10);
  const dataArg     = args['data']         ?? 'data/example.csv';
  const outputPath  = args['output'];
  const responseCol = args['response-col'] ?? 'y';

  if (!outputPath) {
    process.stderr.write('Error: --output is required\n');
    process.exit(1);
  }

  // --- Resolve model text ---
  let modelText;
  if (BUILTIN_MODELS[modelArg]) {
    modelText = BUILTIN_MODELS[modelArg];
  } else {
    // Try reading from file
    const modelPath = resolve(process.cwd(), modelArg);
    if (!existsSync(modelPath)) {
      process.stderr.write(`Error: unknown model "${modelArg}" and file not found at ${modelPath}\n`);
      process.exit(1);
    }
    modelText = readFileSync(modelPath, 'utf8');
  }

  // --- Load data CSV ---
  const dataPath = resolve(process.cwd(), dataArg);
  if (!existsSync(dataPath)) {
    // Fall back to project root
    const fallback = resolve(PROJECT_ROOT, dataArg);
    if (!existsSync(fallback)) {
      process.stderr.write(`Error: data file not found: ${dataPath}\n`);
      process.exit(1);
    }
    process.chdir(PROJECT_ROOT);
  }

  let csvText;
  try {
    csvText = readFileSync(resolve(process.cwd(), dataArg), 'utf8');
  } catch (e) {
    // final attempt: resolve from project root
    csvText = readFileSync(resolve(PROJECT_ROOT, dataArg), 'utf8');
  }

  // --- Lazy imports (after potential chdir) ---
  const { Lexer }                   = await import(`${PROJECT_ROOT}/src/parser/lexer.js`);
  const { Parser }                  = await import(`${PROJECT_ROOT}/src/parser/parser.js`);
  const { ModelGraph }              = await import(`${PROJECT_ROOT}/src/parser/model-graph.js`);
  const { runGibbs }                = await import(`${PROJECT_ROOT}/src/samplers/gibbs.js`);
  const { parseCSV, prepareDataColumns } = await import(`${PROJECT_ROOT}/src/data/csv-loader.js`);
  const { rhat, essMultiChain }     = await import(`${PROJECT_ROOT}/src/utils/diagnostics.js`);

  // --- Prepare data ---
  const rows = parseCSV(csvText);
  const { columns: rawCols } = prepareDataColumns(rows);
  const N = rows.length;

  // Convert TypedArrays → plain arrays
  const cols = {};
  for (const [k, v] of Object.entries(rawCols)) {
    cols[k] = Array.isArray(v) ? v : Array.from(v);
  }

  // Map response column to 'y' if needed
  if (responseCol !== 'y' && cols[responseCol]) {
    cols['y'] = cols[responseCol];
  }
  // Auto-detect for known model types when 'y' column is absent
  if (!cols['y']) {
    if (modelArg === 'poisson'   && cols['y_count']) cols['y'] = cols['y_count'];
    if (modelArg === 'bernoulli' && cols['y_bin'])   cols['y'] = cols['y_bin'];
  }

  if (!cols['y']) {
    process.stderr.write(`Error: no 'y' column found in data. Use --response-col to specify.\n`);
    process.exit(1);
  }

  // Build constants: always N; J for mixed model
  const constants = { N };
  if ((modelArg === 'mixed' || (cols.group && new Set(cols.group).size > 1)) && cols.group) {
    constants.J = new Set(cols.group).size;
  }

  // --- Parse model and build graph ---
  const tokens = new Lexer(modelText).tokenize();
  const ast    = new Parser(tokens).parse();
  const graph  = new ModelGraph(ast, { columns: cols, ...constants });
  graph.build();

  // --- Run sampler with timing ---
  process.stderr.write(`Running FANGS: model=${modelArg}  N=${N}  n_samples=${nSamples}  chains=${nChains}  burnin=${burnin}\n`);

  const t0 = performance.now();

  const samples = await runGibbs(graph, {
    nChains,
    nSamples,
    burnin,
    thin,
  });

  const elapsed_ms = performance.now() - t0;

  // --- Compute summaries ---
  const outputRows = [];
  const paramNames = Object.keys(samples);

  for (const param of paramNames) {
    const chains = samples[param]; // chains[chainIdx][sampleIdx]
    const all    = chains.flat();

    const stats   = summarize(all);
    const rhatVal = chains.length >= 2 ? rhat(chains) : NaN;
    const essVal  = essMultiChain(chains);

    outputRows.push({
      model:       modelArg,
      N_data:      N,
      n_samples:   nSamples,
      n_chains:    nChains,
      burnin,
      thin,
      elapsed_ms:  elapsed_ms.toFixed(2),
      param,
      mean:        stats.mean.toFixed(6),
      sd:          stats.sd.toFixed(6),
      q2_5:        stats.q2_5.toFixed(6),
      q50:         stats.q50.toFixed(6),
      q97_5:       stats.q97_5.toFixed(6),
      rhat:        isFinite(rhatVal) ? rhatVal.toFixed(4) : 'NA',
      ess:         isFinite(essVal)  ? essVal.toFixed(1)  : 'NA',
    });
  }

  writeCSV(outputRows, outputPath);

  // Write machine-readable timing to stderr for R to parse
  process.stderr.write(`FANGS_ELAPSED_MS:${elapsed_ms.toFixed(2)}\n`);
  process.stderr.write(`FANGS_N_PARAMS:${paramNames.length}\n`);

  process.stdout.write(
    `Done. ${paramNames.length} params, elapsed: ${(elapsed_ms / 1000).toFixed(3)}s\n` +
    `Output: ${outputPath}\n`
  );
}

main().catch(e => {
  process.stderr.write(`Fatal error: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
