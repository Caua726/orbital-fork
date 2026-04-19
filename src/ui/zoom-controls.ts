import { zoomIn, zoomOut } from '../core/player';
import { marcarInteracaoUi } from './interacao-ui';

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .zoom-controls {
      position: fixed;
      right: var(--hud-margin, 16px);
      bottom: calc(var(--hud-margin, 16px) + 140px);
      display: none;
      flex-direction: column;
      gap: 8px;
      z-index: 450;
      pointer-events: auto;
    }
    body.touch .zoom-controls { display: flex; }
    .zoom-controls button {
      width: 48px; height: 48px;
      border-radius: 10px;
      border: 1px solid var(--hud-border, rgba(255,255,255,0.35));
      background: rgba(10,20,35,0.75);
      color: var(--hud-text, #e8f2ff);
      font-size: 22px;
      font-family: "Silkscreen", "VT323", monospace;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      user-select: none;
      touch-action: manipulation;
    }
    .zoom-controls button:active {
      background: rgba(30,60,100,0.9);
    }
  `;
  document.head.appendChild(style);
}

export function criarZoomControls(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();
  const wrap = document.createElement('div');
  wrap.className = 'zoom-controls';
  wrap.setAttribute('data-ui', 'true');

  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      marcarInteracaoUi();
      fn();
    });
    return b;
  };

  wrap.appendChild(mk('+', () => zoomIn()));
  wrap.appendChild(mk('\u2212', () => zoomOut()));

  _container = wrap;
  document.body.appendChild(wrap);
  return wrap;
}

export function destruirZoomControls(): void {
  if (_container) {
    _container.remove();
    _container = null;
  }
}
