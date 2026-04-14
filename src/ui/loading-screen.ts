/**
 * A lightweight full-screen loading overlay used between the main menu
 * and the first frame of a new game. Matches the main-menu visual
 * language (blur + HUD tokens, no color accents).
 */

let _container: HTMLDivElement | null = null;
let _labelEl: HTMLDivElement | null = null;
let _styleInjected = false;
let _visibleSince = 0;

const MIN_VISIBLE_MS = 450;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .loading-screen {
      position: fixed;
      inset: 0;
      z-index: 600;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      color: var(--hud-text);
      font-family: var(--hud-font);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 300ms ease-out, visibility 0s linear 300ms;
    }

    .loading-screen.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 200ms ease-out, visibility 0s linear 0s;
    }

    .loading-label {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.4);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--hud-text);
      margin-bottom: calc(var(--hud-unit) * 1.1);
      line-height: 1;
    }

    .loading-bar {
      width: calc(var(--hud-unit) * 14);
      height: calc(var(--hud-unit) * 0.35);
      border: 1px solid var(--hud-border);
      background: var(--hud-bg);
      overflow: hidden;
      position: relative;
    }

    .loading-bar::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: -40%;
      width: 40%;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.15) 20%,
        rgba(255, 255, 255, 0.85) 50%,
        rgba(255, 255, 255, 0.15) 80%,
        transparent 100%
      );
      animation: loading-sweep 1.3s linear infinite;
    }

    @keyframes loading-sweep {
      0%   { left: -40%; }
      100% { left: 100%; }
    }

    .loading-sub {
      margin-top: calc(var(--hud-unit) * 0.8);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-bar::before {
        animation: none;
        left: 0;
        width: 100%;
        opacity: 0.3;
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

  const label = document.createElement('div');
  label.className = 'loading-label';
  label.textContent = 'Criando mundo';
  _labelEl = label;
  container.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'loading-bar';
  container.appendChild(bar);

  const sub = document.createElement('div');
  sub.className = 'loading-sub';
  sub.textContent = 'Gerando sistemas solares';
  container.appendChild(sub);

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
