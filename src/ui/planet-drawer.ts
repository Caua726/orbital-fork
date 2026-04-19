/**
 * Rich in-game side drawer showing the full view of a planet.
 *
 * Opens when the player clicks a planet. Aggregates everything that
 * was previously spread between the legacy planet-panel, tooltips,
 * and the separate lore modal: name, owner (with faction lore link),
 * resources, factories/infrastructure, ships, active research,
 * construction, production queue, plus the procedural lore summary.
 *
 * This is a non-blocking side drawer — there is no backdrop, the
 * world canvas stays interactive behind it. Re-renders on demand when
 * the caller invokes atualizarPlanetaDrawer with the same planet —
 * cheap enough (throttled ~2 Hz) to call each frame while open.
 */

import type { Mundo, Planeta } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { nomeTipoPlaneta, getTierMax } from '../world/mundo';
import { getPersonalidades } from '../world/ia-decisao';
import { gerarImperioLore } from '../world/lore/imperio-lore';
import { abrirImperioLore } from './lore-modal';
import { oreIcon, alloyIcon, fuelIcon } from './resource-bar';
import { renderPlanetaParaCanvas, liberarPortraitPlaneta } from '../world/planeta-procedural';
import { setCameraFollow } from '../core/player';
import { abrirPlanetDetailsModal } from './planet-details-modal';

let _modal: HTMLDivElement | null = null;
let _bodyEl: HTMLDivElement | null = null;
let _styleInjected = false;
let _closeResolver: (() => void) | null = null;
let _currentPlaneta: Planeta | null = null;
let _currentMundo: Mundo | null = null;
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let _lastRebuildMs = 0;
/** Live-shader portrait canvas mounted inside the drawer header.
 *  Refreshed periodically via refreshPortrait() — not every frame,
 *  since portrait doesn't need 60 Hz. */
