import { Lexer } from '../parser/lexer.js';
import { Parser } from '../parser/parser.js';
import { ModelGraph } from '../parser/model-graph.js';
import { runGibbs } from './gibbs.js';
import { summarizeAll } from '../utils/diagnostics.js';

/**
 * Tracks whether the worker has been asked to stop sampling.
 * Set to true on a STOP message; reset to false at the start of each run.
 */
let stopRequested = false;

/**
 * Accumulates samples per chain per parameter until a flush threshold is
 * reached, then posts a SAMPLES message and clears the buffer.
 */
const BATCH_SIZE = 10;

/**
 * Build a fresh sample buffer for a given set of parameter names.
 * @param {string[]} paramNames
 * @returns {Object.<string, number[]>}
 */
function makeSampleBuffer(paramNames) {
    const buffer = {};
    for (const name of paramNames) {
        buffer[name] = [];
    }
    return buffer;
}

/**
 * Flush all buffered samples for a single chain to the main thread, then
 * clear the buffer so it is ready for the next batch.
 *
 * @param {number} chainIdx
 * @param {Object.<string, number[]>} buffer
 */
function flushSamples(chainIdx, buffer) {
    for (const [paramName, values] of Object.entries(buffer)) {
        if (values.length > 0) {
            self.postMessage({
                type: 'SAMPLES',
                chainIdx,
                paramName,
                values: values.slice(),
            });
            buffer[paramName] = [];
        }
    }
}

/**
 * Entry point — parse the model, build the graph, run all chains, collect
 * samples, and report back to the main thread.
 *
 * @param {string} modelSource   Raw BUGS/JAGS model text.
 * @param {Object} dataColumns   Map of variable name -> array of values.
 * @param {number} dataN         Number of observations.
 * @param {number} dataJ         Number of groups (may be 0 if no random effects).
 * @param {Object} settings      { nChains, nSamples, burnin, thin }
 */
async function startSampling(modelSource, dataColumns, dataN, dataJ, settings) {
    stopRequested = false;

    const { nChains, nSamples, burnin, thin } = settings;

    // --- Parse model -------------------------------------------------------
    const lexer = new Lexer(modelSource);
    const tokens = lexer.tokenize();

    const parser = new Parser(tokens);
    const ast = parser.parse();

    // --- Build model graph -------------------------------------------------
    const graph = new ModelGraph(ast, { dataColumns, N: dataN, J: dataJ });

    // --- Collect all samples across chains (keyed by paramName) for the
    //     final summary computation. Structure: { paramName: number[][] }
    //     where the outer array index corresponds to chainIdx.
    const allSamples = {};

    // --- Per-chain sample buffers (flushed every BATCH_SIZE saved samples) -
    // We create one buffer per chain; they are set up inside the loop below.

    // Total iterations that will actually be saved (for progress reporting).
    const totalSaved = nSamples;

    // --- Run sampler -------------------------------------------------------
    await runGibbs(graph, {
        nChains,
        nSamples,
        burnin,
        thin,

        /**
         * Called once per *saved* sample (after thinning and burn-in).
         *
         * @param {number} chainIdx   0-based chain index.
         * @param {number} sampleIdx  0-based index of saved sample.
         * @param {Object} paramValues  Map of paramName -> current scalar value.
         */
        onSample(chainIdx, sampleIdx, paramValues) {
            // Lazily initialise storage structures on first sample of chain 0.
            if (chainIdx === 0 && sampleIdx === 0) {
                for (const name of Object.keys(paramValues)) {
                    allSamples[name] = Array.from({ length: nChains }, () => []);
                }
            }

            // Lazily initialise the per-chain batch buffer.
            if (!this._buffers) {
                this._buffers = {};
            }
            if (!this._buffers[chainIdx]) {
                this._buffers[chainIdx] = makeSampleBuffer(Object.keys(paramValues));
            }

            const buffer = this._buffers[chainIdx];

            for (const [name, value] of Object.entries(paramValues)) {
                buffer[name].push(value);
                if (allSamples[name]) {
                    allSamples[name][chainIdx].push(value);
                }
            }

            // Flush when the buffer reaches BATCH_SIZE saved samples.
            const firstParamValues = Object.values(buffer)[0];
            if (firstParamValues && firstParamValues.length >= BATCH_SIZE) {
                flushSamples(chainIdx, buffer);
            }
        },

        /**
         * Called on every iteration (including burn-in).
         *
         * @param {number} chainIdx
         * @param {number} iter       Current iteration number (1-based).
         * @param {number} total      Total number of iterations (burnin + nSamples*thin).
         * @param {Object} paramValues  Current parameter values.
         */
        onProgress(chainIdx, iter, total, paramValues) {
            self.postMessage({
                type: 'PROGRESS',
                chainIdx,
                iter,
                total,
                paramValues,
            });
        },

        /** Checked before each iteration; returning true aborts sampling. */
        shouldStop() {
            return stopRequested;
        },
    });

    // Flush any remaining buffered samples for every chain.
    if (this && this._buffers) {
        for (const [chainIdx, buffer] of Object.entries(this._buffers)) {
            flushSamples(Number(chainIdx), buffer);
        }
    }

    // If sampling was stopped early we may have fewer samples than requested;
    // that is acceptable — just summarise whatever was collected.
    const summary = summarizeAll(allSamples);

    self.postMessage({ type: 'DONE', summary });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = function onmessage(event) {
    const msg = event.data;

    if (msg.type === 'STOP') {
        stopRequested = true;
        return;
    }

    if (msg.type === 'START') {
        const { modelSource, dataColumns, dataN, dataJ, settings } = msg;

        startSampling(modelSource, dataColumns, dataN, dataJ, settings).catch(
            (err) => {
                self.postMessage({
                    type: 'ERROR',
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        );

        return;
    }

    // Unknown message — silently ignore.
};
