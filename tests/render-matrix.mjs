#!/usr/bin/env node
/**
 * Render matrix — every in-canvas element, one layer at a time, on every
 * engine × backend × driver, diffed against the Pixi/WebGL hardware reference.
 *
 * For each VARIANT (engine/backend on a Chromium driver profile) it boots the
 * same seeded match, freezes every clock (`window.__render.freeze`), then for
 * each SCENE moves the camera, sets the layer mask (`window.__render.setLayers`)
 * and screenshots the canvas with all DOM chrome hidden. Then:
 *   - compares each capture with the reference variant (Pixi/WebGL on the real
 *     GPU — the renderer the game shipped with) and with the same engine on the
 *     real GPU (separates "engine differs" from "driver differs");
 *   - records the driver each page REALLY got (WebGL renderer string, WebGPU
 *     adapter) and marks the variant INVALID when a hardware profile fell back
 *     to software or the engine fell back to another backend;
 *   - writes test-results/render-matrix/{report.html,report.json} + PNGs.
 *
 * Usage (needs `vite preview` or `vite dev` up):
 *   ORBITAL_DEV_URL=http://127.0.0.1:4173/orbital-fork/ node tests/render-matrix.mjs
 * Env:
 *   ORBITAL_MATRIX_VARIANTS  comma list of variant ids to run (default: all)
 *   ORBITAL_MATRIX_SCENES    comma list of scene ids to run (default: all)
 *   ORBITAL_MATRIX_OUT       output dir (default test-results/render-matrix)
 *   ORBITAL_BASELINE_URL     pre-weydra build (tests/baseline/prepare-baseline.mjs);
 *                            when set it becomes the reference
 *   PLAYWRIGHT_CHROMIUM_PATH Chromium binary (default /usr/bin/chromium if present)
 *
 * Exit code is non-zero when the reference can't be captured, a variant
 * crashes, or a valid variant DIVERGES from its same-engine GPU path or its
 * Pixi twin without a documented exception (EXCECOES). Differences against the
 * pre-weydra baseline are reported, with the intended ones explained
 * (ESPERADAS_BASELINE).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { SCENES, prepararFixtures, posicionar } from '../public/render-lab/cenas.mjs';

const BASE = (process.env.ORBITAL_DEV_URL ?? 'http://localhost:4173/orbital-fork/').replace(/\/?$/, '/');
const OUT = path.resolve(process.env.ORBITAL_MATRIX_OUT ?? path.join(import.meta.dirname, '..', 'test-results', 'render-matrix'));
const SEED = 20261018;
const VIEW = { width: 1280, height: 720 };
// A hung variant (e.g. a mid-session engine recovery while the harness keeps
// the sim frozen) must not hold the whole run: close its browser and move on.
const VARIANT_TIMEOUT_MS = 5 * 60_000;
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ?? (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

// ── Driver profiles ───────────────────────────────────────────────────────
// `expect` is checked against the strings the page actually reports, so a
// hardware profile that silently landed on SwiftShader can't pass as hardware.
const LAVAPIPE_ICD = ['/usr/share/vulkan/icd.d/lvp_icd.json', '/usr/share/vulkan/icd.d/lvp_icd.x86_64.json']
  .find((f) => fs.existsSync(f));
const PROFILES = {
  'hw-vulkan': {
    label: 'GPU real · ANGLE/Vulkan + Dawn/Vulkan',
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu'],
    expectWebgl: (s) => !/swiftshader|llvmpipe/i.test(s),
    expectWebgpu: (a) => a && !a.isFallbackAdapter && a.architecture !== 'swiftshader',
  },
  'hw-gl': {
    label: 'GPU real · ANGLE/OpenGL',
    args: ['--use-angle=gl', '--enable-unsafe-webgpu'],
    expectWebgl: (s) => !/swiftshader|llvmpipe/i.test(s),
    expectWebgpu: (a) => a && !a.isFallbackAdapter && a.architecture !== 'swiftshader',
  },
  'sw-swiftshader': {
    label: 'Software · SwiftShader',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
    expectWebgl: (s) => /swiftshader/i.test(s),
    expectWebgpu: (a) => a && (a.isFallbackAdapter || a.architecture === 'swiftshader'),
  },
  'sw-llvmpipe': {
    label: 'Software · Mesa llvmpipe (ANGLE/Vulkan sobre lavapipe)',
    args: ['--use-angle=vulkan', '--enable-features=Vulkan'],
    env: LAVAPIPE_ICD ? { VK_ICD_FILENAMES: LAVAPIPE_ICD } : null,
    expectWebgl: (s) => /llvmpipe/i.test(s),
    expectWebgpu: () => false,
  },
};

// ── Variants ──────────────────────────────────────────────────────────────
// With ORBITAL_BASELINE_URL (the pre-weydra game, built by
// tests/baseline/prepare-baseline.mjs) the baseline on the real GPU is the
// reference: it is what the game looked like before the migration. Without
// it, today's Pixi/WebGL on the real GPU stands in.
const BASELINE_URL = process.env.ORBITAL_BASELINE_URL?.replace(/\/?$/, '/');
const REFERENCE = BASELINE_URL ? 'baseline-webgl@hw-vulkan' : 'pixi-webgl@hw-vulkan';
const ALL_VARIANTS = [
  ...(BASELINE_URL ? [['baseline', 'webgl', 'hw-vulkan']] : []),
  ['pixi', 'webgl', 'hw-vulkan'],
  ['pixi', 'webgl', 'hw-gl'],
  ['pixi', 'webgl', 'sw-swiftshader'],
  ['pixi', 'webgl', 'sw-llvmpipe'],
  ['pixi', 'webgpu', 'hw-vulkan'],
  ['pixi', 'webgpu', 'sw-swiftshader'],
  ['pixi', 'canvas', 'hw-vulkan'],
  ['pixi', 'canvas', 'sw-swiftshader'],
  ['weydra', 'webgl2', 'hw-vulkan'],
  ['weydra', 'webgl2', 'hw-gl'],
  ['weydra', 'webgl2', 'sw-swiftshader'],
  ['weydra', 'webgl2', 'sw-llvmpipe'],
  ['weydra', 'webgpu', 'hw-vulkan'],
  ['weydra', 'webgpu', 'sw-swiftshader'],
  // Canvas2D/CPU backend: no GPU API involved, the driver profile only
  // changes how Chromium composites the 2D canvas.
  ['weydra', 'software', 'hw-vulkan'],
  ['weydra', 'software', 'sw-swiftshader'],
  // Same variant captured again: the harness's own noise floor. Anything
  // these two show as different is NOT a renderer difference.
  ['pixi', 'webgl', 'hw-vulkan', 'repetição'],
  ['weydra', 'webgl2', 'hw-vulkan', 'repetição'],
].map(([engine, backend, profile, rep]) => ({
  id: `${engine}-${backend}@${profile}${rep ? `#${rep}` : ''}`, engine, backend, profile, repeatOf: rep ? `${engine}-${backend}@${profile}` : null,
}));

/** Same engine on the real GPU — the "driver-only" baseline for a variant. */
function sameEngineBaseline(v) {
  if (v.repeatOf) return v.repeatOf;
  if (v.engine === 'baseline') return null;
  if (v.engine === 'pixi') return 'pixi-webgl@hw-vulkan';
  // CPU backends compare against the GPU path of the same engine.
  if (v.backend === 'software') return 'weydra-webgl2@hw-vulkan';
  return `weydra-${v.backend}@hw-vulkan`;
}

