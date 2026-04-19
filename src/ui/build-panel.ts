import type { Mundo, Planeta } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { injectBottomSheetStyles } from './bottom-sheet.css';
import { pulseElement } from './animations.css';
import {
  calcularCustoTier,
  calcularTempoConstrucaoMs,
  calcularTempoColonizadoraMs,
  getTierMax,
} from '../world/mundo';
import { construirNoPlaneta } from '../world/construcao';
import { CUSTO_NAVE_COMUM } from '../world/constantes';
import { carregarSpritesheet, getSpritesheetImage } from '../world/spritesheets';
import { t } from '../core/i18n/t';

type AbaId = 'edificios' | 'naves' | 'pesquisa';

interface SpriteCell {
  sheet: 'ships' | 'buildings';
  row: number;
  col: number;
}

interface CardSpec {
  acao: string;
  nomeKey: string;
  // Given the resolved state, return which cell of which spritesheet to draw.
  sprite: (state: CardState) => SpriteCell;
  // Returns enabled state, current/destination tier, and cost (in comum) for this card.
  resolve: (planeta: Planeta) => CardState;
}

interface CardState {
  enabled: boolean;
  tier: number | null;
  cost: number | null;
  // Optional reason to grey out (e.g. queue full, max tier).
  hiddenReason?: 'maxTier' | 'noFactory' | 'noResearch' | 'queueFull' | 'lowResources';
}

const SLOTS_POR_ABA = 8;
const FILA_MAX = 5;
const SPRITE_CELL = 96;

let _container: HTMLDivElement | null = null;
let _styleInjected = false;
let _tabsEl: HTMLDivElement | null = null;
let _gridEl: HTMLDivElement | null = null;
let _gridWrapEl: HTMLDivElement | null = null;
let _activeTab: AbaId = 'edificios';
let _selectedPlanet: Planeta | null = null;
let _mundoRef: Mundo | null = null;
let _renderKey = '';

// ─── Spritesheet loader (shared with naves.ts and ship-panel.ts) ───────────

const _cardSprites: { canvas: HTMLCanvasElement; cell: SpriteCell }[] = [];

function loadSheet(name: 'ships' | 'buildings'): void {
  if (getSpritesheetImage(name)) return;
  carregarSpritesheet(name).then(() => {
    for (const { canvas, cell } of _cardSprites) {
      if (cell.sheet === name) drawSprite(canvas, cell);
    }
  });
}

function drawSprite(canvas: HTMLCanvasElement, cell: SpriteCell): void {
  const img = getSpritesheetImage(cell.sheet);
  if (!img) return;
  const cssSize = canvas.clientWidth || parseInt(getComputedStyle(canvas).width, 10) || 40;
  if (cssSize === 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    img,
    cell.col * SPRITE_CELL, cell.row * SPRITE_CELL, SPRITE_CELL, SPRITE_CELL,
    0, 0, canvas.width, canvas.height,
  );
}

function spriteColForTier(tier: number | null): number {
  const t = tier ?? 1;
  return Math.max(0, Math.min(4, t - 1));
}

// ─── SVG helper for the cost icon only (ship/building icons come from sprite) ───

function iconCredit(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M12 2l5 5-5 5-5-5 5-5z M12 12l5 5-5 5-5-5 5-5z');
  svg.appendChild(p);
  return svg;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}

function fmtCost(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function getSelectedPlayerPlanet(mundo: Mundo): Planeta | null {
  const p = mundo.planetas.find((planeta) => planeta.dados.selecionado) ?? null;
  if (!p || p.dados.dono !== 'jogador') return null;
  return p;
}

function highestUnlockedTier(planeta: Planeta, categoria: string): number {
  const arr = planeta.dados.pesquisas[categoria];
  if (!arr) return 0;
  let best = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) best = i + 1;
  }
  return best;
}

function queueFull(planeta: Planeta): boolean {
  return planeta.dados.filaProducao.length >= FILA_MAX;
}

// ─── Card specifications per tab ────────────────────────────────────────────

