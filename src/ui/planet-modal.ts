/**
 * Rich in-game modal showing the full view of a planet.
 *
 * Opens when the player clicks a planet. Aggregates everything that
 * was previously spread between the side planet-panel, tooltips, and
 * the separate lore modal: name, owner (with faction lore link),
 * resources, factories/infrastructure, ships, active research,
 * construction, production queue, plus the procedural lore summary.
 *
 * Built with real DOM (no ASCII decoration) and matches the HUD
 * aesthetic. Re-renders on demand when the caller invokes
 * atualizarPlanetaModal with the same planet — cheap enough to call
 * each frame while open.
 */

import type { Mundo, Planeta } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { nomeTipoPlaneta, getTierMax, obterProducaoNaturalCiclo, calcularTempoRestantePlaneta, getPesquisaAtual } from '../world/mundo';
import { getPersonalidades } from '../world/ia-decisao';
import { gerarPlanetaLore } from '../world/lore/planeta-lore';
import { gerarImperioLore } from '../world/lore/imperio-lore';
import { abrirImperioLore, abrirPlanetaLore } from './lore-modal';

let _backdrop: HTMLDivElement | null = null;
let _modal: HTMLDivElement | null = null;
let _bodyEl: HTMLDivElement | null = null;
let _styleInjected = false;
let _closeResolver: (() => void) | null = null;
let _currentPlaneta: Planeta | null = null;
let _currentMundo: Mundo | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .planeta-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(6px);
      z-index: 940;
      display: none;
    }
    .planeta-modal-backdrop.visible { display: block; }

    .planeta-modal {
      position: fixed;
      top: 50%; left: 50%;
      width: clamp(360px, 60vmin, 720px);
      max-height: 88vh;
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(10px);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      z-index: 941;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      opacity: 0;
      transform: translate(-50%, calc(-50% + var(--hud-unit) * 0.8)) scale(0.97);
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 200ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 240ms;
    }
    .planeta-modal.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 200ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .planeta-modal-head {
      display: flex;
      align-items: flex-start;
      gap: calc(var(--hud-unit) * 1);
      padding: calc(var(--hud-unit) * 1.1) calc(var(--hud-unit) * 1.3);
      border-bottom: 1px solid var(--hud-line);
      background:
        radial-gradient(ellipse at top left, rgba(120, 170, 255, 0.08), transparent 60%),
        transparent;
    }

    .planeta-modal-portrait {
      width: calc(var(--hud-unit) * 5);
      height: calc(var(--hud-unit) * 5);
      border: 1px solid var(--hud-line);
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.04), rgba(0,0,0,0.2));
      display: grid;
      place-items: center;
      flex-shrink: 0;
      overflow: hidden;
    }
    .planeta-modal-portrait .dot {
      width: 60%;
      height: 60%;
      border-radius: 50%;
      border: 1px solid var(--hud-border);
    }

    .planeta-modal-meta {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
      flex: 1;
      min-width: 0;
    }
    .planeta-modal-name {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.25);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      line-height: 1.1;
      color: var(--hud-text);
      margin: 0;
    }
    .planeta-modal-tipo {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.72);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .planeta-modal-owner {
      display: inline-flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.4);
      margin-top: calc(var(--hud-unit) * 0.4);
      font-size: calc(var(--hud-unit) * 0.82);
      color: var(--hud-text);
      cursor: pointer;
      width: fit-content;
    }
    .planeta-modal-owner-dot {
      width: calc(var(--hud-unit) * 0.7);
      height: calc(var(--hud-unit) * 0.7);
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.3);
    }
    .planeta-modal-owner.clickable:hover .planeta-modal-owner-name { text-decoration: underline; }

    .planeta-modal-close {
      appearance: none;
      background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text-dim);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.9);
      width: calc(var(--hud-unit) * 1.8);
      height: calc(var(--hud-unit) * 1.8);
      cursor: pointer;
      border-radius: 50%;
      transition: background 120ms ease, color 120ms ease;
      flex-shrink: 0;
    }
    .planeta-modal-close:hover {
      background: rgba(255,255,255,0.08);
      color: var(--hud-text);
    }

    .planeta-modal-body {
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1.3) calc(var(--hud-unit) * 1.2);
      overflow-y: auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: calc(var(--hud-unit) * 0.9);
    }

    .planeta-card {
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.85);
      background: rgba(255,255,255,0.02);
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.4);
    }
    .planeta-card.span-2 { grid-column: span 2; }
    .planeta-card-title {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.68);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin: 0 0 calc(var(--hud-unit) * 0.2);
    }

    .planeta-stats-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--hud-unit) * 0.5);
      font-size: calc(var(--hud-unit) * 0.85);
    }
    .planeta-stats-label { color: var(--hud-text-dim); }
    .planeta-stats-value { color: var(--hud-text); font-variant-numeric: tabular-nums; }

    .planeta-resources-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: calc(var(--hud-unit) * 0.5);
    }
    .planeta-resource {
      text-align: center;
      padding: calc(var(--hud-unit) * 0.4);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      background: rgba(0,0,0,0.15);
    }
    .planeta-resource-icon { font-size: calc(var(--hud-unit) * 1); }
    .planeta-resource-label {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.62);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .planeta-resource-value {
      font-size: calc(var(--hud-unit) * 0.95);
      color: var(--hud-text);
      font-variant-numeric: tabular-nums;
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
      font-size: calc(var(--hud-unit) * 0.78);
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
      font-size: calc(var(--hud-unit) * 0.82);
      line-height: 1.5;
      color: var(--hud-text-dim);
      font-style: italic;
      margin: 0;
    }

    .planeta-modal-actions {
      display: flex;
      gap: calc(var(--hud-unit) * 0.4);
      flex-wrap: wrap;
      padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 1.3) calc(var(--hud-unit) * 0.9);
      border-top: 1px solid var(--hud-line);
      background: rgba(0,0,0,0.2);
    }
    .planeta-modal-btn {
      appearance: none;
      padding: calc(var(--hud-unit) * 0.45) calc(var(--hud-unit) * 0.85);
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
    .planeta-modal-btn:hover { background: rgba(255,255,255,0.08); }
    .planeta-modal-btn.primary { background: rgba(140, 190, 255, 0.12); border-color: rgba(140, 190, 255, 0.4); }
    .planeta-modal-btn.primary:hover { background: rgba(140, 190, 255, 0.22); }

    .planeta-empty {
      color: var(--hud-text-dim);
      font-style: italic;
      font-size: calc(var(--hud-unit) * 0.8);
    }

    @media (max-width: 600px) {
      .planeta-modal-body { grid-template-columns: 1fr; }
      .planeta-card.span-2 { grid-column: span 1; }
    }
  `;
  document.head.appendChild(style);
}

function removeAllChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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
  const tipos: Array<[string, string, number]> = [
    ['Comum', '▣', p.dados.recursos.comum],
    ['Raro', '✦', p.dados.recursos.raro],
    ['Fuel', '◈', p.dados.recursos.combustivel],
  ];
  for (const [label, icon, val] of tipos) {
    const r = document.createElement('div');
    r.className = 'planeta-resource';
    const i = document.createElement('div');
    i.className = 'planeta-resource-icon';
    i.textContent = icon;
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

function cardProducao(p: Planeta): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'planeta-card';
  const t = document.createElement('h3');
  t.className = 'planeta-card-title';
  t.textContent = 'Produção do ciclo';
  card.appendChild(t);

  const base = obterProducaoNaturalCiclo(p);
  const mult = p.dados.producao || 1;

  const rows: Array<[string, string]> = [
    ['Comum', `+${fmtRate(base.comum * mult)}`],
    ['Raro', `+${fmtRate(base.raro * mult)}`],
    ['Combustível', `+${fmtRate(base.combustivel * mult)}`],
    ['Próximo ciclo em', formatMs(calcularTempoRestantePlaneta(p))],
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

function progressItem(label: string, remainingMs: number, totalMs: number): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'planeta-progress-item';
  const line = document.createElement('div');
  line.className = 'planeta-progress-line';
  const l = document.createElement('span'); l.textContent = label;
  const t = document.createElement('span'); t.textContent = formatMs(remainingMs);
  line.append(l, t);
  const bar = document.createElement('div');
  bar.className = 'planeta-progress-bar';
  const fill = document.createElement('div');
  fill.className = 'planeta-progress-bar-fill';
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, 100 * (1 - remainingMs / totalMs))) : 0;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  item.append(line, bar);
  return item;
}

function cardAtividade(p: Planeta): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'planeta-card span-2';
  const t = document.createElement('h3');
  t.className = 'planeta-card-title';
  t.textContent = 'Atividade atual';
  card.appendChild(t);

  let any = false;
  const constr = p.dados.construcaoAtual;
  if (constr) {
    any = true;
    const label = `${constr.tipo === 'fabrica' ? 'Upgrade fábrica' : 'Upgrade infra'} → tier ${constr.tierDestino}`;
    card.appendChild(progressItem(label, constr.tempoRestanteMs, constr.tempoTotalMs));
  }
  const naveProducao = p.dados.producaoNave;
  if (naveProducao) {
    any = true;
    card.appendChild(progressItem(`Construindo ${naveProducao.tipoNave} (t${naveProducao.tier})`, naveProducao.tempoRestanteMs, naveProducao.tempoTotalMs));
  }
  const pesquisa = getPesquisaAtual(p);
  if (pesquisa) {
    any = true;
    card.appendChild(progressItem(`Pesquisando ${pesquisa.categoria} (t${pesquisa.tier})`, pesquisa.tempoRestanteMs, pesquisa.tempoTotalMs));
  }
  if (p.dados.filaProducao.length > 0) {
    any = true;
    const line = document.createElement('div');
    line.className = 'planeta-stats-row';
    const l = document.createElement('span'); l.className = 'planeta-stats-label';
    l.textContent = p.dados.repetirFilaProducao ? 'Fila (loop)' : 'Fila';
    const v = document.createElement('span'); v.className = 'planeta-stats-value';
    v.textContent = String(p.dados.filaProducao.length);
    line.append(l, v);
    card.appendChild(line);
  }
  if (!any) {
    const empty = document.createElement('div');
    empty.className = 'planeta-empty';
    empty.textContent = 'Sem atividade em andamento.';
    card.appendChild(empty);
  }
  return card;
}

function cardLore(p: Planeta, mundo: Mundo): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'planeta-card span-2';
  const t = document.createElement('h3');
  t.className = 'planeta-card-title';
  t.textContent = 'Sobre o planeta';
  card.appendChild(t);

  const ia = getPersonalidades().find((x) => x.id === p.dados.dono);
  const lore = gerarPlanetaLore({
    planetaId: p.id,
    galaxySeed: mundo.galaxySeed,
    tipo: p.dados.tipoPlaneta,
    dono: p.dados.dono,
    nomePlaneta: p.dados.nome,
    donoNome: ia?.nome,
    donoArquetipo: ia?.arquetipo,
    tamanho: p.dados.tamanho,
  });

  const slogan = document.createElement('p');
  slogan.className = 'planeta-lore-summary';
  slogan.textContent = lore.slogan;
  card.appendChild(slogan);

  const biomas = document.createElement('p');
  biomas.className = 'planeta-lore-summary';
  biomas.textContent = lore.biomas;
  card.appendChild(biomas);

  return card;
}

// ─── Main builders ──────────────────────────────────────────────────

function buildHeader(p: Planeta): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'planeta-modal-head';

  const portrait = document.createElement('div');
  portrait.className = 'planeta-modal-portrait';
  const dot = document.createElement('div');
  dot.className = 'dot';
  dot.style.background = `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), ${tipoPlanetaCor(p.dados.tipoPlaneta)} 60%)`;
  portrait.appendChild(dot);
  head.appendChild(portrait);

  const meta = document.createElement('div');
  meta.className = 'planeta-modal-meta';
  const h = document.createElement('h2');
  h.className = 'planeta-modal-name';
  h.textContent = p.dados.nome;
  meta.appendChild(h);
  const tipo = document.createElement('div');
  tipo.className = 'planeta-modal-tipo';
  tipo.textContent = nomeTipoPlaneta(p.dados.tipoPlaneta);
  meta.appendChild(tipo);

  const owner = document.createElement('div');
  const dono = p.dados.dono;
  const ia = getPersonalidades().find((x) => x.id === dono);
  const clickable = dono !== 'jogador' && dono !== 'neutro' && !!ia;
  owner.className = `planeta-modal-owner${clickable ? ' clickable' : ''}`;
  const ownerDot = document.createElement('div');
  ownerDot.className = 'planeta-modal-owner-dot';
  ownerDot.style.background = ownerColor(dono);
  owner.appendChild(ownerDot);
  const ownerName = document.createElement('span');
  ownerName.className = 'planeta-modal-owner-name';
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

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'planeta-modal-close';
  closeBtn.setAttribute('aria-label', 'Fechar');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    marcarInteracaoUi();
    close();
  });
  head.appendChild(closeBtn);

  return head;
}

function tipoPlanetaCor(tipo: string): string {
  if (tipo === 'marte') return '#c96a3a';
  if (tipo === 'gasoso') return '#9a7fc2';
  return '#4a9e6a';
}

function buildActions(p: Planeta, mundo: Mundo): HTMLDivElement {
  const actions = document.createElement('div');
  actions.className = 'planeta-modal-actions';

  const archiveBtn = document.createElement('button');
  archiveBtn.type = 'button';
  archiveBtn.className = 'planeta-modal-btn';
  archiveBtn.textContent = 'Ver arquivo planetário';
  archiveBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    marcarInteracaoUi();
    const ia = getPersonalidades().find((x) => x.id === p.dados.dono);
    const lore = gerarPlanetaLore({
      planetaId: p.id,
      galaxySeed: mundo.galaxySeed,
      tipo: p.dados.tipoPlaneta,
      dono: p.dados.dono,
      nomePlaneta: p.dados.nome,
      donoNome: ia?.nome,
      donoArquetipo: ia?.arquetipo,
      tamanho: p.dados.tamanho,
    });
    void abrirPlanetaLore(lore, p.dados.nome);
  });
  actions.appendChild(archiveBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'planeta-modal-btn primary';
  closeBtn.textContent = 'Fechar';
  closeBtn.addEventListener('click', () => close());
  actions.appendChild(closeBtn);

  return actions;
}

function rebuildBody(p: Planeta, mundo: Mundo): void {
  if (!_bodyEl) return;
  removeAllChildren(_bodyEl);
  _bodyEl.appendChild(cardInfraestrutura(p));
  _bodyEl.appendChild(cardRecursos(p));
  _bodyEl.appendChild(cardProducao(p));
  _bodyEl.appendChild(cardAtividade(p));
  _bodyEl.appendChild(cardLore(p, mundo));
}

// ─── Public API ─────────────────────────────────────────────────────

function ensureModal(): void {
  if (_modal) return;
  injectStyles();
  const backdrop = document.createElement('div');
  backdrop.className = 'planeta-modal-backdrop';
  backdrop.addEventListener('click', () => close());
  _backdrop = backdrop;
  document.body.appendChild(backdrop);

  const modal = document.createElement('div');
  modal.className = 'planeta-modal';
  modal.setAttribute('data-ui', 'true');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });
  _modal = modal;
  document.body.appendChild(modal);

  window.addEventListener('keydown', (e) => {
    if (_closeResolver && e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

export function abrirPlanetaModal(planeta: Planeta, mundo: Mundo): Promise<void> {
  ensureModal();
  if (!_modal || !_backdrop) return Promise.resolve();
  if (_closeResolver && _currentPlaneta === planeta) return Promise.resolve();

  _currentPlaneta = planeta;
  _currentMundo = mundo;

  removeAllChildren(_modal);
  _modal.appendChild(buildHeader(planeta));
  const body = document.createElement('div');
  body.className = 'planeta-modal-body';
  _bodyEl = body;
  _modal.appendChild(body);
  rebuildBody(planeta, mundo);
  _modal.appendChild(buildActions(planeta, mundo));

  _backdrop.classList.add('visible');
  _modal.classList.add('visible');

  if (!_closeResolver) {
    return new Promise<void>((resolve) => { _closeResolver = resolve; });
  }
  return Promise.resolve();
}

/** Re-render the currently-shown planet's cards without re-opening. */
export function atualizarPlanetaModal(): void {
  if (!_closeResolver || !_currentPlaneta || !_currentMundo || !_bodyEl) return;
  rebuildBody(_currentPlaneta, _currentMundo);
}

export function isPlanetaModalAberto(): boolean {
  return _closeResolver !== null;
}

function close(): void {
  _backdrop?.classList.remove('visible');
  _modal?.classList.remove('visible');
  _currentPlaneta = null;
  _currentMundo = null;
  const r = _closeResolver;
  _closeResolver = null;
  if (r) r();
}

export function destruirPlanetaModal(): void {
  _modal?.remove();
  _backdrop?.remove();
  _modal = null;
  _backdrop = null;
  _bodyEl = null;
  _styleInjected = false;
  if (_closeResolver) {
    const r = _closeResolver;
    _closeResolver = null;
    r();
  }
}