let _portraitCanvas: HTMLCanvasElement | null = null;
let _lastPortraitRefreshMs = 0;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Side drawer — coexists with an interactive world, no backdrop.
       The entry/exit animation uses visibility + opacity + transform;
       display stays flex throughout so the CSS transition fires. */
    .planeta-drawer {
      /* Compact side panel — anchored to the right edge, vertically
         centered on the viewport. max-height prevents it from
         overlapping the bottom build-panel on short screens. */
      position: fixed;
      top: 50%;
      left: auto;
      right: var(--hud-margin);
      bottom: auto;
      width: clamp(280px, 24vw, 360px);
      max-height: calc(100vh - var(--hud-unit) * 16);
      margin: 0;
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      z-index: 941;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      /* Entry/exit state — fully off the right edge, kept vertically
         centered with translateY(-50%). */
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate(calc(100% + var(--hud-margin) * 2), -50%);
      transition:
        opacity 220ms ease-out,
        transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 320ms;
    }
    .planeta-drawer.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate(0, -50%);
      transition:
        opacity 220ms ease-out,
        transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .planeta-drawer-head {
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.6);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.9);
      border-bottom: 1px solid var(--hud-line);
    }

    .planeta-drawer-portrait {
      width: calc(var(--hud-unit) * 4.5);
      height: calc(var(--hud-unit) * 4.5);
      border: 1px solid var(--hud-line);
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.04), rgba(0,0,0,0.2));
      display: grid;
      place-items: center;
      flex-shrink: 0;
      overflow: hidden;
    }

    .planeta-drawer-meta {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
      flex: 1;
      min-width: 0;
    }
    .planeta-drawer-name {
      /* Using --hud-font (variable-width) not --hud-font-display
         (Press Start 2P) because planet names are procedural and can
         be long — the pixel font would force ellipsis-truncation on
         most 2-word names even in the widest drawer. Keep uppercase +
         tracking so the label-like feel survives. */
      font-family: var(--hud-font);
      font-weight: 600;
      font-size: calc(var(--hud-unit) * 1.0);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1.15;
      color: var(--hud-text);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .planeta-drawer-tipo {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.8);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .planeta-drawer-owner {
      display: inline-flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.3);
      margin-top: calc(var(--hud-unit) * 0.3);
      font-size: calc(var(--hud-unit) * 0.85);
      color: var(--hud-text);
      cursor: pointer;
      width: fit-content;
    }
    .planeta-drawer-owner-dot {
      width: calc(var(--hud-unit) * 0.7);
      height: calc(var(--hud-unit) * 0.7);
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.3);
    }
    .planeta-drawer-owner.clickable:hover .planeta-drawer-owner-name { text-decoration: underline; }

    .planeta-drawer-focus {
      align-self: flex-start;
      width: calc(var(--hud-unit) * 2);
      height: calc(var(--hud-unit) * 2);
      display: grid;
      place-items: center;
      padding: 0;
      margin: 0;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      color: var(--hud-text-dim);
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
      flex-shrink: 0;
    }
    .planeta-drawer-focus:hover {
      background: rgba(255,255,255,0.10);
      color: var(--hud-text);
      border-color: var(--hud-border);
    }
    .planeta-drawer-focus svg { width: 60%; height: 60%; display: block; }

    /* Header button row — keeps the focus + details buttons grouped
       on the right side of the planet-drawer header so they share a
       visual lane instead of floating inconsistently. */
    .planeta-drawer-head-actions {
      display: flex;
      gap: calc(var(--hud-unit) * 0.3);
      align-self: flex-start;
      flex-shrink: 0;
    }

    /* "Ver detalhes" button — full-width below the header metadata so
       it reads as a primary CTA without fighting the compact focus
       icon. Same token family as other drawer buttons. */
    .planeta-drawer-details-btn {
      appearance: none;
      margin: 0 calc(var(--hud-unit) * 0.8) calc(var(--hud-unit) * 0.4);
      padding: calc(var(--hud-unit) * 0.55) calc(var(--hud-unit) * 0.9);
      background: rgba(140, 190, 255, 0.10);
      border: 1px solid rgba(140, 190, 255, 0.35);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.78);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
      border-radius: calc(var(--hud-radius) * 0.5);
      transition: background 140ms ease, border-color 140ms ease;
    }
    .planeta-drawer-details-btn:hover {
      background: rgba(140, 190, 255, 0.22);
      border-color: rgba(140, 190, 255, 0.55);
    }

    .planeta-drawer-body {
      padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.8) calc(var(--hud-unit) * 0.7);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.5);
    }

    .planeta-card {
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 0.6);
      background: rgba(255,255,255,0.02);
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.25);
    }
    .planeta-card-title {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.8);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin: 0 0 calc(var(--hud-unit) * 0.2);
    }

    .planeta-stats-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--hud-unit) * 0.4);
      font-size: calc(var(--hud-unit) * 0.9);
    }
    .planeta-stats-label { color: var(--hud-text-dim); }
    .planeta-stats-value { color: var(--hud-text); font-variant-numeric: tabular-nums; }

    .planeta-resources-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: calc(var(--hud-unit) * 0.3);
    }
    .planeta-resource {
      text-align: center;
      padding: calc(var(--hud-unit) * 0.25) calc(var(--hud-unit) * 0.15);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      background: rgba(0,0,0,0.15);
    }
    .planeta-resource-icon {
      width: calc(var(--hud-unit) * 1.4);
      height: calc(var(--hud-unit) * 1.4);
      margin: 0 auto;
      color: rgba(255,255,255,0.92);
    }
    .planeta-resource-icon svg {
      width: 100%;
      height: 100%;
      display: block;
      fill: currentColor;
    }
    .planeta-resource-label {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.7);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .planeta-resource-value {
      font-size: calc(var(--hud-unit) * 1.1);
      color: var(--hud-text);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .planeta-progress-item {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
      padding: calc(var(--hud-unit) * 0.4) 0;
      border-bottom: 1px solid var(--hud-line);
    }
    .planeta-progress-item:last-child { border-bottom: none; }
    .planeta-progress-line {
      display: flex;
      justify-content: space-between;
      font-size: calc(var(--hud-unit) * 0.95);
    }
    .planeta-progress-bar {
      width: 100%;
      height: calc(var(--hud-unit) * 0.25);
      background: rgba(255,255,255,0.06);
      border-radius: calc(var(--hud-radius) * 0.3);
      overflow: hidden;
    }
    .planeta-progress-bar-fill {
      height: 100%;
      background: #8ec6ff;
      transition: width 180ms ease;
    }

    .planeta-lore-summary {
      font-size: calc(var(--hud-unit) * 0.95);
      line-height: 1.5;
      color: var(--hud-text-dim);
      font-style: italic;
      margin: 0;
    }

    .planeta-drawer-actions {
      display: flex;
      gap: calc(var(--hud-unit) * 0.3);
      flex-wrap: wrap;
      padding: calc(var(--hud-unit) * 0.45) calc(var(--hud-unit) * 0.8);
      border-top: 1px solid var(--hud-line);
      background: rgba(0,0,0,0.2);
    }
    .planeta-drawer-btn {
      appearance: none;
      padding: calc(var(--hud-unit) * 0.45) calc(var(--hud-unit) * 0.75);
      background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.75);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 120ms ease;
    }
    .planeta-drawer-btn:hover { background: rgba(255,255,255,0.08); }
    .planeta-drawer-btn.primary { background: rgba(140, 190, 255, 0.12); border-color: rgba(140, 190, 255, 0.4); }
    .planeta-drawer-btn.primary:hover { background: rgba(140, 190, 255, 0.22); }

    .planeta-empty {
      color: var(--hud-text-dim);
      font-style: italic;
      font-size: calc(var(--hud-unit) * 0.95);
    }

    /* NOTE: removed a stale @media (max-width: 600px) block that
       applied grid properties to a flex container — dead rules. If
       small-viewport adjustments are needed later, tune .planeta-drawer
       width directly instead of toggling a non-existent grid. */
  `;
  document.head.appendChild(style);
}

function removeAllChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function ownerLabel(dono: string): string {
  if (dono === 'jogador') return 'Seu Império';
  if (dono === 'neutro') return 'Neutro';
  const ia = getPersonalidades().find((x) => x.id === dono);
  return ia?.nome ?? 'Desconhecido';
}

function ownerColor(dono: string): string {
  if (dono === 'jogador') return '#44aaff';
  if (dono === 'neutro') return '#888888';
  const ia = getPersonalidades().find((x) => x.id === dono);
  if (ia) return `#${ia.cor.toString(16).padStart(6, '0')}`;
  return '#888888';
}

