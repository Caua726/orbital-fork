import type { Mundo, Nave } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import {
  obterNaveSelecionada,
  capacidadeCargaCargueira,
  cancelarMovimentoNave,
  alternarLoopCargueira,
} from '../world/mundo';
import { iniciarComandoNave } from '../core/player';
import { carregarSpritesheet, getSpritesheetImage } from '../world/spritesheets';
import { t } from '../core/i18n/t';

// ─── Static lookup tables ───────────────────────────────────────────────────

const NOME_TIPO_KEY: Record<string, string> = {
  colonizadora: 'nave.colonizadora',
  cargueira: 'nave.cargueira',
  batedora: 'nave.batedora',
  torreta: 'nave.torreta',
};

const SHIP_SPRITE_ROW: Record<string, number> = {
  colonizadora: 0,
  cargueira: 1,
  batedora: 2,
  torreta: 3,
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const SPRITE_CELL = 96;

// ─── Shared spritesheet loader ──────────────────────────────────────────────

function loadShipsSheet(): void {
  if (getSpritesheetImage('ships')) return;
  carregarSpritesheet('ships').then(() => redrawPortrait());
}

function drawShipSprite(canvas: HTMLCanvasElement, row: number, col: number): void {
  const img = getSpritesheetImage('ships');
  if (!img) return;
  const cssSize = canvas.clientWidth || parseInt(getComputedStyle(canvas).width, 10) || 64;
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
    col * SPRITE_CELL, row * SPRITE_CELL, SPRITE_CELL, SPRITE_CELL,
    0, 0, canvas.width, canvas.height,
  );
}

function redrawPortrait(): void {
  if (!_portraitCanvas || !_selectedShip) return;
  const cell = spriteCellForShip(_selectedShip);
  drawShipSprite(_portraitCanvas, cell.row, cell.col);
}

function spriteCellForShip(nave: Nave): { row: number; col: number } {
  const row = SHIP_SPRITE_ROW[nave.tipo] ?? 0;
  const col = Math.max(0, Math.min(4, (nave.tier || 1) - 1));
  return { row, col };
}

// ─── Module state ───────────────────────────────────────────────────────────

let _container: HTMLDivElement | null = null;
let _styleInjected = false;
let _selectedShip: Nave | null = null;
let _mundoRef: Mundo | null = null;

let _nameEl: HTMLDivElement | null = null;
let _subtitleEl: HTMLDivElement | null = null;
let _portraitCanvas: HTMLCanvasElement | null = null;
let _barFillEl: HTMLDivElement | null = null;
let _barLabelEl: HTMLDivElement | null = null;
let _statsEl: HTMLDivElement | null = null;
let _buttonsEl: HTMLDivElement | null = null;

let _metaKey = '';
let _statsKey = '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function nomeTipoNave(tipo: string): string {
  const key = NOME_TIPO_KEY[tipo];
  return key ? t(key) : tipo;
}

function shipLabel(nave: Nave): string {
  if (nave.tipo === 'colonizadora') return t('nave.colonizadora');
  return `${nomeTipoNave(nave.tipo)} ${ROMAN[nave.tier] ?? nave.tier}`;
}

function estadoLabel(estado: string): string {
  switch (estado) {
    case 'orbitando': return t('nave.estado.orbitando');
    case 'viajando': return t('nave.estado.viajando');
    case 'parado': return t('nave.estado.parado');
    default: return estado;
  }
}

function alvoLabel(nave: Nave): string {
  const alvo = nave.alvo;
  if (!alvo) return '—';
  if (alvo._tipoAlvo === 'planeta') return (alvo as { dados: { nome?: string } }).dados.nome ?? t('ship_panel.alvo_planeta_fallback');
  if (alvo._tipoAlvo === 'sol') return t('ship_panel.alvo_estrela');
  if (alvo._tipoAlvo === 'ponto') return `(${Math.round((alvo as { x: number }).x)}, ${Math.round((alvo as { y: number }).y)})`;
  return '—';
}

function cargaAtual(nave: Nave): number {
  return nave.carga.comum + nave.carga.raro + nave.carga.combustivel;
}

function getCargoFillPercent(nave: Nave): number {
  if (nave.tipo !== 'cargueira') return 100;
  const cap = capacidadeCargaCargueira(nave.tier);
  if (!cap) return 0;
  return Math.max(0, Math.min(100, (cargaAtual(nave) / cap) * 100));
}

