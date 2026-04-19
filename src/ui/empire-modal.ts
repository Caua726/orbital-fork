/**
 * Empire overview modal — opened from the empire badge click.
 *
 * Shows a consolidated dashboard of the player's empire: identity
 * (name + rendered sigil), archetype + objective (derived from the
 * pesos genome), live stats (planets/ships/resources/research), the
 * six personality weights as bars, and the procedural lore sections
 * inline. Entirely passive — no controls, it's a reading surface.
 *
 * Mirrors the structure of planet-details-modal for visual parity.
 */

import type { Mundo } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { gerarSigilo, gerarSigiloManual } from './empire-builder/sigilos';
import { inferirArquetipo } from '../world/imperio-jogador';
import { attachTooltip } from './tooltip';
import { aplicarTooltipsLore } from './lore-keywords';
import { shouldRefresh, forceRefresh } from './hud-refresh';

let _backdrop: HTMLDivElement | null = null;
let _modal: HTMLDivElement | null = null;
let _styleInjected = false;
let _closeResolver: (() => void) | null = null;
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let _currentMundo: Mundo | null = null;
let _sigilEl: HTMLDivElement | null = null;
let _sigilKey: string | null = null;

const OBJETIVO_LABEL: Record<string, string> = {
  conquista: 'Conquista',
  economia: 'Economia',
  ciencia: 'Ciência',
  sobrevivencia: 'Sobrevivência',
  exploracao: 'Exploração',
  livre: 'Livre',
};

const OBJETIVO_TOOLTIP: Record<string, string> = {
  conquista: 'Eliminar todos os impérios rivais.',
  economia: 'Acumular riqueza abundante — recursos, fábricas, produção.',
  ciencia: 'Dominar toda a árvore de pesquisa antes dos rivais.',
  sobrevivencia: 'Resistir aos ataques e durar mais que os outros.',
  exploracao: 'Descobrir todos os sistemas e planetas da galáxia.',
  livre: 'Sem meta explícita — jogue como preferir.',
};

const ARQUETIPO_TOOLTIP: Record<string, string> = {
  warlord: 'Guerreiro — ataque, conquista e frotas agressivas.',
  trader: 'Comerciante — produção, economia e logística de carga.',
  scientist: 'Cientista — pesquisa, tecnologia e tiers altos.',
  defender: 'Defensor — torretas, contenção e território seguro.',
  explorer: 'Explorador — mobilidade, expansão e visão longa.',
};

