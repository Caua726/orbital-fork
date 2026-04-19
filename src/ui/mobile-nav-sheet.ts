import { marcarInteracaoUi } from './interacao-ui';
import { pulseElement } from './animations.css';
import { abrirPauseMenu } from './pause-menu';
// eslint-disable-next-line @typescript-eslint/no-deprecated
import { abrirSettings } from './settings-panel';
import { salvarAgora } from '../world/save';
import { toast } from './toast';
import { t } from '../core/i18n/t';

let _overlay: HTMLDivElement | null = null;
let _sheet: HTMLDivElement | null = null;
let _styleInjected = false;
let _open = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .mobile-nav-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 960;
      opacity: 0;
      transition: opacity 180ms ease;
      pointer-events: auto;
    }
    .mobile-nav-backdrop.visible { opacity: 1; }

    .mobile-nav-sheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      max-width: 100vw;
      background: rgba(8,14,24,0.96);
      border-top: 1px solid rgba(255,255,255,0.16);
      border-radius: 18px 18px 0 0;
      box-shadow: 0 -6px 24px rgba(0,0,0,0.55);
      z-index: 961;
      padding: 10px 14px env(safe-area-inset-bottom, 16px);
      transform: translateY(100%);
      transition: transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1);
      color: var(--hud-text, #e8f2ff);
      font-family: "Silkscreen", "VT323", monospace;
    }
    .mobile-nav-sheet.visible { transform: translateY(0); }

    .mobile-nav-grabber {
      display: flex;
      justify-content: center;
      padding: 6px 0 10px;
      cursor: grab;
      touch-action: none;
    }
    .mobile-nav-grabber-bar {
      width: 48px;
      height: 5px;
      border-radius: 3px;
      background: rgba(255,255,255,0.35);
    }

    .mobile-nav-title {
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.55);
      padding: 2px 8px 10px;
    }

    .mobile-nav-item {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      min-height: 56px;
      padding: 14px 16px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 12px;
      color: var(--hud-text, #e8f2ff);
      font-family: inherit;
      font-size: 16px;
      letter-spacing: 0.04em;
      cursor: pointer;
      text-align: left;
      margin-bottom: 4px;
    }
    .mobile-nav-item:active {
      background: rgba(40,80,130,0.5);
      border-color: rgba(255,255,255,0.35);
      transform: scale(0.98);
    }
    .mobile-nav-item .mobile-nav-icon {
      font-size: 22px;
      width: 28px;
      text-align: center;
      opacity: 0.85;
    }
    .mobile-nav-item.danger { color: #ffb8b8; }
  `;
  document.head.appendChild(style);
}

function makeItem(icon: string, label: string, onTap: () => void, danger = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mobile-nav-item' + (danger ? ' danger' : '');
  const ic = document.createElement('span');
  ic.className = 'mobile-nav-icon';
  ic.textContent = icon;
  const lb = document.createElement('span');
  lb.textContent = label;
  b.append(ic, lb);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    pulseElement(b);
    fecharMobileNav();
    // defer the target action so the sheet-close animation starts first
    setTimeout(onTap, 60);
  });
  return b;
}

export function abrirMobileNav(): void {
  if (_open) return;
  injectStyles();
  if (!_overlay) {
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-nav-backdrop';
    backdrop.setAttribute('data-ui', 'true');
    backdrop.addEventListener('click', () => fecharMobileNav());
    document.body.appendChild(backdrop);
    _overlay = backdrop;

    const sheet = document.createElement('div');
    sheet.className = 'mobile-nav-sheet';
    sheet.setAttribute('data-ui', 'true');

    const grabber = document.createElement('div');
    grabber.className = 'mobile-nav-grabber';
    const bar = document.createElement('span');
    bar.className = 'mobile-nav-grabber-bar';
    grabber.appendChild(bar);
    // Swipe-down to dismiss
    let startY = 0, curY = 0, grabbing = false;
    grabber.addEventListener('pointerdown', (e) => {
      grabbing = true; startY = e.clientY; curY = 0;
      grabber.setPointerCapture?.(e.pointerId);
    });
    grabber.addEventListener('pointermove', (e) => {
      if (!grabbing) return;
      curY = e.clientY - startY;
      if (curY > 0 && _sheet) {
        _sheet.style.transform = `translateY(${curY}px)`;
        _sheet.style.transition = 'none';
      }
    });
    const endGrab = () => {
      if (!grabbing) return;
      grabbing = false;
      if (_sheet) { _sheet.style.transform = ''; _sheet.style.transition = ''; }
      if (curY > 60) fecharMobileNav();
    };
    grabber.addEventListener('pointerup', endGrab);
    grabber.addEventListener('pointercancel', endGrab);
    sheet.appendChild(grabber);

    const title = document.createElement('div');
    title.className = 'mobile-nav-title';
    title.textContent = t('hud.menu') ?? 'MENU';
    sheet.appendChild(title);

    sheet.appendChild(makeItem('\u25B6', t('pause.continuar'), () => { /* just close */ }));
    sheet.appendChild(makeItem('\u25EF', t('pause.salvar'), () => {
      salvarAgora();
      toast(t('toast.salvo'), 'info');
    }));
    sheet.appendChild(makeItem('\u2699', t('menu.configuracoes'), () => abrirSettings()));
    sheet.appendChild(makeItem('\u23F8', 'Pausa', () => abrirPauseMenu()));
    sheet.appendChild(makeItem('\u29C8', t('pause.sair'), () => {
      window.dispatchEvent(new CustomEvent('orbital:voltar-ao-menu'));
    }, true));

    document.body.appendChild(sheet);
    _sheet = sheet;
  }
  _open = true;
  requestAnimationFrame(() => {
    _overlay?.classList.add('visible');
    _sheet?.classList.add('visible');
  });
}

export function fecharMobileNav(): void {
  if (!_open) return;
  _open = false;
  _overlay?.classList.remove('visible');
  _sheet?.classList.remove('visible');
}

export function isMobileNavAberto(): boolean {
  return _open;
}