/** The Pixi variant a Weydra variant must look like (same driver profile). */
function pixiTwin(v) {
  if (v.engine !== 'weydra' || v.repeatOf) return null;
  const backend = { webgl2: 'webgl', webgpu: 'webgpu', software: 'canvas' }[v.backend];
  return backend ? `pixi-${backend}@${v.profile}` : null;
}

// ── Parity gate ───────────────────────────────────────────────────────────
// Engines and backends must look the same ("not pixel-perfect, but working
// the same"): a valid variant that DIVERGES from its same-engine GPU path or
// from its Pixi twin fails the run, unless an exception below explains it.
const EXCECOES = [
  {
    variantes: /@sw-|software|canvas/,
    cenas: ['sol', 'sistema'],
    motivo: 'o corpo do sol usa um hash com sin(); CPU e rasterizadores por software têm outra precisão — mesma aparência, outro padrão de células',
  },
  {
    variantes: /canvas|software/,
    cenas: ['orbitas', 'rota', 'anel-planeta', 'naves-selecionadas'],
    motivo: 'o Canvas2D sempre suaviza (antialias) linhas finas e a GPU não; imitar o serrilhado exigiria reler e regravar o quadro inteiro a cada frame',
  },
  {
    variantes: /pixi-canvas/,
    cenas: ['sol', 'planeta-zoom-baixo', 'nevoa-sobre-mundo', 'cena-completa-longe'],
    motivo: 'o renderer Canvas do Pixi não tem filtros: a meia resolução dos planetas é por sprite, com a grade alinhada ao sprite e não à tela — bordas de bloco deslocadas 1 px (mesma imagem, ver report)',
  },
];
// Known, intended differences against the pre-weydra reference (d51623e).
const ESPERADAS_BASELINE = {
  sol: 'ruído do hash com sin() do corpo do sol (o sol tem a mesma forma, coroa e cores)',
  sistema: 'a baseline cortava/deslocava o sol em zoom ≤ 0,5 (vertex shader sem uWorldTransformMatrix dentro do filtro) — corrigido',
  fantasma: 'a baseline perdia a silhueta do fantasma pelo mesmo bug do filtro — corrigido',
  'anel-planeta': 'o anel do planeta nunca aparecia na baseline (herdava a escala do planeta) — agora visível nas duas engines, por decisão do usuário',
};
function excecao(variantId, cena) {
  return EXCECOES.find((e) => e.variantes.test(variantId) && e.cenas.includes(cena)) ?? null;
}

