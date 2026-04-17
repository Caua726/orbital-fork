import { Application } from 'pixi.js';
import type { Mundo, TipoJogador } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo, destruirMundo } from './world/mundo';
import { criarMundoMenu, atualizarMundoMenu, destruirMundoMenu, type MundoMenu } from './world/mundo-menu';
import { configurarCamera, destruirCamera, atualizarCamera, getCamera, setCameraPos, setTipoJogador, zoomIn, zoomOut, setZoom, instalarEdgeScroll, aplicarEdgeScrollAoCamera, cancelarComandoNaveSeAtivo } from './core/player';
import { instalarDispatcher, onAction, onActionUp } from './core/input/dispatcher';
import { criarSidebar, destruirSidebar } from './ui/sidebar';
import { criarEmpireBadge, destruirEmpireBadge } from './ui/empire-badge';
import { criarChatLog, destruirChatLog } from './ui/chat-log';
import { criarResourceBar, destruirResourceBar } from './ui/resource-bar';
import { criarCreditsBar, destruirCreditsBar } from './ui/credits-bar';
import { criarMinimap, atualizarMinimap, onMinimapClick, onMinimapZoomIn, onMinimapZoomOut, destruirMinimap } from './ui/minimap';
import { criarDebugMenu, atualizarDebugMenu, getDebugState, getCheats, destruirDebugMenu, setGameSpeed, fecharDebugOverlays, toggleDebugFast, toggleDebugFull } from './ui/debug-menu';
import { installRootVariables } from './ui/hud-layout';
import { criarPlanetPanel, atualizarPlanetPanel, destruirPlanetPanel } from './ui/planet-panel';
import { criarBuildPanel, atualizarBuildPanel, destruirBuildPanel } from './ui/build-panel';
import { criarShipPanel, atualizarShipPanel, destruirShipPanel } from './ui/ship-panel';
import { criarColonizerPanel, atualizarColonizerPanel, destruirColonizerPanel } from './ui/colonizer-panel';
import { criarColonyModal, atualizarColonyModal, destruirColonyModal } from './ui/colony-modal';
import { criarConfirmDialog, destruirConfirmDialog } from './ui/confirm-dialog';
import { criarMainMenu, esconderMainMenu, mostrarMainMenu } from './ui/main-menu';
import { abrirPauseMenu, isPauseMenuOpen } from './ui/pause-menu';
import { reconstruirMundo, iniciarAutosave, instalarListenersCicloDeVida, acumularTempoJogado, lerEMigrar, recuperarEmergency, salvarAgora, getBackendAtivo, getUltimoErro } from './world/save';
import type { MundoDTO } from './world/save';
import { toast } from './ui/toast';
import { getConfig, setConfigDuranteBoot, onConfigChange } from './core/config';
import { abrirNewWorldModal } from './ui/new-world-modal';
import { criarLoadingScreen, mostrarCarregando, esconderCarregando } from './ui/loading-screen';
import { somVitoria, somDerrota } from './audio/som';
import { setAppReferenceForBake } from './world/planeta-procedural';
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

