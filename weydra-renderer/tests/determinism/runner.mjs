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
 * Captures: Pixi (WebGL) as the art reference, then weydra over WebGL2, then
 * weydra over WebGPU (`weydra_backend=webgpu`, extra Chromium flags passed via
 * ORBITAL_WEBGPU_ARGS). The WebGPU pass is skipped — not failed — when the
 * browser has no adapter; it exists because a WebGPU canvas only offers linear
 * formats, which used to render the whole scene darker than Pixi.
 *
 * Bit-exact across WebGL2 (Pixi-compiled GLSL) and wgpu (naga-translated
 * WGSL) is rarely achievable across different shader compilers; the
 * test serves as a regression gate against PCG/FBM/cloud math drift in the
 * WGSL port, not absolute proof of pixel equivalence.
 *
 * Usage:
 *   1) `bun run dev` (in another terminal) — boots Vite dev server.
 *   2) `bun run test:determinism` — runs this script.
 *
 * Env overrides:
 *   ORBITAL_DEV_URL — base URL of the dev server (default
 *                     http://localhost:5173/orbital-fork/).
 *   ORBITAL_WEBGPU_ARGS — Chromium flags for the WebGPU capture (default
 *                     `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`;
 *                     use `--use-webgpu-adapter=swiftshader` where Vulkan is absent).
 *
 * Exit codes:
 *   0 — bit-exact or within the pixel tolerance (WebGPU may be skipped).
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
const URL_WEYDRA = `${BASE_URL}?weydra_determinism_test=1&engine=weydra&weydra_backend=webgl2`;
const URL_WEYDRA_WEBGPU = `${BASE_URL}?weydra_determinism_test=1&engine=weydra&weydra_backend=webgpu`;
const VIEWPORT = { width: 800, height: 800 };
// Conservative settle delay. The harness stops the Pixi ticker after one
// render, so this is mostly waiting for shader compile + first paint.
const SETTLE_MS = 3000;
const OUT_DIR = '/tmp';

// Chromium only exposes WebGPU behind flags on most CI machines; override with
// ORBITAL_WEBGPU_ARGS (space separated) e.g. `--use-webgpu-adapter=swiftshader`.
const WEBGPU_ARGS = (process.env.ORBITAL_WEBGPU_ARGS
  ?? '--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan')
  .split(' ')
  .filter(Boolean);

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

async function captureScene(playwright, url, label, { extraArgs = [], expectBackend = null } = {}) {
  const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ?? (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(systemChromium ? { executablePath: systemChromium } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist', ...extraArgs],
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

  const effectiveBackend = await page
    .evaluate(() => (window).__weydraDeterminismBackend ?? null)
    .catch(() => null);
  if (expectBackend && effectiveBackend !== expectBackend) {
    await browser.close();
    return { skipped: `backend efetivo "${effectiveBackend}" != "${expectBackend}"` };
  }

  const buffer = await page.screenshot({ fullPage: false, omitBackground: false });
  await browser.close();

  const outPath = path.join(OUT_DIR, `determinism-${label}.png`);
  fs.writeFileSync(outPath, buffer);
  return { buffer, outPath, effectiveBackend };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function comparePixels(bufferA, bufferB, label) {
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
  const diffPath = path.join(OUT_DIR, `determinism-diff-${label}.png`);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  const ratio = differentPixels / (a.width * a.height);
  return {
    passed: ratio < 0.01,
    differentPixels,
    ratio,
    diffPath,
    reason: ratio < 0.01 ? 'within-tolerance' : 'pixel-drift',
  };
}

/**
 * Compare a weydra capture against the Pixi reference and report. Returns
 * whether the pair is within tolerance.
 */
function gate(labelA, captureA, labelB, captureB) {
  const hashes = [sha256(captureA.buffer), sha256(captureB.buffer)];
  console.log('');
  console.log(`${labelA}   PNG SHA-256: ${hashes[0]}  (${captureA.buffer.length} bytes)`);
  console.log(`${labelB} PNG SHA-256: ${hashes[1]}  (${captureB.buffer.length} bytes)`);
  if (hashes[0] === hashes[1]) {
    console.log(`PASS (${labelB} × ${labelA}) — bit-exact PNG match.`);
    return true;
  }
  console.log(`Hashes differ — comparing decoded pixels (${labelB} × ${labelA})…`);
  const cmp = comparePixels(captureA.buffer, captureB.buffer, `${labelB}-vs-${labelA}`);
  console.log(`  differing pixels:  ${cmp.differentPixels}`);
  console.log(`  differing ratio:   ${(cmp.ratio * 100).toFixed(4)}%`);
  console.log(`  reason:            ${cmp.reason}`);
  console.log(`  diff   → ${cmp.diffPath}`);
  console.log(`  ${labelA}   → ${captureA.outPath}`);
  console.log(`  ${labelB} → ${captureB.outPath}`);
  console.log('');
  console.log('Gate: fewer than 1% of pixels may differ by 3 or more in any RGB channel.');
  return cmp.passed;
}

async function main() {
  const playwright = await loadPlaywright();

  console.log('Capturing Pixi reference scene…');
  const pixi = await captureScene(playwright, URL_PIXI, 'pixi');
  console.log('Capturing weydra reference scene (WebGL2)…');
  const weydra = await captureScene(playwright, URL_WEYDRA, 'weydra');

  let ok = gate('pixi', pixi, 'weydra', weydra);

  // WebGPU: the browser reaches the canvas through a linear-only format, which
  // used to render the whole scene darker (missing sRGB encode). Gate it here —
  // no other path in CI exercises WebGPU.
  console.log('');
  console.log('Capturing weydra reference scene (WebGPU)…');
  const webgpu = await captureScene(playwright, URL_WEYDRA_WEBGPU, 'weydra-webgpu', {
    extraArgs: WEBGPU_ARGS,
    expectBackend: 'webgpu',
  });
  if (webgpu.skipped) {
    console.log(`SKIP — WebGPU indisponível neste navegador (${webgpu.skipped}).`);
    console.log('  Dica: ORBITAL_WEBGPU_ARGS="--use-webgpu-adapter=swiftshader" bun run test:determinism');
  } else {
    ok = gate('pixi', pixi, 'weydra-webgpu', webgpu) && ok;
  }

  process.exit(ok ? 0 : 1);
}

// ESM-safe "is this the entry?" check.
const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntry) {
  main().catch((err) => {
    console.error('Determinism runner threw:', err);
    process.exit(1);
  });
}
