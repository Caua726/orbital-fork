#!/usr/bin/env node
/**
 * Fog parity gate.
 *
 * Guards the two ways the fog-of-war diverged between the engines:
 *
 *  1. The Pixi canvas fog is redrawn every `fogThrottle` frames with
 *     `rgba(2,5,16, fogAlpha)` — without a `clearRect` first, source-over
 *     composites over the previous frame and the canvas converges to fully
 *     opaque navy (measured alpha 0.996→1.000 with fogAlpha 0.75). The fog
 *     then hides stars/suns/planets outside vision while the weydra shader
 *     keeps them faintly visible.
 *  2. The weydra fog pass blends in LINEAR space (sRGB surface view) while the
 *     canvas composites in sRGB space, so the same `fogAlpha` used to land on
 *     a visibly different colour for the whole fogged area.
 *
 * Asserts, with a seeded world and the same camera on both engines:
 *   - the fogged-space colour matches between engines (each channel within 4);
 *   - the Pixi fog canvas keeps the configured alpha (0.75 ± 0.05), i.e. the
 *     clearRect is still there;
 *   - a sun behind the fog is still visible (dimmed), not erased by it.
 *
 * Usage: ORBITAL_DEV_URL=http://127.0.0.1:4173/orbital-fork/ node tests/fog-parity-smoke.mjs
 */
