/**
 * A lightweight full-screen loading overlay used between the main menu
 * and the first frame of a new game. Matches the main-menu visual
 * language (blur + HUD tokens, no color accents).
 */

let _container: HTMLDivElement | null = null;
let _labelEl: HTMLSpanElement | null = null;
let _styleInjected = false;
let _visibleSince = 0;

const MIN_VISIBLE_MS = 450;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* Full-screen blackout while the world is being created. Hides the
       menu world completely so there's no visual noise during the
       transition between the menu system and the real game world. */
    .loading-screen {
      position: fixed;
      inset: 0;
      z-index: 600;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 260ms ease-out, visibility 0s linear 260ms;
    }

    .loading-screen.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 200ms ease-out, visibility 0s linear 0s;
    }

    /* A compact HUD-panel card: same tokens as ship-panel / colony-modal. */
    .loading-card {
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      padding: calc(var(--hud-unit) * 1.1) calc(var(--hud-unit) * 1.8);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.75);
      font-family: var(--hud-font);
      color: var(--hud-text);
      min-width: calc(var(--hud-unit) * 14);
    }

    .loading-label {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.85);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--hud-text);
      line-height: 1;
    }

    /* Thin underline bar that slides a bright indicator back and forth. */
    .loading-bar {
      width: 100%;
      height: 2px;
      background: var(--hud-line);
      position: relative;
      overflow: hidden;
    }

    .loading-bar::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: -30%;
      width: 30%;
      background: var(--hud-text);
      animation: loading-bar-slide 1.6s ease-in-out infinite;
    }

    @keyframes loading-bar-slide {
      0%   { left: -30%; }
      50%  { left: 100%; }
      100% { left: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-bar::before {
        animation: none;
        left: 0;
        width: 100%;
        opacity: 0.4;
      }
    }
  `;
  document.head.appendChild(style);
}

export function criarLoadingScreen(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const container = document.createElement('div');
  container.className = 'loading-screen';

  const card = document.createElement('div');
  card.className = 'loading-card';

  const label = document.createElement('span');
  label.className = 'loading-label';
  label.textContent = 'Criando mundo';
  _labelEl = label;
  card.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'loading-bar';
  card.appendChild(bar);

  container.appendChild(card);

  document.body.appendChild(container);
  _container = container;
  return container;
}

export function mostrarCarregando(label?: string): void {
  if (!_container) criarLoadingScreen();
  if (_labelEl && label) _labelEl.textContent = label;
  _container?.classList.add('visible');
  _visibleSince = performance.now();
}

/**
 * Hides the loader. If it hasn't been visible for at least MIN_VISIBLE_MS,
 * waits before hiding so the player actually perceives the transition.
 */
export function esconderCarregando(): Promise<void> {
  if (!_container) return Promise.resolve();
  const elapsed = performance.now() - _visibleSince;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
  return new Promise((resolve) => {
    setTimeout(() => {
      _container?.classList.remove('visible');
      resolve();
    }, wait);
  });
}