const CARDS_EDIFICIOS: CardSpec[] = [
  {
    acao: 'fabrica',
    nomeKey: 'build_panel.card_fabrica',
    sprite: (state) => ({ sheet: 'buildings', row: 0, col: spriteColForTier(state.tier) }),
    resolve: (p) => {
      const tierAtual = p.dados.fabricas;
      const max = tierAtual >= getTierMax();
      const cost = calcularCustoTier(tierAtual);
      const tempo = calcularTempoConstrucaoMs(tierAtual);
      if (max || cost == null || tempo == null) {
        return { enabled: false, tier: tierAtual, cost: null, hiddenReason: 'maxTier' };
      }
      const okFila = !queueFull(p);
      const okRecursos = p.dados.recursos.comum >= cost;
      return {
        enabled: okFila && okRecursos,
        tier: tierAtual + 1,
        cost,
        hiddenReason: !okFila ? 'queueFull' : !okRecursos ? 'lowResources' : undefined,
      };
    },
  },
  {
    acao: 'infraestrutura',
    nomeKey: 'build_panel.card_infra',
    sprite: (state) => ({ sheet: 'buildings', row: 1, col: spriteColForTier(state.tier) }),
    resolve: (p) => {
      const tierAtual = p.dados.infraestrutura;
      const max = tierAtual >= getTierMax();
      const cost = calcularCustoTier(tierAtual);
      const tempo = calcularTempoConstrucaoMs(tierAtual);
      if (max || cost == null || tempo == null) {
        return { enabled: false, tier: tierAtual, cost: null, hiddenReason: 'maxTier' };
      }
      const okFila = !queueFull(p);
      const okRecursos = p.dados.recursos.comum >= cost;
      return {
        enabled: okFila && okRecursos,
        tier: tierAtual + 1,
        cost,
        hiddenReason: !okFila ? 'queueFull' : !okRecursos ? 'lowResources' : undefined,
      };
    },
  },
];

function naveCard(
  acao: string,
  nomeKey: string,
  spriteRow: number,
  categoria: string | null,
): CardSpec {
  return {
    acao,
    nomeKey,
    sprite: (state) => ({
      sheet: 'ships',
      row: spriteRow,
      col: categoria == null ? 0 : spriteColForTier(state.tier),
    }),
    resolve: (p) => {
      // Colonizadora has no research and is always tier 1; just needs ≥1 factory.
      if (categoria == null) {
        const okFabrica = p.dados.fabricas >= 1;
        const okFila = !queueFull(p);
        const okRecursos = p.dados.recursos.comum >= CUSTO_NAVE_COMUM;
        const tempo = calcularTempoColonizadoraMs(p);
        if (!okFabrica || tempo == null) {
          return { enabled: false, tier: 1, cost: CUSTO_NAVE_COMUM, hiddenReason: 'noFactory' };
        }
        return {
          enabled: okFila && okRecursos,
          tier: 1,
          cost: CUSTO_NAVE_COMUM,
          hiddenReason: !okFila ? 'queueFull' : !okRecursos ? 'lowResources' : undefined,
        };
      }
      // Tiered ships: build the highest research tier that the factory supports.
      const tierResearch = highestUnlockedTier(p, categoria);
      const tier = Math.min(tierResearch, p.dados.fabricas);
      if (tier < 1) {
        return { enabled: false, tier: null, cost: CUSTO_NAVE_COMUM, hiddenReason: 'noResearch' };
      }
      const okFila = !queueFull(p);
      const okRecursos = p.dados.recursos.comum >= CUSTO_NAVE_COMUM;
      return {
        enabled: okFila && okRecursos,
        tier,
        cost: CUSTO_NAVE_COMUM,
        hiddenReason: !okFila ? 'queueFull' : !okRecursos ? 'lowResources' : undefined,
      };
    },
  };
}

const CARDS_NAVES: CardSpec[] = [
  naveCard('nave_colonizadora', 'build_panel.card_colonizadora', 0, null),
  naveCard('nave_cargueira', 'build_panel.card_cargueira', 1, 'cargueira'),
  naveCard('nave_batedora', 'build_panel.card_batedora', 2, 'batedora'),
  naveCard('nave_torreta', 'build_panel.card_torreta', 3, 'torreta'),
  naveCard('nave_fragata', 'build_panel.card_fragata', 4, 'fragata'),
];

// Custo de pesquisa em RARO (constant in pesquisa.ts: CUSTO_PESQUISA_RARO=5)
const CUSTO_PESQ_RARO = 5;

