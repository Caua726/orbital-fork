import { Application } from 'pixi.js';
import type { Mundo } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo } from './world/mundo';
import { criarMundoMenu, atualizarMundoMenu, destruirMundoMenu, type MundoMenu } from './world/mundo-menu';
import { configurarCamera, atualizarCamera, getCamera, setCameraPos, setTipoJogador, zoomIn, zoomOut, setZoom } from './core/player';
import { getTipos } from './ui/selecao';
import { criarSidebar } from './ui/sidebar';
import { criarEmpireBadge } from './ui/empire-badge';
import { criarChatLog } from './ui/chat-log';
import { criarResourceBar } from './ui/resource-bar';
import { criarCreditsBar } from './ui/credits-bar';
import { criarMinimap, atualizarMinimap, onMinimapClick, onMinimapZoomIn, onMinimapZoomOut } from './ui/minimap';
import { criarDebugMenu, atualizarDebugMenu, getDebugState, getCheats } from './ui/debug-menu';
import { installRootVariables } from './ui/hud-layout';
import { criarPlanetPanel, atualizarPlanetPanel } from './ui/planet-panel';
import { criarBuildPanel, atualizarBuildPanel } from './ui/build-panel';
import { criarShipPanel, atualizarShipPanel } from './ui/ship-panel';
import { criarColonizerPanel, atualizarColonizerPanel } from './ui/colonizer-panel';
import { criarColonyModal, atualizarColonyModal } from './ui/colony-modal';
import { criarConfirmDialog } from './ui/confirm-dialog';
import { criarMainMenu, esconderMainMenu } from './ui/main-menu';
import { somVitoria, somDerrota } from './audio/som';

// Top-level state shared across bootstrap and iniciarJogo.
let _app: Application | null = null;
let _mundo: Mundo | null = null;
let _mundoMenu: MundoMenu | null = null;
let _gameStarted = false;
let _hudInstalled = false;

// Cinematic camera state during the main menu.
let _cinematicPhase = 0;

async function bootstrap(): Promise<void> {
  installRootVariables();

  const app = new Application();
  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x000000,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: true,
  });

  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.appendChild(app.canvas);

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });

  _app = app;

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

  // Keyboard zoom — installed once, active during both menu and game.
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
  });

  // Start the ticker. During the menu it only updates the menu world +
  // cinematic camera; once iniciarJogo flips _gameStarted it switches to
  // the full game loop.
  startTicker();

  criarMainMenu({
    onNewGame: () => {
      void iniciarJogo();
    },
    onLoadGame: (_saveId: string) => {
      // Phase 2: save/load not implemented yet.
      void iniciarJogo();
    },
  });
}

function startTicker(): void {
  if (!_app) return;
  const app = _app;

  let fimTocado = false;

  app.ticker.add(() => {
    app.ticker.speed = getDebugState().gameSpeed;

    // ── Menu phase: cheap per-frame updates on the menu world only ──
    if (!_gameStarted) {
      if (!_mundoMenu) return;
      const menu = _mundoMenu;

      // Cinematic camera pan around the menu system's sun.
      _cinematicPhase += app.ticker.deltaMS / 40000;
      const angle = _cinematicPhase * Math.PI * 2;
      const radius = 900;
      const camera = getCamera();
      camera.x = menu.sistema.sol.x + Math.cos(angle) * radius;
      camera.y = menu.sistema.sol.y + Math.sin(angle) * radius * 0.6;

      // Apply the same camera transform the real game loop does so the
      // world actually shows at the camera position. atualizarCamera
      // expects a full Mundo but we only need the container transform;
      // inline it here against the menu container.
      menu.container.scale.set(camera.zoom);
      menu.container.x = -camera.x * camera.zoom + app.screen.width / 2;
      menu.container.y = -camera.y * camera.zoom + app.screen.height / 2;

      atualizarMundoMenu(menu, app, camera.x, camera.y, app.ticker.deltaMS);
      return;
    }

    // ── Game phase: full update of the real world + HUD ──
    if (!_mundo) return;
    const mundo = _mundo;

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
    atualizarMundo(mundo, app, camera);

    atualizarMinimap(camera);
    atualizarPlanetPanel(mundo, app);
    atualizarBuildPanel(mundo);
    atualizarShipPanel(mundo);
    atualizarColonizerPanel(mundo);
    atualizarColonyModal(mundo);
    atualizarDebugMenu();

    const estado = getEstadoJogo();
    if (estado === 'vitoria' && !fimTocado) {
      somVitoria();
      fimTocado = true;
    } else if (estado === 'derrota' && !fimTocado) {
      somDerrota();
      fimTocado = true;
    }
  });
}

async function iniciarJogo(): Promise<void> {
  if (!_app || _gameStarted) return;
  const app = _app;

  esconderMainMenu();

  // Tear down the menu background world so it doesn't keep running in
  // parallel with the real one.
  if (_mundoMenu) {
    destruirMundoMenu(_mundoMenu, app);
    _mundoMenu = null;
  }

  // Build the real game world.
  const tipoEscolhido = getTipos()[0];
  setTipoJogador();
  const mundo = await criarMundo(app, tipoEscolhido) as unknown as Mundo;
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

  // Flip the flag LAST so the ticker doesn't try to read _mundo before
  // all the HUD panels are ready.
  _gameStarted = true;
}

void bootstrap();
