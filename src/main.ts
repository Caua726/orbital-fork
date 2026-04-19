import { Application } from 'pixi.js';
import type { Mundo, TipoJogador } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo, destruirMundo, setDificuldadeProximoMundo, getDificuldadeAtual } from './world/mundo';
import { getStarfieldMemoryBytes, precompilarShaderStarfield, setAppReferenceForFundo } from './world/fundo';
import { getCanvasPlanetsMemoryBytes } from './world/planeta-procedural';
import { getFogMemoryBytes } from './world/nevoa';
import { getSpritesheetMemoryBytes } from './world/spritesheets';
import { getAiMemoryBytes } from './world/ia-memoria';
import { getLastSeenMemoryBytes } from './world/last-seen';
import { getCombateMemoryBytes } from './world/combate-resolucao';
import type { Dificuldade, PersonalidadeIA } from './world/personalidade-ia';
import { gerarPersonalidades, PRESETS_DIFICULDADE } from './world/personalidade-ia';
import { setPersonalidadesParaMundoCarregado } from './world/ia-decisao';
import { gerarLoreFaccao } from './world/lore-faccao';
import { criarMundoMenu, atualizarMundoMenu, destruirMundoMenu, type MundoMenu } from './world/mundo-menu';
import { configurarCamera, destruirCamera, atualizarCamera, getCamera, setCameraPos, setTipoJogador, zoomIn, zoomOut, setZoom, instalarEdgeScroll, aplicarEdgeScrollAoCamera, cancelarComandoNaveSeAtivo } from './core/player';
import { instalarDispatcher, onAction, onActionUp } from './core/input/dispatcher';
import { criarSidebar, destruirSidebar } from './ui/sidebar';
import { criarEmpireBadge, destruirEmpireBadge } from './ui/empire-badge';
import { criarChatLog, destruirChatLog } from './ui/chat-log';
import { criarResourceBar, destruirResourceBar, atualizarResourceBar } from './ui/resource-bar';
import { criarCreditsBar, destruirCreditsBar } from './ui/credits-bar';
import { criarMinimap, atualizarMinimap, onMinimapClick, onMinimapZoomIn, onMinimapZoomOut, destruirMinimap } from './ui/minimap';
import { criarDebugMenu, atualizarDebugMenu, getDebugState, getCheats, destruirDebugMenu, setGameSpeed, fecharDebugOverlays, toggleDebugFast, toggleDebugFull } from './ui/debug-menu';
import { installRootVariables } from './ui/hud-layout';
import { instalarUiMode } from './core/ui-mode';
import { criarZoomControls } from './ui/zoom-controls';
import { injectMobileStyles } from './ui/mobile.css';
import { injectAnimations } from './ui/animations.css';
import { criarPlanetPanel, atualizarPlanetPanel, destruirPlanetPanel } from './ui/planet-panel';
import { atualizarPlanetaDrawer, destruirPlanetaDrawer } from './ui/planet-drawer';
import { criarBuildPanel, atualizarBuildPanel, destruirBuildPanel } from './ui/build-panel';
import { criarShipPanel, atualizarShipPanel, destruirShipPanel } from './ui/ship-panel';
import { criarColonizerPanel, atualizarColonizerPanel, destruirColonizerPanel } from './ui/colonizer-panel';
import { criarColonyModal, atualizarColonyModal, destruirColonyModal } from './ui/colony-modal';
import { criarConfirmDialog, destruirConfirmDialog } from './ui/confirm-dialog';
import { criarMainMenu, esconderMainMenu, mostrarMainMenu } from './ui/main-menu';
import { abrirPauseMenu, isPauseMenuOpen } from './ui/pause-menu';
import { reconstruirMundo, iniciarAutosave, pararAutosave, instalarListenersCicloDeVida, acumularTempoJogado, lerEMigrarComRelatorio, recuperarEmergency, salvarAgora, getBackendAtivo, getUltimoErro } from './world/save';
import { instalarProviderRuntimeExtras } from './world/save/serializar';
import { reconciliarMundo, resumirDiagnosticos } from './world/save/reconciler';
import { abrirSaveModal } from './ui/save-modal';
import type { MundoDTO } from './world/save';
import { toast } from './ui/toast';
import { getConfig, setConfigDuranteBoot, onConfigChange } from './core/config';
import { abrirNewWorldModal } from './ui/new-world-modal';
import { criarLoadingScreen, mostrarCarregando, esconderCarregando, setLoadingFase } from './ui/loading-screen';
import { t } from './core/i18n/t';
import { somVitoria, somDerrota } from './audio/som';
import { iniciarMusicaAmbiente, pararMusicaAmbiente } from './audio/musica-ambiente';
import { setAppReferenceForBake, precompilarShadersPlaneta } from './world/planeta-procedural';
// Top-level state shared across bootstrap, iniciarJogoNovo, and carregarMundo.
let _app: Application | null = null;
let _mundo: Mundo | null = null;
let _mundoMenu: MundoMenu | null = null;
let _gameStarted = false;
let _hudInstalled = false;
let _transitioning = false;
let _fimTocado = false;

// Cinematic camera state during the main menu. Accumulated seconds,
// fed into layered sines for a non-circular, more organic drift.
let _cinematicTime = 0;

const _panState = { up: false, down: false, left: false, right: false };

// ─── Feature flags ──────────────────────────────────────────────────
// All flags use the HABILITADO suffix for consistency with credits-bar.
// Flip to true to re-enable the corresponding UI element.

/** Legacy sidebar nav + chat log (non-functional decoration). */
const HUD_LEGACY_HABILITADO = false;

/** Old side planet-panel. Superseded by planet-modal on planet click. */
const PLANET_PANEL_HABILITADO = false;

/** Credits bar (credits value + UTC clock + refresh). Non-functional —
 *  the "43892" was a decorative pretend-online counter. */
const CREDITS_BAR_HABILITADO = false;

/** Decorative globe icon inside the credits bar (only relevant if
 *  CREDITS_BAR_HABILITADO is also true). */
const GLOBE_HABILITADO = false;

