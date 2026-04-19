import { abrirMobileNav } from './mobile-nav-sheet';
import { marcarInteracaoUi } from './interacao-ui';
import { pulseElement } from './animations.css';

let _button: HTMLButtonElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .mobile-menu-btn {
      display: none;
      position: fixed;
      top: 14px;
      left: 14px;
      width: 64px;
      height: 64px;
      border-radius: 14px;
      border: 1px solid var(--hud-border, rgba(255,255,255,0.45));
      background: rgba(10,20,35,0.88);
      color: var(--hud-text, #e8f2ff);
      z-index: 501;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      font-size: 34px;
      line-height: 1;
      font-family: "Silkscreen", "VT323", monospace;
      touch-action: manipulation;
      pointer-events: auto;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    }
    body.size-sm .mobile-menu-btn,
    body.portrait.size-md .mobile-menu-btn {
      display: flex;
    }
    .mobile-menu-btn:active {
      transform: scale(0.92);
      background: rgba(30,60,100,0.95);
    }
  `;
  document.head.appendChild(style);
}

export function criarMobileMenuBtn(): HTMLButtonElement {
  if (_button) return _button;
  injectStyles();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mobile-menu-btn';
  btn.setAttribute('data-ui', 'true');
  btn.setAttribute('aria-label', 'menu');
  btn.textContent = '\u2630';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    pulseElement(btn);
    abrirMobileNav();
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
}
