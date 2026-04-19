/**
 * Semi-fullscreen planet details modal.
 *
 * Opened from the "Ver detalhes" button in planet-drawer.ts. Shows
 * a much larger layout than the sidebar drawer — two columns on
 * wide viewports (portrait + identity on the left, live stats on
 * the right) collapsing to a single scrollable column on narrow.
 *
 * Intentionally kept open-ended: sections can be added incrementally.
 * For now it surfaces every field DadosPlaneta exposes, plus a couple
 * of derived values (system, discovered-by-player). Lore and history
 * sections are marked as future work so the UI scaffolding doesn't
 * have to land all at once.
 *
 * Only one details modal open at a time.
 */

import type { Mundo, Planeta } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { nomeTipoPlaneta, TIPO_PLANETA } from '../world/planeta';
import { getPersonalidades } from '../world/ia-decisao';
import { criarPlanetaProceduralSprite } from '../world/planeta-procedural';
import { Application, Container } from 'pixi.js';

let _backdrop: HTMLDivElement | null = null;
let _modal: HTMLDivElement | null = null;
let _styleInjected = false;
let _closeResolver: (() => void) | null = null;
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let _current: Planeta | null = null;
let _currentMundo: Mundo | null = null;
// Mini Pixi app driving the portrait sprite so the planet actually
// rotates inside the details modal. Lazily booted on first open.
let _portraitApp: Application | null = null;
let _portraitContainer: Container | null = null;
let _portraitSprite: Container | null = null;
// Init is async — Pixi v8 Application.init returns a Promise and the
// renderer / canvas getters throw if accessed before it resolves. We
// remember the init Promise so every renderPortrait call can await it
// (the 'two-click to open' symptom was the Uncaught TypeError from
// accessing app.canvas on the first click, before init landed).
let _portraitInitPromise: Promise<unknown> | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .planet-details-backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(6px);
      z-index: 980;
      opacity: 0;
      visibility: hidden;
      transition: opacity 220ms ease-out, visibility 0s linear 220ms;
    }
    .planet-details-backdrop.visible {
      opacity: 1;
      visibility: visible;
      transition: opacity 220ms ease-out, visibility 0s linear 0s;
    }

    .planet-details-modal {
      position: fixed;
      top: 50%; left: 50%;
      /* Semi-fullscreen: clamp keeps it readable on huge monitors
         AND usable on cramped laptops. */
      width: min(92vw, calc(var(--hud-unit) * 52));
      height: min(88vh, calc(var(--hud-unit) * 36));
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(10px);
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
    .planet-details-modal.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 220ms ease-out,
        transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    /* ─ Header ─ */
    .pd-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: calc(var(--hud-unit) * 0.8);
      padding: calc(var(--hud-unit) * 1) calc(var(--hud-unit) * 1.4);
      border-bottom: 1px solid var(--hud-line);
      flex-shrink: 0;
    }
    .pd-title {
      font-family: var(--hud-font);
      font-weight: 600;
      font-size: calc(var(--hud-unit) * 1.15);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      line-height: 1.15;
      margin: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pd-subtitle {
      font-size: calc(var(--hud-unit) * 0.75);
      color: var(--hud-text-dim);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-top: calc(var(--hud-unit) * 0.1);
    }
    .pd-close {
      appearance: none;
      background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text-dim);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.95);
      width: calc(var(--hud-unit) * 1.7);
      height: calc(var(--hud-unit) * 1.7);
      border-radius: 50%;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .pd-close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--hud-text);
      border-color: rgba(255, 255, 255, 0.35);
    }

    /* ─ Body: 2-column at wide, stacked at narrow ─ */
    .pd-body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(calc(var(--hud-unit) * 14), 1fr) 2fr;
      gap: calc(var(--hud-unit) * 1);
      padding: calc(var(--hud-unit) * 1.1) calc(var(--hud-unit) * 1.4);
      overflow: hidden;
    }
    @media (max-width: 760px) {
      .pd-body {
        grid-template-columns: 1fr;
        overflow-y: auto;
      }
    }

    .pd-left, .pd-right {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.8);
      overflow-y: auto;
      padding-right: calc(var(--hud-unit) * 0.2);
    }
    .pd-body::-webkit-scrollbar,
    .pd-left::-webkit-scrollbar,
    .pd-right::-webkit-scrollbar { width: 8px; }
    .pd-body::-webkit-scrollbar-thumb,
    .pd-left::-webkit-scrollbar-thumb,
    .pd-right::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.14);
      border-radius: 4px;
    }

    /* ─ Portrait ─ */
    .pd-portrait {
      aspect-ratio: 1;
      width: 100%;
      max-width: calc(var(--hud-unit) * 14);
      align-self: center;
      border-radius: 50%;
      overflow: hidden;
      position: relative;
      background: #050910;
      border: 1px solid var(--hud-border);
      box-shadow: 0 0 calc(var(--hud-unit) * 0.8) rgba(120, 180, 255, 0.08) inset;
    }
    .pd-portrait canvas {
      position: absolute;
      inset: 0;
      width: 100% !important;
      height: 100% !important;
      image-rendering: pixelated;
    }

    /* ─ Section cards ─ */
    .pd-section {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.85);
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.4);
    }
    .pd-section-title {
      font-family: var(--hud-font);
      font-weight: 600;
      font-size: calc(var(--hud-unit) * 0.78);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin: 0;
      padding-bottom: calc(var(--hud-unit) * 0.3);
      border-bottom: 1px solid var(--hud-line);
    }

    .pd-kv-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: calc(var(--hud-unit) * 0.25) calc(var(--hud-unit) * 0.8);
      font-size: calc(var(--hud-unit) * 0.82);
    }
    .pd-kv-grid .k {
      color: var(--hud-text-dim);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-size: calc(var(--hud-unit) * 0.7);
    }
    .pd-kv-grid .v {
      color: var(--hud-text);
      overflow-wrap: anywhere;
    }

    .pd-owner-dot {
      display: inline-block;
      width: calc(var(--hud-unit) * 0.55);
      height: calc(var(--hud-unit) * 0.55);
      border-radius: 50%;
      margin-right: calc(var(--hud-unit) * 0.3);
      vertical-align: middle;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }

    .pd-empty {
      color: var(--hud-text-dim);
      font-style: italic;
      font-size: calc(var(--hud-unit) * 0.78);
    }
  `;
  document.head.appendChild(style);
}

function corDono(dono: string): string {
  if (dono === 'jogador') return '#8ce0ff';
  if (dono === 'neutro') return '#7a8897';
  const ia = getPersonalidades().find((x) => x.id === dono);
  if (ia) return `#${ia.cor.toString(16).padStart(6, '0')}`;
  return '#555';
}

