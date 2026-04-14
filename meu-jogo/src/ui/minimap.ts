import type { Application } from 'pixi.js';
import type { Mundo, Camera } from '../types';
import { registerMinimap, unregisterMinimap } from './hud-layout';

const CORES_DONO: Record<string, string> = {
  neutro: 'rgba(140,140,140,0.8)',
  jogador: '#60ccff',
};

let _container: HTMLDivElement | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _viewportEl: HTMLDivElement | null = null;
let _styleInjected = false;
let _mundo: Mundo | null = null;
let _app: Application | null = null;
let _onClick: ((worldX: number, worldY: number) => void) | null = null;
let _onZoomIn: (() => void) | null = null;
let _onZoomOut: (() => void) | null = null;

export function onMinimapClick(cb: (worldX: number, worldY: number) => void): void {
  _onClick = cb;
}

export function onMinimapZoomIn(cb: () => void): void {
  _onZoomIn = cb;
}

export function onMinimapZoomOut(cb: () => void): void {
  _onZoomOut = cb;
}

function makePlusIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'square');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M12 5v14M5 12h14');
  svg.appendChild(p);
  return svg;
}

function makeMinusIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'square');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M5 12h14');
  svg.appendChild(p);
  return svg;
}

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
    }

    .minimap-inner {
      position: relative;
      width: 100%;
      height: 100%;
      border: 1px solid rgba(255,255,255,0.55);
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
      border: 1px solid rgba(255,255,255,0.95);
      box-sizing: border-box;
      pointer-events: none;
    }

    .minimap-zoom {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      background: rgba(0,0,0,0.6);
      border-left: 1px solid rgba(255,255,255,0.3);
      border-bottom: 1px solid rgba(255,255,255,0.3);
      z-index: 2;
    }

    .minimap-zoom-btn {
      width: calc(var(--hud-unit) * 2);
      height: calc(var(--hud-unit) * 2);
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.2);
      color: rgba(255,255,255,0.8);
      cursor: pointer;
      outline: none;
      padding: 0;
      transition: background 120ms ease, color 120ms ease;
    }

    .minimap-zoom-btn:last-child { border-bottom: none; }

    .minimap-zoom-btn:hover {
      background: rgba(255,255,255,0.15);
      color: #fff;
    }

    .minimap-zoom-btn:active {
      background: rgba(255,255,255,0.25);
    }

    .minimap-zoom-btn svg {
      width: calc(var(--hud-unit) * 0.9);
      height: calc(var(--hud-unit) * 0.9);
      display: block;
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

  _canvas.width = Math.round(cssW * dpr);
  _canvas.height = Math.round(cssH * dpr);

  const w = _canvas.width;
  const h = _canvas.height;

  ctx.imageSmoothingEnabled = false;

  // Black background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(w / _mundo.tamanho, h / _mundo.tamanho);

  // Draw suns
  for (const sol of _mundo.sois) {
    if (!sol._visivelAoJogador) continue;
    const sx = sol.x * scale;
    const sy = sol.y * scale;
    const cor = sol._cor ?? 0xffdd88;
    const r = Math.floor(((cor >> 16) & 0xff)).toString();
    const g = Math.floor(((cor >> 8) & 0xff)).toString();
    const b = Math.floor((cor & 0xff)).toString();
    ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
    const size = 6 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw planets
  for (const p of _mundo.planetas) {
    if (!p._visivelAoJogador) continue;
    const px = p.x * scale;
    const py = p.y * scale;
    const color = CORES_DONO[p.dados.dono] ?? 'rgba(140,140,140,0.85)';
    ctx.fillStyle = color;
    const radius = Math.max(3 * dpr, Math.min(7 * dpr, (p.dados.tamanho * scale) / 1.2));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw ships
  for (const nave of _mundo.naves) {
    const nx = nave.x * scale;
    const ny = nave.y * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const size = 3 * dpr;
    ctx.fillRect(Math.floor(nx - size / 2), Math.floor(ny - size / 2), size, size);
  }
}

function updateViewport(camera: Camera): void {
  if (!_viewportEl || !_mundo || !_app) return;
  const zoom = camera.zoom || 1;
  const viewW = _app.screen.width / zoom;
  const viewH = _app.screen.height / zoom;

  const xPct = (camera.x / _mundo.tamanho) * 100;
  const yPct = (camera.y / _mundo.tamanho) * 100;
  const wPct = (viewW / _mundo.tamanho) * 100;
  const hPct = (viewH / _mundo.tamanho) * 100;

  _viewportEl.style.left = `${xPct}%`;
  _viewportEl.style.top = `${yPct}%`;
  _viewportEl.style.width = `${wPct}%`;
  _viewportEl.style.height = `${hPct}%`;
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

  // Zoom controls integrated into the minimap
  const zoomBar = document.createElement('div');
  zoomBar.className = 'minimap-zoom';

  const btnIn = document.createElement('button');
  btnIn.className = 'minimap-zoom-btn';
  btnIn.title = 'Zoom In  ( + )';
  btnIn.appendChild(makePlusIcon());
  btnIn.addEventListener('click', (e) => {
    e.stopPropagation();
    _onZoomIn?.();
  });
  zoomBar.appendChild(btnIn);

  const btnOut = document.createElement('button');
  btnOut.className = 'minimap-zoom-btn';
  btnOut.title = 'Zoom Out  ( − )';
  btnOut.appendChild(makeMinusIcon());
  btnOut.addEventListener('click', (e) => {
    e.stopPropagation();
    _onZoomOut?.();
  });
  zoomBar.appendChild(btnOut);

  inner.appendChild(zoomBar);

  // Click to warp camera (but ignore clicks on zoom buttons)
  inner.addEventListener('click', (e) => {
    if (!_mundo || !_onClick) return;
    const target = e.target as HTMLElement;
    if (target.closest('.minimap-zoom')) return;
    const rect = inner.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const fracY = (e.clientY - rect.top) / rect.height;
    _onClick(fracX * _mundo.tamanho, fracY * _mundo.tamanho);
  });

  panel.appendChild(inner);
  _container = panel;
  document.body.appendChild(panel);

  registerMinimap(panel);

  requestAnimationFrame(drawMinimap);
  window.addEventListener('resize', () => requestAnimationFrame(drawMinimap));

  return panel;
}

export function atualizarMinimap(camera: Camera): void {
  drawMinimap();
  updateViewport(camera);
}

export function destruirMinimap(): void {
  if (_container) {
    unregisterMinimap();
    _container.remove();
    _container = null;
    _canvas = null;
    _viewportEl = null;
    _mundo = null;
    _app = null;
  }
}
