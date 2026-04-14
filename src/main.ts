import { Application } from 'pixi.js';
import type { Mundo } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo } from './world/mundo';
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

  // Build the procedural world up front so the menu can render it as a
  // live background. The same world is reused when the player clicks
  // Novo Jogo — no destroy/recreate, just a transition from cinematic
  // camera to player control.
  const tipoEscolhido = getTipos()[0];
  setTipoJogador();
  const mundo = await criarMundo(app, tipoEscolhido) as unknown as Mundo;
  app.stage.addChild(mundo.container);
  _mundo = mundo;

  // Start the camera parked near the player's home system so the menu
  // orbits a familiar-looking target.
  const planetaJogador = mundo.planetas.find((p) => p.dados.dono === 'jogador');
  if (planetaJogador) {
    const sistema = mundo.sistemas[planetaJogador.dados.sistemaId];
    if (sistema?.sol) {
      setCameraPos(sistema.sol.x, sistema.sol.y);
    } else {
      setCameraPos(planetaJogador.x, planetaJogador.y);
    }
  }
  // Zoom out a bit so the whole system fits nicely in the background.
  setZoom(0.55);

  configurarCamera(app, mundo);

  // Keyboard zoom — installed once, active during both menu and game.
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
  });

  // Start the ticker: runs every frame from now on. While the menu is up
  // it only updates the world physics and pans the camera cinematically.
  // Once iniciarJogo flips _gameStarted it also updates HUD panels and
  // reads win/loss state.
  startTicker();

  // Finally, show the main menu on top.
  criarMainMenu({
    onNewGame: () => {
      void iniciarJogo();
    },
    onLoadGame: (_saveId: string) => {
      // Phase 2: save/load not implemented yet. For now just starts fresh.
      void iniciarJogo();
    },
  });
}

function startTicker(): void {
  if (!_app || !_mundo) return;
  const app = _app;
  const mundo = _mundo;

  let fimTocado = false;

  app.ticker.add(() => {
    app.ticker.speed = getDebugState().gameSpeed;

    // Free Resources cheat (gameplay only — while menu is up, the player
    // has no control anyway, so skip it).
    if (_gameStarted) {
      const c = getCheats();
      if (c.recursosInfinitos) {
        for (const p of mundo.planetas) {
          if (p.dados.dono !== 'jogador') continue;
          p.dados.recursos.comum = Math.max(p.dados.recursos.comum, 999999);
          p.dados.recursos.raro = Math.max(p.dados.recursos.raro, 999999);
          p.dados.recursos.combustivel = Math.max(p.dados.recursos.combustivel, 999999);
        }
      }
    }

    // Cinematic camera pan during the menu: slow orbit around the
    // player's home system's sun. 40-second period, radius tuned so the
    // whole system stays on screen at the menu's default zoom.
    if (!_gameStarted) {
      _cinematicPhase += app.ticker.deltaMS / 40000;
      const planetaJogador = mundo.planetas.find((p) => p.dados.dono === 'jogador');
      const sistema = planetaJogador ? mundo.sistemas[planetaJogador.dados.sistemaId] : null;
      const center = sistema?.sol ?? planetaJogador;
      if (center) {
        const angle = _cinematicPhase * Math.PI * 2;
        const radius = 900;
        const camera = getCamera();
        camera.x = center.x + Math.cos(angle) * radius;
        camera.y = center.y + Math.sin(angle) * radius * 0.6;
      }
    }

    const camera = getCamera();
    atualizarCamera(mundo, app);
    atualizarMundo(mundo, app, camera);

    if (_gameStarted) {
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
    }
  });
}

async function iniciarJogo(): Promise<void> {
  if (!_app || !_mundo || _gameStarted) return;
  _gameStarted = true;

  const app = _app;
  const mundo = _mundo;

  esconderMainMenu();

  // Snap the camera to the player's planet at a comfortable zoom.
  const planetaJogador = mundo.planetas.find((p) => p.dados.dono === 'jogador');
  if (planetaJogador) setCameraPos(planetaJogador.x, planetaJogador.y);
  setZoom(1.0);

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
}

void bootstrap();