async function bootstrap(): Promise<void> {
  installRootVariables();

  const app = new Application();

  const gfx = getConfig().graphics;
  // renderScale multiplies the baseline (devicePixelRatio) so users on
  // high-DPI displays can drop below native and users on low-end GPUs
  // can render fewer pixels without changing window layout. The CSS
  // size of the canvas stays at window.innerWidth × innerHeight;
  // only the backing-store resolution changes.
  const baselineDpr = window.devicePixelRatio || 1;
  const renderScale = gfx.renderScale ?? 1;
  const baseInit: any = {
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x000000,
    resolution: baselineDpr * renderScale,
    autoDensity: true,
    antialias: true,
  };
  if (gfx.gpuPreference !== 'auto') {
    baseInit.powerPreference = gfx.gpuPreference;
  }

  // Software mode: Canvas 2D renderer (no GPU), Mínimo preset
  const effectiveRenderer = gfx.renderer === 'software' ? 'canvas' : gfx.renderer;
  if (gfx.renderer === 'software') {
    baseInit.antialias = false;
    baseInit.resolution = 1;
    baseInit.autoDensity = false;
    // Apply Mínimo preset via boot path (no observers)
    setConfigDuranteBoot({
      graphics: {
        ...gfx,
        qualidadeEfeitos: 'minimo',
        fogThrottle: 5,
        maxFantasmas: 0,
        densidadeStarfield: 0.15,
        shaderLive: false,
        mostrarOrbitas: false,
      },
    });
  }

  // Optional: WebGL version forced context injection (non-software)
  if (gfx.renderer !== 'software' && effectiveRenderer === 'webgl' && gfx.webglVersion !== 'auto') {
    const canvas = document.createElement('canvas');
    const ctxOpts: WebGLContextAttributes = { antialias: true, premultipliedAlpha: true };
    if (gfx.gpuPreference !== 'auto') {
      ctxOpts.powerPreference = gfx.gpuPreference;
    }
    const gl = gfx.webglVersion === '1'
      ? canvas.getContext('webgl', ctxOpts)
      : canvas.getContext('webgl2', ctxOpts);
    if (gl) {
      baseInit.context = gl as any;
      baseInit.canvas = canvas as any;
    } else {
      console.warn(`[renderer] WebGL ${gfx.webglVersion} indisponível, caindo pra auto`);
      setConfigDuranteBoot({ graphics: { ...gfx, webglVersion: 'auto' } });
    }
  }

  // Fallback chain: try the user's choice, then step through the
  // remaining options. Order is intentional — WebGL is the most-
  // polished 2D path, WebGPU is newer but widely supported on 2025
  // browsers, Canvas2D is the last-resort software fallback.
  const fallbackOrder: Array<'webgl' | 'webgpu' | 'canvas'> = ['webgl', 'webgpu', 'canvas'];
  const primary = effectiveRenderer as 'webgl' | 'webgpu' | 'canvas';
  const chain: Array<'webgl' | 'webgpu' | 'canvas'> = [
    primary,
    ...fallbackOrder.filter((r) => r !== primary),
  ];

  let initOk = false;
  let lastErr: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const attempt = chain[i];
    try {
      const attemptInit: any = { ...baseInit, preference: attempt };
      // Forced WebGL-version context only applies when we're really
      // initializing WebGL — drop it for the other attempts.
      if (attempt !== 'webgl') {
        delete attemptInit.context;
        delete attemptInit.canvas;
      }
      await app.init(attemptInit);
      initOk = true;
      // If we had to fall back, sync the config so the settings
      // panel reflects what actually got picked. Also toast the user.
      if (attempt !== primary) {
        const cfgRenderer = attempt === 'canvas' ? 'software' : attempt;
        setConfigDuranteBoot({ graphics: { ...getConfig().graphics, renderer: cfgRenderer as any } });
        const labels: Record<string, string> = { webgl: 'WebGL', webgpu: 'WebGPU', canvas: 'Canvas2D' };
        const from = labels[primary] ?? primary;
        const to = labels[attempt] ?? attempt;
        window.setTimeout(
          () => toast(`${from} indisponível — usando ${to}`, 'err'),
          2000,
        );
        console.warn(`[renderer] ${from} failed, fell back to ${to}`);
      } else if (attempt === 'webgl' && effectiveRenderer === 'webgl' && gfx.webglVersion !== 'auto') {
        // Honored the user's choice — nothing to report.
      }
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`[renderer] ${attempt} init failed:`, err);
      // Special case: forced WebGL version failed, retry WebGL with
      // auto version before falling off to the next backend.
      if (attempt === 'webgl' && gfx.webglVersion !== 'auto' && baseInit.context) {
        setConfigDuranteBoot({ graphics: { ...getConfig().graphics, webglVersion: 'auto' } });
        delete baseInit.context;
        delete baseInit.canvas;
        try {
          await app.init({ ...baseInit, preference: 'webgl' });
          initOk = true;
          window.setTimeout(() => toast(t('toast.webgl_fallback', { v: gfx.webglVersion }), 'err'), 2000);
          break;
        } catch (err2) {
          lastErr = err2;
          console.warn('[renderer] WebGL auto also failed:', err2);
        }
      }
      // Continue to next backend in the chain.
    }
  }
  if (!initOk) throw lastErr ?? new Error('No renderer backend succeeded');

  // ── Pixi render profiling ──────────────────────────────────────
  // Wrap renderer.render so every internal render call is timed and
  // accumulated into the 'pixiRender' profiling bucket. On software
  // rasterizers (WARP / SwiftShader) this sync call IS the real GPU
  // cost; on WebGL/WebGPU hardware it measures CPU-side submission
  // latency (queue stuff) which is usually small. The delta between
  // 'pixiRender' and 'frameWall' is the compositor + vsync wait.
  try {
    const { profileMark, profileAcumular, profileContar } = await import('./world/profiling');
    const origRender = app.renderer.render.bind(app.renderer);
    (app.renderer as any).render = (...args: unknown[]) => {
      const t = profileMark();
      try {
        return (origRender as any)(...args);
      } finally {
        profileAcumular('pixiRender', t);
      }
    };

    // WebGL drawCall + texture upload counters. We intercept the GL
    // context's draw*/tex*Image2D methods so the debug HUD knows exactly
    // what Pixi submitted this frame. Zero overhead when profiling is
    // off — the HUD just reads the accumulator.
    //
    // Context-loss guard: if the canvas gets webglcontextlost, the
    // wrapped draw/tex calls would keep firing into a dead context
    // (spamming console errors). `_glHooksActive` disables the
    // counter increments without un-wrapping the methods.
    const gl = (app.renderer as any).gl as (WebGL2RenderingContext | WebGLRenderingContext | undefined);
    if (gl && typeof gl.drawElements === 'function') {
      let _glHooksActive = true;
      const canvas = (app.renderer as any).canvas as HTMLCanvasElement | undefined;
      canvas?.addEventListener('webglcontextlost', () => { _glHooksActive = false; });
      canvas?.addEventListener('webglcontextrestored', () => { _glHooksActive = true; });

      const origDE = gl.drawElements.bind(gl);
      const origDA = gl.drawArrays.bind(gl);
      const origTI = gl.texImage2D.bind(gl);
      const origTS = gl.texSubImage2D.bind(gl);
      (gl as any).drawElements = (mode: number, count: number, type: number, offset: number) => {
        if (_glHooksActive) {
          profileContar('drawCalls', 1);
          profileContar('triangles', (count / 3) | 0);
        }
        return origDE(mode, count, type, offset);
      };
      (gl as any).drawArrays = (mode: number, first: number, count: number) => {
        if (_glHooksActive) {
          profileContar('drawCalls', 1);
          profileContar('triangles', (count / 3) | 0);
        }
        return origDA(mode, first, count);
      };
      (gl as any).texImage2D = (...args: unknown[]) => {
        if (_glHooksActive) profileContar('textureUploads', 1);
        return (origTI as any)(...args);
      };
      (gl as any).texSubImage2D = (...args: unknown[]) => {
        if (_glHooksActive) profileContar('textureUploads', 1);
        return (origTS as any)(...args);
      };
      const gl2 = gl as WebGL2RenderingContext;
      if (typeof gl2.drawElementsInstanced === 'function') {
        const origDEI = gl2.drawElementsInstanced.bind(gl2);
        (gl2 as any).drawElementsInstanced = (
          mode: number, count: number, type: number, offset: number, instanceCount: number,
        ) => {
          if (_glHooksActive) {
            profileContar('drawCalls', 1);
            profileContar('triangles', ((count / 3) | 0) * instanceCount);
          }
          return origDEI(mode, count, type, offset, instanceCount);
        };
      }
    }
  } catch (err) {
    console.warn('[profiling] renderer.render wrap failed:', err);
  }

  // ── Software-renderer detection ────────────────────────────────
  // Chrome on Windows without GPU acceleration falls through ANGLE
  // to WARP; Chromium in some configurations uses SwiftShader.
  // Both can't reach gameplay-viable framerates on this game, so we
  // force the minimum preset + tiny render scale on first detection
  // and toast the user with a clear explanation. The flag we save
  // to config stops the auto-apply from running on every boot.
  try {
    const { detectarRendererSoftware } = await import('./core/benchmark');
    const sw = detectarRendererSoftware(app);
    if (sw.isSoftware) {
      const currentGfx = getConfig().graphics;
      // Software detected → apply 'mínimo' preset once. The preset
      // itself carries every software-friendly value (low render
      // scale, aggressive fog throttle, 1 starfield layer, 2 planet
      // octaves etc) so no renderer-specific overrides needed here.
      if (!(currentGfx as any)._softwareDetectedOnce) {
        const { aplicarPreset } = await import('./core/graphics-preset');
        aplicarPreset('minimo');
        setConfigDuranteBoot({
          graphics: { ...getConfig().graphics, _softwareDetectedOnce: true } as any,
        });
      }
      window.setTimeout(() => {
        toast(`Renderizando via ${sw.friendlyName} — GPU do navegador está desabilitada. Jogo ajustado pro preset mínimo. Ative aceleração por hardware pra performance normal.`, 'err');
      }, 1500);
      console.warn(`[renderer] software detected: ${sw.friendlyName} (${sw.kind})`);
    }
  } catch (err) {
    console.warn('[renderer] software detection failed:', err);
  }

  // ── Vsync + FPS cap wiring ──────────────────────────────────────
  // vsync=true  → rAF-driven ticker. fpsCap via ticker.maxFPS.
  // vsync=false → stop the rAF ticker, drive updates from a
  //               setTimeout loop. fpsCap enforces a minimum delay
  //               when > 0. With cap=0 the browser's ~4ms minimum
  //               setTimeout clamp caps us at roughly 250 FPS — but
  //               that's the price of staying responsive. The
  //               MessageChannel trick that bypasses the clamp
  //               saturated the ticker and froze the tab, so we
  //               live with the ~250 ceiling.
  let _loopTimer: number | null = null;
  const aplicarModoFps = (vsync: boolean, cap: number): void => {
    if (_loopTimer !== null) {
      window.clearTimeout(_loopTimer);
      _loopTimer = null;
    }
    if (vsync) {
      app.ticker.maxFPS = cap > 0 ? cap : 0;
      if (!app.ticker.started) app.ticker.start();
      return;
    }
    app.ticker.stop();
    const minDelayMs = cap > 0 ? 1000 / cap : 0;
    let lastTickMs = performance.now();
    const loop = (): void => {
      const now = performance.now();
      app.ticker.update(now);
      const elapsed = performance.now() - lastTickMs;
      lastTickMs = now;
      const wait = Math.max(0, minDelayMs - elapsed);
      _loopTimer = window.setTimeout(loop, wait) as unknown as number;
    };
    loop();
  };
  aplicarModoFps(gfx.vsync, gfx.fpsCap);
  onConfigChange((cfg) => aplicarModoFps(cfg.graphics.vsync, cfg.graphics.fpsCap));

  // Live render-scale updates: change Pixi's backing-store resolution
  // and force a resize so every Mesh/Sprite gets the new projection.
  // The canvas CSS size stays the same; browser bilinear-upscales when
  // renderScale < 1.
  let _lastRenderScale = renderScale;
  // Clamp renderScale so the backing canvas never exceeds the GPU's
  // max texture size. WebGPU's default limit is 8192 and WebGL2 is
  // typically 16384; requesting larger causes the canvas to render
  // blank (WebGPU) or fall back to 0×0 (some WebGL drivers). Query
  // Pixi's reported limit; default to 8192 if unavailable.
  const getMaxRenderScale = (): number => {
    const r = app.renderer as any;
    const maxTex = r?.limits?.maxTextureSize
      ?? r?.maxTextureSize
      ?? 8192;
    const needed = Math.max(window.innerWidth, window.innerHeight) * baselineDpr;
    return needed > 0 ? maxTex / needed : 4;
  };

  onConfigChange((cfg) => {
    const requested = cfg.graphics.renderScale ?? 1;
    const safeMax = getMaxRenderScale();
    const next = Math.min(requested, safeMax);
    if (next === _lastRenderScale) return;
    _lastRenderScale = next;
    (app.renderer as any).resolution = baselineDpr * next;
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });

  // ── FPS counter ──
  const fpsEl = document.createElement('div');
  fpsEl.style.cssText = `
    position: fixed; top: calc(var(--hud-unit) * 0.5); right: calc(var(--hud-unit) * 0.5);
    font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.75);
    color: var(--hud-text-dim); background: rgba(0,0,0,0.5);
    padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.5);
    border: 1px solid var(--hud-border); z-index: 600; pointer-events: none;
    display: ${gfx.mostrarFps ? 'block' : 'none'};
  `;
  document.body.appendChild(fpsEl);

  // ── RAM profiler — breakdown by allocation category ──
  // Multi-line readout beneath the FPS counter. Uses pre-formatted
  // monospace text so the columns line up regardless of value width.
  const ramEl = document.createElement('div');
  ramEl.style.cssText = `
    position: fixed;
    top: calc(var(--hud-unit) * 0.5 + var(--hud-unit) * 1.8);
    right: calc(var(--hud-unit) * 0.5);
    font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.7);
    color: var(--hud-text-dim); background: rgba(0,0,0,0.6);
    padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.6);
    border: 1px solid var(--hud-border); z-index: 600; pointer-events: none;
    display: ${gfx.mostrarRam ? 'block' : 'none'};
    white-space: pre; line-height: 1.35; text-align: right;
    min-width: calc(var(--hud-unit) * 9);
  `;
  document.body.appendChild(ramEl);

  // Build an app-side estimate of total RAM use — this always works
  // (unlike performance.memory which is Chromium-only and doesn't
  // even reflect GPU textures, the real cost in this game). We show
  // performance.memory as an extra field if the browser exposes it.
  //
  // Accounted for:
  //   - Starfield GPU tile cache (the big one: 16 MB / tile × cache size)
  //   - Fog-of-war canvas + GPU upload (~4 MB)
  //   - Planet/ship sprite + data (rough per-entity constant)
  //   - A fixed baseline for Pixi runtime + spritesheets + JS bundle
  // Baseline: Pixi runtime + app bundle + misc framework state. Not
  // broken down further because we have no API to introspect it — it
  // is a flat "everything else" bucket.
  const BASELINE_BYTES = 45 * 1024 * 1024;

  const fmtMB = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    if (mb >= 100) return mb.toFixed(0).padStart(5);
    if (mb >= 10) return mb.toFixed(1).padStart(5);
    return mb.toFixed(2).padStart(5);
  };

  const sampleRam = (): void => {
    const activeFundo = _mundo?.fundo ?? _mundoMenu?.fundo;
    const starfield = activeFundo ? getStarfieldMemoryBytes(activeFundo) : 0;
    const fog       = getFogMemoryBytes();
    const sprites   = getSpritesheetMemoryBytes();
    const aiMem     = getAiMemoryBytes();
    const lastSeen  = getLastSeenMemoryBytes();
    const combate   = getCombateMemoryBytes();
    const world     = _mundo;
    // Shader-mode planets are ~4 KB each (mesh + shader uniforms).
    // Canvas2D mode swaps that for ImageData + GPU upload of the
    // per-planet canvas — tracked via getCanvasPlanetsMemoryBytes.
    const planetasSprite = (world?.planetas.length ?? 0) * 4 * 1024;
    const planetasCanvas = world ? getCanvasPlanetsMemoryBytes(world.planetas) : 0;
    const planetas = planetasCanvas > 0 ? planetasCanvas : planetasSprite;
    const naves     = (world?.naves.length ?? 0) * 2 * 1024;
    const sistemas  = (world?.sistemas.length ?? 0) * 8 * 1024;

    const total =
      BASELINE_BYTES + starfield + fog + sprites +
      aiMem + lastSeen + combate +
      planetas + naves + sistemas;

    // Build the breakdown block. Categories are ordered by typical
    // size (descending) so the big contributors are at the top.
    const rows: [string, number][] = [
      ['Starfield', starfield],
      ['Baseline ', BASELINE_BYTES],
      ['Sprites  ', sprites],
      ['Sistemas ', sistemas],
      ['Planetas ', planetas],
      ['Naves    ', naves],
      ['Fog      ', fog],
      ['AI memor', aiMem],
      ['Last-seen', lastSeen],
      ['Combate  ', combate],
    ];

    const lines: string[] = [`TOTAL ~${fmtMB(total)} MB`];
    for (const [label, bytes] of rows) {
      if (bytes < 1024) continue; // skip sub-1KB noise
      lines.push(`${label} ${fmtMB(bytes)} MB`);
    }

    // Chromium bonus — actual JS heap, if the API is exposed.
    const mem = (performance as any).memory;
    if (mem && typeof mem.usedJSHeapSize === 'number') {
      lines.push(`JS heap  ${fmtMB(mem.usedJSHeapSize)} MB`);
    }

    ramEl.textContent = lines.join('\n');
  };
  // Prime the label so the first toggle-on shows content right away.
  sampleRam();

  let _fpsAccum = 0;
  let _fpsFrames = 0;
  let _ramAccum = 0;
  app.ticker.add(() => {
    _fpsFrames++;
    _fpsAccum += app.ticker.deltaMS;
    if (_fpsAccum >= 500) {
      fpsEl.textContent = `${Math.round(_fpsFrames / (_fpsAccum / 1000))} FPS`;
      _fpsAccum = 0;
      _fpsFrames = 0;
    }
    // RAM sampled at ~1Hz; performance.memory is a heavy call on some
    // engines and the value only moves on the scale of MB anyway.
    _ramAccum += app.ticker.deltaMS;
    if (_ramAccum >= 1000 && ramEl.style.display !== 'none') {
      _ramAccum = 0;
      sampleRam();
    }
  });
  onConfigChange((cfg) => {
    fpsEl.style.display = cfg.graphics.mostrarFps ? 'block' : 'none';
    const showRam = cfg.graphics.mostrarRam;
    ramEl.style.display = showRam ? 'block' : 'none';
    // Re-sample immediately on toggle-on so the value is fresh.
    if (showRam) sampleRam();
  });

  // ── Scanlines CRT overlay ──
  const scanlinesEl = document.createElement('div');
  scanlinesEl.style.cssText = `
    position: fixed; inset: 0; z-index: 99; pointer-events: none;
    background:
      repeating-linear-gradient(
        0deg,
        transparent 0px,
        transparent 1px,
        rgba(0, 0, 0, 0.12) 1px,
        rgba(0, 0, 0, 0.12) 2px
      ),
      radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0,0,0,0.25) 100%);
    display: ${gfx.scanlines ? 'block' : 'none'};
  `;
  document.body.appendChild(scanlinesEl);
  onConfigChange((cfg) => {
    scanlinesEl.style.display = cfg.graphics.scanlines ? 'block' : 'none';
  });

  instalarUiMode();
  injectMobileStyles();
  injectAnimations();
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.appendChild(app.canvas);

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });

  // WebGL context loss recovery. Without calling preventDefault() the
  // browser is allowed to never restore the context. With it, the
  // browser will try to recreate the context, and we offer the user a
  // reload since the custom planet shaders need rebuilding to work
  // again (state they held in GPU memory is gone).
  const canvas = app.canvas as HTMLCanvasElement;
  canvas.addEventListener('webglcontextlost', (e: Event) => {
    e.preventDefault();
    console.warn('[renderer] WebGL context lost — requesting restore');
    void abrirSaveModal({
      title: 'CONTEXTO GRÁFICO PERDIDO',
      severity: 'erro',
      summary: 'O navegador perdeu o contexto WebGL. Recarregue pra recuperar a renderização dos planetas.',
      actions: [
        { label: 'Recarregar agora', value: 'reload', variant: 'primary' },
        { label: 'Depois', value: 'cancel', variant: 'neutral' },
      ],
    }).then((choice) => {
      if (choice === 'reload') window.location.reload();
    });
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.info('[renderer] WebGL context restored');
  });

  _app = app;
  (window as any)._app = app;
  setAppReferenceForBake(app);

  // Pre-compile the planet/star shader programs NOW so the driver link
  // step happens during boot (where a pause is expected) instead of
  // mid-frame the first time a real planet renders. Without this the
  // initial ~second of gameplay showed a visible FPS sag while the GL
  // driver compiled + linked the shared GlProgram.
  setAppReferenceForFundo(app);
  await precompilarShadersPlaneta(app);
  await precompilarShaderStarfield(app);

  // Build the menu background: a lightweight single-system world, not
  // the full 18-system game world. When the player clicks Novo Jogo we
  // destroy this and create the real one.
  const mundoMenu = await criarMundoMenu(app);
  app.stage.addChild(mundoMenu.container);
  _mundoMenu = mundoMenu;

  // Park the camera at the center of the menu system and zoom out so
  // the whole thing fits nicely in view.
  setCameraPos(mundoMenu.sistema.sol.x, mundoMenu.sistema.sol.y);
  setZoom(0.55);
  instalarEdgeScroll();

  // Install the global input dispatcher and register action handlers.
  instalarDispatcher();

  onAction('zoom_in', () => zoomIn());
  onAction('zoom_out', () => zoomOut());

  // Focus selection: center the camera on whatever the player has
  // selected right now. Ship > planet > sun priority — if nothing is
  // selected, fall back to the player's home planet so the key never
  // does nothing. Useful when piloting a ship (camera snaps back to
  // the ship after panning away).
  onAction('focar_alvo', () => {
    if (!_mundo) return;
    const nave = _mundo.naves.find((n) => n.selecionado && n.dono === 'jogador');
    if (nave) { setCameraPos(nave.x, nave.y); return; }
    const planeta = _mundo.planetas.find((p) => p.dados.selecionado);
    if (planeta) { setCameraPos(planeta.x, planeta.y); return; }
    const sol = _mundo.sois.find((s) => (s as any)._selecionado);
    if (sol) { setCameraPos(sol.x, sol.y); return; }
    const home = _mundo.planetas.find((p) => p.dados.dono === 'jogador');
    if (home) setCameraPos(home.x, home.y);
  });

  onAction('cancel_or_menu', () => {
    if (cancelarComandoNaveSeAtivo()) return;
    if (fecharDebugOverlays()) return;
    if (_gameStarted && !isPauseMenuOpen()) abrirPauseMenu();
  });

  onAction('toggle_debug_fast', () => { toggleDebugFast(); });
  onAction('toggle_debug_full', () => { toggleDebugFull(); });

  onAction('quicksave', () => {
    salvarAgora();
    toast(t('toast.salvo'), 'info');
  });

  onAction('speed_pause', () => {
    setGameSpeed(getDebugState().gameSpeed === 0 ? 1 : 0);
  });
  onAction('speed_1x', () => { setGameSpeed(1); });
  onAction('speed_2x', () => { setGameSpeed(2); });
  onAction('speed_4x', () => { setGameSpeed(4); });

  onAction('pan_up',    () => { _panState.up = true; });
  onActionUp('pan_up',  () => { _panState.up = false; });
  onAction('pan_down',  () => { _panState.down = true; });
  onActionUp('pan_down',() => { _panState.down = false; });
  onAction('pan_left',  () => { _panState.left = true; });
  onActionUp('pan_left',() => { _panState.left = false; });
  onAction('pan_right', () => { _panState.right = true; });
  onActionUp('pan_right',() => { _panState.right = false; });

  // Release any held pan keys if the window loses focus mid-press.
  window.addEventListener('blur', () => {
    _panState.up = _panState.down = _panState.left = _panState.right = false;
  });

  // Start the ticker. During the menu it only updates the menu world +
  // cinematic camera; once iniciarJogo flips _gameStarted it switches to
  // the full game loop.
  startTicker();

  // Pre-install the loading screen so iniciarJogo can flip it on instantly.
  criarLoadingScreen();

  criarMainMenu({
    onNewGame: () => {
      abrirNewWorldModal({
        onConfirm: (nome, tipoJogador, dificuldade) => { void iniciarJogoNovo(nome, tipoJogador, dificuldade); },
        onCancel: () => {},
      });
    },
    onLoadGame: (nome: string) => { void carregarMundo(nome); },
  });

  // Provide runtime extras (camera / speed / selection / difficulty) to
  // the save layer — called at each serialize without a circular import.
  instalarProviderRuntimeExtras(() => {
    const cam = getCamera();
    const planetaSel = _mundo?.planetas.find((p) => p.dados.selecionado);
    const naveSel = _mundo?.naves.find((n) => n.selecionado);
    return {
      dificuldade: getDificuldadeAtual(),
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom },
      gameSpeed: getDebugState().gameSpeed,
      selecaoUI: {
        planetaId: planetaSel?.id,
        naveId: naveSel?.id,
      },
    };
  });

  instalarListenersCicloDeVida();

  window.addEventListener('orbital:voltar-ao-menu', () => {
    void voltarAoMenu();
  });
}

