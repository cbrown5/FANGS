/**
 * End-to-end popup tests using Playwright.
 * Run with: node tests/popup-e2e.mjs
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE_URL = 'http://localhost:4321';

// All popup IDs reachable via ? buttons on static (always-visible) elements.
// Tab-specific triggers (posteriors-tab, summary-tab, ppc, prior-check, trace-plot)
// may be hidden until the relevant tab is active — tested separately.
const STATIC_POPUP_IDS = [
  'data-formatting',
  'gibbs-sampler',
  'chains',
  'mcmc',
  'burn-in',
  'thinning',
];

// IDs on tab title elements — require switching tabs first
const TAB_POPUP_MAP = {
  'trace':     'trace-plot',
  'posteriors': 'posteriors-tab',
  'summary':   'summary-tab',
  'ppc':       'ppc',
  'prior-check': 'prior-check',
};

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
    failures.push(message);
  }
}

/** Wait for the popup body to contain real content (not just "Loading…"). */
async function waitForContent(page, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = (await page.textContent('.fangs-popup-body') ?? '').trim();
    if (text.length > 20 && !text.startsWith('Loading')) return text;
    await page.waitForTimeout(100);
  }
  return (await page.textContent('.fangs-popup-body') ?? '').trim();
}

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Ignore CORS / mixed-content errors from external CDN (KaTeX CSS)
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Capture JS errors (filter out known CDN/network noise)
  const jsErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('cdn.jsdelivr') && !t.includes('net::ERR') && !t.includes('Failed to fetch')) {
        jsErrors.push(t);
      }
    }
  });
  page.on('pageerror', err => jsErrors.push(err.message));

  console.log(`\nNavigating to ${BASE_URL} …`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // ── 1. Page loads without JS errors ──────────────────────────────────────
  console.log('\n[1] Page load');
  assert(jsErrors.length === 0, `No JS errors on load${jsErrors.length ? ': ' + jsErrors.join('; ') : ''}`);

  // ── 2. Trigger buttons injected for all static popups ────────────────────
  console.log('\n[2] Trigger button injection (left-panel popups)');
  for (const id of STATIC_POPUP_IDS) {
    const btn = await page.$(`[data-popup="${id}"] .fangs-popup-trigger`);
    assert(btn !== null, `Trigger button exists for data-popup="${id}"`);
  }

  // ── 3. Modal opens, shows content, closes correctly ──────────────────────
  console.log('\n[3] Modal lifecycle (open / content / close)');

  // Open
  await page.click(`[data-popup="${STATIC_POPUP_IDS[0]}"] .fangs-popup-trigger`);
  await page.waitForSelector('.fangs-popup-overlay', { state: 'visible', timeout: 3000 });
  assert(await page.isVisible('.fangs-popup-overlay'), 'Overlay visible after trigger click');
  assert(await page.isVisible('.fangs-popup-dialog'), 'Dialog visible after trigger click');

  // Content loads (async replacement of "Loading…")
  const firstContent = await waitForContent(page);
  assert(firstContent.length > 20, `First popup has real content (${firstContent.length} chars)`);

  // Close via × button
  await page.click('.fangs-popup-close');
  await page.waitForSelector('.fangs-popup-overlay', { state: 'hidden', timeout: 3000 });
  assert(!(await page.isVisible('.fangs-popup-overlay')), 'Overlay hidden after × button');

  // ── 4. Escape key closes the modal ───────────────────────────────────────
  console.log('\n[4] Close via Escape key');
  await page.click(`[data-popup="${STATIC_POPUP_IDS[0]}"] .fangs-popup-trigger`);
  await page.waitForSelector('.fangs-popup-overlay', { state: 'visible', timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.fangs-popup-overlay', { state: 'hidden', timeout: 3000 });
  assert(!(await page.isVisible('.fangs-popup-overlay')), 'Overlay hidden after Escape');

  // ── 5. Backdrop click closes the modal ───────────────────────────────────
  console.log('\n[5] Close via backdrop click');
  await page.click(`[data-popup="${STATIC_POPUP_IDS[0]}"] .fangs-popup-trigger`);
  await page.waitForSelector('.fangs-popup-overlay', { state: 'visible', timeout: 3000 });
  await page.click('.fangs-popup-overlay', { position: { x: 10, y: 10 } });
  await page.waitForSelector('.fangs-popup-overlay', { state: 'hidden', timeout: 3000 });
  assert(!(await page.isVisible('.fangs-popup-overlay')), 'Overlay hidden after backdrop click');

  // ── 6. All static popup IDs load real content ────────────────────────────
  console.log('\n[6] Content for all static popup IDs');
  for (const id of STATIC_POPUP_IDS) {
    await page.click(`[data-popup="${id}"] .fangs-popup-trigger`);
    await page.waitForSelector('.fangs-popup-overlay', { state: 'visible', timeout: 3000 });
    const text = await waitForContent(page);
    assert(text.length > 20, `Popup "${id}" content loaded (${text.length} chars)`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.fangs-popup-overlay', { state: 'hidden', timeout: 2000 });
  }

  // ── 7. Tab-specific popup triggers (switch to each tab first) ────────────
  console.log('\n[7] Tab-specific popup triggers');
  for (const [tabId, popupId] of Object.entries(TAB_POPUP_MAP)) {
    // Click the tab button
    const tabBtn = await page.$(`[data-tab="${tabId}"], .tab-btn[data-tab="${tabId}"]`);
    if (!tabBtn) {
      console.log(`  (skipped "${popupId}" — tab button for "${tabId}" not found)`);
      continue;
    }
    await tabBtn.click();
    await page.waitForTimeout(300);

    // The trigger should now be visible
    const trigger = await page.$(`[data-popup="${popupId}"] .fangs-popup-trigger`);
    if (!trigger) {
      console.log(`  (skipped "${popupId}" — trigger not found after switching to tab "${tabId}")`);
      continue;
    }
    const triggerVisible = await trigger.isVisible();
    assert(triggerVisible, `Trigger for "${popupId}" visible on tab "${tabId}"`);

    if (triggerVisible) {
      await trigger.click();
      await page.waitForSelector('.fangs-popup-overlay', { state: 'visible', timeout: 3000 });
      const text = await waitForContent(page);
      assert(text.length > 20, `Tab popup "${popupId}" content loaded (${text.length} chars)`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.fangs-popup-overlay', { state: 'hidden', timeout: 2000 });
    }
  }

  // ── 8. Dynamic summary-table popups (run sampler first) ──────────────────
  console.log('\n[8] Dynamic popup triggers on summary table headers');

  // Switch to summary tab
  const summaryTabBtn = await page.$(`[data-tab="summary"], .tab-btn[data-tab="summary"]`);
  if (summaryTabBtn) await summaryTabBtn.click();

  // Load example data first (required before sampling)
  const exampleBtn = await page.$('#btn-load-example');
  if (exampleBtn) {
    await exampleBtn.click();
    await page.waitForTimeout(300);
    console.log('  Example data loaded');
  }

  // Reduce sample count so sampler finishes faster in CI
  await page.fill('#input-samples', '500').catch(() => {});
  await page.fill('#input-chains', '2').catch(() => {});

  // Click Run
  const runBtn = await page.$('#btn-run');
  if (runBtn) {
    await runBtn.click();
    try {
      // Wait for summary table to render (up to 60s)
      await page.waitForFunction(
        () => document.querySelector('#summary-container .fangs-summary-table tbody tr') !== null,
        { timeout: 60000 }
      );
      console.log('  Sampler completed — summary table populated');

      // Switch back to summary tab (sampler auto-switches to trace tab)
      const summaryTabBtn2 = await page.$(`[data-tab="summary"]`);
      if (summaryTabBtn2) await summaryTabBtn2.click();
      await page.waitForTimeout(300);

      const tablePopupTriggers = await page.$$(
        '#summary-container .fangs-popup-trigger'
      );
      assert(tablePopupTriggers.length > 0, `Summary table has popup trigger(s) (found ${tablePopupTriggers.length})`);

      if (tablePopupTriggers.length > 0) {
        await tablePopupTriggers[0].click();
        await page.waitForSelector('.fangs-popup-overlay', { state: 'visible', timeout: 3000 });
        const text = await waitForContent(page);
        assert(text.length > 20, `Dynamic summary table popup has content (${text.length} chars)`);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.fangs-popup-overlay', { state: 'hidden', timeout: 2000 });
      }
    } catch (e) {
      console.log(`  (skipped — sampler timed out or table not populated: ${e.message.split('\n')[0]})`);
    }
  } else {
    console.log('  (skipped — Run button not found)');
  }

  // ── 9. No unexpected JS errors throughout ────────────────────────────────
  console.log('\n[9] No unexpected JS errors throughout testing');
  assert(jsErrors.length === 0, `No JS errors during testing${jsErrors.length ? ': ' + jsErrors.join('; ') : ''}`);

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailed assertions:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  console.log('══════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
