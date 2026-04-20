import type { Application } from 'pixi.js';
import type { Mundo, Camera } from '../types';
import { registerMinimap, unregisterMinimap } from './hud-layout';

const CORES_DONO: Record<string, string> = {
  neutro: 'rgba(140,140,140,0.85)',
  jogador: '#8ce0ff',
};

let _container: HTMLDivElement | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _viewportEl: HTMLDivElement | null = null;
let _backdropEl: HTMLDivElement | null = null;
let _fullscreenBtn: HTMLButtonElement | null = null;
let _styleInjected = false;
let _mundo: Mundo | null = null;
let _app: Application | null = null;
let _onClick: ((worldX: number, worldY: number) => void) | null = null;
let _resizeHandler: (() => void) | null = null;
let _isFullscreen = false;

export function onMinimapClick(cb: (worldX: number, worldY: number) => void): void {
  _onClick = cb;
}

// No-op stubs — zoom buttons removed from minimap, but keep the public
// API so main.ts imports don't break. Callers can still register via
// these; the minimap itself no longer triggers zoom.
export function onMinimapZoomIn(_cb: () => void): void { /* noop */ }
export function onMinimapZoomOut(_cb: () => void): void { /* noop */ }

function svgIcon(d: string, strokeWidth = 2.5): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'square');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