function pesquisaCard(
  categoria: 'cargueira' | 'batedora' | 'torreta' | 'fragata',
  nomeKey: string,
  spriteRow: number,
): CardSpec {
  return {
    // The acao gets the dynamic tier suffix appended in resolveAcao.
    acao: `pesquisa_${categoria}`,
    nomeKey,
    sprite: (state) => ({
      sheet: 'ships',
      row: spriteRow,
      col: spriteColForTier(state.tier),
    }),
    resolve: (p) => {
      const tierAtual = highestUnlockedTier(p, categoria);
      const proxTier = tierAtual + 1;
      // Already maxed?
      if (proxTier > getTierMax()) {
        return { enabled: false, tier: tierAtual, cost: null, hiddenReason: 'maxTier' };
      }
      // Need a factory of at least the destination tier (same gate as
      // building the ship itself).
      if (p.dados.fabricas < proxTier) {
        return { enabled: false, tier: proxTier, cost: CUSTO_PESQ_RARO, hiddenReason: 'noFactory' };
      }
      // One research at a time per planet.
      if (p.dados.pesquisaAtual) {
        return { enabled: false, tier: proxTier, cost: CUSTO_PESQ_RARO, hiddenReason: 'queueFull' };
      }
      const okRecursos = p.dados.recursos.raro >= CUSTO_PESQ_RARO;
      return {
        enabled: okRecursos,
        tier: proxTier,
        cost: CUSTO_PESQ_RARO,
        hiddenReason: !okRecursos ? 'lowResources' : undefined,
      };
    },
  };
}

const CARDS_PESQUISA: CardSpec[] = [
  pesquisaCard('cargueira', 'build_panel.card_pesq_cargueira', 1),
  pesquisaCard('batedora', 'build_panel.card_pesq_batedora', 2),
  pesquisaCard('torreta', 'build_panel.card_pesq_torreta', 3),
  pesquisaCard('fragata', 'build_panel.card_pesq_fragata', 4),
];

function cardsForTab(tab: AbaId): CardSpec[] {
  switch (tab) {
    case 'edificios': return CARDS_EDIFICIOS;
    case 'naves': return CARDS_NAVES;
    case 'pesquisa': return CARDS_PESQUISA;
  }
}