function nomeDono(dono: string): string {
  if (dono === 'jogador') return 'Você';
  if (dono === 'neutro') return 'Neutro';
  const ia = getPersonalidades().find((x) => x.id === dono);
  return ia?.nome ?? dono;
}

function fmtNum(n: number): string {
  const r = Math.round(n);
  if (r < 1000) return String(r);
  if (r < 1_000_000) return `${(r / 1000).toFixed(r < 10_000 ? 1 : 0)}K`;
  return `${(r / 1_000_000).toFixed(1)}M`;
}

function nomeSistema(mundo: Mundo, sistemaId: number): string {
  const sistema = mundo.sistemas[sistemaId];
  if (!sistema) return '—';
  // Sistema doesn't carry its own name; the sun inherits the system's
  // first-planet name. Falls back to "Sistema N" if the sun has no id.
  return sistema.id ? `Sistema ${sistema.id}` : `Sistema ${sistemaId + 1}`;
}

function buildSectionIdentidade(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Identidade';
  sec.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pd-kv-grid';

  const rows: Array<[string, string | Node]> = [
    ['Nome', p.dados.nome],
    ['Tipo', nomeTipoPlaneta(p.dados.tipoPlaneta)],
    ['Sistema', nomeSistema(mundo, p.dados.sistemaId)],
    ['Tamanho', `${Math.round(p.dados.tamanho)} u`],
    ['Descoberto', p._descobertoAoJogador ? 'Sim' : 'Não'],
    ['Visível', p._visivelAoJogador ? 'Agora' : 'Via memória'],
  ];

  // Owner with color swatch.
  const donoWrap = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'pd-owner-dot';
  dot.style.background = corDono(p.dados.dono);
  donoWrap.append(dot, document.createTextNode(nomeDono(p.dados.dono)));
  rows.unshift(['Dono', donoWrap]);

  for (const [k, v] of rows) {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('div');
    vEl.className = 'v';
    if (typeof v === 'string') vEl.textContent = v;
    else vEl.appendChild(v);
    grid.append(kEl, vEl);
  }

  sec.appendChild(grid);
  return sec;
}

function buildSectionRecursos(p: Planeta): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Recursos';
  sec.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pd-kv-grid';
  const r = p.dados.recursos;
  const rows: Array<[string, string]> = [
    ['Comum', fmtNum(r.comum)],
    ['Raro', fmtNum(r.raro)],
    ['Combustível', fmtNum(r.combustivel)],
    ['Produção/tick', fmtNum(p.dados.producao)],
  ];
  for (const [k, v] of rows) {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('div');
    vEl.className = 'v';
    vEl.textContent = v;
    grid.append(kEl, vEl);
  }
  sec.appendChild(grid);
  return sec;
}

