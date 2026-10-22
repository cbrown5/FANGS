#!/usr/bin/env node
/**
 * prep-algal-stressors.js
 *
 * Builds course/data/algal-yield.csv (the M21 summative dataset) from the raw
 * King et al. diuron experiment in tutorial/data/algal-stressors/.
 *
 * The raw file is the 72-hour slice of the diuron experiment: photosynthetic
 * yield measured in 15 light x diuron treatment cells, repeated across 4
 * independent algal cultures ("blocks"). We keep the yield response because it
 * is measured in every block (cell density is missing for block 1) and recode
 * both stressors as 1-based factor levels, because neither effect is linear in
 * its numeric value.
 *
 * Usage: node scripts/prep-algal-stressors.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(PROJECT_ROOT, 'tutorial/data/algal-stressors/diuron_data72hrs.csv');
const DEST   = resolve(PROJECT_ROOT, 'course/data/algal-yield.csv');

// Treatment levels, in the order the course text assumes (lowest = reference).
const LIGHT_LEVELS  = [5, 20, 80];
const DIURON_LEVELS = [0, 0.11, 0.33, 1, 3];

function readCSV(path) {
  const lines = readFileSync(path, 'utf8').replace(/\r/g, '').trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const parts = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = parts[i]; });
    return row;
  });
}

function writeCSV(path, rows) {
  const keys = Object.keys(rows[0]);
  const body = rows.map((r) => keys.map((k) => r[k]).join(',')).join('\n');
  writeFileSync(path, `${keys.join(',')}\n${body}\n`, 'utf8');
}

const raw = readCSV(SOURCE);

// Blocks are renumbered to start at 1 and run consecutively, so that the
// `b[block[i]]` random-effect indexing in the model text works directly.
const blocks = [...new Set(raw.map((r) => Number(r.block)))].sort((a, b) => a - b);

const rows = raw.map((r) => {
  const lightNum  = Number(r.Light_num);
  const diuronNum = Number(r.Diuron_num);
  const light  = LIGHT_LEVELS.indexOf(lightNum) + 1;
  const diuron = DIURON_LEVELS.indexOf(diuronNum) + 1;
  if (light === 0 || diuron === 0) {
    throw new Error(`Unexpected treatment level: light=${lightNum} diuron=${diuronNum}`);
  }
  return {
    yield_ps:   Number(r.Yield),
    light,
    diuron,
    block:      blocks.indexOf(Number(r.block)) + 1,
    light_umol: lightNum,
    diuron_ugL: diuronNum,
  };
});

const missing = rows.filter((r) => !Number.isFinite(r.yield_ps));
if (missing.length > 0) {
  throw new Error(`${missing.length} rows have a missing yield value`);
}

writeCSV(DEST, rows);

process.stdout.write(
  `Wrote ${DEST}\n` +
  `  N = ${rows.length} rows, ${blocks.length} blocks, ` +
  `${new Set(rows.map((r) => r.light)).size} light x ` +
  `${new Set(rows.map((r) => r.diuron)).size} diuron cells\n`
);