import * as fs from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = (process.env.ORBITAL_DEV_URL ?? 'http://localhost:4173/orbital-fork/').replace(/\/$/, '/');
const SEED = 4242;
const TOLERANCIA_CANAL = 4;
const ALPHA_NOMINAL = 0.75;
const ALPHA_TOLERANCIA = 0.05;
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ?? (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
// Permite rodar o mesmo gate em outro driver (ex.: ORBITAL_CHROME_ARGS="--use-angle=vulkan").
const EXTRA_ARGS = (process.env.ORBITAL_CHROME_ARGS ?? '').split(' ').filter(Boolean);
// Backend do Weydra sob teste: webgl2 (padrão) ou webgpu (com as flags do Chromium).
const WEYDRA_BACKEND = process.env.ORBITAL_WEYDRA_BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';

const browser = await chromium.launch({
  headless: true,
  ...(systemChromium ? { executablePath: systemChromium } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', ...EXTRA_ARGS],
});

const amostras = {};

async function medir(engine) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ eng, seed, backend }) => {
    // Mesmo mundo nas duas engines: worldgen consome Math.random.
    let s = seed >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    localStorage.setItem('orbital_config', JSON.stringify({
      rendering: { engine: eng, pixi: { backend: 'webgl' }, weydra: { backend } },
    }));
  }, { eng: engine, seed: SEED, backend: WEYDRA_BACKEND });

  const page = await context.newPage();
  const erros = [];
  const logs = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => Boolean(window._app && (document.querySelector('#pixi-canvas') || document.querySelector('#weydra-canvas'))),
    null,
    { timeout: 30_000 },
  );
  await page.locator('.menu-btn.primary').click();
  await page.locator('.new-world-modal .nwm-input').first().fill('Fog parity');
  for (let passo = 0; passo < 5; passo++) await page.locator('.new-world-modal .nwm-btn.primary').click();
  await page.waitForFunction(() => Boolean(window.__mundo?.()?.planetas?.length), null, { timeout: 120_000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen.visible'), null, { timeout: 120_000 });
  await page.evaluate(() => window.__test.speed(0));

  const alvo = await page.evaluate(() => {
    const mundo = window.__mundo();
    const home = mundo.planetas.find((p) => p.dados.dono === 'jogador');
    const sistema = mundo.sistemas.find((s) => s.planetas.includes(home));
    return {
      home: { x: Math.round(home.x), y: Math.round(home.y) },
      sol: { x: Math.round(sistema.sol.x), y: Math.round(sistema.sol.y) },
    };
  });

  const amostrar = async (x, y, zoom) => {
    await page.evaluate(([cx, cy, z]) => { window.__setCam(cx, cy); window.__setZoom(z); }, [x, y, zoom]);
    await page.waitForTimeout(1200);
    const png = PNG.sync.read(await page.screenshot({ clip: { x: 350, y: 200, width: 900, height: 500 } }));
    const pixel = (px, py) => {
      const i = (py * png.width + px) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    return { centro: pixel(450, 250), canto: pixel(20, 20) };
  };

  const nevoa = await amostrar(alvo.home.x + 20000, alvo.home.y + 20000, 0.5);
  const sol = await amostrar(alvo.sol.x, alvo.sol.y, 1.2);
  const canvasAlpha = await page.evaluate(() => {
    const mundo = window.__mundo();
    const sprite = (mundo.visaoContainer?.children ?? []).find((c) => c.texture?.source?.resource?.getContext);
    if (!sprite) return null;
    const canvas = sprite.texture.source.resource;
    const d = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return +(d[3] / 255).toFixed(3);
  });

  await context.close();
  return { nevoa, sol, canvasAlpha, erros, logs };
}

try {
  for (const engine of ['pixi', 'weydra']) amostras[engine] = await medir(engine);

  const falhas = [];
  const { pixi, weydra } = amostras;

  for (const engine of ['pixi', 'weydra']) {
    if (amostras[engine].erros.length) falhas.push(`${engine}: erros de página: ${amostras[engine].erros.join(' | ')}`);
  }

  // Quando o backend do Weydra é pedido explicitamente, exigir que ele tenha
  // sido o efetivo — um fallback silencioso para WebGL2 faria o gate passar
  // medindo o backend errado.
  if (WEYDRA_BACKEND !== 'auto') {
    const inicializou = weydra.logs.find((l) => l.includes('renderer initialized'));
    if (!inicializou?.includes(`(${WEYDRA_BACKEND})`)) {
      falhas.push(`pediu weydra backend=${WEYDRA_BACKEND} mas o loader reportou: ${inicializou ?? 'nenhum log de init'}`);
    }
  }

  // 1. Cor da névoa fora da visão igual nas duas engines.
  const deltas = [0, 1, 2].map((c) => Math.abs(pixi.nevoa.centro[c] - weydra.nevoa.centro[c]));
  const maiorDelta = Math.max(...deltas);
  if (maiorDelta > TOLERANCIA_CANAL) {
    falhas.push(
      `névoa divergente entre engines: pixi=${pixi.nevoa.centro} weydra=${weydra.nevoa.centro} (Δ maior ${maiorDelta} > ${TOLERANCIA_CANAL})`,
    );
  }

  // 2. O canvas do Pixi mantém o alpha configurado (regressão do clearRect).
  if (pixi.canvasAlpha === null) {
    falhas.push('canvas de névoa do Pixi não encontrado para medir o alpha');
  } else if (Math.abs(pixi.canvasAlpha - ALPHA_NOMINAL) > ALPHA_TOLERANCIA) {
    falhas.push(
      `alpha do canvas de névoa = ${pixi.canvasAlpha} (esperado ${ALPHA_NOMINAL} ± ${ALPHA_TOLERANCIA}) — clearRect ausente?`,
    );
  }

  // 3. Sol atrás da névoa continua visível (dim), não apagado.
  for (const engine of ['pixi', 'weydra']) {
    const { sol, nevoa } = amostras[engine];
    const brilhoSol = sol.centro[0] + sol.centro[1] + sol.centro[2];
    const brilhoNevoa = nevoa.centro[0] + nevoa.centro[1] + nevoa.centro[2];
    if (brilhoSol - brilhoNevoa < 60) {
      falhas.push(`${engine}: sol atrás da névoa sumiu (sol=${sol.centro} névoa=${nevoa.centro})`);
    }
  }

  console.log(`weydra backend: ${WEYDRA_BACKEND}`);
  console.log(`pixi   : névoa=${pixi.nevoa.centro} sol=${pixi.sol.centro} canvasAlpha=${pixi.canvasAlpha}`);
  console.log(`weydra : névoa=${weydra.nevoa.centro} sol=${weydra.sol.centro} canvasAlpha=${weydra.canvasAlpha}`);
  console.log(`delta da névoa entre engines: ${maiorDelta} (limite ${TOLERANCIA_CANAL})`);

  if (falhas.length) {
    console.error('FALHOU — paridade da névoa:');
    for (const f of falhas) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('PASS — névoa com a mesma cor nas duas engines, alpha configurado respeitado e sol visível através dela.');
  }
} finally {
  await browser.close();
}
