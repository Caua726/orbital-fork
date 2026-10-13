import { Application } from 'pixi.js';
import type { Mundo, TipoJogador } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo, destruirMundo, setDificuldadeProximoMundo, getDificuldadeAtual } from './world/mundo';
import { criarNave as criarNaveTest, enviarNaveParaPosicao as enviarNaveParaPosicaoTest, enviarNaveParaAlvo as enviarNaveParaAlvoTest, removerNave as removerNaveTest } from './world/naves';
import { abrirPlanetaDrawer as abrirPlanetaDrawerTest } from './ui/planet-drawer';
import { getStarfieldMemoryBytes, precompilarShaderStarfield, setAppReferenceForFundo } from './world/fundo';
import { getCanvasPlanetsMemoryBytes, renderPlanetaParaCanvas } from './world/planeta-procedural';
import { getFogMemoryBytes, getMemoria as getMemoriaTest } from './world/nevoa';
import { getSpritesheetMemoryBytes } from './world/spritesheets';
import { getAiMemoryBytes } from './world/ia-memoria';
import { getLastSeenMemoryBytes } from './world/last-seen';
import { getCombateMemoryBytes } from './world/combate-resolucao';
import type { Dificuldade, PersonalidadeIA } from './world/personalidade-ia';
import type { ImperioJogador } from './world/imperio-jogador';
import { gerarPersonalidades, PRESETS_DIFICULDADE } from './world/personalidade-ia';
import { setPersonalidadesParaMundoCarregado } from './world/ia-decisao';
import { gerarLoreFaccao } from './world/lore-faccao';
import { criarMundoMenu, atualizarMundoMenu, destruirMundoMenu, type MundoMenu } from './world/mundo-menu';
import { configurarCamera, destruirCamera, atualizarCamera, getCamera, setCameraPos, setCameraPosAnimated, setTipoJogador, zoomIn, zoomOut, setZoom, instalarEdgeScroll, aplicarEdgeScrollAoCamera, cancelarComandoNaveSeAtivo, clearCameraFollow } from './core/player';
import { instalarDispatcher, onAction, onActionUp, setDispatcherHabilitado } from './core/input/dispatcher';
import { criarSidebar, destruirSidebar } from './ui/sidebar';
import { criarMobileMenuBtn, destruirMobileMenuBtn } from './ui/mobile-menu-btn';
import { criarEmpireBadge, atualizarEmpireBadge, setEmpireBadgeOnClick, destruirEmpireBadge } from './ui/empire-badge';
import { abrirEmpireModal, atualizarEmpireModal, destruirEmpireModal } from './ui/empire-modal';
import { criarChatLog, destruirChatLog } from './ui/chat-log';
import { criarResourceBar, destruirResourceBar, atualizarResourceBar } from './ui/resource-bar';
import { criarCreditsBar, destruirCreditsBar } from './ui/credits-bar';
import { criarMinimap, atualizarMinimap, onMinimapClick, onMinimapZoomIn, onMinimapZoomOut, destruirMinimap, fecharMinimapFullscreenSeAtivo } from './ui/minimap';
import { criarDebugMenu, atualizarDebugMenu, getDebugState, getCheats, destruirDebugMenu, setGameSpeed, fecharDebugOverlays, toggleDebugFast, toggleDebugFull } from './ui/debug-menu';
import { installRootVariables } from './ui/hud-layout';
import { instalarUiMode } from './core/ui-mode';
import { criarZoomControls, destruirZoomControls } from './ui/zoom-controls';
import { injectMobileStyles } from './ui/mobile.css';
import { injectAnimations } from './ui/animations.css';
import { criarPlanetPanel, atualizarPlanetPanel, destruirPlanetPanel } from './ui/planet-panel';
import { atualizarPlanetaDrawer, destruirPlanetaDrawer } from './ui/planet-drawer';
import { atualizarPlanetDetailsModal, destruirPlanetDetailsModal } from './ui/planet-details-modal';
import { atualizarMobilePlanetaDrawer, destruirMobilePlanetaDrawer } from './ui/mobile-planet-drawer';
import { atualizarStarDrawer } from './ui/star-drawer';
import { criarBuildPanel, atualizarBuildPanel, destruirBuildPanel } from './ui/build-panel';
import { criarShipPanel, atualizarShipPanel, destruirShipPanel } from './ui/ship-panel';
import { criarMobileShipPanel, atualizarMobileShipPanel, destruirMobileShipPanel } from './ui/mobile-ship-panel';
import { criarMobileColonizerPanel, atualizarMobileColonizerPanel, destruirMobileColonizerPanel } from './ui/mobile-colonizer-panel';
import { isTouchMode } from './core/ui-mode';

