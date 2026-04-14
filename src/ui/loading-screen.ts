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
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      color: var(--hud-text);
      font-family: var(--hud-font);
      display: flex;
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
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 1);
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--hud-text);
      line-height: 1;
      display: inline-flex;
      align-items: baseline;
    }

    /* Three dots that fill in sequentially, hold, then reset. */
    .loading-dots {
      display: inline-block;
      margin-left: calc(var(--hud-unit) * 0.3);
      width: calc(var(--hud-unit) * 1.2);
      text-align: left;
      font-family: inherit;
      color: var(--hud-text);
    }

    .loading-dots::after {
      content: '';
      animation: loading-dots 1.4s steps(4, end) infinite;
    }

    @keyframes loading-dots {
      0%   { content: ''; }
      25%  { content: '.'; }
      50%  { content: '..'; }
      75%  { content: '...'; }
      100% { content: ''; }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-dots::after {
        animation: none;
        content: '...';
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

  const labelText = document.createElement('span');
  labelText.textContent = 'Criando mundo';
  _labelEl = labelText;
  label.appendChild(labelText);

  const dots = document.createElement('span');
  dots.className = 'loading-dots';
  label.appendChild(dots);

  container.appendChild(label);

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
