/**
 * Determinism harness scene.
 *
 * Hidden boot path used by `weydra-renderer/tests/determinism/runner.mjs`
 * to render a single, fully-deterministic planet under either the legacy
 * Pixi GLSL shader path or the weydra WGSL live-shader path. The runner
 * captures the framebuffer of each backend and compares them — see the
 * companion README for pass/fail criteria.
 *
 * Activation: `?weydra_determinism_test=1` plus `&engine=pixi|weydra`.
 *
 * The harness:
 *  - bypasses the menu/world bootstrap entirely;
 *  - hides every HUD chrome element;
 *  - forces fixed graphics + weydra config (only the planet path of
 *    interest is on);
 *  - spawns ONE planet at world (0, 0), tipo=COMUM (planetType=0),
 *    seed=3.14, size=400px, with camera (0, 0) zoom 1, time 0;
 *  - renders one frame and stops the ticker so the framebuffer is
 *    stable for screenshot capture.
 *
 * Strictly additive: when the URL flag is absent this module is never
 * imported.
 */

import { Application, Container } from 'pixi.js';
import { setConfigDuranteBoot } from '../core/config';
import { TIPO_PLANETA } from './planeta';
import { criarPlanetaProceduralSprite, setAppReferenceForBake, precompilarShadersPlaneta } from './planeta-procedural';
import { startWeydra, getWeydraRenderer } from '../weydra-loader';

/** True when the URL contains ?weydra_determinism_test=1 */
export function isDeterminismMode(): boolean {
  if (typeof window === 'undefined') return false;
  const sp = new URLSearchParams(window.location.search);
  return sp.get('weydra_determinism_test') === '1';
}

/** "pixi" (default) | "weydra" — selects which planet path is exercised. */
export function determinismEngine(): 'pixi' | 'weydra' {
  const sp = new URLSearchParams(window.location.search);
  const v = sp.get('engine');
  return v === 'weydra' ? 'weydra' : 'pixi';
}

/**
 * Backend requested for the weydra side of the reference scene:
 * `?weydra_backend=webgpu|webgl2`, default `auto` (WebGPU when the browser
 * offers an adapter). The runner pins it so a WebGL2 fallback can't be
 * mistaken for a passing WebGPU capture.
 */
export function determinismWeydraBackend(): 'auto' | 'webgpu' | 'webgl2' {
  const v = new URLSearchParams(window.location.search).get('weydra_backend');
  return v === 'webgpu' || v === 'webgl2' ? v : 'auto';
}

/** Tiny mulberry32 PRNG so the palette draws are byte-identical between
 *  runs regardless of Math.random state. The shader path consumes ~10
 *  RNG calls (jitter, color variation, rotation, etc.) — feeding it a
 *  seeded PRNG is what makes the framebuffer reproducible. */
function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard reference-scene viewport. The runner sets the same value. */
const VIEW = 800;
const PLANET_SIZE = 400;
const PLANET_SEED = 3.14;
const PALETTE_RNG_SEED = 0xC0FFEE;