function isMobileRuntime(): boolean {
  if (isTouchMode()) return true;
  const b = document.body.classList;
  return b.contains('size-sm') || b.contains('mobile-ua');
}
import { criarColonizerPanel, atualizarColonizerPanel, destruirColonizerPanel } from './ui/colonizer-panel';
import { criarColonyModal, atualizarColonyModal, destruirColonyModal } from './ui/colony-modal';
import { criarConfirmDialog, destruirConfirmDialog } from './ui/confirm-dialog';
import { criarMainMenu, esconderMainMenu, mostrarMainMenu } from './ui/main-menu';
import { abrirPauseMenu, isPauseMenuOpen } from './ui/pause-menu';
import { reconstruirMundo, iniciarAutosave, pararAutosave, instalarListenersCicloDeVida, acumularTempoJogado, getTempoJogadoMs, lerEMigrarComRelatorio, recuperarEmergency, salvarAgora, getBackendAtivo, getUltimoErro } from './world/save';
import { instalarProviderRuntimeExtras, serializarMundo } from './world/save/serializar';
import { reconciliarMundo, resumirDiagnosticos } from './world/save/reconciler';
import { abrirSaveModal } from './ui/save-modal';
import type { MundoDTO } from './world/save';
import { toast } from './ui/toast';
import { getConfig, onConfigChange, setConfig, setGraphicsEngine, type GraphicsEngine, type PixiBackend, type WeydraBackend } from './core/config';
import { abrirNewWorldModal } from './ui/new-world-modal';
import { criarLoadingScreen, mostrarCarregando, esconderCarregando, setLoadingFase } from './ui/loading-screen';
import { t } from './core/i18n/t';
import { somVitoria, somDerrota } from './audio/som';
import { iniciarMusicaAmbiente, pararMusicaAmbiente } from './audio/musica-ambiente';
import { setAppReferenceForBake, precompilarShadersPlaneta } from './world/planeta-procedural';
import { setRenderFpsCap, aplicarTamanhoRenderizador, takePaintedFrameCount } from './weydra-loader';
import { destroyEngineRuntime, initializeEngineRuntime, resizeEngineRuntime } from './core/engine-runtime';
import { fecharTelaErro, instalarErrorBoundary, mostrarTelaErro } from './ui/error-screen';
import { abrirMatchResultModal } from './ui/match-result-modal';
import { continuarComoSandbox } from './world/match-state';
// Top-level state shared across bootstrap, iniciarJogoNovo, and carregarMundo.
let _app: Application | null = null;
let _mundo: Mundo | null = null;
let _mundoMenu: MundoMenu | null = null;
let _gameStarted = false;
let _hudInstalled = false;
let _transitioning = false;
let _fimTocado = false;
let _sessionMeta: { nome: string; criadoEm: number } | null = null;

interface EngineSwitchRequest {
  engine: GraphicsEngine;
  pixiBackend?: PixiBackend;
  weydraBackend?: WeydraBackend;
  pixiWebglVersion?: 'auto' | '1' | '2';
  pixiGpuPreference?: 'auto' | 'high-performance' | 'low-power';
}

// Cinematic camera state during the main menu. Accumulated seconds,
// fed into layered sines for a non-circular, more organic drift.
let _cinematicTime = 0;

const _panState = { up: false, down: false, left: false, right: false };
let _hudAcumMs = 0;

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
const _guardedCanvases = new WeakSet<HTMLCanvasElement>();

function instalarGuardasCanvas(canvas: HTMLCanvasElement, engine: GraphicsEngine): void {
  if (_guardedCanvases.has(canvas)) return;
  _guardedCanvases.add(canvas);
  canvas.addEventListener('webglcontextlost', (event: Event) => {
    // app.destroy() deliberately loses its context during an engine
    // transaction. That is teardown, not a recoverable device failure.
    if (_transitioning || !canvas.isConnected) return;
    console.warn(`[renderer] contexto WebGL perdido (${engine})`);
    if (engine === 'weydra') {
      // Weydra não recria buffers/pipelines/texturas de um contexto perdido, e
      // preventDefault() faria o navegador "restaurar" um contexto que o
      // renderer não sabe reconstruir (quadro preto silencioso). Tratar como
      // fatal troca a sessão para o Pixi, que reconstrói tudo do DTO.
      window.dispatchEvent(new CustomEvent('orbital:renderer-fatal', {
        detail: { engine: 'weydra', error: new Error('contexto WebGL perdido') },
      }));
      return;
    }
    event.preventDefault();
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
    if (!_transitioning) console.info('[renderer] WebGL context restored');
  });
}