async function bootstrap(): Promise<void> {
  installRootVariables();

  const app = new Application();

  const gfx = getConfig().graphics;
  const baseInit: any = {
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x000000,
    resolution: window.devicePixelRatio || 1,
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

  try {
    await app.init({ ...baseInit, preference: effectiveRenderer });
  } catch (err) {
    if (gfx.renderer === 'software') {
      console.warn('[renderer] Canvas renderer failed, falling back to WebGL:', err);
      setConfigDuranteBoot({ graphics: { ...getConfig().graphics, renderer: 'webgl' } });
      await app.init({ ...baseInit, preference: 'webgl' });
      window.setTimeout(() => toast('Renderizador Canvas indisponível — usando WebGL', 'err'), 2000);
    } else if (gfx.renderer === 'webgpu') {
      console.warn('[renderer] WebGPU failed, falling back to WebGL:', err);
      setConfigDuranteBoot({ graphics: { ...getConfig().graphics, renderer: 'webgl' } });
      await app.init({ ...baseInit, preference: 'webgl' });
      window.setTimeout(() => toast('WebGPU indisponível — usando WebGL', 'err'), 2000);
    } else if (effectiveRenderer === 'webgl' && gfx.webglVersion !== 'auto') {
      console.warn(`[renderer] WebGL ${gfx.webglVersion} forçado falhou, caindo pra auto:`, err);
      setConfigDuranteBoot({ graphics: { ...getConfig().graphics, webglVersion: 'auto' } });
      delete baseInit.context;
      delete baseInit.canvas;
      await app.init({ ...baseInit, preference: 'webgl' });
      window.setTimeout(() => toast(`WebGL ${gfx.webglVersion} indisponível — usando automático`, 'err'), 2000);
    } else {
      throw err;
    }
  }

  // Apply initial FPS cap
  if (gfx.fpsCap > 0) {
    app.ticker.maxFPS = gfx.fpsCap;
  }

  // React to config changes for FPS cap
  onConfigChange((cfg) => {
    app.ticker.maxFPS = cfg.graphics.fpsCap > 0 ? cfg.graphics.fpsCap : 0;
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
  let _fpsAccum = 0;
  let _fpsFrames = 0;
  app.ticker.add(() => {
    _fpsFrames++;
    _fpsAccum += app.ticker.deltaMS;
    if (_fpsAccum >= 500) {
      fpsEl.textContent = `${Math.round(_fpsFrames / (_fpsAccum / 1000))} FPS`;
      _fpsAccum = 0;
      _fpsFrames = 0;
    }
  });
  onConfigChange((cfg) => {
    fpsEl.style.display = cfg.graphics.mostrarFps ? 'block' : 'none';
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

  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.appendChild(app.canvas);

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });

  _app = app;
  (window as any)._app = app;
  setAppReferenceForBake(app);

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

  onAction('cancel_or_menu', () => {
    if (cancelarComandoNaveSeAtivo()) return;
    if (fecharDebugOverlays()) return;
    if (_gameStarted && !isPauseMenuOpen()) abrirPauseMenu();
  });

  onAction('toggle_debug_fast', () => { toggleDebugFast(); });
  onAction('toggle_debug_full', () => { toggleDebugFull(); });

  onAction('quicksave', () => {
    salvarAgora();
    toast('Salvo', 'info');
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
        onConfirm: (nome, tipoJogador) => { void iniciarJogoNovo(nome, tipoJogador); },
        onCancel: () => {},
      });
    },
    onLoadGame: (nome: string) => { void carregarMundo(nome); },
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

  if (!_hudInstalled) {
    _hudInstalled = true;
    criarEmpireBadge('Valorian Empire', 24);
    criarCreditsBar(43892);
    criarResourceBar();
    criarChatLog();
    criarSidebar();
    criarPlanetPanel();
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
  await esconderCarregando();
}

async function iniciarJogoNovo(nome: string, tipoJogador: TipoJogador): Promise<void> {
  if (!_app || _gameStarted || _transitioning) return;
  _transitioning = true;
  const app = _app;

  esconderMainMenu();
  mostrarCarregando('Criando mundo');
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  setTipoJogador();
  const mundo = await criarMundo(app, tipoJogador) as unknown as Mundo;
  await entrarNoJogo(mundo, nome, Date.now(), 0);
}

function mostrarModalSaveCorrompido(nome: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[save] load failed:', err);
  const action = prompt(
    `Não foi possível carregar "${nome}".\n\nErro: ${msg}\n\nDigite APAGAR pra remover o save, ou EXPORTAR pra baixar o JSON cru.`,
    '',
  );
  if (action === 'APAGAR') {
    void getBackendAtivo().apagar(nome);
    toast('Save apagado', 'info');
  } else if (action === 'EXPORTAR') {
    try {
      // Read raw string directly — carregar() swallows parse errors,
      // which defeats the purpose of exporting corrupt data.
      const rawStr = localStorage.getItem(`orbital_save:${nome}`);
      if (!rawStr) {
        toast('Nada para exportar', 'err');
        return;
      }
      const blob = new Blob([rawStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nome}-corrupt.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast('Save exportado', 'info');
    } catch (e) {
      toast('Falha ao exportar', 'err');
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
  mostrarCarregando(`Carregando mundo: ${nome}`);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  let dto: MundoDTO | null = null;
  try {
    dto = await recuperarEmergency(nome);
    if (!dto) dto = await lerEMigrar(nome);
  } catch (err) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    mostrarModalSaveCorrompido(nome, err);
    return;
  }
  if (!dto) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    toast(`Save "${nome}" não encontrado`, 'err');
    return;
  }

  try {
    setTipoJogador();
    const mundo = await reconstruirMundo(dto, app);
    await entrarNoJogo(mundo, nome, dto.criadoEm, dto.tempoJogadoMs);
  } catch (err) {
    _transitioning = false;
    await esconderCarregando();
    mostrarMainMenu();
    mostrarModalSaveCorrompido(nome, err);
  }
}

async function voltarAoMenu(): Promise<void> {
  if (!_app) return;
  const app = _app;

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

  // 3. Tear down game world
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