/** Hide every DOM HUD node so the screenshot only shows canvas pixels. */
function hideHud(): void {
  const style = document.createElement('style');
  style.textContent = `
    /* Determinism mode: kill every overlay so only the canvas paints. */
    html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
    #main-menu, .main-menu, .hud-root, .hud-banner-erro,
    .empire-badge, .resource-bar, .credits-bar, .minimap, .debug-menu,
    .planet-panel, .planet-drawer, .planet-modal, .ship-panel,
    .colonizer-panel, .colony-modal, .build-panel, .pause-menu,
    .save-modal, .toast, .loading-screen, .scanlines,
    .mobile-menu-btn, .mobile-planet-drawer, .star-drawer,
    .new-world-modal, .planet-details-modal, .confirm-dialog,
    .sidebar, .chat-log, .zoom-controls {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Run the determinism harness instead of the normal game bootstrap.
 * Returns when the reference frame is on screen (and the ticker is
 * stopped). The runner waits a fixed timeout, then screenshots.
 */
export async function rodarCenaDeterminismo(): Promise<void> {
  hideHud();

  const engine = determinismEngine();

  // setConfigDuranteBoot writes to localStorage. Without this snapshot
  // a user who ran the determinism test in their normal browser would
  // boot back into the game with planetsLive forced and every other
  // weydra subsystem disabled — silently corrupted graphics settings.
  // Restore the original blob on next paint so reloads see the user's
  // own config again.
  const STORAGE_KEY = 'orbital_config';
  const originalConfigBlob = (() => {
    try { return localStorage.getItem(STORAGE_KEY); }
    catch { return null; }
  })();
  const restoreOriginalConfig = (): void => {
    try {
      if (originalConfigBlob === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, originalConfigBlob);
    } catch { /* private mode or quota — give up silently */ }
  };
  // Best-effort: restore on unload too, in case the runner kills the
  // page before our requestAnimationFrame fires.
  window.addEventListener('beforeunload', restoreOriginalConfig);

  // Pin every config field that influences planet rendering. Only the
  // planet path of interest is enabled; everything else (starfield,
  // ships, etc.) is forced off so the framebuffer reflects the planet
  // alone. setConfigDuranteBoot is observer-free, so this won't trigger
  // a Pixi resize or a weydra subsystem (re)init mid-flight.
  setConfigDuranteBoot({
    // `rendering` is the source of truth: `alinharEngineAtomico` mirrors it into
    // the legacy `weydra.*` booleans and `weydra.backend`, so setting the legacy
    // mirror here would be overwritten.
    rendering: { weydra: { backend: determinismWeydraBackend() } },
    graphics: {
      qualidadeEfeitos: 'alto',
      shaderLive: true,
      mostrarFps: false,
      mostrarRam: false,
      scanlines: false,
      mostrarOrbitas: false,
      renderer: 'webgl',
      webglVersion: 'auto',
      gpuPreference: 'high-performance',
      renderScale: 1,
      vsync: true,
      fpsCap: 60,
    } as any,
    weydra: {
      starfield: false,
      ships: false,
      shipTrails: false,
      starfieldBright: false,
      planetsBaked: false,
      // Live planet path on ONLY when engine=weydra. The pixi path keeps
      // it off so criarPlanetaProceduralSprite picks the GLSL Mesh path.
      planetsLive: engine === 'weydra',
    } as any,
  });

  // Build the reference Pixi application. Fixed 800x800 canvas, no DPR
  // scaling, transparent background when weydra is in play (so the
  // wgpu canvas behind shows through).
  const app = new Application();
  await app.init({
    width: VIEW,
    height: VIEW,
    backgroundColor: 0x000000,
    backgroundAlpha: engine === 'weydra' ? 0 : 1,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
  });

  document.body.appendChild(app.canvas);
  app.canvas.style.position = 'fixed';
  app.canvas.style.top = '0';
  app.canvas.style.left = '0';
  app.canvas.style.width = `${VIEW}px`;
  app.canvas.style.height = `${VIEW}px`;
  app.canvas.style.zIndex = '1';

  setAppReferenceForBake(app);
  await precompilarShadersPlaneta(app);

  // Start the weydra renderer if we're in that engine mode. startWeydra
  // is a no-op when no weydra subsystem flag is on, so the pixi path
  // doesn't pay this cost.
  if (engine === 'weydra') {
    const started = await startWeydra();
    // The runner asserts this: a WebGPU capture that silently fell back to
    // WebGL2 would compare equal for the wrong reason.
    Object.assign(window, { __weydraDeterminismBackend: started.effectiveBackend });
  }

  // Camera: world (0, 0), zoom 1. Build a parent container that maps
  // world (0, 0) to the centre of the canvas. The planet itself is at
  // world (0, 0) so it lands dead-centre.
  const container = new Container();
  container.x = VIEW / 2;
  container.y = VIEW / 2;
  app.stage.addChild(container);

  // Push the same camera into the weydra renderer if active so its
  // world-to-screen transform matches Pixi's.
  if (engine === 'weydra') {
    const r = getWeydraRenderer();
    if (r) {
      // (x, y, vw, vh, time) — vw/vh are WORLD UNITS at zoom 1, time = 0.
      r.setCamera(0, 0, VIEW, VIEW, 0);
    }
  }

  // Spawn the reference planet using the seeded PRNG so palette and
  // rotation are bit-identical across boots. tamanho=400 fills half
  // the viewport.
  const rng = makeSeededRng(PALETTE_RNG_SEED);
  const planeta = criarPlanetaProceduralSprite(0, 0, PLANET_SIZE, TIPO_PLANETA.COMUM, PLANET_SEED, rng);
  container.addChild(planeta as unknown as Container);

  // Time = 0. The shader uniform `uTime` is set to 0 by default in
  // both paths; we explicitly stop the ticker so nothing advances it.
  // For the weydra path, force-set uTime = 0 on the instance just to
  // be belt-and-suspenders.
  const w = (planeta as any)._weydraPlanet;
  if (w) {
    w.uTime = 0;
    w.uRotation = 0;
  }
  const s = (planeta as any)._planetShader;
  if (s && s.resources && s.resources.planetUniforms) {
    try {
      s.resources.planetUniforms.uniforms.uTime = 0;
      s.resources.planetUniforms.uniforms.uRotation = 0;
    } catch {
      /* shader uniform layout may differ — ignore */
    }
  }

  // One render, then stop the ticker so the framebuffer is stable.
  app.renderer.render(app.stage);
  app.ticker.stop();

  // Restore the user's config now that we've finished the boot-time
  // override and the runner is about to capture a screenshot. The
  // determinism scene only needs the override during the single render
  // above; once the ticker is stopped, the override is no longer needed
  // and would otherwise leak into the next normal boot from this origin.
  restoreOriginalConfig();
  window.removeEventListener('beforeunload', restoreOriginalConfig);

  // Mark the page once the browser compositor has actually painted the
  // canvas — Pixi's render submits CPU-side commands synchronously, but
  // the GPU paint lands on the next animation frame. Without the rAF
  // wait, a fast Playwright screenshot could capture a blank frame.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  (window as any).__weydraDeterminismReady = true;
  document.title = `determinism-${engine}-ready`;
}