function buildSectionInfra(p: Planeta): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Infraestrutura';
  sec.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pd-kv-grid';
  const rows: Array<[string, string]> = [
    ['Fábricas T', String(p.dados.fabricas)],
    ['Infraestrutura T', String(p.dados.infraestrutura)],
    ['Naves em órbita', String(p.dados.naves)],
  ];
  if (p.dados.construcaoAtual) {
    const c = p.dados.construcaoAtual;
    const pct = 100 - Math.round((c.tempoRestanteMs / c.tempoTotalMs) * 100);
    rows.push(['Construindo', `${c.tipo} T${c.tierDestino} — ${pct}%`]);
  }
  if (p.dados.producaoNave) {
    const pn = p.dados.producaoNave;
    const pct = 100 - Math.round((pn.tempoRestanteMs / pn.tempoTotalMs) * 100);
    rows.push(['Fabricando', `${pn.tipoNave} T${pn.tier} — ${pct}%`]);
  }
  for (const [k, v] of rows) {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('div');
    vEl.className = 'v';
    vEl.textContent = v;
    grid.append(kEl, vEl);
  }
  sec.appendChild(grid);
  return sec;
}

function buildSectionPesquisa(p: Planeta): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Pesquisa';
  sec.appendChild(title);

  if (p.dados.pesquisaAtual) {
    const grid = document.createElement('div');
    grid.className = 'pd-kv-grid';
    const pa = p.dados.pesquisaAtual;
    const pct = 100 - Math.round((pa.tempoRestanteMs / pa.tempoTotalMs) * 100);
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = 'Em andamento';
    const vEl = document.createElement('div');
    vEl.className = 'v';
    vEl.textContent = `${pa.categoria} T${pa.tier} — ${pct}%`;
    grid.append(kEl, vEl);
    sec.appendChild(grid);
  } else {
    const empty = document.createElement('div');
    empty.className = 'pd-empty';
    empty.textContent = 'Nenhuma pesquisa ativa';
    sec.appendChild(empty);
  }
  return sec;
}

async function renderPortrait(host: HTMLDivElement, p: Planeta): Promise<void> {
  // Boot a tiny Pixi app once; reuse across opens.
  if (!_portraitApp) {
    const app = new Application();
    _portraitApp = app;
    _portraitInitPromise = app.init({
      width: 256,
      height: 256,
      background: 0x050910,
      antialias: true,
    }).then(() => {
      _portraitContainer = new Container();
      app.stage.addChild(_portraitContainer);
    }).catch((err) => {
      console.warn('[planet-details] portrait Pixi init failed:', err);
      _portraitApp = null;
      _portraitContainer = null;
    });
  }
  // Wait for init to resolve before touching app.canvas / app.renderer
  // — otherwise Pixi's getters throw because renderer is still
  // undefined. This is the actual fix for the two-click open bug.
  await _portraitInitPromise;
  // Caller could have navigated away in the meantime.
  if (_current !== p) return;
  const app = _portraitApp;
  const cont = _portraitContainer;
  if (!app || !cont) return;
  host.replaceChildren();
  if (_portraitSprite) {
    cont.removeChild(_portraitSprite);
    _portraitSprite.destroy({ children: true });
    _portraitSprite = null;
  }
  const size = 220;
  const sprite = criarPlanetaProceduralSprite(128, 128, size, p.dados.tipoPlaneta);
  cont.addChild(sprite as unknown as Container);
  _portraitSprite = sprite as unknown as Container;
  host.appendChild(app.canvas);
}

function refreshContent(): void {
  if (!_modal || !_current) return;
  const p = _current;
  const mundo = _currentMundo;

  // Title + subtitle in header.
  const title = _modal.querySelector<HTMLHeadingElement>('.pd-title');
  if (title) {
    title.textContent = p.dados.nome;
    title.title = p.dados.nome;
  }
  const sub = _modal.querySelector<HTMLDivElement>('.pd-subtitle');
  if (sub) {
    sub.textContent = `${nomeTipoPlaneta(p.dados.tipoPlaneta)} · ${nomeDono(p.dados.dono)}`;
  }

  // Rebuild sections each refresh — cheap, fits the drawer idiom.
  const left = _modal.querySelector<HTMLDivElement>('.pd-left');
  const right = _modal.querySelector<HTMLDivElement>('.pd-right');
  if (left) {
    const portrait = left.querySelector<HTMLDivElement>('.pd-portrait');
    if (portrait) void renderPortrait(portrait, p);
    // Keep portrait + identity section.
    const keep = left.querySelector<HTMLDivElement>('.pd-portrait');
    left.replaceChildren();
    if (keep) left.appendChild(keep);
    if (mundo) left.appendChild(buildSectionIdentidade(p, mundo));
  }
  if (right) {
    right.replaceChildren();
    right.appendChild(buildSectionRecursos(p));
    right.appendChild(buildSectionInfra(p));
    if (p.dados.tipoPlaneta !== TIPO_PLANETA.ASTEROIDE) {
      right.appendChild(buildSectionPesquisa(p));
    }
  }
}

