#!/usr/bin/env node
/**
 * Build script: renders popup .qmd/.md files to HTML and bundles them into
 * src/content/popups-bundle.js for use as a fallback when fetch() is
 * unavailable (e.g. file:// protocol).
 *
 * Usage: node scripts/build-popups-bundle.js
 *    or: npm run build:popups
 *
 * When Quarto is installed the script uses `quarto render` for full LaTeX/KaTeX
 * support. When Quarto is not available it falls back to a built-in
 * Markdown-to-HTML converter that handles all the constructs used in the
 * popup source files (headings, bold/italic, code blocks, tables, lists, math
 * placeholders) without any external npm dependencies.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POPUPS_DIR = join(ROOT, 'src', 'content', 'popups');
const RENDERED_DIR = join(POPUPS_DIR, '_rendered');
const BUNDLE_OUT = join(ROOT, 'src', 'content', 'popups-bundle.js');

// ---------------------------------------------------------------------------
// Built-in Markdown → HTML converter (no external dependencies)
// Handles the subset of Markdown/Quarto used in the popup .qmd files.
// ---------------------------------------------------------------------------

/** Escape special HTML characters in text content. */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert inline Markdown: bold, italic, code, math, links. */
function inlineToHtml(text) {
  // Escape HTML first (we'll unescape safe tags we add)
  let s = escHtml(text);

  // Inline code: `code` — protect from further processing
  const codeSlots = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    codeSlots.push(`<code>${code}</code>`);
    return `\x00CODE${codeSlots.length - 1}\x00`;
  });

  // Inline math: $...$ (non-greedy, single-line)
  s = s.replace(/\$([^$\n]+)\$/g, (_, math) => `<span class="math inline">\\(${math}\\)</span>`);

  // Bold-italic: ***text***
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (not preceded/followed by *)
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
function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Blank line ─────────────────────────────────────────────────────────
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Fenced code block ```...``` ────────────────────────────────────────
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

    // ── Block math $$...$$  ────────────────────────────────────────────────
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

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ── ATX headings # ## ### ──────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineToHtml(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // ── Table (lines starting with |) ─────────────────────────────────────
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      // tableLines[0] = header row, tableLines[1] = separator, rest = body
      const parseRow = row =>
        row.split('|').slice(1, -1).map(cell => cell.trim());

      const headers = parseRow(tableLines[0]);
      // tableLines[1] is the --- separator, skip it
      const bodyRows = tableLines.slice(2).map(parseRow);

      const thCells = headers.map(h => `<th>${inlineToHtml(h)}</th>`).join('');
      const bodyHtml = bodyRows
        .map(cells => {
          const tds = cells.map(c => `<td>${inlineToHtml(c)}</td>`).join('');
          return `<tr>${tds}</tr>`;
        })
        .join('\n');

      out.push(`<table>\n<thead><tr>${thCells}</tr></thead>\n<tbody>\n${bodyHtml}\n</tbody>\n</table>`);
      continue;
    }

    // ── Unordered list ─────────────────────────────────────────────────────
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineToHtml(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>\n${items.join('\n')}\n</ul>`);
      continue;
    }

    // ── Ordered list ───────────────────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineToHtml(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>\n${items.join('\n')}\n</ol>`);
      continue;
    }

    // ── Paragraph: accumulate consecutive non-special lines ────────────────
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
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Check whether Quarto is available
let quartoAvailable = false;
try {
  execSync('quarto --version', { stdio: 'pipe' });
  quartoAvailable = true;
} catch (_) {
  // Quarto not installed — will use built-in converter
}

const contentMap = {};

if (quartoAvailable) {
  // ── Quarto path ────────────────────────────────────────────────────────
  console.log('Quarto found — running quarto render...');
  try {
    execSync(`quarto render "${POPUPS_DIR}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('quarto render failed.');
    process.exit(1);
  }

  if (!existsSync(RENDERED_DIR)) {
    console.error(`Expected rendered output at ${RENDERED_DIR} but directory not found.`);
    process.exit(1);
  }

  const htmlFiles = readdirSync(RENDERED_DIR).filter(f => extname(f) === '.html');
  if (htmlFiles.length === 0) {
    console.error('No .html files found in _rendered/. Check Quarto output.');
    process.exit(1);
  }

  for (const filename of htmlFiles.sort()) {
    const id = basename(filename, '.html');
    contentMap[id] = readFileSync(join(RENDERED_DIR, filename), 'utf8').trim();
  }
} else {
  // ── Built-in Markdown converter path ──────────────────────────────────
  console.log('Quarto not found — using built-in Markdown converter.');

  const sourceFiles = readdirSync(POPUPS_DIR)
    .filter(f => (extname(f) === '.qmd' || extname(f) === '.md') && !f.startsWith('_'))
    .sort();

  if (sourceFiles.length === 0) {
    console.error(`No .qmd or .md files found in ${POPUPS_DIR}.`);
    process.exit(1);
  }

  for (const filename of sourceFiles) {
    const id = basename(filename, extname(filename));
    const raw = readFileSync(join(POPUPS_DIR, filename), 'utf8');
    contentMap[id] = markdownToHtml(raw).trim();
    console.log(`  rendered ${filename} → ${id}`);
  }

  // Also write _rendered/ directory so fetch() works in server mode
  if (!existsSync(RENDERED_DIR)) mkdirSync(RENDERED_DIR);
  for (const [id, html] of Object.entries(contentMap)) {
    writeFileSync(join(RENDERED_DIR, `${id}.html`), html, 'utf8');
  }
  console.log(`Wrote ${Object.keys(contentMap).length} HTML files to ${RENDERED_DIR}`);
}

// ── Emit bundle ────────────────────────────────────────────────────────────
const header = [
  '// AUTO-GENERATED by scripts/build-popups-bundle.js — do not edit by hand.',
  '// Source: src/content/popups/*.qmd rendered via Quarto (or built-in converter).',
  '// Regenerate: npm run build:popups',
  '//',
  '// This bundle is a fallback for when fetch() is unavailable (e.g. file:// protocol).',
  '// In server mode, popups.js fetches HTML directly from src/content/popups/_rendered/.',
  '',
  'export const POPUP_CONTENT = {',
].join('\n');

const entries = Object.entries(contentMap).map(([id, html]) => {
  const escaped = html
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  return `  '${id}': \`${escaped}\``;
});

const output = `${header}\n${entries.join(',\n')}\n};\n`;
writeFileSync(BUNDLE_OUT, output, 'utf8');
console.log(`Wrote ${Object.keys(contentMap).length} popup entries to ${BUNDLE_OUT}`);
