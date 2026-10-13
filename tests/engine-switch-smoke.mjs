#!/usr/bin/env node

import * as fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.ORBITAL_DEV_URL ?? 'http://localhost:4173/orbital-fork/';
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ?? (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

const browser = await chromium.launch({
  headless: true,
  ...(systemChromium ? { executablePath: systemChromium } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    localStorage.setItem('orbital_config', JSON.stringify({
      rendering: {
        engine: 'pixi',
        pixi: { backend: 'webgl', webglVersion: 'auto', gpuPreference: 'high-performance' },
        weydra: { backend: 'webgl2' },
      },
    }));
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window._app && document.querySelector('#pixi-canvas')), null, { timeout: 30_000 });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('orbital:request-engine-switch', { detail: { engine: 'weydra', weydraBackend: 'webgl2' } }));
  });
  await page.waitForFunction(() => {
    const weydra = document.querySelector('#weydra-canvas');
    return Boolean(window._app && weydra && getComputedStyle(weydra).display !== 'none' && !document.querySelector('#pixi-canvas'));
  }, null, { timeout: 30_000 });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('orbital:request-engine-switch', { detail: { engine: 'pixi', pixiBackend: 'webgl' } }));
  });
  await page.waitForFunction(() => Boolean(window._app && document.querySelector('#pixi-canvas')), null, { timeout: 30_000 });

  // Start a real match through the public UI so the next switches exercise
  // DTO serialization/reconstruction rather than only rebuilding the menu.
  await page.locator('.menu-btn.primary').click();
  await page.locator('.new-world-modal .nwm-input').first().fill('Engine Switch Smoke');
  for (let step = 0; step < 5; step++) {
    await page.locator('.new-world-modal .nwm-btn.primary').click();
  }
  await page.waitForFunction(() => {
    const world = window.__mundo?.();
    return Boolean(world && world.planetas?.length > 0 && document.querySelector('.main-menu.hidden'));
  }, null, { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen.visible'), null, { timeout: 60_000 });
  await page.waitForTimeout(250);
  const snapshotBefore = await page.evaluate(() => {
    const world = window.__mundo();
    return {
      planetIds: world.planetas.map((planet) => planet.id).sort(),
      shipIds: world.naves.map((ship) => ship.id).sort(),
      objective: world.match.objective,
    };
  });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('orbital:request-engine-switch', { detail: { engine: 'weydra', weydraBackend: 'webgl2' } }));
  });
  try {
    await page.waitForFunction(() => {
      const world = window.__mundo?.();
      return Boolean(
        (world?.planetas?.length && !document.querySelector('#pixi-canvas'))
        || document.querySelector('.orbital-error-screen'),
      );
    }, null, { timeout: 20_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      pixi: Boolean(document.querySelector('#pixi-canvas')),
      weydraDisplay: getComputedStyle(document.querySelector('#weydra-canvas')).display,
      loading: document.querySelector('.loading-screen')?.textContent,
      error: document.querySelector('.orbital-error-screen')?.textContent,
      worldPlanets: window.__mundo?.()?.planetas?.length ?? null,
    }));
    throw new Error(`live switch timeout: ${JSON.stringify(diagnostic)}; browser=${pageErrors.join(' | ')}`, { cause: error });
  }
  const switchFailure = await page.locator('.orbital-error-screen').textContent().catch(() => null);
  if (switchFailure) throw new Error(`live match switch rolled back: ${switchFailure}`);
  const snapshotAfter = await page.evaluate(() => {
    const world = window.__mundo();
    return {
      planetIds: world.planetas.map((planet) => planet.id).sort(),
      shipIds: world.naves.map((ship) => ship.id).sort(),
      objective: world.match.objective,
    };
  });
  if (JSON.stringify(snapshotBefore) !== JSON.stringify(snapshotAfter)) {
    throw new Error('world identity changed while reconstructing the match on Weydra');
  }

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('orbital:request-engine-switch', { detail: { engine: 'pixi', pixiBackend: 'webgl' } }));
  });
  await page.waitForFunction(() => Boolean(window.__mundo?.()?.planetas?.length && document.querySelector('#pixi-canvas')), null, { timeout: 60_000 });

  const fatalScreen = await page.locator('.orbital-error-screen').count();
  if (fatalScreen > 0 || pageErrors.length > 0) {
    throw new Error(`runtime switch smoke failed: errors=${pageErrors.join(' | ') || 'none'}, errorScreen=${fatalScreen}`);
  }
  console.log('PASS — menu and live-match Pixi → Weydra → Pixi switches preserved world identity without reload.');
} finally {
  await browser.close();
}
