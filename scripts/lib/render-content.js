#!/usr/bin/env node
/**
 * render-content.js
 * Shared content-build helper used by both the popup build
 * (scripts/build-popups-bundle.js) and the course build
 * (scripts/build-course.js).
 *
 * Renders a directory of `.qmd`/`.md` source files to HTML fragments and emits
 * an ES-module bundle of `{ id: html }` for use as a fallback when fetch() is
 * unavailable (e.g. the file:// protocol).
 *
 * When Quarto is installed it uses `quarto render` for full LaTeX/KaTeX
 * support. Otherwise it falls back to a built-in Markdown→HTML converter that
 * handles the constructs used across the project's content files (headings,
 * bold/italic, code blocks, tables, lists, inline/block math) with no external
 * npm dependencies.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Built-in Markdown → HTML converter (no external dependencies)
// ---------------------------------------------------------------------------

/** Escape special HTML characters in text content. */
export function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert inline Markdown: bold, italic, code, math, links. */
function inlineToHtml(text) {
  let s = escHtml(text);

  // Inline code: `code` — protect from further processing
  const codeSlots = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    codeSlots.push(`<code>${code}</code>`);
    return `\x00CODE${codeSlots.length - 1}\x00`;
  });

  // Inline math: $...$ (non-greedy, single-line)
  s = s.replace(/\$([^$\n]+)\$/g, (_, math) => `<span class="math inline">\\(${math}\\)</span>`);

  // Bold-italic / bold / italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore inline code slots
  s = s.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeSlots[+i]);

  return s;
}

/**
 * Convert a Markdown string to an HTML fragment.
 * Handles: headings, paragraphs, bold/italic, inline code, fenced code blocks,
 * unordered/ordered lists, tables, horizontal rules, block math ($$...$$).
 */
export function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    // Fenced code block ```...```
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escHtml(lines[i]));
        i++;
      }
      i++; // consume closing ```
      const langAttr = lang ? ` class="language-${escHtml(lang)}"` : '';
      out.push(`<pre><code${langAttr}>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // Single-line block math $$ ... $$
    const inlineDisplay = line.trim().match(/^\$\$(.+)\$\$$/);
    if (inlineDisplay) {
      out.push(`<div class="math display">\\[${inlineDisplay[1]}\\]</div>`);
      i++;
      continue;
    }

    // Block math $$...$$ (delimiters on their own lines)
    if (line.trim() === '$$') {
      const mathLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // consume closing $$
      out.push(`<div class="math display">\\[${mathLines.join('\n')}\\]</div>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ATX headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineToHtml(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Table
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = row => row.split('|').slice(1, -1).map(cell => cell.trim());
      const headers = parseRow(tableLines[0]);
      const bodyRows = tableLines.slice(2).map(parseRow);
      const thCells = headers.map(h => `<th>${inlineToHtml(h)}</th>`).join('');
      const bodyHtml = bodyRows
        .map(cells => `<tr>${cells.map(c => `<td>${inlineToHtml(c)}</td>`).join('')}</tr>`)
        .join('\n');
      out.push(`<table>\n<thead><tr>${thCells}</tr></thead>\n<tbody>\n${bodyHtml}\n</tbody>\n</table>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineToHtml(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>\n${items.join('\n')}\n</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineToHtml(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>\n${items.join('\n')}\n</ol>`);
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|\$\$|[-*+]\s|\d+\.\s|\|)/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(inlineToHtml(lines[i]));
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${paraLines.join(' ')}</p>`);
    } else {
      // Defensive: a line matched a "special" prefix but no handler consumed it.
      // Emit it as a paragraph and advance so we can never infinite-loop.
      out.push(`<p>${inlineToHtml(lines[i])}</p>`);
      i++;
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Build orchestration
// ---------------------------------------------------------------------------

/** True if the Quarto CLI is available on PATH. */
export function quartoAvailable() {
  try {
    execSync('quarto --version', { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Render a directory of content and emit a bundle.
 *
 * @param {object} opts
 * @param {string} opts.srcDir       - Directory containing .qmd/.md sources
 * @param {string} opts.renderedDir  - Directory to write _rendered/<id>.html
 * @param {string} opts.bundleOut    - Path of the ESM bundle to emit
 * @param {string} opts.exportName   - Named export inside the bundle (e.g. POPUP_CONTENT)
 * @param {string} [opts.label]      - Human label for log lines
 * @returns {Record<string,string>}  - Map of id → rendered HTML
 */
export function buildContent({ srcDir, renderedDir, bundleOut, exportName, label = 'content' }) {
  const contentMap = {};

  if (quartoAvailable()) {
    console.log(`[${label}] Quarto found — running quarto render...`);
    try {
      execSync(`quarto render "${srcDir}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`[${label}] quarto render failed.`);
      process.exit(1);
    }
    if (!existsSync(renderedDir)) {
      console.error(`[${label}] Expected rendered output at ${renderedDir} but not found.`);
      process.exit(1);
    }
    const htmlFiles = readdirSync(renderedDir).filter(f => extname(f) === '.html');
    if (htmlFiles.length === 0) {
      console.error(`[${label}] No .html files found in ${renderedDir}. Check Quarto output.`);
      process.exit(1);
    }
    for (const filename of htmlFiles.sort()) {
      const id = basename(filename, '.html');
      contentMap[id] = readFileSync(join(renderedDir, filename), 'utf8').trim();
    }
  } else {
    console.log(`[${label}] Quarto not found — using built-in Markdown converter.`);
    const sourceFiles = readdirSync(srcDir)
      .filter(f => (extname(f) === '.qmd' || extname(f) === '.md') && !f.startsWith('_'))
      .sort();
    if (sourceFiles.length === 0) {
      console.error(`[${label}] No .qmd or .md files found in ${srcDir}.`);
      process.exit(1);
    }
    for (const filename of sourceFiles) {
      const id = basename(filename, extname(filename));
      const raw = readFileSync(join(srcDir, filename), 'utf8');
      contentMap[id] = markdownToHtml(raw).trim();
      console.log(`  rendered ${filename} → ${id}`);
    }
    if (!existsSync(renderedDir)) mkdirSync(renderedDir, { recursive: true });
    for (const [id, html] of Object.entries(contentMap)) {
      writeFileSync(join(renderedDir, `${id}.html`), html, 'utf8');
    }
    console.log(`[${label}] Wrote ${Object.keys(contentMap).length} HTML files to ${renderedDir}`);
  }

  // Emit bundle
  const header = [
    '// AUTO-GENERATED by scripts/build-* (shared scripts/lib/render-content.js) — do not edit by hand.',
    `// Regenerate via the relevant npm build script.`,
    '//',
    '// This bundle is a fallback for when fetch() is unavailable (e.g. file:// protocol).',
    '',
    `export const ${exportName} = {`,
  ].join('\n');

  const entries = Object.entries(contentMap).map(([id, html]) => {
    const escaped = html
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    return `  '${id}': \`${escaped}\``;
  });

  writeFileSync(bundleOut, `${header}\n${entries.join(',\n')}\n};\n`, 'utf8');
  console.log(`[${label}] Wrote ${Object.keys(contentMap).length} entries to ${bundleOut}`);
  return contentMap;
}