function startTicker(): void {
  if (!_app) return;
  const app = _app;

  app.ticker.add(() => {
    app.ticker.speed = getDebugState().gameSpeed;

    // ── Menu phase: cheap per-frame updates on the menu world only ──
    if (!_gameStarted) {
      if (!_mundoMenu) return;
      const menu = _mundoMenu;

      // Procedural camera drift: two overlapping sine pairs at
      // intentionally non-commensurate frequencies so the trajectory
      // never exactly repeats. Primary wave defines the broad drift,
      // secondary wave adds shorter-period jitter so the motion feels
      // organic rather than a clean ellipse.
      _cinematicTime += app.ticker.deltaMS / 1000;
      const t = _cinematicTime;
      const camera = getCamera();
      camera.x = menu.sistema.sol.x
        + Math.sin(t * 0.09) * 720
        + Math.sin(t * 0.23 + 1.7) * 180;
      camera.y = menu.sistema.sol.y
        + Math.cos(t * 0.07) * 480
        + Math.cos(t * 0.19 + 0.9) * 140;

      // Apply the same camera transform the real game loop does so the
      // world actually shows at the camera position.
      menu.container.scale.set(camera.zoom);
      menu.container.x = -camera.x * camera.zoom + app.screen.width / 2;
      menu.container.y = -camera.y * camera.zoom + app.screen.height / 2;

      atualizarMundoMenu(menu, app, camera.x, camera.y, app.ticker.deltaMS);
      return;
    }

    // ── Game phase: full update of the real world + HUD ──
    if (!_mundo) return;
    const mundo = _mundo;
    acumularTempoJogado(app.ticker.deltaMS);

    const c = getCheats();
    if (c.recursosInfinitos) {
      for (const p of mundo.planetas) {
        if (p.dados.dono !== 'jogador') continue;
        p.dados.recursos.comum = Math.max(p.dados.recursos.comum, 999999);
        p.dados.recursos.raro = Math.max(p.dados.recursos.raro, 999999);
        p.dados.recursos.combustivel = Math.max(p.dados.recursos.combustivel, 999999);
      }
    }

    const camera = getCamera();
    atualizarCamera(mundo, app);
    aplicarEdgeScrollAoCamera(app.ticker.deltaMS);

    // Keyboard pan — applied per-frame so holding a key scrolls smoothly.
    const PAN_SPEED = 800;
    const panScale = PAN_SPEED * (app.ticker.deltaMS / 1000) / (camera.zoom || 1);
    if (_panState.up) camera.y -= panScale;
    if (_panState.down) camera.y += panScale;
    if (_panState.left) camera.x -= panScale;
    if (_panState.right) camera.x += panScale;

    atualizarMundo(mundo, app, camera);

    atualizarMinimap(camera);
    atualizarPlanetPanel(mundo, app);
    atualizarPlanetaDrawer();
    atualizarResourceBar(mundo);
    atualizarBuildPanel(mundo);
    atualizarShipPanel(mundo);
    atualizarColonizerPanel(mundo);
    atualizarColonyModal(mundo);
    atualizarDebugMenu();
    atualizarHudBannerErro();

    const estado = getEstadoJogo();
    if (estado === 'vitoria' && !_fimTocado) {
      somVitoria();
      _fimTocado = true;
    } else if (estado === 'derrota' && !_fimTocado) {
      somDerrota();
      _fimTocado = true;
    }
  });
}

