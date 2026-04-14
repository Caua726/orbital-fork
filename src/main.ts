import { Application } from 'pixi.js';
import type { Mundo } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo } from './world/mundo';
import { configurarCamera, atualizarCamera, getCamera, setCameraPos, setTipoJogador, zoomIn, zoomOut } from './core/player';
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
import { somVitoria, somDerrota } from './audio/som';

async function bootstrap(): Promise<void> {
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

  const tipoEscolhido = getTipos()[0];
  setTipoJogador();

  const mundo = await criarMundo(app, tipoEscolhido) as unknown as Mundo;
  app.stage.addChild(mundo.container);

  const planetaJogador = mundo.planetas.find(p => p.dados.dono === 'jogador');
  if (planetaJogador) setCameraPos(planetaJogador.x, planetaJogador.y);

  configurarCamera(app, mundo);

  installRootVariables();
  criarEmpireBadge('Valorian Empire', 24);
  criarCreditsBar(43892);
  criarResourceBar();
  criarChatLog();
  criarSidebar();
  criarMinimap(app, mundo);
  criarPlanetPanel();
  criarBuildPanel();
  criarShipPanel();
  criarColonizerPanel();
  criarColonyModal();
  criarConfirmDialog();
  onMinimapClick((worldX, worldY) => {
    setCameraPos(worldX, worldY);
  });
  onMinimapZoomIn(() => zoomIn());
  onMinimapZoomOut(() => zoomOut());

  // Keyboard shortcuts for zoom
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
  });

  criarDebugMenu(app, mundo);

  let fimTocado = false;

  app.ticker.add(() => {
    // Apply game speed from debug menu (ticker.speed scales deltaMS)
    app.ticker.speed = getDebugState().gameSpeed;

    // Free Resources cheat (top up player resources — the other cheats are
    // wired natively by the game systems that read from `cheats`).
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

void bootstrap();
