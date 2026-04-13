import { somClique } from '../audio/som';
import { Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Camera, Nave, Planeta, Sol } from '../types';
import { consumirInteracaoUi } from '../ui/interacao-ui';
import {
  cancelarMovimentoNave,
  definirRotaManualNave,
  definirPlanetaRotaCargueira,
  encontrarNaveNoPonto,
  encontrarPlanetaNoPonto,
  encontrarSolNoPonto,
  limparSelecoes,
  obterNaveSelecionada,
  selecionarNave,
  selecionarPlaneta,
} from '../world/mundo';

const camera: Camera = { x: 0, y: 0, zoom: 1 };

let cameraDragging = false;
const cameraLastMouse = { x: 0, y: 0 };
const clickStartScreen = { x: 0, y: 0 };
let clickInfo: { nave: Nave | null; planeta: Planeta | null; sol: Sol | null } | null = null;
let comandoNave: { tipo: 'mover' | 'origem' | 'destino'; nave: Nave | null; pontos: { x: number; y: number }[] } | null = null;
let comandoPreviewGfx: Graphics | null = null;
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

export function zoomIn(factor: number = 1.15): void {
  camera.zoom = Math.min(2.0, camera.zoom * factor);
}

export function zoomOut(factor: number = 1.15): void {
  camera.zoom = Math.max(0.3, camera.zoom / factor);
}

export function setZoom(zoom: number): void {
  camera.zoom = Math.max(0.3, Math.min(2.0, zoom));
}

export function setCameraPos(x: number, y: number): void {
  camera.x = x;
  camera.y = y;
}

export function iniciarComandoNave(tipo: 'mover' | 'origem' | 'destino', nave: Nave | null): void {
  if (!nave) return;
  if (tipo === 'mover' && comandoNave?.tipo === 'mover' && comandoNave.nave === nave) {
    if (comandoNave.pontos.length > 0) {
      definirRotaManualNave(nave, comandoNave.pontos.map((p) => ({ _tipoAlvo: 'ponto', x: p.x, y: p.y })));
    }
    comandoNave = null;
    atualizarPreviewComandoNave();
    return;
  }
  if (tipo === 'mover') {
    comandoNave = { tipo, nave, pontos: [] };
    atualizarPreviewComandoNave();
    return;
  }
  comandoNave = { tipo, nave, pontos: [] };
  atualizarPreviewComandoNave();
}

export function cancelarComandoNave(): void {
  comandoNave = null;
  atualizarPreviewComandoNave();
}

export function getTextoComandoNave(): string {
  if (!comandoNave?.nave?.selecionado) return '';
  if (comandoNave.tipo === 'mover') return `Modo movimento: ${comandoNave.pontos.length}/5 pontos, clique no mapa e depois em Mover para iniciar`;
  if (comandoNave.tipo === 'origem') return 'Config origem: clique em um planeta seu';
  return 'Config destino: clique em um planeta seu';
}

export function getComandoNaveAtual(): { tipo: 'mover' | 'origem' | 'destino'; nave: Nave | null; pontos: { x: number; y: number }[] } | null {
  return comandoNave;
}

function screenToWorld(sx: number, sy: number, app: Application) {
  return {
    x: (sx - app.screen.width / 2) / camera.zoom + camera.x,
    y: (sy - app.screen.height / 2) / camera.zoom + camera.y,
  };
}

export function configurarCamera(app: Application, mundo: Mundo): void {
  const canvas = app.canvas;
  if (!comandoPreviewGfx) {
    comandoPreviewGfx = new Graphics();
    comandoPreviewGfx.eventMode = 'none';
    mundo.rotasContainer.addChild(comandoPreviewGfx);
  }

  canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());

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
  });

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!cameraDragging) return;

    const dx = e.clientX - cameraLastMouse.x;
    const dy = e.clientY - cameraLastMouse.y;
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    cameraLastMouse.x = e.clientX;
    cameraLastMouse.y = e.clientY;
  });

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

      if (naveSelecionada && comandoNave?.nave === naveSelecionada && comandoNave.tipo === 'mover') {
        if (comandoNave.pontos.length < 5) {
          comandoNave.pontos.push({ x: destinoMapa.x, y: destinoMapa.y });
          atualizarPreviewComandoNave();
          somClique();
        }
      } else if (clickInfo?.nave) {
        cancelarComandoNave();
        selecionarNave(mundo, clickInfo.nave);
        somClique();
      } else if (naveSelecionada && comandoNave?.nave === naveSelecionada) {
        if ((comandoNave.tipo === 'origem' || comandoNave.tipo === 'destino') && clickInfo?.planeta?.dados.dono === 'jogador') {
          definirPlanetaRotaCargueira(naveSelecionada, comandoNave.tipo, clickInfo.planeta);
          cancelarComandoNave();
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
  });

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const mouseWorld = screenToWorld(e.clientX, e.clientY, app);

    if (e.deltaY < 0) {
      camera.zoom = Math.min(2.0, camera.zoom * 1.1);
    } else {
      camera.zoom = Math.max(0.3, camera.zoom / 1.1);
    }

    camera.x = mouseWorld.x - (e.clientX - app.screen.width / 2) / camera.zoom;
    camera.y = mouseWorld.y - (e.clientY - app.screen.height / 2) / camera.zoom;
  }, { passive: false });
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
