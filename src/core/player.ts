import { somClique } from '../audio/som';
import { Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Camera, Nave, Planeta, Sol } from '../types';
import { consumirInteracaoUi } from '../ui/interacao-ui';
import { getConfig } from './config';
import {
  cancelarMovimentoNave,
  definirRotaManualNave,
  definirPlanetaRotaCargueira,
  encontrarNaveNoPonto,
  encontrarPlanetaNoPonto,
  encontrarSolNoPonto,
  enviarNaveParaAlvo,
  enviarNaveParaPosicao,
  limparSelecoes,
  obterNaveSelecionada,
  selecionarNave,
  selecionarPlaneta,
} from '../world/mundo';
import { mostrarNotificacao } from '../ui/notificacao';

const camera: Camera = { x: 0, y: 0, zoom: 1 };

let cameraDragging = false;
const cameraLastMouse = { x: 0, y: 0 };
const clickStartScreen = { x: 0, y: 0 };
let clickInfo: { nave: Nave | null; planeta: Planeta | null; sol: Sol | null } | null = null;
// Command modes:
//   'mover'   — cargueira/batedora/torreta multi-waypoint route mode
//   'origem'  — cargueira route origin picker
//   'destino' — cargueira route destination picker
//   'target_colonizadora' — colonizer-panel armed targeting mode; next
//                           planet click dispatches the colonizadora there
//   'move_colonizadora'   — colonizer-panel armed free-move mode; next map
//                           click sends the colonizadora to that point
type ComandoTipo = 'mover' | 'origem' | 'destino' | 'target_colonizadora' | 'move_colonizadora';
let comandoNave: { tipo: ComandoTipo; nave: Nave | null; pontos: { x: number; y: number }[] } | null = null;
let comandoPreviewGfx: Graphics | null = null;
// Cached reference so zoomIn/zoomOut (called from keyboard/minimap/ship panel)
// can anchor the zoom at screen center instead of the origin.
let _appRef: Application | null = null;
const COR_PREVIEW_ROTA = 0x27465f;
const COR_PREVIEW_PONTO = 0x3d6888;

function atualizarPreviewComandoNave(): void {
  if (!comandoPreviewGfx) return;
  comandoPreviewGfx.clear();
  if (comandoNave?.tipo !== 'mover' || !comandoNave.nave || comandoNave.pontos.length <= 0) return;

  comandoPreviewGfx.moveTo(comandoNave.nave.x, comandoNave.nave.y);
  for (const ponto of comandoNave.pontos) {
    comandoPreviewGfx.lineTo(ponto.x, ponto.y);
  }
  comandoPreviewGfx.stroke({ color: COR_PREVIEW_ROTA, width: 1.2, alpha: 0.88 });

  for (const ponto of comandoNave.pontos) {
    comandoPreviewGfx.circle(ponto.x, ponto.y, 3.5).fill({ color: 0x08111a, alpha: 0.96 });
    comandoPreviewGfx.circle(ponto.x, ponto.y, 3.5).stroke({ color: COR_PREVIEW_PONTO, width: 1.1, alpha: 0.94 });
  }
}

export function setTipoJogador(): void {}

export function getCamera(): Camera {
  return camera;
}

export function getZoom(): number {
  return camera.zoom;
}

/**
 * Zoom the camera while keeping a specific screen point anchored in place.
 * If `sx`/`sy` are omitted the anchor defaults to the center of the viewport
 * (matching what the user expects from keyboard/minimap zoom buttons).
 */
function aplicarZoom(novoZoom: number, sx?: number, sy?: number): void {
  const app = _appRef;
  if (!app) {
    camera.zoom = Math.max(0.3, Math.min(2.0, novoZoom));
    return;
  }
  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const anchorSx = sx ?? screenW / 2;
  const anchorSy = sy ?? screenH / 2;
  // World point currently under the anchor, before zoom.
  const worldX = (anchorSx - screenW / 2) / camera.zoom + camera.x;
  const worldY = (anchorSy - screenH / 2) / camera.zoom + camera.y;
  camera.zoom = Math.max(0.3, Math.min(2.0, novoZoom));
  // Re-derive camera so the same world point stays under the anchor.
  camera.x = worldX - (anchorSx - screenW / 2) / camera.zoom;
  camera.y = worldY - (anchorSy - screenH / 2) / camera.zoom;
}

export function zoomIn(factor: number = 1.15): void {
  aplicarZoom(camera.zoom * factor);
}

export function zoomOut(factor: number = 1.15): void {
  aplicarZoom(camera.zoom / factor);
}

export function setZoom(zoom: number): void {
  aplicarZoom(zoom);
}

export function setCameraPos(x: number, y: number): void {
  camera.x = x;
  camera.y = y;
}

