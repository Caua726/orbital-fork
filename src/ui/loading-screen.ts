/**
 * A lightweight full-screen loading overlay used between the main menu
 * and the first frame of a new game. Matches the main-menu visual
 * language (blur + HUD tokens, no color accents).
 */

import { t } from '../core/i18n/t';

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
       menu world completely. Inner layers add a starfield + slow
       horizontal scanline so the screen isn't dead black. */
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
      overflow: hidden;
      transition: opacity 260ms ease-out, visibility 0s linear 260ms;
    }

    /* Twinkling starfield layer (populated by JS at load time) */
    .loading-stars {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .loading-star {
      position: absolute;
      width: 2px;
      height: 2px;
      background: #fff;
      border-radius: 50%;
      opacity: 0;
      animation: loading-twinkle linear infinite;
    }

    @keyframes loading-twinkle {
      0%, 100% { opacity: 0; transform: scale(0.6); }
      50%      { opacity: var(--star-alpha, 0.8); transform: scale(1); }
    }

    /* CRT-style horizontal scanline that sweeps top→bottom slowly.
       Uses transform (NOT top) so the animation runs on the GPU
       compositor thread and keeps going even when the main thread
       is blocked by worldgen — otherwise the loading screen freezes
       until criarMundo finishes. */
    .loading-scan {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.4) 30%,
        rgba(255, 255, 255, 0.7) 50%,
        rgba(255, 255, 255, 0.4) 70%,
        transparent 100%
      );
      box-shadow: 0 0 calc(var(--hud-unit) * 0.6) rgba(255, 255, 255, 0.15);
      will-change: transform, opacity;
      animation: loading-scan-sweep 6s linear infinite;
      pointer-events: none;
    }

    @keyframes loading-scan-sweep {
      0%   { transform: translateY(-2vh); opacity: 0; }
      10%  { opacity: 0.8; }
      90%  { opacity: 0.8; }
      100% { transform: translateY(102vh); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-star { animation: none; opacity: 0.3; }
      .loading-scan { display: none; }
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

    /* Thin underline bar that slides a bright indicator back and forth.
       The indicator is driven by transform (NOT left) so the animation
       runs entirely on the GPU compositor. That's the only reason the
       progress bar keeps moving during the 1-2s of blocking worldgen
       work — main thread can be 100% busy and the animation still
       tracks frames perfectly. */
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
      left: 0;
      width: 30%;
      background: var(--hud-text);
      will-change: transform;
      transform: translateX(-100%);
      animation: loading-bar-slide 1.6s ease-in-out infinite;
    }

    /* Bar travels from fully off-screen left (-100% of its own width)
       to fully off-screen right (100%/0.3 = 333.33%), held at the end
       for half the cycle so the eye catches the return animation. */
    @keyframes loading-bar-slide {
      0%   { transform: translateX(-100%); }
      50%  { transform: translateX(333.33%); }
      100% { transform: translateX(333.33%); }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-bar::before {
        animation: none;
        transform: translateX(0);
        width: 100%;
        opacity: 0.4;
      }
    }
  `;
  document.head.appendChild(style);
}

function createStars(host: HTMLDivElement, count: number): void {
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'loading-star';
    const size = Math.random() < 0.85 ? 1 : Math.random() < 0.97 ? 2 : 3;
    const alpha = 0.25 + Math.random() * 0.65;
    const duration = 2.5 + Math.random() * 5;
    const delay = Math.random() * 6;
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.setProperty('--star-alpha', alpha.toFixed(2));
    star.style.animationDuration = `${duration.toFixed(1)}s`;
    star.style.animationDelay = `${delay.toFixed(1)}s`;
    host.appendChild(star);
  }
}

export function criarLoadingScreen(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const container = document.createElement('div');
  container.className = 'loading-screen';

  // Background animation layers
  const stars = document.createElement('div');
  stars.className = 'loading-stars';
  createStars(stars, 140);
  container.appendChild(stars);

  const scan = document.createElement('div');
  scan.className = 'loading-scan';
  container.appendChild(scan);

  const card = document.createElement('div');
  card.className = 'loading-card';

  const label = document.createElement('span');
  label.className = 'loading-label';
  label.textContent = t('loading.criando');
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
 * Update the label shown on the loading screen mid-flight (e.g. to
 * communicate the current generation phase). Yields to the browser via
 * rAF so the new text actually paints before the next sync block runs.
 */
export function setLoadingFase(label: string): Promise<void> {
  if (_labelEl) _labelEl.textContent = label;
  // Yield twice — once to let the textContent change paint, once to
  // give the browser a chance to actually render the frame.
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
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