function ensureModal(): void {
  if (_modal) return;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'planet-details-backdrop';
  backdrop.setAttribute('data-ui', 'true');
  // Close on pointerdown (not click) AND only when the press actually
  // STARTS on the backdrop itself. Reason: the user's click that
  // opens this modal via the drawer button ends its mouseup-phase on
  // top of the newly-appended backdrop. A plain `click` handler then
  // fires on the backdrop (because click synthesises to the nearest
  // common ancestor of down + up), so the open-click immediately
  // became a close-click — that's the "need two clicks to open" bug.
  // Using pointerdown filters the phantom click out because the
  // original pointerdown was on the button, not the backdrop.
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
  _backdrop = backdrop;

  const modal = document.createElement('div');
  modal.className = 'planet-details-modal';
  modal.setAttribute('data-ui', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'pd-details-title');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });

  const head = document.createElement('div');
  head.className = 'pd-head';
  const titleWrap = document.createElement('div');
  titleWrap.style.minWidth = '0';
  const title = document.createElement('h2');
  title.className = 'pd-title';
  title.id = 'pd-details-title';
  const sub = document.createElement('div');
  sub.className = 'pd-subtitle';
  titleWrap.append(title, sub);
  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'pd-close';
  btnClose.setAttribute('aria-label', 'Fechar detalhes');
  btnClose.textContent = '×';
  btnClose.addEventListener('click', () => close());
  head.append(titleWrap, btnClose);
  modal.appendChild(head);

  const body = document.createElement('div');
  body.className = 'pd-body';
  const left = document.createElement('div');
  left.className = 'pd-left';
  const portrait = document.createElement('div');
  portrait.className = 'pd-portrait';
  left.appendChild(portrait);
  const right = document.createElement('div');
  right.className = 'pd-right';
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

export function abrirPlanetDetailsModal(p: Planeta, mundo: Mundo): Promise<void> {
  const firstOpen = !_modal;
  ensureModal();
  if (!_modal || !_backdrop) return Promise.resolve();

  _current = p;
  _currentMundo = mundo;
  refreshContent();

  const modal = _modal;
  const backdrop = _backdrop;
  // On FIRST open the element is freshly in the DOM with opacity 0
  // + visibility hidden from CSS. Adding `.visible` in the same tick
  // skips the transition because the browser hasn't painted the
  // hidden state yet (that's the 'double-click to open' bug). Use a
  // double-rAF so there's guaranteed a full paint cycle at opacity 0
  // before we toggle visible.
  const apply = () => {
    backdrop.classList.add('visible');
    modal.classList.add('visible');
  };
  if (firstOpen) {
    // Force style recalc, then wait two frames.
    void modal.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(apply);
    });
  } else {
    apply();
  }
  marcarInteracaoUi();

  return new Promise<void>((resolve) => { _closeResolver = resolve; });
}

/** Callable from outside (e.g. per-tick) so mundo updates surface
 *  live inside the modal. Safe to call when the modal is closed. */
export function atualizarPlanetDetailsModal(): void {
  if (!_modal || !_current) return;
  if (!_modal.classList.contains('visible')) return;
  refreshContent();
}

export function fecharPlanetDetailsModal(): void {
  close();
}

function close(): void {
  if (!_modal || !_backdrop) return;
  _modal.classList.remove('visible');
  _backdrop.classList.remove('visible');
  _current = null;
  _currentMundo = null;
  if (_portraitSprite) {
    try { _portraitSprite.destroy({ children: true }); } catch { /* noop */ }
    _portraitSprite = null;
  }
  if (_closeResolver) {
    const resolve = _closeResolver;
    _closeResolver = null;
    resolve();
  }
}

export function destruirPlanetDetailsModal(): void {
  close();
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  if (_portraitApp) {
    try { _portraitApp.destroy(true, { children: true, texture: true }); } catch { /* noop */ }
    _portraitApp = null;
    _portraitContainer = null;
  }
  if (_modal) { _modal.remove(); _modal = null; }
  if (_backdrop) { _backdrop.remove(); _backdrop = null; }
}