// ─── Card builders ──────────────────────────────────────────────────

function cardRecursos(p: Planeta): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'planeta-card';
  const t = document.createElement('h3');
  t.className = 'planeta-card-title';
  t.textContent = 'Recursos';
  card.appendChild(t);

  const grid = document.createElement('div');
  grid.className = 'planeta-resources-grid';
  // Uses the same SVG glyphs as the top resource-bar for a consistent
  // visual vocabulary across the HUD.
  const tipos: Array<[string, () => SVGSVGElement, number]> = [
    ['Comum', oreIcon, p.dados.recursos.comum],
    ['Raro', alloyIcon, p.dados.recursos.raro],
    ['Fuel', fuelIcon, p.dados.recursos.combustivel],
  ];
  for (const [label, iconFn, val] of tipos) {
    const r = document.createElement('div');
    r.className = 'planeta-resource';
    const i = document.createElement('div');
    i.className = 'planeta-resource-icon';
    i.appendChild(iconFn());
    const v = document.createElement('div');
    v.className = 'planeta-resource-value';
    v.textContent = Math.floor(val).toString();
    const l = document.createElement('div');
    l.className = 'planeta-resource-label';
    l.textContent = label;
    r.append(i, v, l);
    grid.appendChild(r);
  }
  card.appendChild(grid);
  return card;
}

