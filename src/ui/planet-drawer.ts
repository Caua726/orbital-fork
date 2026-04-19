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
import { parseAcaoNave } from '../world/naves';
import { diagnosticarFila, moverItemFila, removerItemFila } from '../world/construcao';
import { bindFilaDragDrop, isFilaDragging } from './fila-dnd';

const LABEL_NAVE_DRAWER: Record<string, string> = {
  colonizadora: 'Colonizadora',
  cargueira: 'Cargueira',
  batedora: 'Batedora',
  torreta: 'Torreta',
  fragata: 'Fragata',
};

function rotuloAcaoFilaDrawer(acao: string): string {
  const parsed = parseAcaoNave(acao);
  if (parsed) {
    const nome = LABEL_NAVE_DRAWER[parsed.tipo] ?? parsed.tipo;
    return parsed.tipo === 'colonizadora' ? nome : `${nome} T${parsed.tier}`;
  }
  if (acao === 'fabrica') return 'Fábrica';
  if (acao === 'infraestrutura') return 'Infraestrutura';
  return acao;
}

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
  // HMR defence: remove any previous injection before re-adding so
  // Vite hot reloads pick up CSS changes immediately instead of
  // stacking stale rules on top that may win by source order.
  if (_styleInjected) {
    const old = document.head.querySelector('style[data-src="planet-drawer"]');
    if (old) old.remove();
  }
  _styleInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-src', 'planet-drawer');
  style.textContent = `
    /* Side drawer — coexists with an interactive world, no backdrop.
       The entry/exit animation uses visibility + opacity + transform;
       display stays flex throughout so the CSS transition fires. */
    .planeta-drawer {
      /* Compact side panel anchored to the right edge, vertically
         centered via auto margins. NOT via translateY(-50%) — that
         percentage resolves against the element's own height, which
         is 0 on the first frame of the mount-time animation (before
         children are laid out), so Y evaluated to 0 and the drawer
         slid in from the bottom of the viewport. Auto margins on
         top/bottom center the element against the viewport regardless
         of its own height, so the animation only has to move X. */
      position: fixed;
      top: 0;
      bottom: 0;
      left: auto;
      right: var(--hud-margin);
      width: clamp(280px, 24vw, 360px);
      height: fit-content;
      max-height: calc(100vh - var(--hud-unit) * 16);
      margin: auto 0;
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

      opacity: 1;
      pointer-events: auto;
      /* Mount: compound animation gives the drawer a tactile feel —
         fade in fast (200ms) so content reads immediately, slide in
         slower (340ms) with a tiny overshoot so it settles with
         weight. Transform uses a cubic-bezier that ends slightly
         past its target and eases back. */
      animation:
        pd-fade-in 200ms ease-out both,
        pd-slide-in 340ms cubic-bezier(0.16, 0.84, 0.24, 1.03) both;
      /* Exit uses transition instead of another animation so it
         starts deterministically from the current rest state and
         doesn't race against fill-mode of the mount animation. */
      transition:
        opacity 180ms ease-in,
        transform 260ms cubic-bezier(0.5, 0, 0.75, 0);
      will-change: transform, opacity;
    }
    @keyframes pd-slide-in {
      from { transform: translateX(calc(100% + var(--hud-margin) * 2)); }
      60%  { transform: translateX(-6px); }
      to   { transform: translateX(0); }
    }
    @keyframes pd-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Exit: kill any running mount animation, let the transition
       handle the slide-out to offscreen-right + fade. */
    .planeta-drawer.closing {
      animation: none;
      opacity: 0;
      pointer-events: none;
      transform: translateX(calc(100% + var(--hud-margin) * 2));
    }

    .planeta-drawer-head {
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.6);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.9);
      /* No bottom divider — the Ver Detalhes button's own border and
         the first card below it provide enough visual separation. */
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

    /* "Ver detalhes" button — minimal outlined CTA. Full-width inside
       the drawer, white 1px outline, dimmed text. Hover brightens
       border + text + background faintly. No icons, no pseudo-
       elements, no letter-spacing dance: just a button. */
    .planeta-drawer-details-btn {
      appearance: none;
      display: block;
      width: calc(100% - var(--hud-unit) * 1.6);
      margin: calc(var(--hud-unit) * 0.55) auto calc(var(--hud-unit) * 0.4);
      padding: calc(var(--hud-unit) * 0.58) calc(var(--hud-unit) * 0.9);
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: rgba(255, 255, 255, 0.8);
      font-family: var(--hud-font);
      font-weight: 600;
      font-size: calc(var(--hud-unit) * 0.78);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      border-radius: calc(var(--hud-radius) * 0.5);
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .planeta-drawer-details-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.7);
      color: #fff;
    }
    .planeta-drawer-details-btn:active { background: rgba(255, 255, 255, 0.14); }

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
      background: rgba(255, 255, 255, 0.75);
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
    .planeta-drawer-btn.primary {
      background: rgba(255, 255, 255, 0.10);
      border-color: rgba(255, 255, 255, 0.55);
    }
    .planeta-drawer-btn.primary:hover {
      background: rgba(255, 255, 255, 0.18);
      border-color: #fff;
    }

    .planeta-empty {
      color: var(--hud-text-dim);
      font-style: italic;
      font-size: calc(var(--hud-unit) * 0.95);
    }

    /* NOTE: removed a stale @media (max-width: 600px) block that
       applied grid properties to a flex container — dead rules. If
       small-viewport adjustments are needed later, tune .planeta-drawer
       width directly instead of toggling a non-existent grid. */

    /* ─ Fila (production queue) ─ */
    .drawer-fila-list {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.3);
      position: relative;
    }
    .drawer-fila-item {
      display: grid;
      grid-template-columns: calc(var(--hud-unit) * 1) calc(var(--hud-unit) * 1.1) 1fr auto calc(var(--hud-unit) * 1.1);
      align-items: center;
      gap: calc(var(--hud-unit) * 0.4);
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.5);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.55);
      background: rgba(255, 255, 255, 0.02);
      font-size: calc(var(--hud-unit) * 0.78);
      transition: transform 180ms ease, box-shadow 160ms ease, opacity 160ms;
    }
    .drawer-fila-item.fila-dragging {
      z-index: 10;
      opacity: 0.92;
      box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1) rgba(0, 0, 0, 0.7);
      transition: none;
      cursor: grabbing;
    }
    .fila-drag-handle {
      width: calc(var(--hud-unit) * 1);
      height: calc(var(--hud-unit) * 1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--hud-text-dim);
      cursor: grab;
      user-select: none;
      font-size: calc(var(--hud-unit) * 0.8);
      line-height: 1;
      letter-spacing: -1px;
    }
    .fila-drag-handle:hover { color: var(--hud-text); }
    .fila-drag-handle.locked {
      opacity: 0.25;
      cursor: not-allowed;
    }
    .fila-remove-btn {
      appearance: none;
      background: transparent;
      border: 1px solid transparent;
      color: var(--hud-text-dim);
      width: calc(var(--hud-unit) * 1.1);
      height: calc(var(--hud-unit) * 1.1);
      border-radius: 50%;
      cursor: pointer;
      font-size: calc(var(--hud-unit) * 0.8);
      line-height: 1;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms, color 120ms, border-color 120ms;
    }
    .fila-remove-btn:hover:not(:disabled) {
      color: #ff9f9f;
      border-color: rgba(255, 120, 120, 0.45);
      background: rgba(255, 120, 120, 0.08);
    }
    .fila-remove-btn:disabled {
      opacity: 0.2;
      cursor: not-allowed;
    }
    .fila-drop-indicator {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 1px;
      pointer-events: none;
      box-shadow: 0 0 calc(var(--hud-unit) * 0.4) rgba(255, 255, 255, 0.35);
      z-index: 20;
      display: none;
    }
    .drawer-fila-diag {
      margin-top: calc(var(--hud-unit) * 0.35);
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.55);
      border: 1px solid rgba(255, 180, 120, 0.45);
      background: rgba(255, 180, 120, 0.08);
      border-radius: calc(var(--hud-radius) * 0.5);
      color: rgba(255, 210, 170, 0.95);
      font-size: calc(var(--hud-unit) * 0.72);
      line-height: 1.35;
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.4);
    }
    .drawer-fila-diag::before {
      content: '⏸';
      color: rgba(255, 200, 140, 0.9);
    }
    .drawer-fila-item.is-active {
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.06);
    }
    .drawer-fila-idx {
      color: var(--hud-text-dim);
      font-size: calc(var(--hud-unit) * 0.7);
      letter-spacing: 0.08em;
      text-align: right;
    }
    .drawer-fila-item.is-active .drawer-fila-idx { color: var(--hud-text); }
    .drawer-fila-pct {
      color: var(--hud-text-dim);
      font-variant-numeric: tabular-nums;
      font-size: calc(var(--hud-unit) * 0.72);
    }
    .drawer-fila-item.is-active .drawer-fila-pct { color: var(--hud-text); }
    .drawer-fila-bar {
      grid-column: 1 / -1;
      height: calc(var(--hud-unit) * 0.18);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
      margin-top: calc(var(--hud-unit) * 0.25);
    }
    .drawer-fila-bar-fill {
      height: 100%;
      background: rgba(255, 255, 255, 0.65);
      border-radius: inherit;
      transition: width 200ms linear;
    }
    .drawer-fila-footer {
      display: flex;
      justify-content: space-between;
      margin-top: calc(var(--hud-unit) * 0.4);
      font-size: calc(var(--hud-unit) * 0.7);
      color: var(--hud-text-dim);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .drawer-fila-footer .on { color: var(--hud-text); }
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

// Monochrome owner tone — the drawer is deliberately colorless so
// owner identity is signalled through brightness + (elsewhere)
// labels / tooltips instead of hue. Player = near-white, neutral =
// mid-grey, AI = dim-grey so "mine" vs "not mine" still reads fast.
function ownerColor(dono: string): string {
  if (dono === 'jogador') return 'rgba(255, 255, 255, 0.95)';
  if (dono === 'neutro') return 'rgba(255, 255, 255, 0.45)';
  return 'rgba(255, 255, 255, 0.65)';
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

function cardFila(p: Planeta): HTMLDivElement | null {
  const d = p.dados;
  const fila = d.filaProducao;
  if (fila.length === 0 && !d.repetirFilaProducao) return null;

  const card = document.createElement('div');
  card.className = 'planeta-card';
  const t = document.createElement('h3');
  t.className = 'planeta-card-title';
  t.textContent = 'Fila de Produção';
  card.appendChild(t);

  const headLocked = d.construcaoAtual !== null || d.producaoNave !== null;

  if (fila.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'planeta-empty';
    empty.textContent = 'Fila vazia';
    card.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'drawer-fila-list';
    fila.slice(0, 5).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'drawer-fila-item';
      row.dataset.filaIdx = String(idx);
      const isHeadActive = idx === 0 && headLocked;
      if (isHeadActive) row.classList.add('is-active');

      const handle = document.createElement('div');
      handle.className = 'fila-drag-handle';
      if (isHeadActive) handle.classList.add('locked');
      handle.textContent = '⋮⋮';
      handle.title = isHeadActive ? 'Item em produção — não pode ser movido' : 'Arrastar para reordenar';

      const idxEl = document.createElement('div');
      idxEl.className = 'drawer-fila-idx';
      idxEl.textContent = isHeadActive ? '>>' : `${idx + 1}.`;

      const nameEl = document.createElement('div');
      nameEl.textContent = rotuloAcaoFilaDrawer(item.acao);

      const pctEl = document.createElement('div');
      pctEl.className = 'drawer-fila-pct';

      let pct: number | null = null;
      if (isHeadActive) {
        const job = d.construcaoAtual ?? d.producaoNave;
        if (job && job.tempoTotalMs > 0) {
          pct = Math.max(0, Math.min(100, Math.round(
            (1 - job.tempoRestanteMs / job.tempoTotalMs) * 100,
          )));
        }
      }
      pctEl.textContent = pct !== null ? `${pct}%` : '—';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'fila-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = isHeadActive ? 'Item em produção não pode ser cancelado' : 'Remover da fila';
      removeBtn.disabled = isHeadActive;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentIdx = Number(row.dataset.filaIdx ?? idx);
        if (removerItemFila(p, currentIdx) && _currentPlaneta && _currentMundo) {
          rebuildBody(_currentPlaneta, _currentMundo);
        }
      });

      row.append(handle, idxEl, nameEl, pctEl, removeBtn);

      if (isHeadActive && pct !== null) {
        const bar = document.createElement('div');
        bar.className = 'drawer-fila-bar';
        const fill = document.createElement('div');
        fill.className = 'drawer-fila-bar-fill';
        fill.style.width = `${pct}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      }
      list.appendChild(row);
    });
    card.appendChild(list);

    // Wire drag & drop after the list is in the card's DOM tree.
    bindFilaDragDrop(list, {
      itemSelector: '.drawer-fila-item',
      handleSelector: '.fila-drag-handle',
      getIdx: (el) => Number(el.dataset.filaIdx ?? -1),
      isLocked: (idx) => headLocked && idx === 0,
      onReorder: (from, to) => {
        if (moverItemFila(p, from, to) && _currentPlaneta && _currentMundo) {
          rebuildBody(_currentPlaneta, _currentMundo);
        }
      },
    });
  }

  // Show a diagnostic line when the queue head can't start — "fila
  // travada porque X". Surfaces silent failures (low comum, missing
  // pesquisa, fabrica tier insuficiente).
  const diag = diagnosticarFila(p);
  if (diag) {
    const diagEl = document.createElement('div');
    diagEl.className = 'drawer-fila-diag';
    diagEl.textContent = diag;
    card.appendChild(diagEl);
  }

  const footer = document.createElement('div');
  footer.className = 'drawer-fila-footer';
  const slots = document.createElement('span');
  slots.textContent = `Slots ${fila.length}/5`;
  const loop = document.createElement('span');
  loop.textContent = `Loop: ${d.repetirFilaProducao ? 'ON' : 'OFF'}`;
  if (d.repetirFilaProducao) loop.classList.add('on');
  footer.append(slots, loop);
  card.appendChild(footer);

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

