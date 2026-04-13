import { registerCreditsBar, unregisterCreditsBar } from './hud-layout';

let _container: HTMLDivElement | null = null;
let _clockEl: HTMLDivElement | null = null;
let _clockInterval: number | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .credits-bar {
      top: var(--hud-margin);
      right: var(--hud-margin);
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 1.1);
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1.5);
      min-height: calc(var(--hud-unit) * 5.4);
      box-sizing: border-box;
      font-family: "Silkscreen", "VT323", monospace;
      white-space: nowrap;
    }

    .credits-globe {
      width: calc(var(--hud-unit) * 2);
      height: calc(var(--hud-unit) * 2);
      color: rgba(255,255,255,0.92);
      flex-shrink: 0;
    }

    .credits-globe svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .credits-value {
      font-size: var(--hud-text-md);
      color: #f5f5f5;
      font-weight: 700;
      letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
    }

    .credits-divider {
      width: 1px;
      height: calc(var(--hud-unit) * 1.6);
      background: rgba(255,255,255,0.3);
    }

    .credits-clock {
      font-size: var(--hud-text-md);
      color: #f5f5f5;
      font-weight: 500;
      letter-spacing: 0.05em;
      font-variant-numeric: tabular-nums;
    }

    .credits-refresh {
      width: calc(var(--hud-unit) * 1.4);
      height: calc(var(--hud-unit) * 1.4);
      cursor: pointer;
      color: rgba(255,255,255,0.6);
      transition: color 150ms;
      flex-shrink: 0;
    }

    .credits-refresh:hover { color: rgba(255,255,255,0.95); }

    .credits-refresh svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;
  document.head.appendChild(style);
}

function createGlobeSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  svg.appendChild(circle);

  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line1.setAttribute('d', 'M3 12h18');
  svg.appendChild(line1);

  const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  ellipse.setAttribute('d', 'M12 3a13 13 0 010 18M12 3a13 13 0 000 18');
  svg.appendChild(ellipse);

  return svg;
}

function createRefreshSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M21 12a9 9 0 11-3.3-7M21 4v5h-5');
  svg.appendChild(arrow);

  return svg;
}

function updateClock(): void {
  if (!_clockEl) return;
  const now = new Date();
  const h = String(now.getUTCHours()).padStart(2, '0');
  const m = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  _clockEl.textContent = `UTC ${h}:${m}:${s}`;
}

export function criarCreditsBar(initialCredits: number = 43892): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const bar = document.createElement('div');
  bar.className = 'hud-panel credits-bar';

  const globe = document.createElement('div');
  globe.className = 'credits-globe';
  globe.appendChild(createGlobeSvg());
  bar.appendChild(globe);

  const value = document.createElement('div');
  value.className = 'credits-value';
  value.textContent = initialCredits.toLocaleString('en-US');
  bar.appendChild(value);

  const divider = document.createElement('div');
  divider.className = 'credits-divider';
  bar.appendChild(divider);

  const clock = document.createElement('div');
  clock.className = 'credits-clock';
  _clockEl = clock;
  bar.appendChild(clock);

  const refresh = document.createElement('div');
  refresh.className = 'credits-refresh';
  refresh.appendChild(createRefreshSvg());
  bar.appendChild(refresh);

  _container = bar;
  document.body.appendChild(bar);
  registerCreditsBar(bar);

  updateClock();
  _clockInterval = window.setInterval(updateClock, 1000);

  return bar;
}

export function atualizarCreditos(credits: number): void {
  if (!_container) return;
  const valEl = _container.querySelector<HTMLDivElement>('.credits-value');
  if (valEl) valEl.textContent = credits.toLocaleString('en-US');
}

export function destruirCreditsBar(): void {
  if (_container) {
    if (_clockInterval !== null) {
      clearInterval(_clockInterval);
      _clockInterval = null;
    }
    unregisterCreditsBar();
    _container.remove();
    _container = null;
    _clockEl = null;
  }
}
