import { abrirPauseMenu } from './pause-menu';
import { marcarInteracaoUi } from './interacao-ui';
import { pulseElement } from './animations.css';

let _button: HTMLButtonElement | null = null;
let _styleInjected = false;
let _styleEl: HTMLStyleElement | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .mobile-menu-btn {
      display: none;
      position: fixed;
      top: calc(12px + var(--safe-top, 0px));
      left: calc(12px + var(--safe-left, 0px));
      width: 44px;
      height: 44px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.45);
      background: transparent;
      color: rgba(255,255,255,0.92);
      z-index: 501;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      line-height: 1;
      font-family: "Silkscreen", "VT323", monospace;
      touch-action: manipulation;
      pointer-events: auto;
      transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
    }
    body.touch .mobile-menu-btn {
      display: flex;
    }
    /* Hide while the main menu is showing — only relevant in-game. */
    body:has(.main-menu:not(.hidden)) .mobile-menu-btn {
      display: none !important;
    }
    .mobile-menu-btn:hover {
      background: rgba(255,255,255,0.08);
      border-color: #fff;
    }
    .mobile-menu-btn:active {
      transform: scale(0.92);
      background: rgba(255,255,255,0.16);
    }
  `;
  document.head.appendChild(style);
  _styleEl = style;
}

export function criarMobileMenuBtn(): HTMLButtonElement {
  if (_button) return _button;
  injectStyles();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mobile-menu-btn';
  btn.setAttribute('data-ui', 'true');
  btn.setAttribute('aria-label', 'Abrir menu');
  btn.textContent = '\u2630';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    pulseElement(btn);
    abrirPauseMenu();
  });
  document.body.appendChild(btn);
  _button = btn;
  return btn;
}

export function destruirMobileMenuBtn(): void {
  if (_button) {
    _button.remove();
    _button = null;
  }
  _styleInjected = false;
  _styleEl?.remove();
  _styleEl = null;
}