// Monochrome placeholder tone for the portrait while the live shader
// warms up. Slight brightness differences per type keep the disc
// feeling procedural without introducing hue.
function tipoPlanetaCor(tipo: string): string {
  if (tipo === 'marte')  return 'rgba(180, 180, 180, 0.35)';
  if (tipo === 'gasoso') return 'rgba(210, 210, 210, 0.35)';
  return 'rgba(160, 160, 160, 0.35)';
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
  if (p.dados.dono === 'jogador') {
    const filaCard = cardFila(p);
    if (filaCard) _bodyEl.appendChild(filaCard);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a fresh drawer DOM element.
 *
 * Fresh-on-every-open is deliberate. Reusing a long-lived _modal led
 * to CSS @keyframes only firing on the very first mount ever, so
 * second and subsequent opens showed the drawer instantly without
 * animation (plus a handful of related bugs around detached refs
 * and state leaking between opens). Always creating anew trivially
 * guarantees the mount-time animation runs every single open.
 */
function createModalElement(): HTMLDivElement {
  injectStyles();
  const modal = document.createElement('div');
  modal.className = 'planeta-drawer';
  modal.setAttribute('data-ui', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'pd-title');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });
  return modal;
}

/** Attach the global Escape-closes-drawer handler once per module
 *  lifetime — outlives individual modal elements. */