async function bootstrap(): Promise<void> {
  instalarErrorBoundary();
  installRootVariables();
  // Instrument long tasks, layout shifts, paints, event-delay,
  // listener/timer/RAF counts. Cheap — observers run on browser's
  // own thread; wrapper cost per listener is a single counter inc.
  const { instalarInstrumentacao } = await import('./core/profiling-instr');
  instalarInstrumentacao();

  const runtime = await initializeEngineRuntime();
  const app = runtime.app;
  // Both engines paint into a canvas that the browser can lose (WebGL context
  // loss); the guard is what turns that into a visible failure instead of a
  // frozen frame.
  instalarGuardasCanvas(runtime.canvas, runtime.engine);
  const gfx = getConfig().graphics;
  const renderScale = gfx.renderScale ?? 1;
  await import('./world/profiling');

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
      // Aviso ao usuário MAS sem mexer nas configurações gráficas. A
      // versão anterior forçava o preset 'minimo' ao detectar software
      // renderer; em alguns Androids a detecção disparava a cada boot
      // (dependendo do que o Chrome retornava em WEBGL_debug_renderer_info)
      // e sobrescrevia as preferências do usuário. Agora só avisa —
      // quem decide o preset é o player.
      window.setTimeout(() => {
        toast(`Renderizando via ${sw.friendlyName} — GPU do navegador está desabilitada. Se o jogo estiver lento, experimente um preset menor em Configurações.`, 'err');
      }, 1500);
      console.warn(`[renderer] software detected: ${sw.friendlyName} (${sw.kind}) — not auto-applying any preset`);
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
  // FPS mode now drives the REAL weydra render loop (the Pixi ticker is a
  // dead no-op shim post-M10.1). vsync on → uncapped, rAF paces to the
  // display refresh. vsync off + cap → throttle the render loop to `cap`
  // fps. The previous implementation drove `app.ticker` (no-op) and, in
  // the vsync-off branch, spawned a perpetual ~250 Hz setTimeout loop that
  // called a no-op forever — a CPU leak that never stopped.
  const aplicarModoFps = (vsync: boolean, cap: number): void => {
    setRenderFpsCap(vsync ? 0 : cap);
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
    const needed = Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
    return needed > 0 ? maxTex / needed : 4;
  };

  onConfigChange((cfg) => {
    const requested = cfg.graphics.renderScale ?? 1;
    const safeMax = getMaxRenderScale();
    const next = Math.min(requested, safeMax);
    if (next === _lastRenderScale) return;
    _lastRenderScale = next;
    // Drive the weydra surface directly — recompute the backing-store size
    // (weydra-loader's currentSize reads renderScale) and resize the wgpu
    // surface. The old code set app.renderer.resolution (read by nothing)
    // and called the shim resize (which never re-configured the weydra
    // surface), so renderScale had zero effect under weydra.
    aplicarTamanhoRenderizador();
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

  // M10.1: replace the no-op `app.ticker.add` FPS/RAM hook with a
  // 500ms setInterval. The original 60 Hz FPS sampling is overkill
  // for a HUD; the sampling is now decoupled from the game loop.
  setInterval(() => {
    // Painted frames over the last 500 ms (from the weydra render loop, so
    // an active fps cap is reflected). The previous version zeroed a counter
    // BEFORE reading it (always 0 FPS) and nothing incremented it.
    const frames = takePaintedFrameCount();
    fpsEl.textContent = `${Math.round(frames / 0.5)} FPS`;
    if (ramEl.style.display !== 'none') {
      sampleRam();
    }
  }, 500);
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
  // M10.1: app.canvas IS the weydra canvas (index.html's
  // <canvas id="weydra-canvas">). The weydra canvas is already
  // positioned via the style attribute in index.html (z-index: 0);
  // no further CSS work is needed here. The comment above about
  // Pixi stacking above weydra is historical (M6) — there's no
  // longer a separate Pixi canvas to position.
  void app.canvas.style;

  window.addEventListener('resize', () => {
    // M10 review: update the shim's `app.screen` so call sites
    // that read app.screen.{width,height} (e.g. src/core/player.ts
    // for camera-pan math) see fresh values. The weydra canvas
    // itself is already CSS-sized (100vw / 100vh in index.html).
    resizeEngineRuntime();
  });

  _app = app;
  (window as any)._app = app;
  // Debug/diagnostics hooks (same spirit as `_app` above): let DevTools and
  // the headless smoke test inspect the live world / drive the camera
  // without a module import.
  (window as any).__mundo = () => _mundo;
  (window as any).__setCam = (x: number, y: number) => setCameraPos(x, y);
  (window as any).__setZoom = (z: number) => setZoom(z);
  // Headless-audit driver: spawn/move ships, force combat, tick the sim —
  // lets an automated screenshot pass exercise render paths (ships, trails,
  // beams, fog ghost) that need live game state. Dev-only, same spirit as
  // the cheats box; guarded behind the window namespace.
  (window as any).__test = {
    spawn: (tipo: string, n = 1) => {
      if (!_mundo) return 'no mundo';
      const home = _mundo.planetas.find((p) => p.dados.dono === 'jogador');
      if (!home) return 'no home';
      const out = [];
      for (let i = 0; i < n; i++) {
        const nv = criarNaveTest(_mundo, home, tipo, 1);
        out.push(nv.id);
      }
      return out;
    },
    send: (naveId: string, x: number, y: number) => {
      if (!_mundo) return 'no mundo';
      const nv = _mundo.naves.find((n) => n.id === naveId);
      if (!nv) return 'no ship';
      return enviarNaveParaPosicaoTest(_mundo, nv, x, y);
    },
    ships: () => (_mundo?.naves ?? []).map((n) => ({ id: n.id, tipo: n.tipo, dono: n.dono, x: Math.round(n.x), y: Math.round(n.y), estado: n.estado })),
    openDrawer: () => {
      if (!_mundo) return 'no mundo';
      const home = _mundo.planetas.find((p) => p.dados.dono === 'jogador');
      if (!home) return 'no home';
      void abrirPlanetaDrawerTest(home, _mundo);
      return 'ok';
    },
    removeShip: (id: string) => {
      if (!_mundo) return 'no mundo';
      const nv = _mundo.naves.find((n) => n.id === id);
      if (!nv) return 'no ship';
      removerNaveTest(_mundo, nv);
      return 'ok';
    },
    speed: (n: number) => { setGameSpeed(n); return 'ok'; },
    // Non-zero while combat beams / impact particles are live on screen.
    combatBytes: () => getCombateMemoryBytes(),
    sendToPlanet: (shipId: string, planetId: string) => {
      if (!_mundo) return 'no mundo';
      const nv = _mundo.naves.find((n) => n.id === shipId);
      const pl = _mundo.planetas.find((p) => p.id === planetId);
      if (!nv || !pl) return 'not found';
      return enviarNaveParaAlvoTest(_mundo, nv, pl);
    },
    ghost: (planetId: string) => {
      if (!_mundo) return 'no mundo';
      const pl = _mundo.planetas.find((p) => p.id === planetId);
      if (!pl) return 'no planet';
      const mem = getMemoriaTest(pl);
      if (!mem) return { hasMemoria: false };
      return {
        hasMemoria: true,
        conhecida: mem.conhecida,
        visualVisible: mem.visual.visible,
        memX: mem.dados ? Math.round(mem.dados.x) : null,
        memY: mem.dados ? Math.round(mem.dados.y) : null,
        hasFantasma: !!mem.visual.fantasma,
      };
    },
    // Rasterize a planet/sun portrait (the CPU path used by all 5 drawer/
    // panel/modal surfaces) and report how much of it is non-blank — a
    // blank canvas = the regression the fix addressed.
    portrait: (kind = 'planet') => {
      if (!_mundo) return 'no mundo';
      const obj = kind === 'sun'
        ? _mundo.sois[0]
        : _mundo.planetas.find((p) => p.dados.dono === 'jogador');
      if (!obj) return 'no obj';
      const c = renderPlanetaParaCanvas(obj as any, 96);
      if (!c) return { ok: false, reason: 'null canvas' };
      const ctx = c.getContext('2d');
      const d = ctx!.getImageData(0, 0, c.width, c.height).data;
      let nonBlank = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] > 12 && d[i + 3] > 8) nonBlank++;
      }
      return { ok: true, w: c.width, h: c.height, nonBlankPct: Math.round((nonBlank / (c.width * c.height)) * 100) };
    },
  };
  setAppReferenceForBake(app);

  // Pre-compile the planet/star shader programs NOW so the driver link
  // step happens during boot (where a pause is expected) instead of
  // mid-frame the first time a real planet renders. Without this the
  // initial ~second of gameplay showed a visible FPS sag while the GL
  // driver compiled + linked the shared GlProgram.
  setAppReferenceForFundo(app);
  await precompilarShadersPlaneta(app);
  await precompilarShaderStarfield(app);

  // Boot the weydra renderer BEFORE building any world. The menu world
  // (criarMundoMenu → criarSistemaSolar) creates sprites/graphics/text
  // via the GraphicsAdapter/sprite pool, which dispatch to weydra only
  // when getWeydraRenderer() !== null. If weydra starts after the menu
  // is built, every menu primitive silently falls back to the Pixi path
  // (dead code post-M10) — black menu + addChild deprecation spam. Await
  // here so the renderer exists when the first world is constructed.
  // The selected engine runtime is already initialized before world creation.

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
    if (nave) { setCameraPosAnimated(nave.x, nave.y); return; }
    const planeta = _mundo.planetas.find((p) => p.dados.selecionado);
    if (planeta) { setCameraPosAnimated(planeta.x, planeta.y); return; }
    const sol = _mundo.sois.find((s) => (s as any)._selecionado);
    if (sol) { setCameraPosAnimated(sol.x, sol.y); return; }
    const home = _mundo.planetas.find((p) => p.dados.dono === 'jogador');
    if (home) setCameraPosAnimated(home.x, home.y);
  });

  onAction('cancel_or_menu', () => {
    if (cancelarComandoNaveSeAtivo()) return;
    // Collapse fullscreen minimap before anything else — it's a
    // dedicated overlay state, closing it on ESC matches every
    // other modal in the game.
    if (fecharMinimapFullscreenSeAtivo()) return;
    if (fecharDebugOverlays()) return;
    if (_gameStarted && !isPauseMenuOpen()) abrirPauseMenu();
  });

  onAction('toggle_debug_fast', () => { toggleDebugFast(); });
  onAction('toggle_debug_full', () => { toggleDebugFull(); });

  onAction('quicksave', () => {
    void salvarAgora().then((ok) => {
      const message = ok
        ? t('toast.salvo')
        : t('hud.erro_salvar', { msg: getUltimoErro()?.message ?? 'erro desconhecido' });
      toast(message, ok ? 'info' : 'err');
    });
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
        onConfirm: (r) => { void iniciarJogoNovo(r.nome, r.tipoJogador, r.dificuldade, r.imperio); },
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

  window.addEventListener('orbital:request-engine-switch', (event: Event) => {
    const detail = (event as CustomEvent<Partial<EngineSwitchRequest>>).detail;
    if (detail?.engine === 'pixi' || detail?.engine === 'weydra') {
      void trocarMotorEmRuntime(detail as EngineSwitchRequest);
    }
  });

  window.addEventListener('orbital:renderer-fatal', (event: Event) => {
    const detail = (event as CustomEvent<{ engine?: GraphicsEngine; error?: unknown }>).detail;
    if (detail?.engine !== 'weydra' || _transitioning) return;
    toast('Weydra falhou durante a renderização; recuperando a sessão no Pixi.', 'err');
    void trocarMotorEmRuntime({ engine: 'pixi' });
  });

  window.addEventListener('orbital:voltar-ao-menu', () => {
    void voltarAoMenu();
  });

  // Hardware back (Android back button, iOS edge-swipe in PWA).
  // Push initial state so popstate is interceptable; convert to a custom
  // event that open modals can listen for. Fire-and-forget — modals that
  // don't subscribe simply ignore it.
  try {
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState({ orbital: 'root' }, '');
      window.addEventListener('popstate', () => {
        window.dispatchEvent(new CustomEvent('orbital:hardware-back'));
        // Re-push so the next back press is also catchable.
        history.pushState({ orbital: 'root' }, '');
      });
    }
  } catch { /* SSR / restricted env */ }

  // weydra-renderer was already booted earlier in bootstrap() (before
  // criarMundoMenu) so the menu world's primitives use the weydra path.
  // Engine initialization is centralized in engine-runtime.ts.
}

