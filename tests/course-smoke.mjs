/**
 * Course smoke test (Playwright).
 * Serves must already be running. Run with: node tests/course-smoke.mjs [baseUrl]
 * Verifies the course shell loads, nav is built, and each challenge type mounts
 * and (where logic allows) lights green.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.argv[2] || 'http://localhost:4399';
let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ FAIL: ${m}`); failed++; } };

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
// Ignore failures to load the external KaTeX CDN (blocked in offline/sandboxed CI).
const isCdnNoise = t => /ERR_CERT|ERR_NAME|net::ERR|Failed to load resource/i.test(t);
page.on('pageerror', e => { if (!isCdnNoise(e.message)) errors.push(e.message); });
page.on('console', m => { if (m.type() === 'error' && !isCdnNoise(m.text())) errors.push(m.text()); });

async function go(hash) {
  await page.goto(`${BASE}/course/index.html#${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

// 1. Shell + nav
await go('m01-discrete-bayes');
assert(await page.locator('.nav-module').count() === 21, 'nav lists 21 modules');
assert(await page.locator('.nav-session').count() === 6, 'nav has 6 sessions');
assert((await page.locator('.module-prose h1').first().innerText()).includes('Bayes'), 'M1 prose renders');

// 2. Discrete Bayes — solve it
assert(await page.locator('.challenge select[data-prior]').count() === 1, 'M1 challenge mounted');
await page.fill('[data-numer="0"]', '0.2');
await page.fill('[data-numer="1"]', '0.1');
await page.fill('[data-numer="2"]', String(1 / 30));
await page.fill('[data-denom]', String(0.2 + 0.1 + 1 / 30));
await page.fill('[data-post="0"]', '0.6');
await page.fill('[data-post="1"]', '0.3');
await page.fill('[data-post="2"]', '0.1');
await page.click('[data-submit]');
await page.waitForTimeout(150);
assert(await page.locator('.challenge.solved').count() === 1, 'M1 lights green on correct answers');

// 3. MAP slider mounts with a canvas
await go('m02-continuous-bayes');
assert(await page.locator('.challenge canvas').count() >= 1, 'M2 slider canvas mounted');
assert(await page.locator('input[type="range"][data-slider]').count() === 1, 'M2 slider present');

// 4. MCMC mounts
await go('m03-mcmc-sampling');
assert(await page.locator('[data-run]').count() === 1, 'M3 run button present');

// 5. Code validator — fix the seeded bug and check it goes green
await go('m04-model-syntax');
assert(await page.locator('textarea[data-code]').count() === 1, 'M4 code editor mounted');
await page.fill('textarea[data-code]', `model {
  for (i in 1:N) {
    y[i] ~ dnorm(mu, sigma)
    mu <- alpha
  }
  alpha ~ dnorm(0, 5)
  sigma ~ dunif(0, 100)
}`);
await page.click('[data-submit]');
await page.waitForTimeout(150);
assert(await page.locator('.challenge.solved').count() === 1, 'M4 lights green when model parses');

// 6. answer-check, quiz, recorder mount
await go('m05-first-fit');
assert(await page.locator('.challenge-table input').count() >= 1, 'M5 answer-check mounted');
await go('m10-diagnostics');
assert(await page.locator('.challenge-q').count() >= 1, 'M10 quiz mounted');
await go('m12-prior-comparison');
assert(await page.locator('[data-add]').count() === 1, 'M12 recorder mounted');

// 7. Math: KaTeX renders when its CDN is reachable; otherwise raw delimiters
//    remain (graceful degradation). Either is acceptable.
await go('m08-gaussian-glm');
await page.waitForTimeout(400);
const katexCount = await page.locator('.module-prose .katex').count();
const mathDivs = await page.locator('.module-prose .math.display').count();
assert(katexCount >= 1 || mathDivs >= 1,
  katexCount >= 1 ? 'KaTeX rendered math' : 'math present (CDN blocked — raw delimiters, degrades gracefully)');

assert(errors.length === 0, `no page/console errors (saw ${errors.length}: ${errors.slice(0, 3).join(' | ')})`);

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