export function iniciarComandoNave(tipo: ComandoTipo, nave: Nave | null): void {
  if (!nave) return;
  // Self-commit: pressing the Mover button a second time while already in
  // 'mover' mode finalises the waypoint list as a manual route.
  if (tipo === 'mover' && comandoNave?.tipo === 'mover' && comandoNave.nave === nave) {
    if (comandoNave.pontos.length > 0) {
      definirRotaManualNave(nave, comandoNave.pontos.map((p) => ({ _tipoAlvo: 'ponto', x: p.x, y: p.y })));
    }
    comandoNave = null;
    atualizarPreviewComandoNave();
    return;
  }
  // Any other transition — including switching from 'origem'/'destino' to
  // 'mover' or vice versa — must explicitly clear the previous mode so
  // stale preview graphics/waypoints don't leak into the new mode.
  if (comandoNave && (comandoNave.tipo !== tipo || comandoNave.nave !== nave)) {
    comandoNave = null;
    atualizarPreviewComandoNave();
  }
  comandoNave = { tipo, nave, pontos: [] };
  atualizarPreviewComandoNave();
}

export function cancelarComandoNave(): void {
  comandoNave = null;
  atualizarPreviewComandoNave();
}

export function cancelarComandoNaveSeAtivo(): boolean {
  if (!comandoNave) return false;
  cancelarComandoNave();
  return true;
}

export function getTextoComandoNave(): string {
  if (!comandoNave?.nave?.selecionado) return '';
  switch (comandoNave.tipo) {
    case 'mover': return `Modo movimento: ${comandoNave.pontos.length}/5 pontos, clique no mapa e depois em Mover para iniciar`;
    case 'origem': return 'Config origem: clique em um planeta seu';
    case 'destino': return 'Config destino: clique em um planeta seu';
    case 'target_colonizadora': return 'Modo colonização: clique num planeta alvo';
    case 'move_colonizadora': return 'Modo voo livre: clique no mapa para definir destino';
  }
}

export function getComandoNaveTipo(): ComandoTipo | null {
  return comandoNave?.tipo ?? null;
}

export function getComandoNaveAtual(): { tipo: ComandoTipo; nave: Nave | null; pontos: { x: number; y: number }[] } | null {
  return comandoNave;
}

function screenToWorld(sx: number, sy: number, app: Application) {
  return {
    x: (sx - app.screen.width / 2) / camera.zoom + camera.x,
    y: (sy - app.screen.height / 2) / camera.zoom + camera.y,
  };
}

let _cameraAbort: AbortController | null = null;

export function destruirCamera(): void {
  if (_cameraAbort) {
    _cameraAbort.abort();
    _cameraAbort = null;
  }
  if (comandoPreviewGfx) {
    comandoPreviewGfx.destroy();
    comandoPreviewGfx = null;
  }
}

export function configurarCamera(app: Application, mundo: Mundo): void {
  // Clean up previous listeners if re-configuring
  destruirCamera();

  _cameraAbort = new AbortController();
  const signal = _cameraAbort.signal;

  const canvas = app.canvas;
  _appRef = app;
  if (!comandoPreviewGfx) {
    comandoPreviewGfx = new Graphics();
    comandoPreviewGfx.eventMode = 'none';
    mundo.rotasContainer.addChild(comandoPreviewGfx);
  }

  canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault(), { signal });

  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY, app);
      clickInfo = {
        nave: encontrarNaveNoPonto(world.x, world.y, mundo),
        planeta: encontrarPlanetaNoPonto(world.x, world.y, mundo, true),
        sol: encontrarSolNoPonto(world.x, world.y, mundo, true),
      };
      clickStartScreen.x = e.clientX;
      clickStartScreen.y = e.clientY;

      if (!clickInfo.nave && !clickInfo.planeta && !clickInfo.sol) {
        cameraDragging = true;
        cameraLastMouse.x = e.clientX;
        cameraLastMouse.y = e.clientY;
      }
      return;
    }

    if (e.button === 1 || e.button === 2) {
      cameraDragging = true;
      cameraLastMouse.x = e.clientX;
      cameraLastMouse.y = e.clientY;
    }
  }, { signal });

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!cameraDragging) return;

    const dx = e.clientX - cameraLastMouse.x;
    const dy = e.clientY - cameraLastMouse.y;
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    cameraLastMouse.x = e.clientX;
    cameraLastMouse.y = e.clientY;
  }, { signal });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (cameraDragging) {
      cameraDragging = false;
    }

    if (e.button !== 0) return;
    if (consumirInteracaoUi()) {
      clickInfo = null;
      return;
    }

    const movedX = e.clientX - clickStartScreen.x;
    const movedY = e.clientY - clickStartScreen.y;
    const movedDist = Math.hypot(movedX, movedY);

    if (movedDist < 5) {
      const naveSelecionada = obterNaveSelecionada(mundo);
      const destinoMapa = screenToWorld(e.clientX, e.clientY, app);

      // Click-arbitration priority (highest to lowest):
      //   1. 'target_colonizadora' mode + planet → dispatch colonizadora
      //   2. 'move_colonizadora' mode + any click → dispatch free move
      //   3. Click on a ship                 → select that ship
      //   4. 'origem'/'destino' mode + planet → set cargueira route
      //   5. 'mover' mode + empty space      → add waypoint
      //   6. Click on a planet                → select that planet
      //   7. Click on empty space             → clear selection

      // (1) Colonizadora targeting: consume the click to dispatch.
      if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'target_colonizadora'
      ) {
        if (clickInfo?.planeta) {
          const ok = enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.planeta);
          if (ok) {
            cancelarComandoNave();
            somClique();
          }
        } else if (clickInfo?.sol) {
          const ok = enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.sol);
          if (ok) {
            cancelarComandoNave();
            somClique();
          }
        } else {
          mostrarNotificacao('Clique em um planeta ou estrela pra alvejar.', '#ffcc66');
        }
        clickInfo = null;
        return;
      }

      // (2) Colonizadora free move: any click becomes the destination.
      if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'move_colonizadora'
      ) {
        if (clickInfo?.planeta) {
          enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.planeta);
        } else if (clickInfo?.sol) {
          enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.sol);
        } else {
          enviarNaveParaPosicao(mundo, naveSelecionada, destinoMapa.x, destinoMapa.y);
        }
        cancelarComandoNave();
        somClique();
        clickInfo = null;
        return;
      }

      if (clickInfo?.nave) {
        cancelarComandoNave();
        selecionarNave(mundo, clickInfo.nave);
        somClique();
      } else if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && (comandoNave.tipo === 'origem' || comandoNave.tipo === 'destino')
        && clickInfo?.planeta?.dados.dono === 'jogador'
      ) {
        definirPlanetaRotaCargueira(naveSelecionada, comandoNave.tipo, clickInfo.planeta);
        cancelarComandoNave();
        somClique();
      } else if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'mover'
        && !clickInfo?.planeta
        && !clickInfo?.sol
      ) {
        if (comandoNave.pontos.length < 5) {
          comandoNave.pontos.push({ x: destinoMapa.x, y: destinoMapa.y });
          atualizarPreviewComandoNave();
          somClique();
        }
      } else if (clickInfo?.planeta) {
        cancelarComandoNave();
        selecionarPlaneta(mundo, clickInfo.planeta);
        somClique();
      } else {
        cancelarComandoNave();
        limparSelecoes(mundo);
      }
    }

    clickInfo = null;
  }, { signal });

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    aplicarZoom(camera.zoom * factor, sx, sy);
  }, { passive: false, signal });
}

