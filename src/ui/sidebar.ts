import { registerSidebar, unregisterSidebar, onLayoutChange } from './hud-layout';
import { abrirPauseMenu } from './pause-menu';
import { t } from '../core/i18n/t';
import { onConfigChange } from '../core/config';

const SPRITE_SRC_SIZE = 32;
const SPRITESHEET = 'assets/hud-icons.png';

// Shared spritesheet image loaded once
let _spriteImage: HTMLImageElement | null = null;
const _spritePromise: Promise<HTMLImageElement> = new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    _spriteImage = img;
    resolve(img);
  };
  img.src = SPRITESHEET;
});

const _iconCanvases: { canvas: HTMLCanvasElement; spriteIndex: number }[] = [];

function drawIcon(canvas: HTMLCanvasElement, spriteIndex: number): void {
  if (!_spriteImage) return;
  const size = canvas.clientWidth;
  if (size === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    _spriteImage,
    spriteIndex * SPRITE_SRC_SIZE, 0, SPRITE_SRC_SIZE, SPRITE_SRC_SIZE,
    0, 0, canvas.width, canvas.height,
  );
}

function redrawAllIcons(): void {
  for (const { canvas, spriteIndex } of _iconCanvases) {
    drawIcon(canvas, spriteIndex);
  }
}

interface NavItem {
  id: string;
  labelKey: string;
  spriteIndex: number;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', labelKey: 'sidebar.overview', spriteIndex: 0 },
  { id: 'planets', labelKey: 'sidebar.planets', spriteIndex: 1 },
  { id: 'fleets', labelKey: 'sidebar.fleets', spriteIndex: 2 },
  { id: 'research', labelKey: 'sidebar.research', spriteIndex: 3 },
  { id: 'construct', labelKey: 'sidebar.construct', spriteIndex: 4 },
  { id: 'alliance', labelKey: 'sidebar.alliance', spriteIndex: 5 },
  { id: 'inbox', labelKey: 'sidebar.inbox', spriteIndex: 6 },
];

let _container: HTMLDivElement | null = null;
let _activeId = '';
let _onNavigate: ((id: string) => void) | null = null;
let _styleInjected = false;
let _unsubConfig: (() => void) | null = null;
let _refreshTextos: (() => void) | null = null;
let _unsubLayout: (() => void) | null = null;

