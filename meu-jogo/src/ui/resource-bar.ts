import { registerResourceBar, unregisterResourceBar } from './hud-layout';

interface Resource {
  id: string;
  value: string;
  rate?: string;
  icon: () => SVGSVGElement;
}

function svg(pathD: string | string[]): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'currentColor');
  const paths = Array.isArray(pathD) ? pathD : [pathD];
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  return s;
}

// Ore / crystal cluster
function oreIcon(): SVGSVGElement {
  return svg([
    'M12 2l-3 5h6l-3-5z',
    'M6 8l-2 5 5 2 1-5-4-2z',
    'M18 8l2 5-5 2-1-5 4-2z',
    'M9 15l3 6 3-6-3-1-3 1z',
  ]);
}

// Alloy / ingot
function alloyIcon(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'currentColor');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 9l4-4h10l4 4-4 10H7L3 9z');
  s.appendChild(path);
  return s;
}

// Fuel / water droplet
function fuelIcon(): SVGSVGElement {
  return svg('M12 2.5c-3 4.5-6 8-6 11.5a6 6 0 0012 0c0-3.5-3-7-6-11.5z');
}

// Energy / lightning
function energyIcon(): SVGSVGElement {
  return svg('M13 2L4 14h6l-1 8 9-12h-6l1-8z');
}

// Population / group
function populationIcon(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'currentColor');
  const paths = [
    // center person
    'M12 5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
    'M7 17c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5v2H7v-2z',
    // left person
    'M5 7a2 2 0 110 4 2 2 0 010-4z',
    'M1 18c0-2 1.8-3.5 4-3.5.4 0 .8 0 1.2.1A5.9 5.9 0 006 17v2H1v-1z',
    // right person
    'M19 7a2 2 0 110 4 2 2 0 010-4z',
    'M23 18v1h-5v-2c0-.7-.1-1.3-.2-2 .4-.1.8-.1 1.2-.1 2.2 0 4 1.5 4 3.1z',
  ];
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  return s;
}

const RESOURCES: Resource[] = [
  { id: 'ore', value: '12.4K', rate: '+320/s', icon: oreIcon },
  { id: 'alloy', value: '8.7K', rate: '+210/s', icon: alloyIcon },
  { id: 'fuel', value: '5.3K', rate: '+115/s', icon: fuelIcon },
  { id: 'energy', value: '2.1K', rate: '+95/s', icon: energyIcon },
  { id: 'population', value: '1.2K', icon: populationIcon },
];

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .resource-bar {
      /* Match the empire-badge dimensions so both top-row panels share
         the exact same height. Badge height = crest (3.6u) + 2x padding
         (0.9u each) = 5.4 units total. */
      --rb-icon: calc(var(--hud-unit) * 2);
      --rb-value: var(--hud-text-md);
      --rb-rate: var(--hud-text-sm);
      --rb-gap: calc(var(--hud-unit) * 1.4);
      --rb-icon-gap: calc(var(--hud-unit) * 0.55);
      min-height: calc(var(--hud-unit) * 5.4);
      box-sizing: border-box;
      overflow: hidden;

      top: var(--hud-margin);
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: var(--rb-gap);
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1.2);
      font-family: "Silkscreen", "VT323", monospace;
      white-space: nowrap;
    }

    .resource-item {
      display: flex;
      align-items: center;
      gap: var(--rb-icon-gap);
    }

    .resource-icon {
      width: var(--rb-icon);
      height: var(--rb-icon);
      color: rgba(255,255,255,0.92);
      flex-shrink: 0;
    }

    .resource-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .resource-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      line-height: 1;
    }

    .resource-value {
      font-size: var(--rb-value);
      color: #f5f5f5;
      font-weight: 700;
      letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
    }

    .resource-rate {
      font-size: var(--rb-rate);
      color: rgba(255,255,255,0.5);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
  `;
  document.head.appendChild(style);
}

export function criarResourceBar(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const bar = document.createElement('div');
  bar.className = 'hud-panel resource-bar';

  for (const res of RESOURCES) {
    const item = document.createElement('div');
    item.className = 'resource-item';
    item.dataset.resourceId = res.id;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'resource-icon';
    iconWrap.appendChild(res.icon());
    item.appendChild(iconWrap);

    const text = document.createElement('div');
    text.className = 'resource-text';

    const value = document.createElement('div');
    value.className = 'resource-value';
    value.textContent = res.value;
    text.appendChild(value);

    if (res.rate) {
      const rate = document.createElement('div');
      rate.className = 'resource-rate';
      rate.textContent = res.rate;
      text.appendChild(rate);
    }

    item.appendChild(text);
    bar.appendChild(item);
  }

  _container = bar;
  document.body.appendChild(bar);
  registerResourceBar(bar);

  return bar;
}

export function atualizarRecurso(id: string, value: string, rate?: string): void {
  if (!_container) return;
  const item = _container.querySelector<HTMLDivElement>(`[data-resource-id="${id}"]`);
  if (!item) return;
  const valEl = item.querySelector<HTMLDivElement>('.resource-value');
  const rateEl = item.querySelector<HTMLDivElement>('.resource-rate');
  if (valEl) valEl.textContent = value;
  if (rateEl && rate !== undefined) rateEl.textContent = rate;
}

export function destruirResourceBar(): void {
  if (_container) {
    unregisterResourceBar();
    _container.remove();
    _container = null;
  }
}
