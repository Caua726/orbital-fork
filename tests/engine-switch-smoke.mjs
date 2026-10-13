#!/usr/bin/env node

import * as fs from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

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

  // ── Backing store acima de 2048 px (WebGL2) ───────────────────────────
  // O device nascia com `Limits::downlevel_webgl2_defaults()`, cujo
  // max_texture_dimension_2d é 2048: qualquer tela 1440p/4K (ou renderScale
  // > 1 numa janela larga) fazia `Surface::configure` falhar e a página morria
  // na tela de erro, sem fallback. Este bloco renderiza num viewport maior que
  // o limite antigo e exige pixels no canvas.
  const bigContext = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  await bigContext.addInitScript(() => {
    localStorage.setItem('orbital_config', JSON.stringify({
      rendering: {
        engine: 'weydra',
        pixi: { backend: 'webgl', webglVersion: 'auto', gpuPreference: 'high-performance' },
        weydra: { backend: 'webgl2' },
      },
    }));
  });
  const bigPage = await bigContext.newPage();
  const bigErrors = [];
  bigPage.on('pageerror', (error) => bigErrors.push(error.message));
  bigPage.on('console', (message) => {
    if (message.type() === 'error') bigErrors.push(`console: ${message.text()}`);
  });
  await bigPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await bigPage.waitForFunction(
    () => Boolean(window.__weydraRenderer && document.querySelector('#weydra-canvas')),
    null,
    { timeout: 30_000 },
  );
  await bigPage.waitForTimeout(1500);
  const bigCanvas = await bigPage.evaluate(() => {
    const canvas = document.querySelector('#weydra-canvas');
    return {
      width: canvas.width,
      height: canvas.height,
      limit: window.__weydraRenderer.maxTextureDimension2d,
      errorScreen: document.querySelector('.orbital-error-screen')?.textContent?.slice(0, 120) ?? null,
    };
  });
  if (bigCanvas.errorScreen) throw new Error(`viewport grande caiu em tela de erro: ${bigCanvas.errorScreen}`);
  if (Math.max(bigCanvas.width, bigCanvas.height) <= 2048) {
    throw new Error(`backing store não passou de 2048: ${bigCanvas.width}x${bigCanvas.height} (limite do device: ${bigCanvas.limit})`);
  }
  const bigShot = PNG.sync.read(await bigPage.screenshot());
  let bigPainted = 0;
  for (let i = 0; i < bigShot.data.length; i += 4) {
    if (bigShot.data[i] > 6 || bigShot.data[i + 1] > 6 || bigShot.data[i + 2] > 6) bigPainted++;
  }
  if (bigPainted / (bigShot.width * bigShot.height) < 0.02) {
    throw new Error(`canvas do weydra ficou (quase) preto em ${bigCanvas.width}x${bigCanvas.height}`);
  }

  // ── Perda de contexto: Weydra não sabe reconstruir recursos GL ─────────
  // O guard tem que trocar a sessão para o Pixi em vez de deixar um quadro
  // congelado (o caminho antigo não fazia nada: nenhum aviso, nenhum erro).
  await bigPage.evaluate(() => {
    const canvas = document.querySelector('#weydra-canvas');
    const gl = canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await bigPage.waitForFunction(() => Boolean(window._app && document.querySelector('#pixi-canvas')), null, { timeout: 60_000 });
  const afterLoss = await bigPage.evaluate(() => ({
    errorScreen: document.querySelector('.orbital-error-screen')?.textContent?.slice(0, 120) ?? null,
    pixiCanvas: Boolean(document.querySelector('#pixi-canvas')),
  }));
  if (!afterLoss.pixiCanvas) throw new Error('perda de contexto não recuperou no Pixi');
  if (afterLoss.errorScreen) throw new Error(`recuperação de contexto terminou em tela de erro: ${afterLoss.errorScreen}`);
  if (bigErrors.length > 0) throw new Error(`erros durante a recuperação de contexto: ${bigErrors.join(' | ')}`);
  await bigContext.close();

  console.log('PASS — menu and live-match Pixi → Weydra → Pixi switches preserved world identity without reload.');
  console.log(`PASS — Weydra/WebGL2 renderizou em ${bigCanvas.width}x${bigCanvas.height} (limite ${bigCanvas.limit}) e recuperou a sessão no Pixi após context loss.`);
} finally {
  await browser.close();
}