export function onSidebarNavigate(cb: (id: string) => void): void {
  _onNavigate = cb;
}

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .sidebar {
      /* Tight clamps: scale with viewport but tightly bounded so huge screens
         don't blow them up and tiny screens don't break. */
      --sb-icon: clamp(18px, 2.4vmin, 28px);
      --sb-label: clamp(7px, 0.75vmin, 10px);
      --sb-pad-v: clamp(6px, 0.8vmin, 12px);
      --sb-pad-h: clamp(6px, 0.8vmin, 12px);
      --sb-gap: clamp(4px, 0.6vmin, 8px);
      --sb-btn-gap: clamp(3px, 0.4vmin, 5px);
      --sb-panel-pad: clamp(8px, 1vmin, 14px);

      left: var(--hud-margin);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-around;
      padding: var(--sb-panel-pad) calc(var(--sb-panel-pad) * 0.7);
      box-sizing: border-box;
      top: 50%;
      transform: translateY(-50%);
    }

    .sidebar-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sb-btn-gap);
      padding: var(--sb-pad-v) var(--sb-pad-h);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      color: var(--hud-text-dim);
      transition: all 120ms ease;
      outline: none;
      width: 100%;
      font-family: inherit;
    }

    .sidebar-btn:hover:not(.active) {
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.2);
      color: rgba(255,255,255,0.75);
    }

    .sidebar-btn.active {
      background: rgba(255,255,255,0.08);
      border-color: rgba(255,255,255,0.65);
      color: var(--hud-text);
    }

    .sidebar-icon {
      width: var(--sb-icon);
      height: var(--sb-icon);
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .sidebar-label {
      font-size: var(--sb-label);
      letter-spacing: 1px;
      font-family: "Silkscreen", "VT323", monospace;
      text-transform: uppercase;
      font-weight: 400;
      line-height: 1;
    }

    .sidebar-separator {
      width: 80%;
      border: none;
      border-top: 1px solid rgba(255,255,255,0.12);
      margin: var(--sb-gap) 0;
    }

    .sidebar-btn-text {
      font-size: var(--sb-label);
      letter-spacing: 1px;
      font-family: "Silkscreen", "VT323", monospace;
      text-transform: uppercase;
    }

    .sidebar-icon-img {
      width: var(--sb-icon);
      height: var(--sb-icon);
      display: block;
      object-fit: contain;
      /* Standalone PNG icons aren't pixel-art — keep smooth scaling. */
      image-rendering: auto;
      filter: brightness(0) invert(1);
      opacity: 0.75;
      transition: opacity 120ms ease;
    }
    .sidebar-btn:hover .sidebar-icon-img { opacity: 1; }

    /* Mobile drawer behavior */
    .sidebar-hamburger {
      display: none;
      position: fixed;
      top: 12px;
      left: 12px;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      border: 1px solid var(--hud-border, rgba(255,255,255,0.35));
      background: rgba(10,20,35,0.75);
      color: var(--hud-text, #e8f2ff);
      z-index: 501;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-family: "Silkscreen", "VT323", monospace;
      touch-action: manipulation;
    }
    body.touch.size-sm .sidebar-hamburger,
    body.touch.portrait.size-md .sidebar-hamburger {
      display: flex;
    }

    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 499;
    }
    body.touch.size-sm.sidebar-open .sidebar-backdrop,
    body.touch.portrait.size-md.sidebar-open .sidebar-backdrop {
      display: block;
    }

    body.touch.size-sm .sidebar,
    body.touch.portrait.size-md .sidebar {
      top: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      transform: translateX(-100%) !important;
      height: 100vh;
      width: min(72vw, 280px);
      background: rgba(6,12,20,0.92);
      border-right: 1px solid var(--hud-border, rgba(255,255,255,0.2));
      transition: transform 220ms ease;
      z-index: 500;
      padding-top: 64px;
      justify-content: flex-start;
      gap: 6px;
    }
    body.touch.size-sm.sidebar-open .sidebar,
    body.touch.portrait.size-md.sidebar-open .sidebar {
      transform: translateX(0) !important;
    }
  `;
  document.head.appendChild(style);
}

function createNavButton(item: NavItem): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'sidebar-btn';
  btn.dataset.navId = item.id;
  btn.dataset.labelKey = item.labelKey;

  const canvas = document.createElement('canvas');
  canvas.className = 'sidebar-icon';
  btn.appendChild(canvas);
  _iconCanvases.push({ canvas, spriteIndex: item.spriteIndex });

  const label = document.createElement('span');
  label.className = 'sidebar-label';
  label.textContent = t(item.labelKey);
  btn.appendChild(label);

  btn.addEventListener('click', () => {
    _activeId = btn.dataset.navId!;
    updateActive();
    if (_onNavigate) _onNavigate(_activeId);
  });

  return btn;
}

function updateActive(): void {
  if (!_container) return;
  _container.querySelectorAll<HTMLButtonElement>('.sidebar-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.navId === _activeId);
  });
}

export function criarSidebar(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const sidebar = document.createElement('div');
  sidebar.className = 'hud-panel sidebar';
  sidebar.setAttribute('data-ui', 'true');
  sidebar.style.pointerEvents = 'auto';

  for (const item of NAV_ITEMS) {
    sidebar.appendChild(createNavButton(item));
  }

  // ── Menu button (icon + label) ──
  const btnMenuOpen = document.createElement('button');
  btnMenuOpen.type = 'button';
  btnMenuOpen.className = 'sidebar-btn';
  const menuIcon = document.createElement('img');
  menuIcon.className = 'sidebar-icon-img';
  menuIcon.src = 'assets/icon-config.png';
  menuIcon.alt = '';
  btnMenuOpen.appendChild(menuIcon);
  const menuLabel = document.createElement('span');
  menuLabel.className = 'sidebar-label';
  menuLabel.textContent = t('hud.menu');
  btnMenuOpen.appendChild(menuLabel);
  btnMenuOpen.addEventListener('click', (e) => {
    e.preventDefault();
    abrirPauseMenu();
  });
  sidebar.appendChild(btnMenuOpen);

  _container = sidebar;
  document.body.appendChild(sidebar);
  registerSidebar(sidebar);

  const hamburger = document.createElement('button');
  hamburger.type = 'button';
  hamburger.className = 'sidebar-hamburger';
  hamburger.setAttribute('data-ui', 'true');
  hamburger.setAttribute('aria-label', 'menu');
  hamburger.textContent = '\u2630';
  hamburger.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  document.body.appendChild(hamburger);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('data-ui', 'true');
  backdrop.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
  });
  document.body.appendChild(backdrop);

  sidebar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.sidebar-btn')) {
      document.body.classList.remove('sidebar-open');
    }
  });

  updateActive();

  _refreshTextos = () => {
    sidebar.querySelectorAll<HTMLSpanElement>('.sidebar-label').forEach((el) => {
      const key = el.parentElement?.dataset.labelKey;
      if (key) el.textContent = t(key);
    });
    menuLabel.textContent = t('hud.menu');
  };
  _unsubConfig = onConfigChange(() => _refreshTextos?.());

  // Redraw icons whenever layout changes (resize, sidebar height update).
  _unsubLayout = onLayoutChange(() => requestAnimationFrame(redrawAllIcons));

  // Initial draw once image loads and after first layout.
  _spritePromise.then(() => requestAnimationFrame(redrawAllIcons));

  return sidebar;
}

export function destruirSidebar(): void {
  if (_container) {
    unregisterSidebar();
    _container.remove();
    _container = null;
  }
  _unsubConfig?.();
  _unsubConfig = null;
  _unsubLayout?.();
  _unsubLayout = null;
  _refreshTextos = null;
}
