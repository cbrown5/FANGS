#!/usr/bin/env node
/**
 * Build script: renders course module .qmd/.md files to HTML and bundles them
 * into course/content/course-bundle.js for use as a fallback when fetch() is
 * unavailable (e.g. file:// protocol).
 *
 * Usage: node scripts/build-course.js
 *    or: npm run build:course
 *
 * Shares all rendering/bundling logic with the popup build via
 * scripts/lib/render-content.js.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from './lib/render-content.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'course', 'content');

buildContent({
  srcDir: CONTENT_DIR,
  renderedDir: join(CONTENT_DIR, '_rendered'),
  bundleOut: join(CONTENT_DIR, 'course-bundle.js'),
  exportName: 'COURSE_CONTENT',
  label: 'course',
});
