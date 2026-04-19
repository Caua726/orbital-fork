import { somClique } from '../audio/som';
import { Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Camera, Nave, Planeta, Sol } from '../types';
import { consumirInteracaoUi } from '../ui/interacao-ui';
import { getConfig } from './config';
import {
  distance, midpoint, isTap, isDoubleTap,
  type TapRecord,
} from './input/pointer-gestures';
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
import { t } from './i18n/t';
import { abrirPlanetaDrawer, fecharPlanetaDrawer } from '../ui/planet-drawer';
import { abrirMobilePlanetaDrawer, fecharMobilePlanetaDrawer } from '../ui/mobile-planet-drawer';
import { abrirStarDrawer, fecharStarDrawer } from '../ui/star-drawer';
import { isTouchMode } from './ui-mode';

const camera: Camera = { x: 0, y: 0, zoom: 1 };

// When non-null, atualizarCamera pins camera to this target each frame.
// Any manual pan (drag, WASD, edge-scroll, pinch, click-to-go, setCameraPos)
// clears this — the user reclaiming camera control always wins.
let _followTarget: Nave | Planeta | Sol | null = null;

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
 *
 * Smooth by default: starts a short tween that `atualizarCamera` advances
 * each frame. Pass `immediate=true` for pinch gestures where the user's
 * fingers are already driving the motion in real time.
 */
let _zoomTween: {
  fromZoom: number; toZoom: number;
  fromX: number; toX: number;
  fromY: number; toY: number;
  startMs: number; durationMs: number;
} | null = null;

function aplicarZoom(novoZoom: number, sx?: number, sy?: number, immediate = false): void {
  const app = _appRef;
  const target = Math.max(0.3, Math.min(2.0, novoZoom));
  if (!app) {
    camera.zoom = target;
    return;
  }
  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const anchorSx = sx ?? screenW / 2;
  const anchorSy = sy ?? screenH / 2;
  // World point currently under the anchor, before the zoom change.
  const worldX = (anchorSx - screenW / 2) / camera.zoom + camera.x;
  const worldY = (anchorSy - screenH / 2) / camera.zoom + camera.y;
  // Camera position that keeps that world point under the anchor AT target zoom.
  const newCamX = worldX - (anchorSx - screenW / 2) / target;
  const newCamY = worldY - (anchorSy - screenH / 2) / target;
  if (immediate) {
    camera.zoom = target;
    camera.x = newCamX;
    camera.y = newCamY;
    _zoomTween = null;
    return;
  }
  _zoomTween = {
    fromZoom: camera.zoom, toZoom: target,
    fromX: camera.x, toX: newCamX,
    fromY: camera.y, toY: newCamY,
    startMs: performance.now(), durationMs: 180,
  };
}

function cancelarZoomTween(): void {
  _zoomTween = null;
}

function avancarZoomTween(): void {
  if (!_zoomTween) return;
  const t = (performance.now() - _zoomTween.startMs) / _zoomTween.durationMs;
  if (t >= 1) {
    camera.zoom = _zoomTween.toZoom;
    camera.x = _zoomTween.toX;
    camera.y = _zoomTween.toY;
    _zoomTween = null;
    return;
  }
  // Ease-out cubic.
  const e = 1 - Math.pow(1 - t, 3);
  camera.zoom = _zoomTween.fromZoom + (_zoomTween.toZoom - _zoomTween.fromZoom) * e;
  camera.x = _zoomTween.fromX + (_zoomTween.toX - _zoomTween.fromX) * e;
  camera.y = _zoomTween.fromY + (_zoomTween.toY - _zoomTween.fromY) * e;
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
  // Cancel any in-flight zoom tween — otherwise the next frame's lerp
  // overwrites the explicit position (e.g. F-focus firing mid-tween).
  cancelarZoomTween();
  // Explicit reposition overrides any active follow — otherwise the
  // follow would snap the camera back next frame.
  _followTarget = null;
}

export function setCameraFollow(target: Nave | Planeta | Sol): void {
  _followTarget = target;
  camera.x = target.x;
  camera.y = target.y;
  cancelarZoomTween();
}

export function clearCameraFollow(): void {
  _followTarget = null;
}