function cardInfraestrutura(p: Planeta): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'planeta-card';
  const t = document.createElement('h3');
  t.className = 'planeta-card-title';
  t.textContent = 'Infraestrutura';
  card.appendChild(t);

  const rows: Array<[string, string]> = [
    ['Fábricas', `${p.dados.fabricas} / ${getTierMax()}`],
    ['Infraestrutura', `${p.dados.infraestrutura} / ${getTierMax()}`],
    ['Naves em órbita', String(p.dados.naves)],
    ['Tipo de mundo', nomeTipoPlaneta(p.dados.tipoPlaneta)],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'planeta-stats-row';
    const l = document.createElement('span'); l.className = 'planeta-stats-label'; l.textContent = label;
    const v = document.createElement('span'); v.className = 'planeta-stats-value'; v.textContent = value;
    row.append(l, v);
    card.appendChild(row);
  }
  return card;
}

// Deeper cards (production rates, active activity, lore preview) were
// removed to keep the drawer compact. Their info is still reachable via
// the "Ver arquivo planetário" button which opens the full lore modal.

// ─── Main builders ──────────────────────────────────────────────────

function buildHeader(p: Planeta): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'planeta-drawer-head';

  const portrait = document.createElement('div');
  portrait.className = 'planeta-drawer-portrait';
  // Initial placeholder tint in case the first live-shader render
  // hasn't landed yet (Pixi not fully ready on first click).
  portrait.style.background = `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2), ${tipoPlanetaCor(p.dados.tipoPlaneta)} 70%)`;
  head.appendChild(portrait);
  refreshPortrait(p, portrait);

  const meta = document.createElement('div');
  meta.className = 'planeta-drawer-meta';
  const h = document.createElement('h2');
  h.className = 'planeta-drawer-name';
  h.id = 'pd-title';
  h.textContent = p.dados.nome;
  // Full name via native tooltip — long procedural names get
  // ellipsis-clipped by the CSS, so exposing the full text on hover
  // matches planet-panel's behaviour and keeps information parity.
  h.title = p.dados.nome;
  meta.appendChild(h);
  const tipo = document.createElement('div');
  tipo.className = 'planeta-drawer-tipo';
  tipo.textContent = nomeTipoPlaneta(p.dados.tipoPlaneta);
  meta.appendChild(tipo);

  const owner = document.createElement('div');
  const dono = p.dados.dono;
  const ia = getPersonalidades().find((x) => x.id === dono);
  const clickable = dono !== 'jogador' && dono !== 'neutro' && !!ia;
  owner.className = `planeta-drawer-owner${clickable ? ' clickable' : ''}`;
  const ownerDot = document.createElement('div');
  ownerDot.className = 'planeta-drawer-owner-dot';
  ownerDot.style.background = ownerColor(dono);
  owner.appendChild(ownerDot);
  const ownerName = document.createElement('span');
  ownerName.className = 'planeta-drawer-owner-name';
  ownerName.textContent = ownerLabel(dono);
  owner.appendChild(ownerName);
  if (clickable && ia && _currentMundo) {
    owner.title = 'Ver arquivo imperial';
    owner.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const loreIA = gerarImperioLore({
        empireId: ia.id,
        galaxySeed: _currentMundo!.galaxySeed,
        personalidade: ia,
        nomeImperio: ia.nome,
      });
      void abrirImperioLore(loreIA);
    });
  }
  meta.appendChild(owner);
  head.appendChild(meta);

  const focusBtn = document.createElement('button');
  focusBtn.type = 'button';
  focusBtn.className = 'planeta-drawer-focus';
  focusBtn.title = 'Centralizar câmera';
  focusBtn.setAttribute('aria-label', 'Centralizar câmera no planeta');
  focusBtn.appendChild(buildFocusIcon());
  focusBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setCameraFollow(p);
  });
  head.appendChild(focusBtn);

  // Close button intentionally omitted — the drawer closes on
  // click-outside (via fecharPlanetaDrawer wired in core/player.ts)
  // and on ESC (keydown handler), so an explicit × is redundant.

  return head;
}