const makeExpandIcon   = (): SVGSVGElement => svgIcon('M4 4h6M4 4v6 M20 20h-6 M20 20v-6', 2.4);
const makeCollapseIcon = (): SVGSVGElement => svgIcon('M10 4v6M10 10H4 M14 20v-6M14 14h6', 2.4);

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .minimap {
      right: var(--hud-margin);
      bottom: var(--hud-margin);
      padding: clamp(6px, 0.7vmin, 12px);
      width: clamp(160px, 18vmin, 240px);
      height: clamp(160px, 18vmin, 240px);
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.78);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 8px;
      box-shadow:
        0 4px 14px rgba(0,0,0,0.55),
        0 0 18px rgba(140, 224, 255, 0.06);
      transition:
        width 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        height 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        top 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        left 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        right 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        bottom 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        padding 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        border-color 220ms ease,
        box-shadow 220ms ease,
        transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }
    .minimap.fullscreen,
    body.touch .minimap.fullscreen,
    body .minimap.fullscreen {
      width: min(92vw, 680px) !important;
      height: min(88dvh, 680px) !important;
      max-width: 92vw !important;
      max-height: 88dvh !important;
      right: auto !important;
      bottom: auto !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      z-index: 940 !important;
      padding: 10px !important;
      border-color: rgba(255,255,255,0.4) !important;
      box-shadow:
        0 12px 40px rgba(0,0,0,0.7),
        0 0 32px rgba(140, 224, 255, 0.12) !important;
    }
    @media (prefers-reduced-motion: reduce) {
      .minimap { transition: none; }
    }

    .minimap-inner {
      position: relative;
      width: 100%;
      height: 100%;
      border: 1px solid rgba(255,255,255,0.35);
      box-sizing: border-box;
      overflow: hidden;
      cursor: pointer;
    }

    .minimap-canvas {
      width: 100%;
      height: 100%;
      display: block;
      image-rendering: pixelated;
    }

    .minimap-viewport {
      position: absolute;
      border: 2px solid #fff;
      box-sizing: border-box;
      pointer-events: none;
      box-shadow: 0 0 8px rgba(255,255,255,0.55);
    }

    .minimap-zoom {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      background: rgba(0,0,0,0.6);
      border-left: 1px solid rgba(255,255,255,0.2);
      border-bottom: 1px solid rgba(255,255,255,0.2);
      z-index: 2;
    }
    .minimap-zoom-btn {
      width: calc(var(--hud-unit) * 1.7);
      height: calc(var(--hud-unit) * 1.7);
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      outline: none;
      padding: 0;
      transition: background 120ms ease, color 120ms ease;
    }
    .minimap-zoom-btn:last-child { border-bottom: none; }
    .minimap-zoom-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .minimap-zoom-btn:active { background: rgba(255,255,255,0.22); }
    .minimap-zoom-btn svg {
      width: calc(var(--hud-unit) * 0.85);
      height: calc(var(--hud-unit) * 0.85);
      display: block;
    }

    /* Fullscreen toggle — top-left corner. */
    .minimap-fullscreen-btn {
      position: absolute;
      top: 2px;
      left: 2px;
      width: calc(var(--hud-unit) * 1.5);
      height: calc(var(--hud-unit) * 1.5);
      min-width: 26px;
      min-height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.2);
      color: rgba(255,255,255,0.7);
      border-radius: 4px;
      cursor: pointer;
      padding: 0;
      z-index: 3;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .minimap-fullscreen-btn:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
      border-color: #fff;
    }
    .minimap-fullscreen-btn svg { width: 60%; height: 60%; display: block; }

    /* Hide inner zoom controls on touch — pinch + double-tap cover zoom. */
    body.touch .minimap-zoom { display: none !important; }

    .minimap-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(4px);
      z-index: 939;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 180ms ease, visibility 0s linear 180ms;
    }
    .minimap-backdrop.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 180ms ease, visibility 0s linear 0s;
    }
  `;
  document.head.appendChild(style);
}

function drawMinimap(): void {
  if (!_canvas || !_mundo) return;
  const ctx = _canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = _canvas.clientWidth;
  const cssH = _canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;

  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (_canvas.width !== targetW || _canvas.height !== targetH) {
    _canvas.width = targetW;
    _canvas.height = targetH;
  }

  const w = _canvas.width;
  const h = _canvas.height;

  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(w / _mundo.tamanho, h / _mundo.tamanho);

  // Suns
  for (const sol of _mundo.sois) {
    if (!sol._visivelAoJogador) continue;
    const sx = sol.x * scale;
    const sy = sol.y * scale;
    const cor = sol._cor ?? 0xffdd88;
    const r = Math.floor(((cor >> 16) & 0xff)).toString();
    const g = Math.floor(((cor >> 8) & 0xff)).toString();
    const b = Math.floor((cor & 0xff)).toString();
    ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
    const size = 7 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Planets
  for (const p of _mundo.planetas) {
    if (!p._visivelAoJogador) continue;
    const px = p.x * scale;
    const py = p.y * scale;
    ctx.fillStyle = CORES_DONO[p.dados.dono] ?? 'rgba(140,140,140,0.85)';
    const radius = Math.max(3 * dpr, Math.min(6 * dpr, (p.dados.tamanho * scale) / 1.2));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ships — player bright, enemies dim. Selected gets a ring.
  for (const nave of _mundo.naves) {
    const nx = nave.x * scale;
    const ny = nave.y * scale;
    const isPlayer = nave.dono === 'jogador';
    ctx.fillStyle = isPlayer ? 'rgba(140,224,255,0.95)' : 'rgba(255,200,200,0.75)';
    const size = (isPlayer ? 3.5 : 2.5) * dpr;
    ctx.fillRect(Math.floor(nx - size / 2), Math.floor(ny - size / 2), size, size);
    if (nave.selecionado) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.arc(nx, ny, size + 2 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function updateViewport(camera: Camera): void {
  if (!_viewportEl || !_mundo || !_app) return;
  const zoom = camera.zoom || 1;
  const viewW = _app.screen.width / zoom;
  const viewH = _app.screen.height / zoom;

  // Force a roughly-square indicator so it reads clearly regardless of
  // actual screen aspect. Min 14% so it's always visible, max 60% so it
  // never dominates the minimap.
  const sidePct = Math.max(
    14,
    Math.min(60, ((viewW + viewH) / 2 / _mundo.tamanho) * 100),
  );
  const xPct = (camera.x / _mundo.tamanho) * 100;
  const yPct = (camera.y / _mundo.tamanho) * 100;

  _viewportEl.style.left = `${xPct - sidePct / 2}%`;
  _viewportEl.style.top = `${yPct - sidePct / 2}%`;
  _viewportEl.style.width = `${sidePct}%`;
  _viewportEl.style.height = `${sidePct}%`;
}

export function criarMinimap(app: Application, mundo: Mundo): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  _mundo = mundo;
  _app = app;

  const panel = document.createElement('div');
  panel.className = 'hud-panel minimap';

  const inner = document.createElement('div');
  inner.className = 'minimap-inner';

  const canvas = document.createElement('canvas');
  canvas.className = 'minimap-canvas';
  _canvas = canvas;
  inner.appendChild(canvas);

  const viewport = document.createElement('div');
  viewport.className = 'minimap-viewport';
  _viewportEl = viewport;
  inner.appendChild(viewport);

  // Fullscreen toggle — expands the minimap into a centered panel so
  // the player can survey the whole galaxy at a larger scale.
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'minimap-fullscreen-btn';
  fsBtn.setAttribute('aria-label', 'Expandir mapa');
  fsBtn.appendChild(makeExpandIcon());
  fsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
  _fullscreenBtn = fsBtn;
  inner.appendChild(fsBtn);

  // Tap warps camera, drag scrubs. Drag only engages past a small
  // threshold so a pure tap still registers cleanly.
  const DRAG_THRESHOLD_PX = 6;
  let pointerDown = false;
  let dragEngaged = false;
  let pointerId = -1;
  let downX = 0;
  let downY = 0;
  const warpFromPointer = (clientX: number, clientY: number): void => {
    if (!_mundo || !_onClick) return;
    const rect = inner.getBoundingClientRect();
    const fracX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const fracY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    _onClick(fracX * _mundo.tamanho, fracY * _mundo.tamanho);
  };
  inner.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.minimap-fullscreen-btn')) return;
    e.preventDefault();
    pointerDown = true;
    dragEngaged = false;
    pointerId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
    try { inner.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  inner.addEventListener('pointermove', (e) => {
    if (!pointerDown || e.pointerId !== pointerId) return;
    if (!dragEngaged) {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragEngaged = true;
    }
    warpFromPointer(e.clientX, e.clientY);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!pointerDown || e.pointerId !== pointerId) return;
    pointerDown = false;
    try { inner.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // If pointer never moved past threshold, this is a tap — warp once.
    if (!dragEngaged) warpFromPointer(e.clientX, e.clientY);
    dragEngaged = false;
  };
  inner.addEventListener('pointerup', endDrag);
  inner.addEventListener('pointercancel', endDrag);

  panel.appendChild(inner);
  _container = panel;
  document.body.appendChild(panel);

  // Backdrop used only when in fullscreen mode — tap to close.
  const backdrop = document.createElement('div');
  backdrop.className = 'minimap-backdrop';
  backdrop.addEventListener('click', () => setFullscreen(false));
  document.body.appendChild(backdrop);
  _backdropEl = backdrop;

  registerMinimap(panel);

  requestAnimationFrame(drawMinimap);
  _resizeHandler = () => requestAnimationFrame(drawMinimap);
  window.addEventListener('resize', _resizeHandler);

  return panel;
}

// Throttle minimap map redraw to ~10Hz. updateViewport (a white box
// over the map) stays per-frame because it's only CSS style mutation.
// Full canvas redraw (bg fill + all planets/ships/fog dots iteration)
// é caro: DPR × (160-240px)² pixels por draw. A 60Hz isso domina o
// canvas 2D cost em mobile. 10Hz é visualmente indistinguível pra
// alguém olhando o minimap.
const _MINIMAP_REDRAW_MS = 100;
let _lastMinimapDrawMs = 0;
export function atualizarMinimap(camera: Camera): void {
  const now = performance.now();
  if (now - _lastMinimapDrawMs >= _MINIMAP_REDRAW_MS) {
    _lastMinimapDrawMs = now;
    drawMinimap();
  }
  updateViewport(camera);
}

function setFullscreen(on: boolean): void {
  _isFullscreen = on;
  if (!_container) return;
  _container.classList.toggle('fullscreen', on);
  _backdropEl?.classList.toggle('visible', on);
  if (_fullscreenBtn) {
    _fullscreenBtn.replaceChildren();
    _fullscreenBtn.appendChild(on ? makeCollapseIcon() : makeExpandIcon());
  }
  // Redraw at multiple points during the 320ms size transition so the
  // canvas keeps up with the animated dimensions. Single rAF occasionally
  // captures the pre-resize size and snaps at the end.
  const ticks = [30, 120, 220, 360];
  for (const t of ticks) setTimeout(drawMinimap, t);
}

function toggleFullscreen(): void {
  setFullscreen(!_isFullscreen);
}

/** Returns true if the minimap was fullscreen and has been collapsed.
 *  Called from the Escape handler so pressing ESC collapses the full
 *  minimap before any other overlay-closing step (pause menu, etc.). */
export function fecharMinimapFullscreenSeAtivo(): boolean {
  if (!_isFullscreen) return false;
  setFullscreen(false);
  return true;
}

export function destruirMinimap(): void {
  if (_resizeHandler) {
    window.removeEventListener('resize', _resizeHandler);
    _resizeHandler = null;
  }
  if (_container) {
    unregisterMinimap();
    _container.remove();
    _container = null;
    _canvas = null;
    _viewportEl = null;
    _mundo = null;
    _app = null;
  }
  _backdropEl?.remove();
  _backdropEl = null;
  _fullscreenBtn = null;
  _isFullscreen = false;
}