// ── Scenes ────────────────────────────────────────────────────────────────
// Shared with the interactive render lab: public/render-lab/cenas.mjs.

// ── Pixel metrics ─────────────────────────────────────────────────────────
function metrics(png) {
  let painted = 0, lum = 0, lum2 = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (r > 8 || g > 8 || b > 8) painted++;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum += l;
    lum2 += l * l;
  }
  const n = png.width * png.height;
  const mean = lum / n;
  return { painted: painted / n, lum: mean, lumStd: Math.sqrt(Math.max(0, lum2 / n - mean * mean)) };
}

function compare(a, b, diffPath) {
  if (a.width !== b.width || a.height !== b.height) return { error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const diff = new PNG({ width: a.width, height: a.height });
  let d3 = 0, d16 = 0, sum = 0, conteudo = 0, d16c = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const m = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    sum += m;
    if (m >= 3) d3++;
    if (m >= 16) d16++;
    // "Content": anything visibly lit in either image (≥ 24 in a channel —
    // above the fog's dark navy). Sparse elements (stars, lines, ships) are
    // a tiny share of the frame, so they're judged against their own pixels.
    const lit = Math.max(a.data[i], a.data[i + 1], a.data[i + 2], b.data[i], b.data[i + 1], b.data[i + 2]) >= 24;
    if (lit) {
      conteudo++;
      if (m >= 16) d16c++;
    }
    const gray = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 12;
    diff.data[i] = m >= 16 ? 255 : gray;
    diff.data[i + 1] = m >= 16 ? 0 : (m >= 3 ? 200 : gray);
    diff.data[i + 2] = m >= 16 ? 64 : gray;
    diff.data[i + 3] = 255;
  }
  if (diffPath) fs.writeFileSync(diffPath, PNG.sync.write(diff));
  const n = a.width * a.height;
  return { d3: d3 / n, d16: d16 / n, mean: sum / n, d16rel: conteudo ? d16c / conteudo : 0, conteudo: conteudo / n };
}