async function entrarNoJogo(mundo: Mundo, nome: string, criadoEm: number, tempoJogadoMs: number): Promise<void> {
  if (!_app) return;
  const app = _app;

  try {
    const { logarEvento } = await import('./world/profiling-logger');
    logarEvento('enter_game', { nome, systems: mundo.sistemas.length, planets: mundo.planetas.length, ships: mundo.naves.length });
  } catch { /* logger optional */ }

  if (_mundoMenu) {
    destruirMundoMenu(_mundoMenu, app);
    _mundoMenu = null;
  }

  app.stage.addChild(mundo.container);
  _mundo = mundo;

  const planetaJogador = mundo.planetas.find((p) => p.dados.dono === 'jogador');
  if (planetaJogador) setCameraPos(planetaJogador.x, planetaJogador.y);
  setZoom(1.0);
  configurarCamera(app, mundo);
  criarZoomControls();

  if (!_hudInstalled) {
    _hudInstalled = true;
    criarEmpireBadge('Valorian Empire', 24);
    if (CREDITS_BAR_HABILITADO) criarCreditsBar(43892, GLOBE_HABILITADO);
    criarResourceBar();
    // Temporarily disabled — sidebar and chat log weren't earning
    // their screen real estate. The code is preserved so they can be
    // re-enabled by flipping HUD_LEGACY_HABILITADO below.
    if (HUD_LEGACY_HABILITADO) {
      criarChatLog();
      criarSidebar();
    } else {
      // Mobile drawer needs the sidebar container + hamburger, even
      // without the legacy nav items. CSS hides it on desktop.
      criarSidebar({ drawerOnly: true });
    }
    // The side planet-panel is superseded by the new planet-modal
    // (opened on planet click). Kept in code but not instantiated —
    // flip PLANET_PANEL_HABILITADO to restore.
    if (PLANET_PANEL_HABILITADO) criarPlanetPanel();
    criarBuildPanel();
    criarShipPanel();
    criarColonizerPanel();
    criarColonyModal();
    criarConfirmDialog();

    criarMinimap(app, mundo);
    onMinimapClick((worldX, worldY) => {
      setCameraPos(worldX, worldY);
    });
    onMinimapZoomIn(() => zoomIn());
    onMinimapZoomOut(() => zoomOut());

    criarDebugMenu(app, mundo);
  }

  _gameStarted = true;
  iniciarAutosave({ mundo, nome, criadoEm, tempoJogadoMs });
  salvarAgora();
  iniciarMusicaAmbiente(mundo.seedMusical);
  await esconderCarregando();
}