/** Primary "Ver detalhes" CTA rendered between the header and the
 *  body cards. Opens the semi-fullscreen planet-details-modal with
 *  the richer layout — two-column identity + resources + infra +
 *  research, portrait on the left, live stats on the right. */
function buildDetailsButton(p: Planeta, mundo: Mundo): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'planeta-drawer-details-btn';
  btn.textContent = 'Ver detalhes';
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    void abrirPlanetDetailsModal(p, mundo);
  });
  return btn;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function buildFocusIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '3');
  // Host panels (e.g. ship-panel) may set `fill: currentColor` on child
  // svg elements which would bleed into this stroke-only icon. Explicit
  // attribute on each shape wins over inherited CSS fill.
  circle.setAttribute('fill', 'none');
  svg.appendChild(circle);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M12 2v3M12 19v3M2 12h3M19 12h3');
  path.setAttribute('fill', 'none');
  svg.appendChild(path);
  return svg;
}

function tipoPlanetaCor(tipo: string): string {
  if (tipo === 'marte') return '#c96a3a';
  if (tipo === 'gasoso') return '#9a7fc2';
  return '#4a9e6a';
}

const PORTRAIT_REFRESH_MS = 500;

/**
 * Render the planet's live shader into a small canvas and swap it
 * into the portrait slot. Called on drawer open and periodically from
 * atualizarPlanetaDrawer — throttled to ~2 Hz since the portrait is
 * a preview, not the main view.
 */
function refreshPortrait(planeta: Planeta, portraitEl: HTMLElement): void {
  // 160px at source resolution keeps the bigger portrait sharp on
  // retina displays without making the GPU work too hard.
  const canvas = renderPlanetaParaCanvas(planeta, 160);
  if (!canvas) return;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.borderRadius = '50%';
  // Replace the existing canvas if any, else append.
  if (_portraitCanvas && _portraitCanvas.parentElement === portraitEl) {
    portraitEl.replaceChild(canvas, _portraitCanvas);
  } else {
    // Clear any placeholder children then mount
    while (portraitEl.firstChild) portraitEl.removeChild(portraitEl.firstChild);
    portraitEl.appendChild(canvas);
  }
  _portraitCanvas = canvas;
  _lastPortraitRefreshMs = performance.now();
}

function tickPortraitIfDue(): void {
  if (!_modal || !_currentPlaneta) return;
  const portraitEl = _modal.querySelector<HTMLElement>('.planeta-drawer-portrait');
  if (!portraitEl) return;
  const now = performance.now();
  if (now - _lastPortraitRefreshMs < PORTRAIT_REFRESH_MS) return;
  refreshPortrait(_currentPlaneta, portraitEl);
}

function buildActions(_p: Planeta, _mundo: Mundo): HTMLDivElement | null {
  // Action row intentionally empty for now — the planetary archive
  // button was removed per user request. The header × still closes
  // the drawer; empire lore is still reachable by clicking the owner
  // row in the header. Returning null so the caller skips appending.
  return null;
}

function rebuildBody(p: Planeta, _mundo: Mundo): void {
  if (!_bodyEl) return;
  removeAllChildren(_bodyEl);
  // Minimal drawer — only the essentials. Deeper info (production
  // rates, active construction, lore, etc.) is reachable via the
  // "Ver arquivo planetário" button in the footer.
  _bodyEl.appendChild(cardRecursos(p));
  _bodyEl.appendChild(cardInfraestrutura(p));
}

// ─── Public API ─────────────────────────────────────────────────────