/**
 * Purely pixel-based, the worse of two measures of pixels whose worst
 * channel differs by ≥16: share of the whole frame, and share of the lit
 * content (so a missing starfield can't hide behind a 0.3 % frame share).
 */
function verdict(cmp) {
  if (!cmp || cmp.error) return 'n/a';
  if (cmp.d16 >= 0.03 || cmp.d16rel >= 0.25) return 'diverge';
  if (cmp.d16 >= 0.005 || cmp.d16rel >= 0.08) return 'próximo';
  return 'igual';
}

// ── Capture one variant ───────────────────────────────────────────────────
async function captureVariant(v, scenes) {
  const prof = PROFILES[v.profile];
  const dir = path.join(OUT, v.id);
  fs.mkdirSync(dir, { recursive: true });
  const result = { ...v, profileLabel: prof.label, scenes: {}, errors: [], warnings: [], gpu: null, info: null, valid: true };
  if (prof.env === null) {
    result.valid = false;
    result.invalidReason = 'driver indisponível nesta máquina';
    return result;
  }
  const browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? { executablePath: systemChromium } : {}),
    env: { ...process.env, ...(prof.env ?? {}) },
    args: ['--enable-webgl', '--ignore-gpu-blocklist', ...prof.args],
  });
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    browser.close().catch(() => {});
  }, VARIANT_TIMEOUT_MS);
  try {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    await context.addInitScript(({ seed, engine, backend }) => {
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const rendering = engine === 'pixi'
        ? { engine, pixi: { backend, webglVersion: 'auto', gpuPreference: 'high-performance' }, weydra: { backend: 'auto' } }
        : { engine, pixi: { backend: 'webgl' }, weydra: { backend } };
      localStorage.setItem('orbital_config', JSON.stringify({ rendering, graphics: { scanlines: false, mostrarFps: false, mostrarRam: false } }));
      // Only the game canvas may paint into the screenshot.
      const css = 'body *{visibility:hidden !important} [data-matrix-keep]{visibility:visible !important}';
      document.addEventListener('orbital:matrix-hide-dom', () => {
        // The game canvas (Pixi's, or the weydra canvas behind the shim).
        window._app?.canvas?.setAttribute('data-matrix-keep', '');
        const st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);
      });
    }, { seed: SEED, engine: v.engine, backend: v.backend });

    const page = await context.newPage();
    page.on('pageerror', (e) => result.errors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') result.errors.push(`console: ${m.text().slice(0, 300)}`);
    });
    await page.goto(v.engine === 'baseline' ? BASELINE_URL : BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window._app && window.__render), null, { timeout: 60_000 });

    const fatal = async () => page.locator('.orbital-error-screen').textContent({ timeout: 200 }).catch(() => null);
    const f0 = await fatal();
    if (f0) throw new Error(`tela de erro no boot: ${f0.slice(0, 300)}`);

    // New match through the real UI; pacifico = no AI (no AI ships, no AI RNG).
    // Frozen before the world exists, so no frame-timing drift (see
    // iniciarPartida in cenas.mjs).
    await page.evaluate(() => window.__render.freeze(10));
    await page.locator('.menu-btn.primary').click();
    await page.locator('.new-world-modal .nwm-input').first().fill('Render Matrix');
    for (let passo = 0; passo < 5; passo++) {
      await page.evaluate(() => {
        for (const sel of document.querySelectorAll('.new-world-modal select')) {
          if ([...sel.options].some((o) => o.value === 'pacifico') && sel.value !== 'pacifico') {
            sel.value = 'pacifico';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
      await page.locator('.new-world-modal .nwm-btn.primary').click();
    }
    await page.waitForFunction(() => Boolean(window.__mundo?.()?.planetas?.length), null, { timeout: 120_000 });
    await page.waitForFunction(() => !document.querySelector('.loading-screen.visible'), null, { timeout: 120_000 });
    await page.evaluate(() => window.__render.freeze(10));

    result.info = await page.evaluate(() => window.__render.info());
    result.gpu = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') ?? c.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const webgl = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null;
      let webgpu = null;
      try {
        const a = await navigator.gpu?.requestAdapter();
        if (a) webgpu = { vendor: a.info?.vendor, architecture: a.info?.architecture, isFallbackAdapter: !!a.info?.isFallbackAdapter };
      } catch { /* no WebGPU */ }
      return { webgl, webgpu };
    });

    // Validity: engine backend and driver must be what the variant claims.
    const effective = result.info?.effective;
    if (v.engine === 'baseline' && !prof.expectWebgl(result.gpu.webgl ?? '')) {
      result.valid = false;
      result.invalidReason = `driver WebGL não é do perfil: ${result.gpu.webgl}`;
    } else if (v.engine === 'baseline') {
      // Pre-weydra build: Pixi only, no engine selector to verify.
    } else if (effective !== v.backend) {
      result.valid = false;
      result.invalidReason = `engine caiu de ${v.backend} para ${effective}`;
    } else if (v.backend === 'webgpu' && !prof.expectWebgpu(result.gpu.webgpu)) {
      result.valid = false;
      result.invalidReason = `adapter WebGPU não é do perfil: ${JSON.stringify(result.gpu.webgpu)}`;
    } else if (v.backend !== 'webgpu' && v.backend !== 'canvas' && v.backend !== 'software'
      && !prof.expectWebgl(result.gpu.webgl ?? '')) {
      result.valid = false;
      result.invalidReason = `driver WebGL não é do perfil: ${result.gpu.webgl}`;
    }

    // Deterministic world fixtures, computed once while frozen.
    const ctx = await page.evaluate(prepararFixtures);

    await page.evaluate(() => document.dispatchEvent(new Event('orbital:matrix-hide-dom')));

    const shoot = async (scene, cam) => {
      await page.evaluate(posicionar, cam);
      await page.waitForTimeout(250);
      const buf = await page.screenshot();
      fs.writeFileSync(path.join(dir, `${scene.id}.png`), buf);
      return buf;
    };

    const layerBits = await page.evaluate(() => ({ ...window.__render.LAYER, ALL_BITS: window.__render.ALL }));
    for (const scene of scenes) {
      try {
        if (scene.prepare) {
          const { patch, aviso } = await page.evaluate(scene.prepare, { ctx });
          Object.assign(ctx, patch);
          if (aviso) result.warnings.push(aviso);
        }
        const cam = await page.evaluate(scene.setup, { L: layerBits, ctx });
        if (!cam) {
          result.scenes[scene.id] = { skipped: 'pré-condição não satisfeita' };
          continue;
        }
        await shoot(scene, cam);
        if (scene.teardown) {
          await page.evaluate(scene.teardown, { ctx });
        }
        result.scenes[scene.id] = { file: `${v.id}/${scene.id}.png` };
        const f = await fatal();
        if (f) throw new Error(`tela de erro na cena ${scene.id}: ${f.slice(0, 300)}`);
      } catch (err) {
        result.scenes[scene.id] = { error: String(err.message ?? err).slice(0, 400) };
        if (/tela de erro/.test(String(err.message))) throw err;
      }
    }
    await page.evaluate(() => window.__render.setLayers(window.__render.ALL));
  } catch (err) {
    result.crash = timedOut
      ? `tempo esgotado (${VARIANT_TIMEOUT_MS / 60_000} min) — variante travou`
      : String(err.message ?? err).slice(0, 800);
  } finally {
    clearTimeout(watchdog);
    await browser.close().catch(() => {});
  }
  return result;
}

