#!/usr/bin/env node
/**
 * Determinism runner.
 *
 * Captures the same fixed-seed reference planet under the legacy Pixi
 * GLSL path (`engine=pixi`) and the weydra WGSL live-shader path
 * (`engine=weydra`), hashes the framebuffers, and reports whether the
 * outputs match.
 *
 * Pass criteria (in order of strictness):
 *   1. SHA-256 of the two PNG screenshots is identical → BIT-EXACT.
 *   2. Otherwise: decoded RGB drift must affect fewer than 1% of pixels,
 *      counting a pixel when any channel differs by at least 3 levels.
 *
 * Bit-exact across WebGL2 (Pixi-compiled GLSL) and wgpu (naga-translated
 * WGSL) is rarely achievable across different shader compilers; the
 * test serves as a regression gate against PCG/FBM/cloud math drift in
 * the WGSL port, not absolute proof of pixel equivalence.
 *
 * Usage:
 *   1) `bun run dev` (in another terminal) — boots Vite dev server.
 *   2) `bun run test:determinism` — runs this script.
 *
 * Env overrides:
 *   ORBITAL_DEV_URL — base URL of the dev server (default
 *                     http://localhost:5173/orbital-fork/).
 *
 * Exit codes:
 *   0 — bit-exact or within the pixel tolerance.
 *   1 — visual drift, missing browser, unreachable server, or harness error.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const BASE_URL = process.env.ORBITAL_DEV_URL ?? 'http://localhost:5173/orbital-fork/';
const URL_PIXI = `${BASE_URL}?weydra_determinism_test=1&engine=pixi`;
const URL_WEYDRA = `${BASE_URL}?weydra_determinism_test=1&engine=weydra`;
const VIEWPORT = { width: 800, height: 800 };
// Conservative settle delay. The harness stops the Pixi ticker after one
// render, so this is mostly waiting for shader compile + first paint.
const SETTLE_MS = 3000;
const OUT_DIR = '/tmp';

async function loadPlaywright() {
  // Playwright is an optional dev-only dep — the team adds it ad-hoc
  // when running this gate. Locate it via the project's node_modules
  // chain so we don't need a project-level package entry.
  try {
    return await import('playwright');
  } catch (e1) {
    try {
      return await import('playwright-core');
    } catch (e2) {
      console.error('Playwright is not installed. Install it with:');
      console.error('  bun add -d playwright');
      console.error('  or: npm i -D playwright');
      console.error('Original errors:');
      console.error('  playwright:', e1?.message ?? e1);
      console.error('  playwright-core:', e2?.message ?? e2);
      process.exit(1);
    }
  }
}

async function captureScene(playwright, url, label) {
  const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ?? (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(systemChromium ? { executablePath: systemChromium } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  page.on('pageerror', (err) => console.warn(`[${label}] page error:`, err?.message ?? err));
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') console.warn(`[${label}] console.${t}: ${msg.text()}`);
  });

  console.log(`[${label}] navigating ${url}`);
  const resp = await page.goto(url, { waitUntil: 'load' }).catch((err) => {
    console.error(`[${label}] navigation failed: ${err?.message ?? err}`);
    console.error('Is the Vite dev server running?  →  bun run dev');
    return null;
  });
  if (!resp) {
    await browser.close();
    process.exit(1);
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  // Belt-and-suspenders: wait for the harness sentinel, then settle.
  await page
    .waitForFunction(() => (window).__weydraDeterminismReady === true, { timeout: 10_000 })
    .catch(() => {
      console.warn(`[${label}] readiness sentinel not seen — falling back to fixed timeout`);
    });
  await page.waitForTimeout(SETTLE_MS);

  const buffer = await page.screenshot({ fullPage: false, omitBackground: false });
  await browser.close();

  const outPath = path.join(OUT_DIR, `determinism-${label}.png`);
  fs.writeFileSync(outPath, buffer);
  return { buffer, outPath };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function comparePixels(bufferA, bufferB) {
  const a = PNG.sync.read(bufferA);
  const b = PNG.sync.read(bufferB);
  if (a.width !== b.width || a.height !== b.height) {
    return { passed: false, differentPixels: Infinity, ratio: 1, reason: 'dimension-mismatch' };
  }
  let differentPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) >= 3
      || Math.abs(a.data[i + 1] - b.data[i + 1]) >= 3
      || Math.abs(a.data[i + 2] - b.data[i + 2]) >= 3
    ) differentPixels++;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.01, includeAA: true });
  fs.writeFileSync(path.join(OUT_DIR, 'determinism-diff.png'), PNG.sync.write(diff));
  const ratio = differentPixels / (a.width * a.height);
  return { passed: ratio < 0.01, differentPixels, ratio, reason: ratio < 0.01 ? 'within-tolerance' : 'pixel-drift' };
}

async function main() {
  const playwright = await loadPlaywright();

  console.log('Capturing Pixi reference scene…');
  const pixi = await captureScene(playwright, URL_PIXI, 'pixi');
  console.log('Capturing weydra reference scene…');
  const weydra = await captureScene(playwright, URL_WEYDRA, 'weydra');

  const hPixi = sha256(pixi.buffer);
  const hWeydra = sha256(weydra.buffer);

  console.log('');
  console.log(`Pixi   PNG SHA-256: ${hPixi}  (${pixi.buffer.length} bytes)`);
  console.log(`Weydra PNG SHA-256: ${hWeydra}  (${weydra.buffer.length} bytes)`);

  if (hPixi === hWeydra) {
    console.log('PASS — bit-exact PNG match.');
    console.log(`  pixi   → ${pixi.outPath}`);
    console.log(`  weydra → ${weydra.outPath}`);
    process.exit(0);
  }

  console.log('Hashes differ — running decoded pixel comparison…');
  const cmp = comparePixels(pixi.buffer, weydra.buffer);
  console.log(`  differing pixels:  ${cmp.differentPixels}`);
  console.log(`  differing ratio:   ${(cmp.ratio * 100).toFixed(4)}%`);
  console.log(`  reason:            ${cmp.reason}`);
  console.log('');
  console.log('Outputs (open in an image diff tool to inspect):');
  console.log(`  pixi   → ${pixi.outPath}`);
  console.log(`  weydra → ${weydra.outPath}`);
  console.log(`  diff   → ${path.join(OUT_DIR, 'determinism-diff.png')}`);
  console.log('');
  console.log('Gate: fewer than 1% of pixels may differ by 3 or more in any RGB channel.');
  process.exit(cmp.passed ? 0 : 1);
}

// ESM-safe "is this the entry?" check.
const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error('Determinism runner threw:', err);
    process.exit(1);
  });
}