export function isFollowing(target?: Nave | Planeta | Sol): boolean {
  if (!_followTarget) return false;
  return target ? _followTarget === target : true;
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
    case 'mover': return t('comando.mover', { n: comandoNave.pontos.length });
    case 'origem': return t('comando.origem');
    case 'destino': return t('comando.destino');
    case 'target_colonizadora': return t('comando.target_colonizadora');
    case 'move_colonizadora': return t('comando.move_colonizadora');
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
  canvas.style.touchAction = 'none';
  _appRef = app;
  if (!comandoPreviewGfx) {
    comandoPreviewGfx = new Graphics();
    comandoPreviewGfx.eventMode = 'none';
    mundo.rotasContainer.addChild(comandoPreviewGfx);
  }

  canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault(), { signal });

  type PointerInfo = { x: number; y: number; startX: number; startY: number; startTime: number; button: number };
  const activePointers = new Map<number, PointerInfo>();
  let pinch: { initialDist: number; initialZoom: number; anchorSx: number; anchorSy: number } | null = null;
  let lastTap: TapRecord | null = null;

  const getWorldHit = (sx: number, sy: number) => {
    const world = screenToWorld(sx, sy, app);
    return {
      nave: encontrarNaveNoPonto(world.x, world.y, mundo),
      planeta: encontrarPlanetaNoPonto(world.x, world.y, mundo, true),
      sol: encontrarSolNoPonto(world.x, world.y, mundo, true),
    };
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* older browsers */ }

    const info: PointerInfo = {
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      startTime: performance.now(),
      button: e.button,
    };
    activePointers.set(e.pointerId, info);

    if (activePointers.size === 1) {
      if (e.button === 0) {
        const hit = getWorldHit(e.clientX, e.clientY);
        clickInfo = hit;
        clickStartScreen.x = e.clientX;
        clickStartScreen.y = e.clientY;
        if (!hit.nave && !hit.planeta && !hit.sol) {
          cameraDragging = true;
          cameraLastMouse.x = e.clientX;
          cameraLastMouse.y = e.clientY;
          _followTarget = null;
        }
      } else if (e.button === 1 || e.button === 2) {
        cameraDragging = true;
        cameraLastMouse.x = e.clientX;
        cameraLastMouse.y = e.clientY;
        _followTarget = null;
      }
    } else if (activePointers.size === 2) {
      // Second pointer: start pinch. Cancel any in-progress drag and
      // wipe clickInfo so that when BOTH fingers lift, neither pointerup
      // can run click-arbitration on stale hit data from the first touch.
      cameraDragging = false;
      clickInfo = null;
      const [a, b] = Array.from(activePointers.values());
      const mid = midpoint(a, b);
      pinch = {
        initialDist: distance(a, b),
        initialZoom: camera.zoom,
        anchorSx: mid.x,
        anchorSy: mid.y,
      };
      // Mark both pointers so their eventual up/cancel won't count as taps.
      a.button = -1;
      b.button = -1;
    }
  }, { signal });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const info = activePointers.get(e.pointerId);
    if (!info) return;
    info.x = e.clientX;
    info.y = e.clientY;

    if (pinch && activePointers.size >= 2) {
      const pts = Array.from(activePointers.values()).slice(0, 2) as [PointerInfo, PointerInfo];
      const d = distance(pts[0], pts[1]);
      const newMid = midpoint(pts[0], pts[1]);
      // Treat the midpoint drift as a pan, so the world stays anchored to
      // the fingers instead of drifting when the user naturally translates
      // while pinching.
      const panDx = newMid.x - pinch.anchorSx;
      const panDy = newMid.y - pinch.anchorSy;
      if (panDx !== 0 || panDy !== 0) {
        camera.x -= panDx / camera.zoom;
        camera.y -= panDy / camera.zoom;
        cancelarZoomTween();
        _followTarget = null;
      }
      pinch.anchorSx = newMid.x;
      pinch.anchorSy = newMid.y;
      if (d > 0 && pinch.initialDist > 0) {
        const ratio = d / pinch.initialDist;
        aplicarZoom(pinch.initialZoom * ratio, pinch.anchorSx, pinch.anchorSy, true);
      }
      return;
    }

    if (cameraDragging && activePointers.size === 1) {
      const dx = e.clientX - cameraLastMouse.x;
      const dy = e.clientY - cameraLastMouse.y;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      cameraLastMouse.x = e.clientX;
      cameraLastMouse.y = e.clientY;
      // Pan overrides any in-flight zoom tween — otherwise the tween snaps
      // the camera back to its pre-pan target on the next frame.
      cancelarZoomTween();
      _followTarget = null;
    }
  }, { signal });

  const finalizePointer = (e: PointerEvent, cancelled: boolean) => {
    const info = activePointers.get(e.pointerId);
    if (!info) return;
    activePointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (pinch && activePointers.size < 2) {
      pinch = null;
      if (activePointers.size === 0) cameraDragging = false;
      return;
    }

    if (cameraDragging && activePointers.size === 0) {
      cameraDragging = false;
    }

    if (cancelled) {
      clickInfo = null;
      return;
    }

    if (info.button !== 0) {
      clickInfo = null;
      return;
    }
    if (activePointers.size > 0) {
      clickInfo = null;
      return;
    }
    if (consumirInteracaoUi()) {
      clickInfo = null;
      return;
    }

    const movedX = e.clientX - info.startX;
    const movedY = e.clientY - info.startY;
    const movedDist = Math.hypot(movedX, movedY);
    const duration = performance.now() - info.startTime;
    const tap = isTap({ dist: movedDist, duration });

    // Double-tap zoom: anchor at the release point so the tapped spot stays in view.
    if (tap) {
      const now = performance.now();
      const currentTap: TapRecord = { time: now, x: e.clientX, y: e.clientY };
      if (isDoubleTap(lastTap, currentTap)) {
        const rect = canvas.getBoundingClientRect();
        aplicarZoom(camera.zoom * 1.5, e.clientX - rect.left, e.clientY - rect.top);
        lastTap = null;
        clickInfo = null;
        return;
      }
      lastTap = currentTap;
    }

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
      if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'target_colonizadora'
      ) {
        if (clickInfo?.planeta) {
          const ok = enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.planeta);
          if (ok) { cancelarComandoNave(); somClique(); }
        } else if (clickInfo?.sol) {
          const ok = enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.sol);
          if (ok) { cancelarComandoNave(); somClique(); }
        } else {
          mostrarNotificacao(t('notificacao.clique_alvo'), '#ffcc66');
        }
        clickInfo = null;
        return;
      }

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
        setCameraPos(clickInfo.nave.x, clickInfo.nave.y);
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
        setCameraPos(clickInfo.planeta.x, clickInfo.planeta.y);
        somClique();
        fecharStarDrawer();
        if (isTouchMode()) {
          void abrirMobilePlanetaDrawer(clickInfo.planeta, mundo);
        } else {
          void abrirPlanetaDrawer(clickInfo.planeta, mundo);
        }
      } else if (clickInfo?.sol) {
        cancelarComandoNave();
        limparSelecoes(mundo);
        if (isTouchMode()) fecharMobilePlanetaDrawer();
        else fecharPlanetaDrawer();
        setCameraPos(clickInfo.sol.x, clickInfo.sol.y);
        void abrirStarDrawer(clickInfo.sol, mundo);
        somClique();
      } else {
        cancelarComandoNave();
        limparSelecoes(mundo);
        if (isTouchMode()) fecharMobilePlanetaDrawer();
        else fecharPlanetaDrawer();
        fecharStarDrawer();
      }
    }

    clickInfo = null;
  };

  canvas.addEventListener('pointerup', (e: PointerEvent) => finalizePointer(e, false), { signal });
  canvas.addEventListener('pointercancel', (e: PointerEvent) => finalizePointer(e, true), { signal });

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
  avancarZoomTween();
  // Follow: pin camera to target each frame. Auto-drop if target died
  // (ship destroyed, planet consumed) so we don't hold a ghost ref.
  if (_followTarget) {
    const t = _followTarget as { destroyed?: boolean; x: number; y: number };
    if (t.destroyed) {
      _followTarget = null;
    } else {
      camera.x = t.x;
      camera.y = t.y;
    }
  }
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
  _followTarget = null;
}