// ── Report ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function writeReport(results, scenes) {
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  const load = (r, sid) => {
    const f = r?.scenes?.[sid]?.file;
    return f && fs.existsSync(path.join(OUT, f)) ? PNG.sync.read(fs.readFileSync(path.join(OUT, f))) : null;
  };
  for (const r of results) {
    for (const s of scenes) {
      const entry = r.scenes[s.id];
      if (!entry?.file) continue;
      const img = load(r, s.id);
      entry.metrics = metrics(img);
      for (const [key, baseId] of [['vsRef', REFERENCE], ['vsEngine', sameEngineBaseline(r)], ['vsPixi', pixiTwin(r)]]) {
        if (!baseId || baseId === r.id) continue;
        const base = byId[baseId];
        const bimg = load(base, s.id);
        if (!bimg) continue;
        const diffFile = `${r.id}/${s.id}.diff-${key}.png`;
        const cmp = compare(img, bimg, path.join(OUT, diffFile));
        entry[key] = { ...cmp, base: baseId, diff: diffFile, verdict: verdict(cmp) };
      }
    }
  }
  // A full scene with almost nothing painted means the capture itself failed
  // (canvas hidden, renderer dead) — never let that pass as a comparison.
  for (const r of results) {
    const full = r.scenes['cena-completa-longe']?.metrics;
    if (full && full.painted < 0.01 && r.valid) {
      r.valid = false;
      r.invalidReason = `captura vazia (cena completa com ${(full.painted * 100).toFixed(2)}% pintado)`;
    } else if (full && full.lumStd < 1 && r.valid) {
      // One flat colour (e.g. a WebGPU canvas the browser never presents,
      // showing the page background) — not a frame of the game.
      r.valid = false;
      r.invalidReason = `captura uniforme (lum ${full.lum.toFixed(0)}, desvio ${full.lumStd.toFixed(2)}): o canvas não foi apresentado`;
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ reference: REFERENCE, seed: SEED, view: VIEW, results }, null, 2));

  const cls = { igual: 'ok', próximo: 'near', diverge: 'bad', 'n/a': 'na' };
  const pct = (x) => (x === undefined ? '—' : `${(x * 100).toFixed(2)}%`);
  const cell = (r, s) => {
    const e = r.scenes?.[s.id];
    if (!e) return '<td class="na">—</td>';
    if (e.error) return `<td class="bad" title="${esc(e.error)}">erro</td>`;
    if (e.skipped) return `<td class="na" title="${esc(e.skipped)}">pulada</td>`;
    const c = e.vsRef ?? (r.id === REFERENCE ? { verdict: 'ref' } : null);
    if (!c) return '<td class="na">sem ref</td>';
    if (c.verdict === 'ref') return `<td class="ref"><a href="#${esc(s.id)}">ref</a></td>`;
    return `<td class="${cls[c.verdict]}"><a href="#${esc(s.id)}">${esc(c.verdict)}</a><br><small>${pct(c.d16)} Δ≥16</small></td>`;
  };
  const head = `<tr><th>cena</th>${results.map((r) => `<th class="${r.valid && !r.crash ? '' : 'inv'}">${esc(r.id)}</th>`).join('')}</tr>`;
  const rows = scenes.map((s) => `<tr><th>${esc(s.title)}</th>${results.map((r) => cell(r, s)).join('')}</tr>`).join('');
  const variants = results.map((r) => `<tr class="${r.valid && !r.crash ? '' : 'inv'}"><td>${esc(r.id)}</td><td>${esc(r.profileLabel)}</td>
    <td>${esc(r.info ? `${r.info.engine} ${r.info.requested}→${r.info.effective}` : '—')}</td>
    <td><small>${esc(r.gpu?.webgl)}</small></td><td><small>${esc(JSON.stringify(r.gpu?.webgpu))}</small></td>
    <td>${r.crash ? `<b>CRASH</b>: ${esc(r.crash)}` : r.valid ? 'ok' : `<b>INVÁLIDA</b>: ${esc(r.invalidReason)}`}
    ${r.warnings.length ? `<br><small>${esc(r.warnings.join(' · '))}</small>` : ''}
    ${r.errors.length ? `<details><summary>${r.errors.length} erro(s) no console</summary><pre>${esc(r.errors.slice(0, 20).join('\n'))}</pre></details>` : ''}</td></tr>`).join('');
  const galleries = scenes.map((s) => `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${ESPERADAS_BASELINE[s.id] && BASELINE_URL ? `<p><small>Diferença esperada contra a baseline: ${esc(ESPERADAS_BASELINE[s.id])}</small></p>` : ''}<div class="grid">
    ${results.map((r) => {
      const e = r.scenes?.[s.id];
      if (!e?.file) return `<figure><div class="ph">${esc(e?.error ?? e?.skipped ?? r.crash ?? '—')}</div><figcaption>${esc(r.id)}</figcaption></figure>`;
      const c = e.vsRef;
      const ce = e.vsEngine;
      return `<figure><a href="${esc(e.file)}"><img loading="lazy" src="${esc(e.file)}"></a>
        ${c ? `<a href="${esc(c.diff)}"><img loading="lazy" class="diff" src="${esc(c.diff)}"></a>` : ''}
        <figcaption><b>${esc(r.id)}</b><br>
        ${c ? `vs ref: <span class="${cls[c.verdict]}">${esc(c.verdict)}</span> Δ≥16 ${pct(c.d16)} do quadro · ${pct(c.d16rel)} do conteúdo · média ${c.mean.toFixed(2)}<br>` : r.id === REFERENCE ? 'REFERÊNCIA<br>' : ''}
        ${ce ? `vs ${esc(ce.base)}: <span class="${cls[ce.verdict]}">${esc(ce.verdict)}</span> Δ≥16 ${pct(ce.d16)}<br>` : ''}
        ${e.vsPixi ? `vs ${esc(e.vsPixi.base)}: <span class="${cls[e.vsPixi.verdict]}">${esc(e.vsPixi.verdict)}</span> Δ≥16 ${pct(e.vsPixi.d16)}<br>` : ''}
        ${excecao(r.id, s.id) ? `<small>exceção: ${esc(excecao(r.id, s.id).motivo)}</small><br>` : ''}
        cobertura ${pct(e.metrics.painted)} · lum ${e.metrics.lum.toFixed(1)}</figcaption></figure>`;
    }).join('')}</div></section>`).join('');

  const html = `<!doctype html><meta charset="utf-8"><title>Orbital — matriz de render</title>
<style>
body{background:#111;color:#ddd;font:13px system-ui;margin:20px}a{color:#8cf}
table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #333;padding:4px 6px;text-align:center;vertical-align:top}
th{background:#1b1b1b}.ok{background:#173d1f}.near{background:#3d3a17}.bad{background:#4a1818}.na{color:#777}.ref{background:#1d2c45}
.inv{opacity:.55;text-decoration:line-through}td small{color:#aaa}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}figure{margin:0;background:#1a1a1a;padding:6px}
figure img{width:100%;display:block;image-rendering:pixelated}figure img.diff{margin-top:3px;opacity:.9}.ph{height:120px;display:flex;align-items:center;justify-content:center;color:#a66;padding:8px}
figcaption{font-size:11px;line-height:1.5}pre{white-space:pre-wrap;text-align:left;max-width:600px}
</style>
<h1>Orbital — matriz de render</h1>
<p>Referência: <b>${esc(REFERENCE)}</b> (${BASELINE_URL ? 'o jogo antes da migração para o Weydra, Pixi/WebGL na GPU real' : 'Pixi/WebGL atual na GPU real'}). Mundo semeado (${SEED}), ${VIEW.width}×${VIEW.height}, relógios congelados.
Toda cena é comparada só por pixels (simulação em passos fixos, sem tempo real), pela pior de duas medidas dos pixels com Δ≥16: fração do quadro e fração do conteúdo aceso (canal ≥ 24 em qualquer lado). <span class="bad">diverge</span> ≥3% do quadro ou ≥25% do conteúdo · <span class="near">próximo</span> ≥0,5% ou ≥8% · <span class="ok">igual</span> abaixo disso.
Diff: vermelho = Δ≥16, verde = Δ≥3.</p>
<h2>Variantes (driver efetivo)</h2>
<table><tr><th>variante</th><th>perfil</th><th>engine</th><th>WebGL renderer</th><th>WebGPU adapter</th><th>status</th></tr>${variants}</table>
<h2>Resumo vs referência</h2><table>${head}${rows}</table>
${galleries}`;
  fs.writeFileSync(path.join(OUT, 'report.html'), html);
}