function startTicker(): void {
  if (!_app) return;

  // M10.1 fix: the Pixi `app.ticker.add(...)` is now a no-op shim.
  // Convert the game loop to a real rAF loop. `_lastT` tracks the
  // wall-clock delta, written to `app.ticker.deltaMS` each frame
  // so the existing call sites that read it see the right value.
  let _lastT = performance.now();
  function _gameTick(): void {
    const app = _app;
    if (!app) {
      requestAnimationFrame(_gameTick);
      return;
    }
    const _now = performance.now();
    // Clamp the wall delta: after the tab is backgrounded/refocused the gap
    // can be seconds, which would feed one giant delta into the economy
    // catch-up loop + combat accumulator (a spike / burst of simulation).
    // 100 ms matches Pixi's default ticker ceiling (_maxElapsedMS), so the
    // simulation advances per hitch exactly like the original Pixi-driven loop.
    const _dt = Math.min(_now - _lastT, 100);
    _lastT = _now;
    (app.ticker as { deltaMS: number }).deltaMS = _dt;
    (app.ticker as { speed: number }).speed = getDebugState().gameSpeed;
    _gameTickBody(app);
    requestAnimationFrame(_gameTick);
  }
  function _gameTickBody(app: Application): void {

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
    const anyPan = _panState.up || _panState.down || _panState.left || _panState.right;
    if (_panState.up) camera.y -= panScale;
    if (_panState.down) camera.y += panScale;
    if (_panState.left) camera.x -= panScale;
    if (_panState.right) camera.x += panScale;
    if (anyPan) clearCameraFollow();

    atualizarMundo(mundo, app, camera);

    // HUD refresh throttle — DOM mutations don't need 60 Hz. Cap to ~30 Hz
    // (33 ms) so heavy panels (resource-bar, build-panel, ship-panel) run
    // half as often without any visible lag.
    _hudAcumMs += app.ticker.deltaMS;
    if (_hudAcumMs >= 33) {
      _hudAcumMs = 0;
      atualizarMinimap(camera);
      atualizarPlanetPanel(mundo, app);
      if (isMobileRuntime()) atualizarMobilePlanetaDrawer();
      else atualizarPlanetaDrawer();
      atualizarPlanetDetailsModal();
      atualizarStarDrawer();
      atualizarResourceBar(mundo);
      atualizarEmpireBadge(mundo);
      atualizarEmpireModal();
      atualizarBuildPanel(mundo);
      if (isMobileRuntime()) {
        atualizarMobileShipPanel(mundo);
        atualizarMobileColonizerPanel(mundo);
      } else {
        atualizarShipPanel(mundo);
        atualizarColonizerPanel(mundo);
      }
      atualizarColonyModal(mundo);
      atualizarDebugMenu();
      atualizarHudBannerErro();
    }

    const estado = getEstadoJogo();
    if (estado === 'vitoria' && !_fimTocado) {
      void processarFimPartida(mundo, 'victory');
    } else if (estado === 'derrota' && !_fimTocado) {
      void processarFimPartida(mundo, 'defeat');
    }
  }
  // M10.1: start the rAF loop. The game loop now fires on
  // requestAnimationFrame directly — `app.ticker.add` is a no-op
  // shim, so the original Pixi-ticker-driven game loop never fired.
  requestAnimationFrame(_gameTick);
}