function ensureModal(): void {
  if (_modal) return;
  injectStyles();
  const modal = document.createElement('div');
  modal.className = 'planeta-drawer';
  modal.setAttribute('data-ui', 'true');
  // ARIA wiring mirrors mobile-planet-drawer so screen readers
  // announce the drawer's purpose on open. aria-labelledby points
  // to the h2 we render inside buildHeader (id="pd-title").
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'pd-title');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });
  _modal = modal;
  document.body.appendChild(modal);

  _keydownHandler = (e: KeyboardEvent) => {
    if (_closeResolver && e.key === 'Escape') { e.preventDefault(); close(); }
  };
  window.addEventListener('keydown', _keydownHandler);
}

export function abrirPlanetaDrawer(planeta: Planeta, mundo: Mundo): Promise<void> {
  ensureModal();
  if (!_modal) return Promise.resolve();
  // Same planet, already open — no-op.
  if (_closeResolver && _currentPlaneta === planeta) return Promise.resolve();

  // Switching planets while a previous open Promise is still live —
  // resolve the old one so its awaiter learns the modal moved on,
  // then create a fresh Promise for the new planet.
  if (_closeResolver && _currentPlaneta !== planeta) {
    const prev = _closeResolver;
    _closeResolver = null;
    prev();
  }

  _currentPlaneta = planeta;
  _currentMundo = mundo;
  _lastRebuildMs = performance.now();

  // Clear the stale portrait-canvas ref BEFORE detaching children.
  // Without this, a planet-switch leaves _portraitCanvas pointing at
  // a now-detached node; the next refreshPortrait compares parents
  // against it and takes the wrong branch. close() already nulls it,
  // but close() isn't called during a planet switch.
  _portraitCanvas = null;
  removeAllChildren(_modal);
  _modal.appendChild(buildHeader(planeta));
  _modal.appendChild(buildDetailsButton(planeta, mundo));
  const body = document.createElement('div');
  body.className = 'planeta-drawer-body';
  _bodyEl = body;
  _modal.appendChild(body);
  rebuildBody(planeta, mundo);
  const actions = buildActions(planeta, mundo);
  if (actions) _modal.appendChild(actions);

  _modal.classList.add('visible');

  return new Promise<void>((resolve) => { _closeResolver = resolve; });
}

const REBUILD_INTERVALO_MS = 500;

/**
 * Re-render the currently-shown planet's cards without re-opening.
 *
 * Throttled to ~2 Hz — the modal shows human-readable stats (resource
 * counts, timers, progress bars), none of which need to update at
 * render-loop frequency. Rebuilding at 60 Hz tore down and recreated
 * ~30 DOM elements per frame, creating GC pressure and layout thrash.
 */
export function atualizarPlanetaDrawer(): void {
  if (!_closeResolver || !_currentPlaneta || !_currentMundo || !_bodyEl) return;
  // Portrait refreshes at its own throttle (500ms) independent of
  // the body rebuild cadence (also 500ms) — they happen to match
  // today but there's no reason to couple them.
  tickPortraitIfDue();
  const now = performance.now();
  if (now - _lastRebuildMs < REBUILD_INTERVALO_MS) return;
  _lastRebuildMs = now;
  rebuildBody(_currentPlaneta, _currentMundo);
}

export function isPlanetaDrawerAberto(): boolean {
  return _closeResolver !== null;
}

function close(): void {
  _modal?.classList.remove('visible');
  _currentPlaneta = null;
  _currentMundo = null;
  _portraitCanvas = null;
  _lastPortraitRefreshMs = 0;
  // Release the Pixi resources cached for the portrait shader render.
  // Keeping them around while the drawer is closed is pure dead weight.
  liberarPortraitPlaneta();
  const r = _closeResolver;
  _closeResolver = null;
  if (r) r();
}

/** Public close — no-op if drawer isn't open. Used by click-outside
 *  handlers in player.ts. */
export function fecharPlanetaDrawer(): void {
  if (_closeResolver) close();
}

export function destruirPlanetaDrawer(): void {
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  _modal?.remove();
  _modal = null;
  _bodyEl = null;
  _styleInjected = false;
  _lastRebuildMs = 0;
  if (_closeResolver) {
    const r = _closeResolver;
    _closeResolver = null;
    r();
  }
}