// ── Main ──────────────────────────────────────────────────────────────────
const want = (env, all) => {
  const list = (process.env[env] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? all.filter((x) => list.includes(x.id)) : all;
};
const variants = want('ORBITAL_MATRIX_VARIANTS', ALL_VARIANTS);
const scenes = want('ORBITAL_MATRIX_SCENES', SCENES);
if (!variants.some((v) => v.id === REFERENCE)) variants.unshift(ALL_VARIANTS.find((v) => v.id === REFERENCE));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
for (const v of variants) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${v.id.padEnd(28)} `);
  const r = await captureVariant(v, scenes);
  results.push(r);
  const ok = Object.values(r.scenes).filter((s) => s.file).length;
  console.log(`${r.crash ? 'CRASH' : r.valid ? 'ok   ' : 'INVÁLIDA'} ${ok}/${scenes.length} cenas · ${((Date.now() - t0) / 1000).toFixed(0)}s`
    + (r.crash ? ` — ${r.crash.slice(0, 160)}` : r.valid ? '' : ` — ${r.invalidReason}`));
}
writeReport(results, scenes);

console.log(`\nResumo vs ${REFERENCE} (Δ≥16 por cena):`);
for (const r of results) {
  if (r.id === REFERENCE) continue;
  const parts = scenes.map((s) => {
    const c = r.scenes[s.id]?.vsRef;
    return c ? `${s.id}=${c.verdict}(${(c.d16 * 100).toFixed(1)}%/${(c.d16rel * 100).toFixed(0)}%c)` : `${s.id}=${r.scenes[s.id]?.error ? 'erro' : '—'}`;
  });
  console.log(`  ${r.id}${r.valid ? '' : ' [INVÁLIDA]'}: ${parts.join(' ')}`);
}
console.log(`\nRelatório: ${path.join(OUT, 'report.html')}`);

// Parity gate over the comparisons between current engines/backends.
const falhas = [];
for (const r of results) {
  if (!r.valid || r.crash || r.repeatOf || r.engine === 'baseline') continue;
  for (const [cena, e] of Object.entries(r.scenes)) {
    for (const key of ['vsEngine', 'vsPixi']) {
      const c = e[key];
      // An exception covers the pair when either side is the variant it names.
      if (c?.verdict === 'diverge' && !excecao(r.id, cena) && !excecao(c.base, cena)) {
        falhas.push(`${r.id} ${cena} ${key}=${c.base} (${(c.d16 * 100).toFixed(1)}% do quadro, ${(c.d16rel * 100).toFixed(0)}% do conteúdo com Δ≥16)`);
      }
    }
  }
}
if (falhas.length) {
  console.error(`\nFAIL — divergência entre engines/backends sem exceção documentada:\n  ${falhas.join('\n  ')}`);
}

const ref = results.find((r) => r.id === REFERENCE);
const crashed = results.filter((r) => r.crash);
if (!ref || ref.crash || !ref.valid) {
  console.error('FAIL — a referência não foi capturada de forma válida.');
  process.exit(1);
}
if (crashed.length) {
  console.error(`FAIL — ${crashed.length} variante(s) quebraram: ${crashed.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
if (falhas.length) process.exit(1);