function getCargoLabel(nave: Nave): string {
  if (nave.tipo !== 'cargueira') return '';
  const cap = capacidadeCargaCargueira(nave.tier);
  return `${Math.floor(cargaAtual(nave))} / ${cap}`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .ship-panel {
      position: fixed;
      z-index: 100;
      bottom: var(--hud-margin);
      left: 50%;
      width: max-content;
      max-width: calc(100vw - var(--hud-margin) * 2);
      box-sizing: border-box;
      color: var(--hud-text);
      font-family: var(--hud-font);
      display: flex;

      transform: translate(-50%, calc(var(--hud-unit) * 1.4));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 240ms;
    }

    .ship-panel.visible {
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
      .ship-panel,
      .ship-panel.visible {
        transition: none;
      }
    }

    .ship-panel-row {
      display: flex;
      align-items: stretch;
      gap: calc(var(--hud-unit) * 0.5);
    }

    .ship-panel-section {
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.9);
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.8);
    }

    /* ── Left: name + portrait + status bar ── */

    .ship-panel-identity {
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.7);
      min-width: 0;
    }

    .ship-panel-text {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
      min-width: 0;
    }

    .ship-panel-name {
      font-family: var(--hud-font-display);
      font-size: var(--hud-text-md);
      line-height: 1.1;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--hud-text);
      white-space: nowrap;
    }

    .ship-panel-subtitle {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      line-height: 1;
      color: var(--hud-text-dim);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .ship-panel-bar {
      width: 100%;
      height: calc(var(--hud-unit) * 0.35);
      border: 1px solid var(--hud-line);
      background: rgba(255,255,255,0.05);
      position: relative;
      margin-top: calc(var(--hud-unit) * 0.35);
    }

    .ship-panel-bar-fill {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      background: rgba(255,255,255,0.85);
      transition: width 200ms ease-out;
    }

    .ship-panel-bar-label {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      color: var(--hud-text-dim);
      letter-spacing: 0.05em;
      margin-top: calc(var(--hud-unit) * 0.2);
      font-variant-numeric: tabular-nums;
    }

    .ship-panel-portrait {
      width: calc(var(--hud-unit) * 3.4);
      height: calc(var(--hud-unit) * 3.4);
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      flex: 0 0 auto;
    }

    /* ── Middle: stats grid ── */

    .ship-panel-stats {
      display: grid;
      grid-template-columns: auto auto;
      gap: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.9);
      align-items: center;
    }

    .ship-panel-stat-label {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      line-height: 1;
    }

    .ship-panel-stat-value {
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      color: var(--hud-text);
      line-height: 1;
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* ── Right: action buttons grid ── */

    .ship-panel-actions {
      display: grid;
      grid-template-columns: repeat(3, auto);
      gap: calc(var(--hud-unit) * 0.3);
      align-items: center;
    }

    .ship-panel-action {
      width: calc(var(--hud-unit) * 2.4);
      height: calc(var(--hud-unit) * 2.4);
      border: 1px solid rgba(255,255,255,0.5);
      border-radius: calc(var(--hud-unit) * 0.2);
      background: rgba(255,255,255,0.02);
      color: var(--hud-text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      appearance: none;
    }

    .ship-panel-action:hover:not(.disabled) {
      background: rgba(255,255,255,0.08);
      border-color: #fff;
      transform: translateY(-1px);
    }

    .ship-panel-action.active {
      background: rgba(255,255,255,0.15);
      border-color: #fff;
    }

    .ship-panel-action.disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .ship-panel-action svg {
      width: calc(var(--hud-unit) * 1.1);
      height: calc(var(--hud-unit) * 1.1);
      fill: currentColor;
    }
  `;
  document.head.appendChild(style);
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function svgIcon(d: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

// 4-way arrow / move
function iconMove(): SVGSVGElement {
  return svgIcon('M12 2l4 4h-3v4h4V7l4 4-4 4v-3h-4v4h3l-4 4-4-4h3v-4H7v3l-4-4 4-4v3h4V6H8l4-4z');
}

// X / cancel
function iconCancel(): SVGSVGElement {
  return svgIcon('M6 5l6 6 6-6 1 1-6 6 6 6-1 1-6-6-6 6-1-1 6-6-6-6 1-1z');
}

// Target / destination (concentric ring)
function iconTarget(): SVGSVGElement {
  return svgIcon('M12 2a10 10 0 110 20 10 10 0 010-20zm0 3a7 7 0 100 14 7 7 0 000-14zm0 3a4 4 0 110 8 4 4 0 010-8z');
}

// Source / origin pin
function iconOrigin(): SVGSVGElement {
  return svgIcon('M12 2a7 7 0 017 7c0 5-7 13-7 13s-7-8-7-13a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z');
}

// Loop / repeat
function iconLoop(): SVGSVGElement {
  return svgIcon('M7 7h8V4l5 5-5 5V11H9v4h4l-5 5-5-5h2V7z');
}

// Close / deselect (X square)
function iconClose(): SVGSVGElement {
  return svgIcon('M4 4h16v16H4V4zm4 3l-1 1 4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z');
}

// ─── Action buttons ─────────────────────────────────────────────────────────

interface ActionSpec {
  id: string;
  title: string;
  icon: () => SVGSVGElement;
  enabled: (nave: Nave) => boolean;
  onClick: (nave: Nave, mundo: Mundo) => void;
}

const ACTIONS: (Omit<ActionSpec, 'title'> & { titleKey: string })[] = [
  {
    id: 'move',
    titleKey: 'ship_panel.action_move',
    icon: iconMove,
    enabled: (n) => n.dono === 'jogador',
    onClick: (n) => iniciarComandoNave('mover', n),
  },
  {
    id: 'cancel',
    titleKey: 'ship_panel.action_cancel',
    icon: iconCancel,
    enabled: (n) => n.dono === 'jogador' && (n.estado === 'viajando' || n.rotaManual.length > 0),
    onClick: (n) => cancelarMovimentoNave(n),
  },
  {
    id: 'close',
    titleKey: 'ship_panel.action_close',
    icon: iconClose,
    enabled: () => true,
    onClick: (n) => { n.selecionado = false; },
  },
  {
    id: 'origin',
    titleKey: 'ship_panel.action_origin',
    icon: iconOrigin,
    enabled: (n) => n.dono === 'jogador' && n.tipo === 'cargueira',
    onClick: (n) => iniciarComandoNave('origem', n),
  },
  {
    id: 'destination',
    titleKey: 'ship_panel.action_destination',
    icon: iconTarget,
    enabled: (n) => n.dono === 'jogador' && n.tipo === 'cargueira',
    onClick: (n) => iniciarComandoNave('destino', n),
  },
  {
    id: 'loop',
    titleKey: 'ship_panel.action_loop',
    icon: iconLoop,
    enabled: (n) => n.dono === 'jogador' && n.tipo === 'cargueira' && !!n.rotaCargueira?.origem && !!n.rotaCargueira?.destino,
    onClick: (n) => alternarLoopCargueira(n),
  },
];

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderActions(nave: Nave): void {
  if (!_buttonsEl) return;
  _buttonsEl.replaceChildren();
  for (const action of ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ship-panel-action';
    btn.title = t(action.titleKey);
    btn.appendChild(action.icon());
    const isEnabled = action.enabled(nave);
    if (!isEnabled) btn.classList.add('disabled');
    if (action.id === 'loop' && nave.rotaCargueira?.loop) btn.classList.add('active');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      marcarInteracaoUi();
      if (!isEnabled || !_mundoRef) return;
      action.onClick(nave, _mundoRef);
    });
    _buttonsEl.appendChild(btn);
  }
}

function renderStats(nave: Nave): void {
  if (!_statsEl) return;
  _statsEl.replaceChildren();

  const rows: [string, string][] = [
    [t('ship_panel.estado'), estadoLabel(nave.estado)],
    [t('ship_panel.origem'), nave.origem?.dados.nome ?? '—'],
    [t('ship_panel.alvo'), alvoLabel(nave)],
  ];

  if (nave.tipo === 'cargueira') {
    const cap = capacidadeCargaCargueira(nave.tier);
    rows.push([t('ship_panel.capacidade'), String(cap)]);
  } else {
    rows.push([t('ship_panel.tipo'), nomeTipoNave(nave.tipo)]);
  }

  for (const [label, value] of rows) {
    const labelEl = document.createElement('div');
    labelEl.className = 'ship-panel-stat-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'ship-panel-stat-value';
    valueEl.textContent = value;
    _statsEl.append(labelEl, valueEl);
  }
}

function renderBar(nave: Nave): void {
  if (!_barFillEl || !_barLabelEl) return;
  if (nave.tipo === 'cargueira') {
    const percent = getCargoFillPercent(nave);
    _barFillEl.style.width = `${percent}%`;
    _barLabelEl.textContent = getCargoLabel(nave);
  } else {
    _barFillEl.style.width = '100%';
    _barLabelEl.textContent = estadoLabel(nave.estado);
  }
}

// ─── Cache keys ─────────────────────────────────────────────────────────────

function getMetaKey(nave: Nave): string {
  return `${nave.id}|${nave.tipo}|${nave.tier}`;
}

function getStatsKey(nave: Nave): string {
  return [
    nave.estado,
    nave.alvo?._tipoAlvo ?? '',
    (nave.alvo as { dados?: { nome?: string } })?.dados?.nome ?? '',
    Math.floor(cargaAtual(nave)),
    nave.rotaCargueira?.origem?.dados.nome ?? '',
    nave.rotaCargueira?.destino?.dados.nome ?? '',
    nave.rotaCargueira?.loop ? '1' : '0',
    nave.rotaManual.length,
  ].join('|');
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function criarShipPanel(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();
  loadShipsSheet();

  const panel = document.createElement('div');
  panel.className = 'ship-panel';
  panel.setAttribute('data-ui', 'true');
  panel.style.pointerEvents = 'auto';
  panel.addEventListener('pointerdown', () => marcarInteracaoUi());

  const row = document.createElement('div');
  row.className = 'ship-panel-row';

  // ── Left: identity + portrait + bar ──
  const left = document.createElement('div');
  left.className = 'ship-panel-section';

  const identity = document.createElement('div');
  identity.className = 'ship-panel-identity';

  const portrait = document.createElement('canvas');
  portrait.className = 'ship-panel-portrait';
  _portraitCanvas = portrait;

  const textWrap = document.createElement('div');
  textWrap.className = 'ship-panel-text';

  const name = document.createElement('div');
  name.className = 'ship-panel-name';
  _nameEl = name;

  const subtitle = document.createElement('div');
  subtitle.className = 'ship-panel-subtitle';
  _subtitleEl = subtitle;

  const bar = document.createElement('div');
  bar.className = 'ship-panel-bar';
  const barFill = document.createElement('div');
  barFill.className = 'ship-panel-bar-fill';
  _barFillEl = barFill;
  bar.appendChild(barFill);

  const barLabel = document.createElement('div');
  barLabel.className = 'ship-panel-bar-label';
  _barLabelEl = barLabel;

  textWrap.append(name, subtitle, bar, barLabel);
  identity.append(portrait, textWrap);
  left.appendChild(identity);

  // ── Middle: stats ──
  const middle = document.createElement('div');
  middle.className = 'ship-panel-section';
  const stats = document.createElement('div');
  stats.className = 'ship-panel-stats';
  _statsEl = stats;
  middle.appendChild(stats);

  // ── Right: buttons ──
  const right = document.createElement('div');
  right.className = 'ship-panel-section';
  const buttons = document.createElement('div');
  buttons.className = 'ship-panel-actions';
  _buttonsEl = buttons;
  right.appendChild(buttons);

  row.append(left, middle, right);
  panel.appendChild(row);
  document.body.appendChild(panel);

  _container = panel;
  return panel;
}

export function atualizarShipPanel(mundo: Mundo): void {
  if (!_container) return;
  _mundoRef = mundo;

  const nave = obterNaveSelecionada(mundo);
  // Yield to colonizer-panel for colonizadoras — it has its own dedicated UI.
  if (!nave || nave.tipo === 'colonizadora') {
    _container.classList.remove('visible');
    _selectedShip = null;
    _metaKey = '';
    _statsKey = '';
    return;
  }

  const metaKey = getMetaKey(nave);
  if (nave !== _selectedShip || metaKey !== _metaKey) {
    _selectedShip = nave;
    _metaKey = metaKey;
    _statsKey = '';
    if (_nameEl) _nameEl.textContent = shipLabel(nave);
    if (_subtitleEl) _subtitleEl.textContent = nave.origem?.dados.nome
      ? t('ship_panel.subtitulo_origem', { nome: nave.origem.dados.nome })
      : '—';
    const cell = spriteCellForShip(nave);
    if (_portraitCanvas) {
      requestAnimationFrame(() => {
        if (_portraitCanvas) drawShipSprite(_portraitCanvas, cell.row, cell.col);
      });
    }
    renderActions(nave);
  }

  const statsKey = getStatsKey(nave);
  if (statsKey !== _statsKey) {
    renderStats(nave);
    renderBar(nave);
    renderActions(nave); // action enabled state depends on route/movement
    _statsKey = statsKey;
  }

  _container.classList.add('visible');
}

export function destruirShipPanel(): void {
  if (_container) {
    _container.remove();
    _container = null;
  }
  _nameEl = null;
  _subtitleEl = null;
  _portraitCanvas = null;
  _barFillEl = null;
  _barLabelEl = null;
  _statsEl = null;
  _buttonsEl = null;
  _selectedShip = null;
  _mundoRef = null;
  _metaKey = '';
  _statsKey = '';
}
