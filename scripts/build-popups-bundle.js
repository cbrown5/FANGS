#!/usr/bin/env node
/**
 * Build script: renders popup .qmd/.md files to HTML and bundles them into
 * src/content/popups-bundle.js for use as a fallback when fetch() is
 * unavailable (e.g. file:// protocol).
 *
 * Usage: node scripts/build-popups-bundle.js
 *    or: npm run build:popups
 *
 * The shared rendering/bundling logic lives in scripts/lib/render-content.js
 * (used by the course build too). When Quarto is installed it renders with full
 * LaTeX/KaTeX support; otherwise it uses a built-in Markdown converter.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from './lib/render-content.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POPUPS_DIR = join(ROOT, 'src', 'content', 'popups');

buildContent({
  srcDir: POPUPS_DIR,
  renderedDir: join(POPUPS_DIR, '_rendered'),
  bundleOut: join(ROOT, 'src', 'content', 'popups-bundle.js'),
  exportName: 'POPUP_CONTENT',
  label: 'popups',
});