function desmontarHud(): void {
  if (!_hudInstalled) return;
  destruirSidebar();
  destruirEmpireBadge();
  destruirEmpireModal();
  destruirCreditsBar();
  destruirResourceBar();
  destruirChatLog();
  destruirPlanetPanel();
  destruirPlanetaDrawer();
  destruirMobilePlanetaDrawer();
  destruirPlanetDetailsModal();
  destruirBuildPanel();
  destruirShipPanel();
  destruirMobileShipPanel();
  destruirMobileColonizerPanel();
  destruirColonizerPanel();
  destruirColonyModal();
  destruirConfirmDialog();
  destruirMinimap();
  destruirDebugMenu();
  destruirZoomControls();
  destruirMobileMenuBtn();
  _hudInstalled = false;
}

async function processarFimPartida(mundo: Mundo, result: 'victory' | 'defeat'): Promise<void> {
  if (_fimTocado) return;
  _fimTocado = true;
  const previousSpeed = getDebugState().gameSpeed || 1;
  setGameSpeed(0);
  if (result === 'victory') somVitoria();
  else somDerrota();
  // Keep the previous autosave intact on defeat so "load" really restores
  // a playable checkpoint. Victory is persisted before sandbox is offered.
  if (result === 'victory') await salvarAgora();
  const sessionName = _sessionMeta?.nome ?? null;
  const action = await abrirMatchResultModal(mundo, result);
  if (action === 'continue' && result === 'victory') {
    continuarComoSandbox(mundo);
    setGameSpeed(previousSpeed);
    await salvarAgora();
    return;
  }
  await voltarAoMenu();
  if (action === 'load' && sessionName) await carregarMundo(sessionName);
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
    setEmpireBadgeOnClick(() => {
      if (_mundo) void abrirEmpireModal(_mundo);
    });
    if (CREDITS_BAR_HABILITADO) criarCreditsBar(43892, GLOBE_HABILITADO);
    criarResourceBar();
    // Temporarily disabled — sidebar and chat log weren't earning
    // their screen real estate. The code is preserved so they can be
    // re-enabled by flipping HUD_LEGACY_HABILITADO below.
    if (HUD_LEGACY_HABILITADO) {
      criarChatLog();
      criarSidebar();
    }
    // Hamburger that opens the pause menu directly on narrow/touch screens.
    criarMobileMenuBtn();
    // The side planet-panel is superseded by the new planet-modal
    // (opened on planet click). Kept in code but not instantiated —
    // flip PLANET_PANEL_HABILITADO to restore.
    if (PLANET_PANEL_HABILITADO) criarPlanetPanel();
    criarBuildPanel();
    if (isMobileRuntime()) {
      criarMobileShipPanel();
      criarMobileColonizerPanel();
    } else {
      criarShipPanel();
      criarColonizerPanel();
    }
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
  _sessionMeta = { nome, criadoEm };
  iniciarAutosave({ mundo, nome, criadoEm, tempoJogadoMs });
  salvarAgora();
  iniciarMusicaAmbiente(mundo.seedMusical);
  await esconderCarregando();
}

