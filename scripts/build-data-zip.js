#!/usr/bin/env node
/**
 * Build script: packages the course datasets in course/data/ into a single
 * downloadable archive, course/data/course-data.zip, so students can grab every
 * CSV at once from the course page's "Download datasets" button.
 *
 * The zip is committed to the repo and served as a plain static file, so the
 * download works in both server mode and file:// mode (where fetch() is blocked
 * and a client-side zip builder could not read the CSVs).
 *
 * Usage: node scripts/build-data-zip.js
 *    or: npm run build:data-zip  (also runs as part of npm run build:course)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, digest } from './lib/make-zip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'course', 'data');
const ZIP_NAME = 'course-data.zip';
const ZIP_PATH = join(DATA_DIR, ZIP_NAME);

// Folder name inside the archive, so unzipping yields course-data/*.csv rather
// than loose files scattered into the user's Downloads folder.
const ARCHIVE_ROOT = 'course-data';

// Fixed timestamp keeps the output byte-identical across rebuilds when the
// datasets have not changed, so the committed zip doesn't churn in git.
const STAMP = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

function shouldInclude(name) {
  if (name === ZIP_NAME) return false;        // never nest the archive in itself
  if (name.startsWith('.')) return false;     // .DS_Store and friends
  return /\.(csv|md|txt)$/i.test(name);
}

function main() {
  if (!existsSync(DATA_DIR)) {
    process.stderr.write(`build:data-zip — no such directory: ${DATA_DIR}\n`);
    process.exit(1);
  }

  const names = readdirSync(DATA_DIR)
    .filter(n => statSync(join(DATA_DIR, n)).isFile())
    .filter(shouldInclude)
    .sort(); // stable order → reproducible archive

  if (names.length === 0) {
    process.stderr.write('build:data-zip — no datasets found, nothing to do\n');
    process.exit(1);
  }

  const entries = names.map(name => ({
    name: `${ARCHIVE_ROOT}/${name}`,
    data: readFileSync(join(DATA_DIR, name)),
  }));

  const previous = existsSync(ZIP_PATH) ? digest(readFileSync(ZIP_PATH)) : null;
  const zip = makeZip(entries, { date: STAMP });
  const current = digest(zip);

  writeFileSync(ZIP_PATH, zip);

  const kb = (zip.length / 1024).toFixed(1);
  const changed = previous === null ? 'created' : (previous === current ? 'unchanged' : 'updated');
  process.stdout.write(
    `build:data-zip — ${basename(ZIP_PATH)} ${changed}: ` +
    `${entries.length} files, ${kb} kB\n`
  );
  for (const n of names) process.stdout.write(`  + ${n}\n`);
}

main();