// For tiered cards (ships and research), the actual action must include
// the chosen tier suffix.
function resolveAcao(spec: CardSpec, state: CardState): string {
  if (spec.acao === 'nave_colonizadora') return spec.acao;
  if (spec.acao.startsWith('nave_')) {
    return state.tier ? `${spec.acao}_${state.tier}` : spec.acao;
  }
  if (spec.acao.startsWith('pesquisa_')) {
    return state.tier ? `${spec.acao}_${state.tier}` : spec.acao;
  }
  return spec.acao;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .build-panel {
      --bp-card: calc(var(--hud-unit) * 4.4);
      --bp-gap: calc(var(--hud-unit) * 0.45);

      /* Docked bottom-center — well clear of the planet drawer on
         the right, so the two surfaces don't overlap or clip. */
      position: fixed;
      z-index: 100;
      bottom: var(--hud-margin);
      left: 50%;
      /* Stop at the drawer's left edge so centering doesn't push
         the panel under the drawer on tight viewports. */
      max-width: calc(100vw - clamp(360px, 32vw, 500px) - var(--hud-margin) * 4);
      width: max-content;
      padding: 0;
      box-sizing: border-box;
      color: var(--hud-text);
      font-family: var(--hud-font);
      overflow: visible;

      transform: translate(-50%, calc(var(--hud-unit) * 1.6));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 240ms;
    }

    .build-panel.visible {
      transform: translate(-50%, 0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    @media (prefers-reduced-motion: reduce) {
      .build-panel,
      .build-panel.visible {
        transition: none;
      }
    }

    .build-tabs {
      display: flex;
      gap: calc(var(--hud-unit) * 0.2);
      padding: 0 calc(var(--hud-unit) * 0.6);
    }

    .build-tab {
      appearance: none;
      border: 1px solid var(--hud-border);
      border-bottom: none;
      background: var(--hud-bg);
      color: var(--hud-text-dim);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1.1);
      cursor: pointer;
      border-top-left-radius: var(--hud-radius);
      border-top-right-radius: var(--hud-radius);
      transition: color 120ms ease, background 120ms ease;
    }

    .build-tab:hover:not(.active) {
      color: var(--hud-text);
      background: rgba(255,255,255,0.04);
    }

    .build-tab.active {
      color: #fff;
      background: var(--hud-bg);
      border-bottom: 1px solid var(--hud-bg);
      position: relative;
      z-index: 2;
    }

    .build-grid-wrap {
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      background: var(--hud-bg);
      padding: calc(var(--hud-unit) * 0.7);
      margin-top: -1px;
      backdrop-filter: blur(3px);
      box-shadow: var(--hud-shadow);
    }

    @keyframes build-tab-enter {
      0%   { opacity: 0; transform: translateY(calc(var(--hud-unit) * 0.5)); }
      60%  { opacity: 1; }
      100% { opacity: 1; transform: translateY(0); }
    }

    .build-grid-wrap.is-switching {
      animation: build-tab-enter 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }

    @media (prefers-reduced-motion: reduce) {
      .build-grid-wrap.is-switching {
        animation: none;
      }
    }

    .build-grid {
      display: grid;
      grid-template-columns: repeat(${SLOTS_POR_ABA}, var(--bp-card));
      gap: var(--bp-gap);
      justify-content: start;
    }

    .build-card {
      width: var(--bp-card);
      height: calc(var(--bp-card) * 1.18);
      border: 1px solid rgba(255,255,255,0.55);
      border-radius: calc(var(--hud-unit) * 0.25);
      background: rgba(255,255,255,0.02);
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: space-between;
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.3);
      position: relative;
      cursor: pointer;
      color: var(--hud-text);
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      font-family: inherit;
      box-sizing: border-box;
      appearance: none;
    }

    .build-card.empty {
      border-style: dashed;
      border-color: rgba(255,255,255,0.18);
      cursor: default;
      pointer-events: none;
    }

    .build-card:hover:not(.disabled):not(.empty) {
      background: rgba(255,255,255,0.08);
      border-color: #fff;
      transform: translateY(-1px);
    }

    .build-card.disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .build-card-tier {
      position: absolute;
      top: calc(var(--hud-unit) * 0.15);
      right: calc(var(--hud-unit) * 0.3);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      color: var(--hud-text-dim);
      letter-spacing: 0.06em;
      line-height: 1;
    }

    .build-card-icon {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--hud-text);
      padding-top: calc(var(--hud-unit) * 0.25);
    }

    .build-card-icon svg {
      width: calc(var(--hud-unit) * 1.9);
      height: calc(var(--hud-unit) * 1.9);
      display: block;
    }

    .build-card-sprite {
      width: calc(var(--hud-unit) * 2.6);
      height: calc(var(--hud-unit) * 2.6);
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .build-card-cost {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: calc(var(--hud-unit) * 0.2);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      color: var(--hud-text);
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .build-card-cost svg {
      width: calc(var(--hud-unit) * 0.8);
      height: calc(var(--hud-unit) * 0.8);
      color: var(--hud-text-dim);
    }

    .build-card-cost.no-cost {
      color: var(--hud-text-faint);
    }
  `;
  document.head.appendChild(style);
}

// ─── DOM construction ───────────────────────────────────────────────────────

function createTab(label: string, id: AbaId): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'build-tab';
  btn.dataset.tab = id;
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    if (_activeTab !== id) {
      _activeTab = id;
      _renderKey = '';
      renderActiveTab();
      updateTabStyles();
      playSwitchAnimation();
    }
  });
  return btn;
}

function updateTabStyles(): void {
  if (!_tabsEl) return;
  for (const child of Array.from(_tabsEl.children)) {
    const btn = child as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.tab === _activeTab);
  }
}

function playSwitchAnimation(): void {
  if (!_gridWrapEl) return;
  _gridWrapEl.classList.remove('is-switching');
  // Force a reflow so removing + re-adding the class restarts the animation.
  void _gridWrapEl.offsetWidth;
  _gridWrapEl.classList.add('is-switching');
}

function createCard(spec: CardSpec, state: CardState): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'build-card';
  if (!state.enabled) card.classList.add('disabled');

  const tier = document.createElement('div');
  tier.className = 'build-card-tier';
  tier.textContent = state.tier ? roman(state.tier) : '';
  card.appendChild(tier);

  const iconWrap = document.createElement('div');
  iconWrap.className = 'build-card-icon';
  const canvas = document.createElement('canvas');
  canvas.className = 'build-card-sprite';
  const cell = spec.sprite(state);
  _cardSprites.push({ canvas, cell });
  iconWrap.appendChild(canvas);
  card.appendChild(iconWrap);

  // Defer initial draw until the element is in the DOM so clientWidth resolves.
  requestAnimationFrame(() => drawSprite(canvas, cell));

  const cost = document.createElement('div');
  cost.className = 'build-card-cost';
  if (state.cost != null) {
    cost.appendChild(iconCredit());
    const value = document.createElement('span');
    value.textContent = fmtCost(state.cost);
    cost.appendChild(value);
  } else {
    cost.classList.add('no-cost');
    cost.textContent = '—';
  }
  card.appendChild(cost);

  card.title = t(spec.nomeKey);
  card.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    if (!state.enabled || !_selectedPlanet || !_mundoRef) return;
    construirNoPlaneta(_mundoRef, _selectedPlanet, resolveAcao(spec, state));
    pulseElement(card, 'orbital-toggle-flash');
    _renderKey = '';
  });

  return card;
}

function createEmptyCard(): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'build-card empty';
  return card;
}

function renderActiveTab(): void {
  if (!_gridEl || !_selectedPlanet) return;
  _gridEl.replaceChildren();
  _cardSprites.length = 0;
  const specs = cardsForTab(_activeTab);
  for (const spec of specs) {
    const state = spec.resolve(_selectedPlanet);
    _gridEl.appendChild(createCard(spec, state));
  }
  for (let i = specs.length; i < SLOTS_POR_ABA; i++) {
    _gridEl.appendChild(createEmptyCard());
  }
}

function getRenderKey(planeta: Planeta): string {
  // Snapshot every value the cards depend on so we can skip re-rendering when nothing changed.
  // Assumes every card cost is paid in `recursos.comum`; revisit when research/rare-resource
  // costs become card-driven.
  const d = planeta.dados;
  const pesquisas = ['cargueira', 'batedora', 'torreta']
    .map((c) => highestUnlockedTier(planeta, c))
    .join(',');
  return [
    _activeTab,
    d.fabricas,
    d.infraestrutura,
    Math.floor(d.recursos.comum),
    d.filaProducao.length,
    pesquisas,
  ].join('|');
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function criarBuildPanel(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();
  injectBottomSheetStyles();
  loadSheet('ships');
  loadSheet('buildings');

  const panel = document.createElement('div');
  panel.className = 'build-panel bottom-sheet-capable';
  panel.setAttribute('data-ui', 'true');
  panel.style.pointerEvents = 'auto';
  panel.addEventListener('pointerdown', () => marcarInteracaoUi());

  const tabs = document.createElement('div');
  tabs.className = 'build-tabs';
  tabs.append(
    createTab(t('build_panel.tab_edificios'), 'edificios'),
    createTab(t('build_panel.tab_naves'), 'naves'),
    createTab(t('build_panel.tab_pesquisa'), 'pesquisa'),
  );
  _tabsEl = tabs;

  const gridWrap = document.createElement('div');
  gridWrap.className = 'build-grid-wrap';
  _gridWrapEl = gridWrap;

  const grid = document.createElement('div');
  grid.className = 'build-grid';
  _gridEl = grid;

  gridWrap.appendChild(grid);
  panel.append(tabs, gridWrap);
  document.body.appendChild(panel);

  _container = panel;
  updateTabStyles();
  return panel;
}

export function atualizarBuildPanel(mundo: Mundo): void {
  if (!_container) return;
  _mundoRef = mundo;

  const planeta = getSelectedPlayerPlanet(mundo);
  if (!planeta) {
    _container.classList.remove('visible');
    _selectedPlanet = null;
    _renderKey = '';
    return;
  }

  if (_selectedPlanet !== planeta) {
    _selectedPlanet = planeta;
    _renderKey = '';
  }

  _container.classList.add('visible');

  const key = getRenderKey(planeta);
  if (key !== _renderKey) {
    renderActiveTab();
    _renderKey = key;
  }
}

export function destruirBuildPanel(): void {
  if (_container) {
    _container.remove();
    _container = null;
  }
  _tabsEl = null;
  _gridEl = null;
  _gridWrapEl = null;
  _selectedPlanet = null;
  _mundoRef = null;
  _renderKey = '';
}