export function cancelarRotaNaveSelecionada(mundo: Mundo): void {
  const naveSelecionada = obterNaveSelecionada(mundo);
  if (!naveSelecionada) return;
  cancelarMovimentoNave(naveSelecionada);
  if (comandoNave?.nave === naveSelecionada) {
    comandoNave = null;
  }
  atualizarPreviewComandoNave();
}

export function atualizarCamera(mundo: Mundo, app: Application): void {
  atualizarPreviewComandoNave();
  mundo.container.scale.set(camera.zoom);
  mundo.container.x = -camera.x * camera.zoom + app.screen.width / 2;
  mundo.container.y = -camera.y * camera.zoom + app.screen.height / 2;
}

let _edgeScrollInstalled = false;
let _edgeScrollVec = { x: 0, y: 0 };

export function instalarEdgeScroll(): void {
  if (_edgeScrollInstalled) return;
  _edgeScrollInstalled = true;

  const THRESHOLD = 40;

  window.addEventListener('mousemove', (e) => {
    if (!getConfig().gameplay.edgeScroll) {
      _edgeScrollVec.x = 0;
      _edgeScrollVec.y = 0;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && target.closest?.('[data-ui="true"]')) {
      _edgeScrollVec.x = 0;
      _edgeScrollVec.y = 0;
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    let dx = 0, dy = 0;
    if (e.clientX < THRESHOLD) dx = -(THRESHOLD - e.clientX) / THRESHOLD;
    else if (e.clientX > w - THRESHOLD) dx = (e.clientX - (w - THRESHOLD)) / THRESHOLD;
    if (e.clientY < THRESHOLD) dy = -(THRESHOLD - e.clientY) / THRESHOLD;
    else if (e.clientY > h - THRESHOLD) dy = (e.clientY - (h - THRESHOLD)) / THRESHOLD;
    _edgeScrollVec.x = Math.max(-1, Math.min(1, dx));
    _edgeScrollVec.y = Math.max(-1, Math.min(1, dy));
  });

  window.addEventListener('mouseleave', () => {
    _edgeScrollVec.x = 0;
    _edgeScrollVec.y = 0;
  });
}

export function aplicarEdgeScrollAoCamera(deltaMs: number): void {
  if (_edgeScrollVec.x === 0 && _edgeScrollVec.y === 0) return;
  if (!getConfig().gameplay.edgeScroll) return;
  const VELOCIDADE_MAX = 800;
  const cam = getCamera();
  const scale = VELOCIDADE_MAX * (deltaMs / 1000) / (cam.zoom || 1);
  cam.x += _edgeScrollVec.x * scale;
  cam.y += _edgeScrollVec.y * scale;
}