async function iniciarJogoNovo(nome: string, tipoJogador: TipoJogador, dificuldade: Dificuldade = 'normal'): Promise<void> {
  if (!_app || _gameStarted || _transitioning) return;
  _transitioning = true;
  const app = _app;

  esconderMainMenu();
  mostrarCarregando(t('loading.criando'));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  setTipoJogador();
  setDificuldadeProximoMundo(dificuldade);
  const mundo = await criarMundo(app, tipoJogador, async (label) => {
    await setLoadingFase(label);
  }) as unknown as Mundo;
  await entrarNoJogo(mundo, nome, Date.now(), 0);
}

async function mostrarModalSaveCorrompido(nome: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[save] load failed:', err);
  const choice = await abrirSaveModal({
    title: t('save.corrompido_titulo') || 'SAVE CORROMPIDO',
    severity: 'erro',
    summary: `Não foi possível carregar "${nome}". O arquivo está corrompido ou incompatível.`,
    details: msg,
    actions: [
      { label: t('save.modal_fechar') || 'Fechar', value: 'cancel', variant: 'neutral' },
      { label: t('save.modal_exportar') || 'Exportar JSON', value: 'EXPORTAR', variant: 'neutral' },
      { label: t('save.modal_apagar') || 'Apagar save', value: 'APAGAR', variant: 'danger' },
    ],
  });
  if (choice === 'APAGAR') {
    void getBackendAtivo().apagar(nome);
    toast(t('toast.save_apagado'), 'info');
  } else if (choice === 'EXPORTAR') {
    try {
      const rawStr = localStorage.getItem(`orbital_save:${nome}`);
      if (!rawStr) {
        toast(t('toast.save_nada_exportar'), 'err');
        return;
      }
      const blob = new Blob([rawStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nome}-corrupt.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast(t('toast.save_exportado'), 'info');
    } catch (e) {
      toast(t('toast.save_falha_exportar'), 'err');
    }
  }
}

let _bannerEl: HTMLDivElement | null = null;
let _bannerLastErr: Error | null = null;
function atualizarHudBannerErro(): void {
  const err = getUltimoErro();
  if (err === _bannerLastErr) return;
  _bannerLastErr = err;
  if (!_bannerEl) {
    _bannerEl = document.createElement('div');
    _bannerEl.style.cssText = `
      position: fixed;
      top: var(--hud-margin);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255, 107, 107, 0.15);
      border: 1px solid #ff6b6b;
      border-radius: var(--hud-radius);
      color: #ff6b6b;
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.85);
      z-index: 400;
      display: none;
    `;
    document.body.appendChild(_bannerEl);
  }
  if (err) {
    _bannerEl.textContent = `Falha ao salvar: ${err.message}`;
    _bannerEl.style.display = '';
  } else {
    _bannerEl.style.display = 'none';
  }
}

async function carregarMundo(nome: string): Promise<void> {
  if (!_app || _gameStarted || _transitioning) return;
  _transitioning = true;
  const app = _app;

  esconderMainMenu();
  mostrarCarregando(t('loading.carregando', { nome }));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  let dto: MundoDTO | null = null;
  let versaoOriginal: number | undefined;
  let transformsMigration: readonly string[] = [];
  try {
    dto = await recuperarEmergency(nome);
    if (!dto) {
      // Prefer the report-returning loader so we can show the user which
      // legacy version was detected and which migrations ran.
      const rel = await lerEMigrarComRelatorio(nome);
      if (rel) {
        dto = rel.dto;
        versaoOriginal = rel.versaoOriginal;
        transformsMigration = rel.transforms;
      }
    }
  } catch (err) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    void mostrarModalSaveCorrompido(nome, err);
    return;
  }
  if (!dto) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    toast(t('toast.save_nao_encontrado', { nome }), 'err');
    return;
  }

  try {
    setTipoJogador();
    // Difficulty restore — must happen BEFORE reconstruirMundo so
    // inicializarIas (via restaurarOuReinicializarIas) reads the right
    // preset and the AI tick rate matches the save.
    if (dto.dificuldade) setDificuldadeProximoMundo(dto.dificuldade);
    const mundo = await reconstruirMundo(dto, app, undefined, async (label) => {
      await setLoadingFase(label);
    });
    await setLoadingFase('Reativando civilizações');
    restaurarOuReinicializarIas(mundo, dto);

    // IA re-init above invokes resetIasV2 under the hood, which also
    // wiped AI memory and tick state restored during reconstruirMundo.
    // Re-apply them AFTER the personality handshake so they survive.
    const [{ restaurarMemoriasIa }, { setIaTickState }] = await Promise.all([
      import('./world/ia-memoria'),
      import('./world/ia-decisao'),
    ]);
    if (dto.iaMemoria) restaurarMemoriasIa(dto.iaMemoria);
    if (dto.iaTickState) setIaTickState(dto.iaTickState);

    // Diagnose and heal any drift between the loaded save and current code
    // before gameplay starts (missing fields, orphan refs, invalid values).
    await setLoadingFase('Reconciliando save');
    const diag = reconciliarMundo(mundo, dto, {
      versaoOriginal,
      transformsAplicados: transformsMigration,
    });
    if (diag.length > 0) {
      console.group('[reconciler] save reconciliado');
      for (const d of diag) {
        const fn = d.severidade === 'erro' ? console.error : d.severidade === 'warn' ? console.warn : console.info;
        fn(`[${d.categoria}] ${d.detalhe}`);
      }
      console.groupEnd();
      const hasWarnOrErro = diag.some((d) => d.severidade === 'warn' || d.severidade === 'erro');
      if (hasWarnOrErro) {
        // Non-trivial drift — show modal so the player can inspect what
        // was auto-fixed before jumping into the game. Info-only runs
        // get a toast (quieter, auto-dismisses).
        void abrirSaveModal({
          title: 'SAVE RECONCILIADO',
          severity: diag.some((d) => d.severidade === 'erro') ? 'erro' : 'warn',
          summary: `Ajustes automáticos foram aplicados ao carregar "${nome}".`,
          items: diag.map((d) => ({ text: `[${d.categoria}] ${d.detalhe}`, tone: d.severidade })),
          actions: [{ label: 'Entendi', value: 'ok', variant: 'primary' }],
        });
      } else {
        const msg = resumirDiagnosticos(diag);
        if (msg) setTimeout(() => toast(msg, 'info'), 800);
      }
    }

    await entrarNoJogo(mundo, nome, dto.criadoEm, dto.tempoJogadoMs);
    // Restore camera / speed / selection AFTER entrarNoJogo so the
    // HUD & camera controllers exist to receive state.
    if (dto.camera) {
      setCameraPos(dto.camera.x, dto.camera.y);
      setZoom(dto.camera.zoom);
    }
    if (typeof dto.gameSpeed === 'number') setGameSpeed(dto.gameSpeed);
    if (dto.selecaoUI?.planetaId) {
      const p = mundo.planetas.find((x) => x.id === dto.selecaoUI!.planetaId);
      if (p) p.dados.selecionado = true;
    }
    if (dto.selecaoUI?.naveId) {
      const n = mundo.naves.find((x) => x.id === dto.selecaoUI!.naveId);
      if (n) n.selecionado = true;
    }
  } catch (err) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    void mostrarModalSaveCorrompido(nome, err);
  }
}