function ensureKeydownHandler(): void {
  if (_keydownHandler) return;
  _keydownHandler = (e: KeyboardEvent) => {
    if (_closeResolver && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', _keydownHandler);
}

export function abrirPlanetaDrawer(planeta: Planeta, mundo: Mundo): Promise<void> {
  ensureKeydownHandler();

  // Same planet, already open — no-op.
  if (_closeResolver && _currentPlaneta === planeta) return Promise.resolve();

  // Planet-switch while drawer is open: keep the current element, just
  // re-render its body. Animating out + in between every selection
  // would feel jumpy. User explicitly complained earlier about
  // 're-animation on content change'.
  if (_closeResolver && _modal && _currentPlaneta !== planeta) {
    const prev = _closeResolver;
    _closeResolver = null;
    prev();
    _currentPlaneta = planeta;
    _currentMundo = mundo;
    _portraitCanvas = null;
    _lastRebuildMs = performance.now();
    removeAllChildren(_modal);
    _modal.appendChild(buildHeader(planeta));
    _modal.appendChild(buildDetailsButton(planeta, mundo));
    const body = document.createElement('div');
    body.className = 'planeta-drawer-body';
    _bodyEl = body;
    _modal.appendChild(body);
    rebuildBody(planeta, mundo);
    return new Promise<void>((resolve) => { _closeResolver = resolve; });
  }

  // Cold open or re-open after previous close: create a BRAND NEW
  // element every time. CSS @keyframes pd-slide-in plays automatically
  // on mount, guaranteeing the slide-in animation every open.
  // If a stale _modal exists (previous close still animating out),
  // yank it immediately so there's no zombie layer.
  if (_modal?.parentElement) _modal.parentElement.removeChild(_modal);

  const modal = createModalElement();
  _modal = modal;
  _currentPlaneta = planeta;
  _currentMundo = mundo;
  _lastRebuildMs = performance.now();
  _portraitCanvas = null;

  modal.appendChild(buildHeader(planeta));
  modal.appendChild(buildDetailsButton(planeta, mundo));
  const body = document.createElement('div');
  body.className = 'planeta-drawer-body';
  _bodyEl = body;
  modal.appendChild(body);
  rebuildBody(planeta, mundo);
  const actions = buildActions(planeta, mundo);
  if (actions) modal.appendChild(actions);

  // Append LAST so children exist before the mount-time animation
  // runs — nothing flashes as the drawer slides in.
  document.body.appendChild(modal);

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
  // Suppress body rebuilds while the user is mid-drag in the fila —
  // otherwise the tick would blow the drag state away every 500ms and
  // the reorder would never complete.
  if (isFilaDragging()) return;
  _lastRebuildMs = now;
  rebuildBody(_currentPlaneta, _currentMundo);
}

export function isPlanetaDrawerAberto(): boolean {
  return _closeResolver !== null;
}

function close(): void {
  const modal = _modal;
  _modal = null;             // detach state ASAP so a follow-up open
  _bodyEl = null;             // creates a brand new element without
  _currentPlaneta = null;     // colliding with the closing one.
  _currentMundo = null;
  _portraitCanvas = null;
  _lastPortraitRefreshMs = 0;
  liberarPortraitPlaneta();
  const r = _closeResolver;
  _closeResolver = null;
  if (r) r();

  if (!modal) return;
  // Slide-out animation runs on .closing; remove element after.
  modal.classList.add('closing');
  setTimeout(() => {
    if (modal.parentElement) modal.parentElement.removeChild(modal);
  }, 300);
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
