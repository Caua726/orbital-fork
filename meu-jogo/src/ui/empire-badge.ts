import { registerBadge, unregisterBadge } from './hud-layout';

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .empire-badge {
      top: var(--hud-margin);
      left: var(--hud-margin);
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 1.1);
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1.7)
               calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1);
      min-height: calc(var(--hud-unit) * 5.4);
      box-sizing: border-box;
      font-family: var(--hud-font);
    }

    .empire-crest {
      width: calc(var(--hud-unit) * 3.6);
      height: calc(var(--hud-unit) * 3.6);
      flex-shrink: 0;
    }

    .empire-crest svg {
      width: 100%;
      height: 100%;
    }

    .empire-text {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
    }

    .empire-name {
      font-size: var(--hud-text-md);
      font-weight: bold;
      color: var(--hud-text);
      letter-spacing: 2px;
      line-height: 1;
    }

    .empire-level {
      font-size: var(--hud-text-sm);
      color: var(--hud-text-dim);
      letter-spacing: 1.5px;
      line-height: 1;
    }
  `;
  document.head.appendChild(style);
}

function createCrestSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('fill', 'none');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '24');
  circle.setAttribute('cy', '24');
  circle.setAttribute('r', '21');
  circle.setAttribute('stroke', 'rgba(255,255,255,0.7)');
  circle.setAttribute('stroke-width', '1.5');
  svg.appendChild(circle);

  const shield = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shield.setAttribute('d', 'M24 10l10 5v8c0 6-4 10.5-10 12.5-6-2-10-6.5-10-12.5v-8l10-5z');
  shield.setAttribute('stroke', 'rgba(255,255,255,0.8)');
  shield.setAttribute('stroke-width', '1.2');
  shield.setAttribute('fill', 'rgba(255,255,255,0.08)');
  svg.appendChild(shield);

  const deco = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  deco.setAttribute('d', 'M24 16l2 4 4 1-3 3 .5 4-3.5-2-3.5 2 .5-4-3-3 4-1 2-4z');
  deco.setAttribute('fill', 'rgba(255,255,255,0.9)');
  svg.appendChild(deco);

  for (const [cx, cy] of [[24, 30], [20, 28], [28, 28], [22, 32], [26, 32]]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', '1');
    dot.setAttribute('fill', 'rgba(255,255,255,0.7)');
    svg.appendChild(dot);
  }

  return svg;
}

export function criarEmpireBadge(empireName: string, level: number): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const badge = document.createElement('div');
  badge.className = 'hud-panel empire-badge';

  const crest = document.createElement('div');
  crest.className = 'empire-crest';
  crest.appendChild(createCrestSvg());
  badge.appendChild(crest);

  const text = document.createElement('div');
  text.className = 'empire-text';

  const name = document.createElement('div');
  name.className = 'empire-name';
  name.textContent = empireName.toUpperCase();
  text.appendChild(name);

  const lvl = document.createElement('div');
  lvl.className = 'empire-level';
  lvl.textContent = `LEVEL ${level}`;
  text.appendChild(lvl);

  badge.appendChild(text);

  _container = badge;
  document.body.appendChild(badge);
  registerBadge(badge);

  return badge;
}

export function destruirEmpireBadge(): void {
  if (_container) {
    unregisterBadge();
    _container.remove();
    _container = null;
  }
}