/**
 * Restore AI personalities from save (preserves names/colors/archetypes
 * across save/load) — or, for old saves without personalidadesIa, regenerate
 * fresh ones matching the dono ids found in the loaded world.
 */
function restaurarOuReinicializarIas(mundo: Mundo, dto: MundoDTO): void {
  const dificuldade = getDificuldadeAtual();
  const cfg = PRESETS_DIFICULDADE[dificuldade];

  // Path 1: save has personality genomes — restore verbatim
  if (dto.personalidadesIa && dto.personalidadesIa.length > 0) {
    const ias: PersonalidadeIA[] = dto.personalidadesIa.map((d) => ({
      id: d.id,
      nome: d.nome,
      cor: d.cor,
      arquetipo: d.arquetipo,
      pesos: { ...d.pesos },
      naveFavorita: d.naveFavorita,
      frotaMinAtaque: d.frotaMinAtaque,
      paciencia: d.paciencia,
      frotaMax: d.frotaMax,
      forca: d.forca,
      // Lore may be absent in v1 saves — regenerate it so tooltips work.
      lore: d.lore ?? gerarLoreFaccao(d.id, d.arquetipo),
    }));
    setPersonalidadesParaMundoCarregado(ias, cfg.tickMs);
    return;
  }

  // Path 2: old save without personalities — regenerate from dono ids
  const idsAtivos = new Set<string>();
  for (const p of mundo.planetas) {
    const d = p.dados.dono;
    if (d.startsWith('inimigo')) idsAtivos.add(d);
  }
  if (idsAtivos.size === 0) return;
  const ias = gerarPersonalidades(idsAtivos.size, cfg.forca || 1);
  const idsArr = Array.from(idsAtivos);
  for (let i = 0; i < ias.length; i++) {
    ias[i].id = idsArr[i];
  }
  setPersonalidadesParaMundoCarregado(ias, cfg.tickMs);
}