const PESO_TOOLTIP: Record<string, string> = {
  agressao: 'Quanto o império prioriza ações ofensivas (ataques, frotas de guerra).',
  expansao: 'Quanto prioriza colonizar planetas neutros.',
  economia: 'Quanto investe em fábricas e infraestrutura.',
  ciencia: 'Quanto investe em pesquisa.',
  defesa: 'Quanto constrói torretas e força defensiva.',
  vinganca: 'Quanto pune quem o atacou por último — memória do rancor.',
};

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .empire-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(3px);
      z-index: 980;
      opacity: 0;
      visibility: hidden;
      transition: opacity 220ms ease-out, visibility 0s linear 220ms;
    }
    .empire-modal-backdrop.visible {
      opacity: 1; visibility: visible;
      transition: opacity 220ms ease-out, visibility 0s linear 0s;
    }

    .empire-modal {
      position: fixed;
      top: 50%; left: 50%;
      width: min(92vw, calc(var(--hud-unit) * 48));
      height: min(88vh, calc(var(--hud-unit) * 36));
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);
      color: var(--hud-text);
      font-family: var(--hud-font);
      z-index: 981;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      opacity: 0;
      transform: translate(-50%, calc(-50% + var(--hud-unit) * 0.8)) scale(0.97);
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 220ms ease-out,
        transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 260ms;
    }
    .empire-modal.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 220ms ease-out,
        transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .em-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: calc(var(--hud-unit) * 0.8);
      padding: calc(var(--hud-unit) * 1) calc(var(--hud-unit) * 1.4);
      border-bottom: 1px solid var(--hud-line);
      flex-shrink: 0;
    }
    .em-title {
      font-size: calc(var(--hud-unit) * 1.15);
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0;
    }
    .em-close {
      appearance: none; background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text-dim);
      font-family: var(--hud-font);
      width: calc(var(--hud-unit) * 1.7);
      height: calc(var(--hud-unit) * 1.7);
      border-radius: 50%;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .em-close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--hud-text);
    }

    .em-body {
      flex: 1; min-height: 0;
      display: grid;
      grid-template-columns: minmax(calc(var(--hud-unit) * 14), 1fr) 2fr;
      gap: calc(var(--hud-unit) * 1);
      padding: calc(var(--hud-unit) * 1.1) calc(var(--hud-unit) * 1.4);
      overflow: hidden;
    }
    @media (max-width: 760px) {
      .em-body { grid-template-columns: 1fr; overflow-y: auto; }
    }
    .em-left, .em-right {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.8);
      overflow-y: auto;
      padding-right: calc(var(--hud-unit) * 0.2);
    }
    .em-sigil {
      aspect-ratio: 1;
      width: 100%;
      max-width: calc(var(--hud-unit) * 14);
      align-self: center;
      background: #050910;
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      padding: calc(var(--hud-unit) * 0.8);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .em-sigil svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .em-section {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.85);
      display: flex; flex-direction: column; gap: calc(var(--hud-unit) * 0.4);
    }
    .em-section-title {
      font-size: calc(var(--hud-unit) * 0.78);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin: 0;
      padding-bottom: calc(var(--hud-unit) * 0.3);
      border-bottom: 1px solid var(--hud-line);
    }
    .em-kv {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: calc(var(--hud-unit) * 0.25) calc(var(--hud-unit) * 0.8);
      font-size: calc(var(--hud-unit) * 0.82);
    }
    .em-kv .k {
      color: var(--hud-text-dim);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-size: calc(var(--hud-unit) * 0.7);
    }

    .em-weight-row {
      display: grid;
      grid-template-columns: calc(var(--hud-unit) * 4.5) 1fr calc(var(--hud-unit) * 2);
      align-items: center;
      gap: calc(var(--hud-unit) * 0.5);
      font-size: calc(var(--hud-unit) * 0.75);
    }
    .em-weight-row .label {
      color: var(--hud-text-dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: calc(var(--hud-unit) * 0.68);
    }
    .em-weight-bar {
      position: relative;
      height: calc(var(--hud-unit) * 0.3);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
    }
    .em-weight-fill {
      position: absolute;
      top: 0; bottom: 0; left: 0;
      background: rgba(255, 255, 255, 0.6);
      border-radius: inherit;
    }
    .em-weight-row .num {
      color: var(--hud-text);
      font-variant-numeric: tabular-nums;
      text-align: right;
      font-size: calc(var(--hud-unit) * 0.72);
    }

    .em-lore-block { display: flex; flex-direction: column; gap: calc(var(--hud-unit) * 0.25); }
    .em-lore-title {
      font-size: calc(var(--hud-unit) * 0.85);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text);
      font-weight: 600;
      border-bottom: 1px solid var(--hud-line);
      padding-bottom: calc(var(--hud-unit) * 0.25);
    }
    .em-lore-p {
      font-size: calc(var(--hud-unit) * 0.82);
      color: var(--hud-text);
      line-height: 1.55;
    }
    .em-lore-q {
      font-style: italic;
      color: var(--hud-text-dim);
      border-left: 2px solid var(--hud-line);
      padding-left: calc(var(--hud-unit) * 0.5);
      font-size: calc(var(--hud-unit) * 0.8);
    }
    .em-empty {
      color: var(--hud-text-dim);
      font-style: italic;
      font-size: calc(var(--hud-unit) * 0.78);
    }
  `;
  document.head.appendChild(style);
}

function sectionIdentidade(mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'em-section';
  const t = document.createElement('h3');
  t.className = 'em-section-title';
  t.textContent = 'Identidade';
  sec.appendChild(t);

  const imp = mundo.imperioJogador;
  const grid = document.createElement('div');
  grid.className = 'em-kv';

  const arqKey = imp ? inferirArquetipo(imp.pesos) : null;
  const objKey = imp?.objetivo ?? null;

  const rows: Array<[string, string, string?]> = [
    ['Nome', imp?.nome ?? '—'],
    [
      'Arquétipo',
      arqKey ? arqKey.charAt(0).toUpperCase() + arqKey.slice(1) : '—',
      arqKey ? ARQUETIPO_TOOLTIP[arqKey] : undefined,
    ],
    [
      'Objetivo',
      objKey ? (OBJETIVO_LABEL[objKey] ?? objKey) : '—',
      objKey ? OBJETIVO_TOOLTIP[objKey] : undefined,
    ],
  ];
  if (imp?.bonus.producao) rows.push([
    'Bônus produção',
    `+${Math.round((imp.bonus.producao - 1) * 100)}%`,
    'Multiplicador aplicado à produção natural de todos os planetas do império.',
  ]);
  if (imp?.bonus.fabricasIniciais) rows.push([
    'Fábricas iniciais',
    String(imp.bonus.fabricasIniciais),
    'Nível de fábrica já construído no planeta inicial ao começar o jogo.',
  ]);
  if (imp?.bonus.infraestruturaInicial) rows.push([
    'Infra inicial',
    String(imp.bonus.infraestruturaInicial),
    'Nível de infraestrutura já erguido no planeta inicial.',
  ]);
  for (const [k, v, tip] of rows) {
    const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
    const vEl = document.createElement('div'); vEl.textContent = v;
    if (tip) attachTooltip(kEl, tip, 'text');
    grid.append(kEl, vEl);
  }
  sec.appendChild(grid);
  return sec;
}

function sectionEstatisticas(mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'em-section';
  const t = document.createElement('h3'); t.className = 'em-section-title'; t.textContent = 'Estatísticas';
  sec.appendChild(t);

  let planetas = 0, naves = 0;
  let comum = 0, raro = 0, combustivel = 0;
  let pesquisasFeitas = 0;
  for (const p of mundo.planetas) {
    if (p.dados.dono !== 'jogador') continue;
    planetas++;
    comum += p.dados.recursos.comum;
    raro += p.dados.recursos.raro;
    combustivel += p.dados.recursos.combustivel;
    for (const arr of Object.values(p.dados.pesquisas)) {
      for (const feito of arr) if (feito) pesquisasFeitas++;
    }
  }
  for (const n of mundo.naves) if (n.dono === 'jogador') naves++;

  const grid = document.createElement('div');
  grid.className = 'em-kv';
  const fmt = (n: number): string => Math.round(n).toLocaleString('pt-BR');
  const rows: Array<[string, string]> = [
    ['Planetas', `${planetas} / ${mundo.planetas.length}`],
    ['Naves ativas', String(naves)],
    ['Comum', fmt(comum)],
    ['Raro', fmt(raro)],
    ['Combustível', fmt(combustivel)],
    ['Pesquisas concluídas', String(pesquisasFeitas)],
  ];
  for (const [k, v] of rows) {
    const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
    const vEl = document.createElement('div'); vEl.textContent = v;
    grid.append(kEl, vEl);
  }
  sec.appendChild(grid);
  return sec;
}

function sectionPesos(mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'em-section';
  const t = document.createElement('h3'); t.className = 'em-section-title'; t.textContent = 'Personalidade';
  sec.appendChild(t);

  const imp = mundo.imperioJogador;
  if (!imp) {
    const e = document.createElement('div');
    e.className = 'em-empty';
    e.textContent = 'Personalidade ainda não autorada.';
    sec.appendChild(e);
    return sec;
  }
  const list: Array<[string, number, string]> = [
    ['Agressão', imp.pesos.agressao, 'agressao'],
    ['Expansão', imp.pesos.expansao, 'expansao'],
    ['Economia', imp.pesos.economia, 'economia'],
    ['Ciência', imp.pesos.ciencia, 'ciencia'],
    ['Defesa', imp.pesos.defesa, 'defesa'],
    ['Vingança', imp.pesos.vinganca, 'vinganca'],
  ];
  for (const [label, val, key] of list) {
    const row = document.createElement('div');
    row.className = 'em-weight-row';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    const bar = document.createElement('div'); bar.className = 'em-weight-bar';
    const fill = document.createElement('div'); fill.className = 'em-weight-fill';
    const pct = Math.max(0, Math.min(100, (val / 1.5) * 100));
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    const num = document.createElement('div'); num.className = 'num'; num.textContent = val.toFixed(2);
    row.append(l, bar, num);
    const tip = PESO_TOOLTIP[key];
    if (tip) attachTooltip(row, tip, 'box');
    sec.appendChild(row);
  }
  return sec;
}

function sectionLore(mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'em-section';
  const t = document.createElement('h3'); t.className = 'em-section-title'; t.textContent = 'História';
  sec.appendChild(t);

  const lore = mundo.imperioJogador?.lore;
  if (!lore || !lore.secoes?.length) {
    const e = document.createElement('div');
    e.className = 'em-empty';
    e.textContent = 'Nenhuma história gerada para este império.';
    sec.appendChild(e);
    return sec;
  }

  if (lore.subtitulo) {
    const sub = document.createElement('div');
    sub.className = 'em-lore-p';
    sub.style.fontStyle = 'italic';
    sub.textContent = lore.subtitulo;
    sec.appendChild(sub);
  }

  for (const secao of lore.secoes) {
    const block = document.createElement('div');
    block.className = 'em-lore-block';
    const title = document.createElement('div');
    title.className = 'em-lore-title';
    title.textContent = secao.titulo;
    block.appendChild(title);
    for (const p of secao.paragrafos) {
      const para = document.createElement('div');
      para.className = 'em-lore-p';
      para.textContent = p;
      block.appendChild(para);
    }
    if (secao.citacao) {
      const q = document.createElement('div');
      q.className = 'em-lore-q';
      q.textContent = `"${secao.citacao}"`;
      block.appendChild(q);
    }
    sec.appendChild(block);
  }

  if (lore.proverbios?.length) {
    const block = document.createElement('div');
    block.className = 'em-lore-block';
    const title = document.createElement('div');
    title.className = 'em-lore-title';
    title.textContent = 'Provérbios';
    block.appendChild(title);
    for (const p of lore.proverbios) {
      const q = document.createElement('div');
      q.className = 'em-lore-q';
      q.textContent = p;
      block.appendChild(q);
    }
    sec.appendChild(block);
  }

  // Wrap personality/objective keywords in the prose with tooltips
  // pointing back at the corresponding pesos / objetivo / arquétipo.
  aplicarTooltipsLore(sec);

  return sec;
}

function refreshContent(): void {
  if (!_modal || !_currentMundo) return;
  const mundo = _currentMundo;

  const titleEl = _modal.querySelector<HTMLHeadingElement>('.em-title');
  if (titleEl) titleEl.textContent = (mundo.imperioJogador?.nome ?? 'Império').toUpperCase();

  const left = _modal.querySelector<HTMLDivElement>('.em-left');
  if (left) {
    // Preserve the sigil DOM node across refreshes — rebuilding it
    // every HUD tick (~30 Hz) both flickered the SVG and wasted work
    // since gerarSigilo does a full re-random-shuffle. Only rebuild
    // its content when the empire's logo identity actually changes.
    let sigilWrap = _sigilEl;
    if (!sigilWrap) {
      sigilWrap = document.createElement('div');
      sigilWrap.className = 'em-sigil';
      _sigilEl = sigilWrap;
    }
    const imp = mundo.imperioJogador;
    const key = imp?.logo
      ? (imp.logo.manual ? `m:${JSON.stringify(imp.logo.manual)}` : `s:${imp.logo.seed}`)
      : 'none';
    if (key !== _sigilKey) {
      _sigilKey = key;
      sigilWrap.replaceChildren();
      if (imp?.logo) {
        const svg = imp.logo.manual ? gerarSigiloManual(imp.logo.manual) : gerarSigilo(imp.logo.seed);
        sigilWrap.appendChild(svg);
      }
    }
    left.replaceChildren(sigilWrap);
    left.appendChild(sectionIdentidade(mundo));
    left.appendChild(sectionEstatisticas(mundo));
  }

  const right = _modal.querySelector<HTMLDivElement>('.em-right');
  if (right) {
    right.replaceChildren();
    right.appendChild(sectionPesos(mundo));
    right.appendChild(sectionLore(mundo));
  }
}

function ensureModal(): void {
  if (_modal) return;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'empire-modal-backdrop';
  backdrop.setAttribute('data-ui', 'true');
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
  _backdrop = backdrop;

  const modal = document.createElement('div');
  modal.className = 'empire-modal';
  modal.setAttribute('data-ui', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });

  const head = document.createElement('div');
  head.className = 'em-head';
  const title = document.createElement('h2');
  title.className = 'em-title';
  title.textContent = 'Império';
  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'em-close';
  btnClose.setAttribute('aria-label', 'Fechar');
  btnClose.textContent = '×';
  btnClose.addEventListener('click', () => close());
  head.append(title, btnClose);
  modal.appendChild(head);

  const body = document.createElement('div');
  body.className = 'em-body';
  const left = document.createElement('div'); left.className = 'em-left';
  const right = document.createElement('div'); right.className = 'em-right';
  body.append(left, right);
  modal.appendChild(body);

  document.body.appendChild(modal);
  _modal = modal;

  _keydownHandler = (e: KeyboardEvent) => {
    if (_closeResolver && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', _keydownHandler);
}

export function abrirEmpireModal(mundo: Mundo): Promise<void> {
  const firstOpen = !_modal;
  ensureModal();
  if (!_modal || !_backdrop) return Promise.resolve();

  _currentMundo = mundo;
  forceRefresh('empire-modal');
  refreshContent();

  const modal = _modal;
  const backdrop = _backdrop;
  const apply = () => {
    backdrop.classList.add('visible');
    modal.classList.add('visible');
  };
  if (firstOpen) {
    void modal.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(apply));
  } else {
    apply();
  }
  marcarInteracaoUi();

  return new Promise<void>((resolve) => { _closeResolver = resolve; });
}

/** Live-refresh so planets/ships/resources update while the modal is open. */
export function atualizarEmpireModal(): void {
  if (!_modal || !_currentMundo) return;
  if (!_modal.classList.contains('visible')) return;
  if (!shouldRefresh('empire-modal')) return;
  refreshContent();
}

export function fecharEmpireModal(): void {
  close();
}

function close(): void {
  if (!_modal || !_backdrop) return;
  _modal.classList.remove('visible');
  _backdrop.classList.remove('visible');
  _currentMundo = null;
  _sigilEl = null;
  _sigilKey = null;
  if (_closeResolver) {
    const resolve = _closeResolver;
    _closeResolver = null;
    resolve();
  }
}

export function destruirEmpireModal(): void {
  close();
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  if (_modal) { _modal.remove(); _modal = null; }
  if (_backdrop) { _backdrop.remove(); _backdrop = null; }
  _styleInjected = false;
}