async function iniciarJogoNovo(nome: string, tipoJogador: TipoJogador, dificuldade: Dificuldade = 'normal', imperio?: ImperioJogador): Promise<void> {
  if (!_app || _gameStarted || _transitioning) return;
  _transitioning = true;
  const app = _app;

  try {
    esconderMainMenu();
    mostrarCarregando(t('loading.criando'));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    setTipoJogador();
    setDificuldadeProximoMundo(dificuldade);
    const mundo = await criarMundo(app, tipoJogador, async (label) => {
      await setLoadingFase(label);
    }) as unknown as Mundo;
    if (imperio) {
      if (dificuldade === 'pacifico' && imperio.objetivo === 'sobrevivencia') {
        imperio = { ...imperio, objetivo: 'livre' };
        toast('Sobrevivência requer adversários; objetivo convertido para Livre.', 'info');
      }
      mundo.imperioJogador = imperio;
      mundo.match.objective = imperio.objetivo;
    }
    await entrarNoJogo(mundo, nome, Date.now(), 0);
    _transitioning = false;
  } catch (err) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    const action = await mostrarTelaErro({
      code: 'WORLD_CREATE_FAILED',
      title: 'NÃO FOI POSSÍVEL CRIAR A GALÁXIA',
      summary: 'O menu foi restaurado com segurança. Você pode tentar novamente ou trocar o motor gráfico.',
      error: err,
      actions: [
        { label: 'Tentar novamente', value: 'retry', primary: true },
        { label: 'Voltar ao menu', value: 'menu' },
      ],
    });
    fecharTelaErro();
    if (action === 'retry') void iniciarJogoNovo(nome, tipoJogador, dificuldade, imperio);
  }
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
    try {
      await getBackendAtivo().apagar(nome);
      toast(t('toast.save_apagado'), 'info');
    } catch (deleteError) {
      void mostrarTelaErro({
        code: 'SAVE_DELETE_FAILED',
        title: 'NÃO FOI POSSÍVEL APAGAR O SAVE',
        summary: 'O save foi mantido. Tente novamente ou exporte os dados antes de recarregar.',
        error: deleteError,
      });
    }
  } else if (choice === 'EXPORTAR') {
    try {
      const rawStr = await getBackendAtivo().exportar(nome);
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
    } catch {
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

  let dto: MundoDTO | null;
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
      const hasErro = diag.some((d) => d.severidade === 'erro');
      const hasWarn = diag.some((d) => d.severidade === 'warn');
      if (hasErro) {
        // Severidade 'erro' means the reconciler detected drift too
        // severe to auto-heal safely (orphan refs, impossible tiers,
        // etc.). Entering anyway produces the "tela toda bugada" the
        // user complained about. Abort cleanly instead — surface the
        // diagnostics through the corrupt-save modal path so the
        // player can export/delete the file.
        throw new Error(
          `Reconciliação detectou ${diag.filter((d) => d.severidade === 'erro').length} erro(s) crítico(s): ` +
          diag.filter((d) => d.severidade === 'erro').map((d) => `[${d.categoria}] ${d.detalhe}`).join('; '),
        );
      }
      if (hasWarn) {
        // Non-trivial but healable drift — show modal so the player
        // can inspect what was auto-fixed before jumping into the game.
        void abrirSaveModal({
          title: 'SAVE RECONCILIADO',
          severity: 'warn',
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
    _transitioning = false;
    // Don't restore the previous UI selection — re-opening a save with a
    // planet still "selected" auto-pops the build-panel on entry, which
    // is unwanted noise. Player can re-select what they need.
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

async function reconstruirSnapshot(dto: MundoDTO, app: Application): Promise<Mundo> {
  if (dto.dificuldade) setDificuldadeProximoMundo(dto.dificuldade);
  const mundo = await reconstruirMundo(dto, app, undefined, async (label) => {
    await setLoadingFase(label);
  });
  restaurarOuReinicializarIas(mundo, dto);
  const [{ restaurarMemoriasIa }, { setIaTickState }] = await Promise.all([
    import('./world/ia-memoria'),
    import('./world/ia-decisao'),
  ]);
  if (dto.iaMemoria) restaurarMemoriasIa(dto.iaMemoria);
  if (dto.iaTickState) setIaTickState(dto.iaTickState);
  const diag = reconciliarMundo(mundo, dto);
  const critical = diag.filter((d) => d.severidade === 'erro');
  if (critical.length > 0) {
    throw new Error(critical.map((d) => `[${d.categoria}] ${d.detalhe}`).join('; '));
  }
  return mundo;
}

function exportarSnapshotEmergencia(dto: MundoDTO): void {
  const blob = new Blob([JSON.stringify(dto, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${dto.nome || 'orbital'}-engine-recovery.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function montarRuntimeComSnapshot(engine: GraphicsEngine, dto: MundoDTO | null): Promise<void> {
  setGraphicsEngine(engine);
  const runtime = await initializeEngineRuntime(engine);
  _app = runtime.app;
  (window as any)._app = runtime.app;
  instalarGuardasCanvas(runtime.canvas, runtime.engine);
  setAppReferenceForBake(runtime.app);
  setAppReferenceForFundo(runtime.app);

  if (!dto) {
    const menu = await criarMundoMenu(runtime.app);
    runtime.app.stage.addChild(menu.container);
    _mundoMenu = menu;
    setCameraPos(menu.sistema.sol.x, menu.sistema.sol.y);
    setZoom(0.55);
    return;
  }

  const mundo = await reconstruirSnapshot(dto, runtime.app);
  await entrarNoJogo(mundo, dto.nome, dto.criadoEm, dto.tempoJogadoMs);
  if (dto.camera) {
    setCameraPos(dto.camera.x, dto.camera.y);
    setZoom(dto.camera.zoom);
  }
  if (dto.selecaoUI?.planetaId) {
    const p = mundo.planetas.find((v) => v.id === dto.selecaoUI!.planetaId);
    if (p) p.dados.selecionado = true;
  }
  if (dto.selecaoUI?.naveId) {
    const n = mundo.naves.find((v) => v.id === dto.selecaoUI!.naveId);
    if (n) n.selecionado = true;
  }
  if (typeof dto.gameSpeed === 'number') setGameSpeed(dto.gameSpeed);
}

async function trocarMotorEmRuntime(request: EngineSwitchRequest): Promise<void> {
  const target = request.engine;
  const currentRendering = getConfig().rendering;
  const backendChanged = request.pixiBackend !== undefined
    || request.weydraBackend !== undefined
    || request.pixiWebglVersion !== undefined
    || request.pixiGpuPreference !== undefined;
  if (_transitioning || (!backendChanged && target === currentRendering.engine) || !_app) return;
  _transitioning = true;
  setDispatcherHabilitado(false);
  const previousRendering = JSON.parse(JSON.stringify(currentRendering)) as typeof currentRendering;
  const previousEngine = previousRendering.engine;
  if (request.pixiBackend) {
    setConfig({ rendering: {
      ...getConfig().rendering,
      pixi: { ...getConfig().rendering.pixi, backend: request.pixiBackend },
    } });
  }
  if (request.weydraBackend) {
    setConfig({ rendering: {
      ...getConfig().rendering,
      weydra: { backend: request.weydraBackend },
    } });
  }
  if (request.pixiWebglVersion || request.pixiGpuPreference) {
    const rendering = getConfig().rendering;
    setConfig({ rendering: {
      ...rendering,
      pixi: {
        ...rendering.pixi,
        ...(request.pixiWebglVersion ? { webglVersion: request.pixiWebglVersion } : {}),
        ...(request.pixiGpuPreference ? { gpuPreference: request.pixiGpuPreference } : {}),
      },
    } });
  }
  const oldApp = _app;
  const dto = _mundo && _sessionMeta
    ? serializarMundo(_mundo, _sessionMeta.nome, {
      criadoEm: _sessionMeta.criadoEm,
      tempoJogadoMs: getTempoJogadoMs(),
    })
    : null;
  if (dto) {
    try { localStorage.setItem('orbital_engine_switch_recovery', JSON.stringify(dto)); } catch { /* quota */ }
  }

  mostrarCarregando(`Trocando para ${target === 'pixi' ? 'Pixi' : 'Weydra'}`);
  try {
    pararAutosave();
    destruirCamera();
    desmontarHud();
    pararMusicaAmbiente();
    if (_mundo) destruirMundo(_mundo, oldApp);
    if (_mundoMenu) destruirMundoMenu(_mundoMenu, oldApp);
    _mundo = null;
    _mundoMenu = null;
    _gameStarted = false;
    _app = null;
    (window as any)._app = null;
    destroyEngineRuntime();

    await montarRuntimeComSnapshot(target, dto);
    localStorage.removeItem('orbital_engine_switch_recovery');
    toast(`Motor alterado para ${target === 'pixi' ? 'Pixi' : 'Weydra'}.`, 'info');
    window.dispatchEvent(new CustomEvent('orbital:engine-changed', {
      detail: { ok: true, engine: target },
    }));
  } catch (switchError) {
    console.error('[engine-switch] target failed, rolling back:', switchError);
    try {
      if (_mundo && _app) destruirMundo(_mundo, _app);
      if (_mundoMenu && _app) destruirMundoMenu(_mundoMenu, _app);
      _mundo = null;
      _mundoMenu = null;
      _gameStarted = false;
      _app = null;
      (window as any)._app = null;
      destroyEngineRuntime();
      setConfig({ rendering: previousRendering });
      await montarRuntimeComSnapshot(previousEngine, dto);
      window.dispatchEvent(new CustomEvent('orbital:engine-changed', {
        detail: { ok: false, engine: previousEngine },
      }));
      const choice = await mostrarTelaErro({
        code: 'ENGINE_SWITCH_ROLLBACK',
        title: 'NÃO FOI POSSÍVEL TROCAR O MOTOR',
        summary: 'A partida foi restaurada no motor anterior. Os backends alternativos do motor solicitado também falharam.',
        error: switchError,
        actions: [{ label: 'Continuar', value: 'continue', primary: true }],
      });
      if (choice === 'continue') fecharTelaErro();
    } catch (rollbackError) {
      const choice = await mostrarTelaErro({
        code: 'ENGINE_SWITCH_FATAL',
        title: 'FALHA AO RESTAURAR A PARTIDA',
        summary: 'O snapshot de emergência continua disponível. Exporte-o antes de recarregar.',
        error: rollbackError,
        actions: [
          ...(dto ? [{ label: 'Exportar snapshot', value: 'export', primary: true }] : []),
          { label: 'Recarregar', value: 'reload' },
        ],
      });
      if (choice === 'export' && dto) exportarSnapshotEmergencia(dto);
      if (choice === 'reload') window.location.reload();
    }
  } finally {
    _transitioning = false;
    setDispatcherHabilitado(true);
    await esconderCarregando();
  }
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
  desmontarHud();

  // Remove error banner if present
  if (_bannerEl) {
    _bannerEl.remove();
    _bannerEl = null;
    _bannerLastErr = null;
  }

  _gameStarted = false;
  _sessionMeta = null;
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

// Determinism harness short-circuit. When the URL contains
// `?weydra_determinism_test=1`, skip the full game bootstrap and render
// a single fixed-seed planet for the headless runner to screenshot.
// Strictly additive: any other URL path falls through to bootstrap().
async function maybeBootDeterminism(): Promise<boolean> {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('weydra_determinism_test') !== '1') return false;
  } catch {
    return false;
  }
  const mod = await import('./world/determinism-scene');
  await mod.rodarCenaDeterminismo();
  return true;
}

void (async () => {
  try {
    if (await maybeBootDeterminism()) return;
    await bootstrap();
  } catch (err) {
    const action = await mostrarTelaErro({
      code: 'BOOT_FATAL',
      title: 'O ORBITAL NÃO CONSEGUIU INICIAR',
      summary: 'Nenhum backend do motor selecionado pôde ser inicializado.',
      error: err,
      actions: [
        { label: 'Iniciar em Pixi Canvas', value: 'safe', primary: true },
        { label: 'Recarregar', value: 'reload' },
      ],
    });
    if (action === 'safe') {
      setConfig({ rendering: {
        ...getConfig().rendering,
        engine: 'pixi',
        pixi: { ...getConfig().rendering.pixi, backend: 'canvas' },
      } });
      window.location.reload();
    } else if (action === 'reload') window.location.reload();
  }
})();