async function voltarAoMenu(): Promise<void> {
  if (!_app) return;
  const app = _app;

  try {
    const { logarEvento } = await import('./world/profiling-logger');
    logarEvento('return_to_menu');
  } catch { /* logger optional */ }

  // 1. Black overlay covers everything during teardown so the user
  //    sees a smooth fade instead of a frame of destroyed content.
  const curtain = document.createElement('div');
  curtain.style.cssText = `
    position: fixed; inset: 0; z-index: 999;
    background: #000; opacity: 0;
    transition: opacity 400ms ease-out;
  `;
  document.body.appendChild(curtain);
  // Fade to black (400ms)
  requestAnimationFrame(() => { curtain.style.opacity = '1'; });
  await new Promise<void>((r) => setTimeout(r, 420));

  // 2. Tear down camera listeners (must happen before mundo is destroyed
  //    since listeners close over the mundo reference)
  destruirCamera();

  // 3. Stop the autosave timer — it holds a reference to the (soon to
  //    be destroyed) mundo and would keep ticking + serializing dead
  //    Pixi containers otherwise. Only pause-menu was calling this
  //    before; other voltar-ao-menu entry points slipped through.
  pararAutosave();

  // 4. Tear down game world
  if (_mundo) {
    destruirMundo(_mundo, app);
    _mundo = null;
  }

  // 4. Tear down all HUD panels
  if (_hudInstalled) {
    destruirSidebar();
    destruirEmpireBadge();
    destruirCreditsBar();
    destruirResourceBar();
    destruirChatLog();
    destruirPlanetPanel();
    destruirPlanetaDrawer();
    destruirBuildPanel();
    destruirShipPanel();
    destruirColonizerPanel();
    destruirColonyModal();
    destruirConfirmDialog();
    destruirMinimap();
    destruirDebugMenu();
    _hudInstalled = false;
  }

  // Remove error banner if present
  if (_bannerEl) {
    _bannerEl.remove();
    _bannerEl = null;
    _bannerLastErr = null;
  }

  _gameStarted = false;
  _transitioning = false;
  _fimTocado = false;
  pararMusicaAmbiente();

  // 5. Recreate menu background world (behind the curtain)
  const mundoMenu = await criarMundoMenu(app);
  app.stage.addChild(mundoMenu.container);
  _mundoMenu = mundoMenu;
  setCameraPos(mundoMenu.sistema.sol.x, mundoMenu.sistema.sol.y);
  setZoom(0.55);
  _cinematicTime = 0;

  // 6. Show main menu, then fade out the curtain to reveal it
  mostrarMainMenu();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  curtain.style.transition = 'opacity 400ms ease-out';
  curtain.style.opacity = '0';
  setTimeout(() => curtain.remove(), 420);
}

void bootstrap();
