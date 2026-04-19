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

import type { Mundo, Nave, Planeta } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { nomeTipoPlaneta, TIPO_PLANETA } from '../world/planeta';
import { getPersonalidades } from '../world/ia-decisao';
import { criarPlanetaProceduralSprite, atualizarTempoPlanetas } from '../world/planeta-procedural';
import { parseAcaoNave } from '../world/naves';
import { gerarPlanetaLore } from '../world/lore/planeta-lore';
import { rngFromSeed } from '../world/lore/seeded-rng';
import { calcularCustoTier, calcularTempoConstrucaoMs } from '../world/recursos';
import { getEventos } from '../world/eventos';
import { getBattles } from '../world/battle-log';
import { getMemoria } from '../world/nevoa';
import { getPrimeiroContato } from '../world/first-contact';
import { inferirArquetipo } from '../world/imperio-jogador';
import { diagnosticarFila, moverItemFila, removerItemFila } from '../world/construcao';
import { bindFilaDragDrop, isFilaDragging } from './fila-dnd';
import { attachTooltip } from './tooltip';
import { aplicarTooltipsLore } from './lore-keywords';
import { Application, Container, Ticker } from 'pixi.js';

const TOOLTIPS: Record<string, string> = {
  // Recursos
  Comum: 'Recurso base — usado em fábricas, naves e infraestrutura.',
  Raro: 'Recurso avançado — consumido em pesquisas de tier alto.',
  Combustível: 'Necessário para o movimento prolongado de naves.',
  'Produção/tick': 'Recursos que o planeta gera a cada ciclo completo.',
  // Infra
  'Fábricas T': 'Tier da fábrica — limita o tier máximo de nave produzível.',
  'Infraestrutura T': 'Tier da infraestrutura — aumenta produção natural.',
  'Naves em órbita': 'Naves do planeta atualmente em estado orbitando.',
  Construindo: 'Construção em andamento — fábrica ou infraestrutura.',
  Fabricando: 'Nave em produção agora.',
  // Órbita
  'Raio orbital': 'Distância do planeta ao centro do sistema (u = unidades do mundo).',
  'Distância do sol': 'Distância atual ao sol do sistema.',
  'Ângulo atual': 'Posição angular na órbita em graus.',
  Velocidade: 'Velocidade angular em radianos por milissegundo.',
  Período: 'Tempo para completar uma órbita inteira.',
  Sentido: 'Direção de giro — horário ou anti-horário.',
  // Pesos / império
  Agressão: 'Quanto o dono prioriza ações ofensivas.',
  Expansão: 'Quanto prioriza colonizar planetas neutros.',
  Economia: 'Quanto investe em fábricas e infraestrutura.',
  Ciência: 'Quanto investe em pesquisa.',
  Defesa: 'Quanto constrói torretas e força defensiva.',
  Vingança: 'Quanto pune quem o atacou por último.',
  // Império (IA)
  Força: 'Multiplicador de poder — escala produção, velocidade e frota da IA.',
  'Frota máxima': 'Limite superior de naves simultâneas da IA.',
  'Mín. p/ atacar': 'Tamanho mínimo de frota antes de a IA lançar um ataque.',
  'Paciência (ticks)': 'Quantos ticks a IA espera antes de começar ações agressivas.',
  'Primeiro contato': 'Quando o jogador observou a facção pela primeira vez.',
  'Planetas controlados': 'Planetas desta facção no mundo inteiro.',
  'Naves ativas': 'Naves da facção em circulação agora.',
  // Identidade / estado
  Descoberto: 'Se o jogador já descobriu este planeta (sai da névoa de guerra).',
  Visão: 'Se o planeta está sob visão direta ou só memória.',
  Visível: 'Estado da visão atual: direta ou reconstruída por memória.',
  Observação: 'Quando foi a última vez que o planeta foi observado.',
  // Fila
  Slots: 'Itens ocupados / máximo da fila de produção.',
  Loop: 'Quando ON, itens completados retornam automaticamente à fila.',
};

const LABEL_NAVE: Record<string, string> = {
  colonizadora: 'Colonizadora',
  cargueira: 'Cargueira',
  batedora: 'Batedora',
  torreta: 'Torreta',
  fragata: 'Fragata',
};

function rotuloNave(n: Nave): string {
  const nome = LABEL_NAVE[n.tipo] ?? n.tipo;
  return n.tipo === 'colonizadora' ? nome : `${nome} T${n.tier}`;
}

function fmtMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const min = Math.floor(s / 60);
  const rest = Math.round(s - min * 60);
  return `${min}m${String(rest).padStart(2, '0')}s`;
}

function fmtTempoAtras(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h}h${String(m % 60).padStart(2, '0')}`;
}

function rotuloAcaoFila(acao: string): string {
  const parsed = parseAcaoNave(acao);
  if (parsed) {
    const nome = LABEL_NAVE[parsed.tipo] ?? parsed.tipo;
    return parsed.tipo === 'colonizadora' ? nome : `${nome} T${parsed.tier}`;
  }
  if (acao === 'fabrica') return 'Fábrica';
  if (acao === 'infraestrutura') return 'Infraestrutura';
  return acao;
}

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
// Remember which planet the current portrait was built for. Rebuilding
// every refreshContent() tick was destroying the sprite and making a
// fresh one with a new random uRotation — the visual symptom was the
// planet "girando loucamente" (jumping to a random angle 60x/sec).
// Keeping the sprite alive lets atualizarTempoPlanetas advance its
// uTime/uRotation smoothly between refreshes.
let _portraitForPlanet: Planeta | null = null;
let _portraitTickerCb: ((t: Ticker) => void) | null = null;

type TabId = 'resumo' | 'imperio' | 'orbita' | 'pesquisa' | 'registro' | 'historia';
const TABS: Array<{ id: TabId; label: string; tip: string }> = [
  { id: 'resumo', label: 'Resumo', tip: 'Recursos, infraestrutura e fila de produção.' },
  { id: 'imperio', label: 'Império', tip: 'Informações sobre o dono do planeta.' },
  { id: 'orbita', label: 'Órbita', tip: 'Posição, sistema solar e vizinhança.' },
  { id: 'pesquisa', label: 'Pesquisa', tip: 'Árvore de tecnologias pesquisadas.' },
  { id: 'registro', label: 'Registro', tip: 'Memória, batalhas e eventos recentes.' },
  { id: 'historia', label: 'História', tip: 'Lore procedural do planeta.' },
];
let _activeTab: TabId = 'resumo';
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
      padding-right: calc(var(--hud-unit) * 0.2);
    }
    .pd-left {
      overflow-y: auto;
    }
    .pd-right {
      overflow: hidden;
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

    /* ─ Fila de produção ─ */
    .pd-fila-list {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.3);
      position: relative;
    }
    .pd-fila-item {
      display: grid;
      grid-template-columns: calc(var(--hud-unit) * 1) calc(var(--hud-unit) * 1.1) 1fr auto calc(var(--hud-unit) * 1.1);
      align-items: center;
      gap: calc(var(--hud-unit) * 0.4);
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.5);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.55);
      background: rgba(255, 255, 255, 0.02);
      font-size: calc(var(--hud-unit) * 0.78);
      min-width: 0;
      transition: transform 180ms ease, box-shadow 160ms ease, opacity 160ms;
    }
    .pd-fila-item.fila-dragging {
      z-index: 10;
      opacity: 0.92;
      box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1) rgba(0, 0, 0, 0.7);
      transition: none;
      cursor: grabbing;
      position: relative;
    }
    .pd-fila-diag {
      margin-top: calc(var(--hud-unit) * 0.35);
      padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 0.6);
      border: 1px solid rgba(255, 180, 120, 0.45);
      background: rgba(255, 180, 120, 0.08);
      border-radius: calc(var(--hud-radius) * 0.5);
      color: rgba(255, 210, 170, 0.95);
      font-size: calc(var(--hud-unit) * 0.74);
      line-height: 1.35;
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.4);
    }
    .pd-fila-diag::before {
      content: '⏸';
      color: rgba(255, 200, 140, 0.9);
    }
    .pd-fila-item.is-active {
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.06);
    }
    .pd-fila-idx {
      color: var(--hud-text-dim);
      font-size: calc(var(--hud-unit) * 0.7);
      letter-spacing: 0.08em;
      text-align: right;
    }
    .pd-fila-item.is-active .pd-fila-idx {
      color: var(--hud-text);
    }
    .pd-fila-name {
      overflow-wrap: anywhere;
      line-height: 1.25;
    }
    .pd-fila-pct {
      color: var(--hud-text-dim);
      font-variant-numeric: tabular-nums;
      font-size: calc(var(--hud-unit) * 0.72);
    }
    .pd-fila-item.is-active .pd-fila-pct {
      color: var(--hud-text);
    }
    .pd-fila-bar {
      grid-column: 1 / -1;
      height: calc(var(--hud-unit) * 0.18);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
      margin-top: calc(var(--hud-unit) * 0.25);
    }
    .pd-fila-bar-fill {
      height: 100%;
      background: rgba(255, 255, 255, 0.65);
      border-radius: inherit;
      transition: width 200ms linear;
    }
    .pd-fila-footer {
      display: flex;
      justify-content: space-between;
      gap: calc(var(--hud-unit) * 0.5);
      margin-top: calc(var(--hud-unit) * 0.2);
      font-size: calc(var(--hud-unit) * 0.7);
      color: var(--hud-text-dim);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pd-fila-footer .on { color: var(--hud-text); }

    /* ─ Tabs ─ */
    .pd-tabs {
      display: flex;
      gap: calc(var(--hud-unit) * 0.2);
      padding-bottom: calc(var(--hud-unit) * 0.5);
      border-bottom: 1px solid var(--hud-line);
      margin-bottom: calc(var(--hud-unit) * 0.6);
      flex-wrap: wrap;
    }
    .pd-tab-btn {
      appearance: none;
      background: transparent;
      border: 1px solid transparent;
      border-radius: calc(var(--hud-radius) * 0.5);
      color: var(--hud-text-dim);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.75);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 0.7);
      cursor: pointer;
      transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
    }
    .pd-tab-btn:hover {
      color: var(--hud-text);
      background: rgba(255, 255, 255, 0.04);
    }
    .pd-tab-btn.active {
      color: var(--hud-text);
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.08);
    }
    .pd-tab-content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.8);
      overflow-y: auto;
      padding-right: calc(var(--hud-unit) * 0.2);
    }
    .pd-tab-content.pd-entering {
      animation: pd-tab-swap 260ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
    }
    @keyframes pd-tab-swap {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ─ Pesquisa tree ─ */
    .pd-pesq-tree {
      display: grid;
      grid-template-columns: auto repeat(5, 1fr);
      gap: calc(var(--hud-unit) * 0.25);
      align-items: center;
      font-size: calc(var(--hud-unit) * 0.75);
    }
    .pd-pesq-tree .cat-name {
      color: var(--hud-text-dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: calc(var(--hud-unit) * 0.68);
      padding-right: calc(var(--hud-unit) * 0.4);
    }
    .pd-pesq-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      height: calc(var(--hud-unit) * 1.1);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.4);
      color: var(--hud-text-dim);
      font-variant-numeric: tabular-nums;
      font-size: calc(var(--hud-unit) * 0.7);
      background: rgba(255, 255, 255, 0.02);
    }
    .pd-pesq-cell.done {
      color: var(--hud-text);
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.08);
    }
    .pd-pesq-cell.active {
      color: var(--hud-text);
      border-color: rgba(255, 255, 255, 0.5);
      background: rgba(255, 255, 255, 0.14);
      animation: pd-pulse 1.4s ease-in-out infinite;
    }
    @keyframes pd-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    /* ─ Lore ─ */
    .pd-lore-slogan {
      font-size: calc(var(--hud-unit) * 0.9);
      font-style: italic;
      color: var(--hud-text);
      line-height: 1.5;
      padding-bottom: calc(var(--hud-unit) * 0.4);
      border-bottom: 1px solid var(--hud-line);
      margin-bottom: calc(var(--hud-unit) * 0.2);
    }
    .pd-lore-block {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.18);
    }
    .pd-lore-label {
      font-size: calc(var(--hud-unit) * 0.68);
      color: var(--hud-text-dim);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .pd-lore-text {
      font-size: calc(var(--hud-unit) * 0.82);
      color: var(--hud-text);
      line-height: 1.5;
    }
    .pd-lore-note {
      font-style: italic;
      color: var(--hud-text-dim);
      font-size: calc(var(--hud-unit) * 0.78);
      line-height: 1.5;
      padding-top: calc(var(--hud-unit) * 0.3);
      border-top: 1px solid var(--hud-line);
    }

    /* ─ Chips (naves em órbita / trânsito, vizinhos) ─ */
    .pd-chips {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--hud-unit) * 0.3);
    }
    .pd-chip {
      display: inline-flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.3);
      padding: calc(var(--hud-unit) * 0.22) calc(var(--hud-unit) * 0.55);
      border: 1px solid var(--hud-line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.03);
      font-size: calc(var(--hud-unit) * 0.72);
      color: var(--hud-text);
    }
    .pd-chip .dot {
      width: calc(var(--hud-unit) * 0.45);
      height: calc(var(--hud-unit) * 0.45);
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }
    .pd-chip .chip-count {
      color: var(--hud-text-dim);
      font-variant-numeric: tabular-nums;
    }

    /* ─ Barras de peso (empire) ─ */
    .pd-weight-row {
      display: grid;
      grid-template-columns: calc(var(--hud-unit) * 4.5) 1fr calc(var(--hud-unit) * 2);
      align-items: center;
      gap: calc(var(--hud-unit) * 0.5);
      font-size: calc(var(--hud-unit) * 0.75);
    }
    .pd-weight-row .label {
      color: var(--hud-text-dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: calc(var(--hud-unit) * 0.68);
    }
    .pd-weight-bar {
      position: relative;
      height: calc(var(--hud-unit) * 0.3);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
    }
    .pd-weight-fill {
      position: absolute;
      top: 0; bottom: 0; left: 0;
      background: rgba(255, 255, 255, 0.55);
      border-radius: inherit;
    }
    .pd-weight-row .num {
      color: var(--hud-text);
      font-variant-numeric: tabular-nums;
      text-align: right;
      font-size: calc(var(--hud-unit) * 0.72);
    }

    /* ─ Registro (eventos/batalhas) ─ */
    .pd-log-list {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.3);
    }
    .pd-log-item {
      padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 0.55);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      background: rgba(255, 255, 255, 0.02);
      font-size: calc(var(--hud-unit) * 0.76);
      line-height: 1.45;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.15);
    }
    .pd-log-head {
      display: flex;
      justify-content: space-between;
      gap: calc(var(--hud-unit) * 0.4);
      color: var(--hud-text-dim);
      font-size: calc(var(--hud-unit) * 0.68);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pd-log-body { color: var(--hud-text); overflow-wrap: anywhere; }
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

function buildSectionFila(p: Planeta): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Fila de Produção';
  sec.appendChild(title);

  const d = p.dados;
  const fila = d.filaProducao;
  const headLocked = d.construcaoAtual !== null || d.producaoNave !== null;

  if (fila.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pd-empty';
    empty.textContent = 'Fila vazia';
    sec.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'pd-fila-list';

    fila.slice(0, 5).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'pd-fila-item';
      row.dataset.filaIdx = String(idx);
      const isHeadActive = idx === 0 && headLocked;
      if (isHeadActive) row.classList.add('is-active');

      const handle = document.createElement('div');
      handle.className = 'fila-drag-handle';
      if (isHeadActive) handle.classList.add('locked');
      handle.textContent = '⋮⋮';
      handle.title = isHeadActive ? 'Item em produção — não pode ser movido' : 'Arrastar para reordenar';

      const idxEl = document.createElement('div');
      idxEl.className = 'pd-fila-idx';
      idxEl.textContent = isHeadActive ? '>>' : `${idx + 1}.`;

      const nameEl = document.createElement('div');
      nameEl.className = 'pd-fila-name';
      nameEl.textContent = rotuloAcaoFila(item.acao);

      const pctEl = document.createElement('div');
      pctEl.className = 'pd-fila-pct';

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
        if (removerItemFila(p, currentIdx)) refreshContent();
      });

      row.append(handle, idxEl, nameEl, pctEl, removeBtn);

      if (isHeadActive && pct !== null) {
        const bar = document.createElement('div');
        bar.className = 'pd-fila-bar';
        const fill = document.createElement('div');
        fill.className = 'pd-fila-bar-fill';
        fill.style.width = `${pct}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      }

      list.appendChild(row);
    });

    sec.appendChild(list);

    bindFilaDragDrop(list, {
      itemSelector: '.pd-fila-item',
      handleSelector: '.fila-drag-handle',
      getIdx: (el) => Number(el.dataset.filaIdx ?? -1),
      isLocked: (idx) => headLocked && idx === 0,
      onReorder: (from, to) => {
        if (moverItemFila(p, from, to)) refreshContent();
      },
    });
  }

  const diag = diagnosticarFila(p);
  if (diag) {
    const diagEl = document.createElement('div');
    diagEl.className = 'pd-fila-diag';
    diagEl.textContent = diag;
    sec.appendChild(diagEl);
  }

  const footer = document.createElement('div');
  footer.className = 'pd-fila-footer';
  const slots = document.createElement('span');
  slots.textContent = `Slots ${fila.length}/5`;
  const loop = document.createElement('span');
  loop.textContent = `Loop: ${d.repetirFilaProducao ? 'ON' : 'OFF'}`;
  if (d.repetirFilaProducao) loop.classList.add('on');
  footer.append(slots, loop);
  sec.appendChild(footer);

  return sec;
}

function buildSectionNavesOrbita(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Naves em Órbita';
  sec.appendChild(title);

  const naves = mundo.naves.filter((n) => n.estado === 'orbitando' && n.alvo === p);
  if (naves.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pd-empty';
    empty.textContent = 'Nenhuma nave em órbita';
    sec.appendChild(empty);
    return sec;
  }

  // Group by (dono, rotuloNave) → count.
  const grupos = new Map<string, { dono: string; rotulo: string; count: number }>();
  for (const n of naves) {
    const key = `${n.dono}::${rotuloNave(n)}`;
    const ex = grupos.get(key);
    if (ex) ex.count++;
    else grupos.set(key, { dono: n.dono, rotulo: rotuloNave(n), count: 1 });
  }

  const chips = document.createElement('div');
  chips.className = 'pd-chips';
  for (const g of grupos.values()) {
    const chip = document.createElement('div');
    chip.className = 'pd-chip';
    chip.title = nomeDono(g.dono);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = corDono(g.dono);
    chip.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = g.rotulo;
    chip.appendChild(label);
    const cnt = document.createElement('span');
    cnt.className = 'chip-count';
    cnt.textContent = `×${g.count}`;
    chip.appendChild(cnt);
    chips.appendChild(chip);
  }
  sec.appendChild(chips);
  return sec;
}

function buildSectionNavesTransito(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Em Trânsito';
  sec.appendChild(title);

  const naves = mundo.naves.filter((n) => n.estado === 'viajando' && n.alvo === p);
  if (naves.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pd-empty';
    empty.textContent = 'Nenhuma nave a caminho';
    sec.appendChild(empty);
    return sec;
  }

  const chips = document.createElement('div');
  chips.className = 'pd-chips';
  const grupos = new Map<string, { dono: string; rotulo: string; count: number }>();
  for (const n of naves) {
    const key = `${n.dono}::${rotuloNave(n)}`;
    const ex = grupos.get(key);
    if (ex) ex.count++;
    else grupos.set(key, { dono: n.dono, rotulo: rotuloNave(n), count: 1 });
  }
  for (const g of grupos.values()) {
    const chip = document.createElement('div');
    chip.className = 'pd-chip';
    chip.title = nomeDono(g.dono);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = corDono(g.dono);
    chip.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = g.rotulo;
    chip.appendChild(label);
    const cnt = document.createElement('span');
    cnt.className = 'chip-count';
    cnt.textContent = `×${g.count}`;
    chip.appendChild(cnt);
    chips.appendChild(chip);
  }
  sec.appendChild(chips);
  return sec;
}

function buildSectionProximoUpgrade(p: Planeta): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Próximos Upgrades';
  sec.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pd-kv-grid';

  const custoFab = calcularCustoTier(p.dados.fabricas);
  const tempoFab = calcularTempoConstrucaoMs(p.dados.fabricas);
  const custoInf = calcularCustoTier(p.dados.infraestrutura);
  const tempoInf = calcularTempoConstrucaoMs(p.dados.infraestrutura);

  const rows: Array<[string, string]> = [
    [
      `Fábrica T${p.dados.fabricas + 1}`,
      custoFab !== null && tempoFab !== null
        ? `${fmtNum(custoFab)} comum · ${fmtMs(tempoFab)}`
        : 'Tier máximo',
    ],
    [
      `Infraestrutura T${p.dados.infraestrutura + 1}`,
      custoInf !== null && tempoInf !== null
        ? `${fmtNum(custoInf)} comum · ${fmtMs(tempoInf)}`
        : 'Tier máximo',
    ],
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

function buildSectionImperio(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Império';
  sec.appendChild(title);

  const dono = p.dados.dono;

  if (dono === 'neutro') {
    const empty = document.createElement('div');
    empty.className = 'pd-empty';
    empty.textContent = 'Planeta não colonizado — sem domínio, sem bandeira.';
    sec.appendChild(empty);
    return sec;
  }

  const planetasDoDono = mundo.planetas.filter((x) => x.dados.dono === dono).length;
  const navesDoDono = mundo.naves.filter((x) => x.dono === dono).length;

  const grid = document.createElement('div');
  grid.className = 'pd-kv-grid';

  const rows: Array<[string, string | Node]> = [];

  // Nome + cor dot
  const header = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'pd-owner-dot';
  dot.style.background = corDono(dono);
  header.append(dot, document.createTextNode(nomeDono(dono)));
  rows.push(['Domínio', header]);

  let pesos: { agressao: number; expansao: number; economia: number; ciencia: number; defesa: number; vinganca: number } | null = null;
  let arquetipo: string | null = null;
  let objetivo: string | null = null;
  let naveFavorita: string | null = null;
  let forca: number | null = null;
  let frotaMax: number | null = null;
  let frotaMinAtaque: number | null = null;
  let paciencia: number | null = null;
  let loreText: string | null = null;

  if (dono === 'jogador') {
    const imp = mundo.imperioJogador;
    if (imp) {
      pesos = imp.pesos;
      arquetipo = inferirArquetipo(imp.pesos);
      objetivo = imp.objetivo;
      rows.push(['Bônus produção', imp.bonus.producao ? `+${Math.round((imp.bonus.producao - 1) * 100)}%` : '—']);
      if (imp.bonus.fabricasIniciais) rows.push(['Fábricas iniciais', String(imp.bonus.fabricasIniciais)]);
      if (imp.bonus.infraestruturaInicial) rows.push(['Infra inicial', String(imp.bonus.infraestruturaInicial)]);
      if (imp.lore) {
        const l = imp.lore;
        const pedacos: string[] = [];
        for (const s of l.secoes ?? []) {
          if (s?.paragrafos?.length) pedacos.push(s.paragrafos.join(' '));
        }
        if (pedacos.length) loreText = pedacos.join(' ');
      }
    }
  } else {
    const ia = getPersonalidades().find((x) => x.id === dono);
    if (ia) {
      pesos = ia.pesos;
      arquetipo = ia.arquetipo;
      naveFavorita = ia.naveFavorita;
      forca = ia.forca;
      frotaMax = ia.frotaMax;
      frotaMinAtaque = ia.frotaMinAtaque;
      paciencia = ia.paciencia;
      if (ia.lore) {
        loreText = `${ia.lore.ideologia} ${ia.lore.eventoMarcante} "${ia.lore.citacao}"`;
      }
      const fc = getPrimeiroContato(dono);
      if (fc !== undefined) rows.push(['Primeiro contato', fmtTempoAtras(mundo.ultimoTickMs - fc)]);
    }
  }

  if (arquetipo) rows.push(['Arquétipo', arquetipo.charAt(0).toUpperCase() + arquetipo.slice(1)]);
  if (objetivo) rows.push(['Objetivo', objetivo.charAt(0).toUpperCase() + objetivo.slice(1)]);
  if (naveFavorita) rows.push(['Nave favorita', naveFavorita.charAt(0).toUpperCase() + naveFavorita.slice(1)]);
  if (forca !== null) rows.push(['Força', forca.toFixed(2)]);
  if (frotaMax !== null) rows.push(['Frota máxima', String(frotaMax)]);
  if (frotaMinAtaque !== null) rows.push(['Mín. p/ atacar', String(frotaMinAtaque)]);
  if (paciencia !== null) rows.push(['Paciência (ticks)', String(paciencia)]);
  rows.push(['Planetas controlados', `${planetasDoDono} / ${mundo.planetas.length}`]);
  rows.push(['Naves ativas', String(navesDoDono)]);

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

  if (pesos) {
    const pesosSec = document.createElement('div');
    pesosSec.className = 'pd-section';
    pesosSec.style.marginTop = '0';
    const pt = document.createElement('h3');
    pt.className = 'pd-section-title';
    pt.textContent = 'Pesos de Decisão';
    pesosSec.appendChild(pt);
    const list: Array<[string, number]> = [
      ['Agressão', pesos.agressao],
      ['Expansão', pesos.expansao],
      ['Economia', pesos.economia],
      ['Ciência', pesos.ciencia],
      ['Defesa', pesos.defesa],
      ['Vingança', pesos.vinganca],
    ];
    for (const [label, val] of list) {
      const row = document.createElement('div');
      row.className = 'pd-weight-row';
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = label;
      const bar = document.createElement('div');
      bar.className = 'pd-weight-bar';
      const fill = document.createElement('div');
      fill.className = 'pd-weight-fill';
      // Pesos ficam roughly 0..1.5. Normalizamos em 1.5 pra barra cheia.
      const pct = Math.max(0, Math.min(100, (val / 1.5) * 100));
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = val.toFixed(2);
      row.append(l, bar, num);
      pesosSec.appendChild(row);
    }
    // buildSection* returns a single HTMLDivElement, but here we have
    // two logical sections (header grid + weights). Wrap both in a
    // flex column so the tab-content stacks them like normal siblings.
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = 'calc(var(--hud-unit) * 0.8)';
    container.appendChild(sec);
    container.appendChild(pesosSec);

    if (loreText) {
      const note = document.createElement('div');
      note.className = 'pd-lore-note';
      note.textContent = loreText;
      container.appendChild(note);
    }
    return container;
  }

  if (loreText) {
    const note = document.createElement('div');
    note.className = 'pd-lore-note';
    note.style.marginTop = 'calc(var(--hud-unit) * 0.4)';
    note.textContent = loreText;
    sec.appendChild(note);
  }

  return sec;
}

function buildSectionRegistro(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Registro';
  sec.appendChild(title);

  const agora = mundo.ultimoTickMs;

  // Memória do fog-of-war
  const mem = getMemoria(p);
  const memWrap = document.createElement('div');
  memWrap.className = 'pd-kv-grid';
  if (p._visivelAoJogador) {
    const k = document.createElement('div'); k.className = 'k'; k.textContent = 'Observação';
    const v = document.createElement('div'); v.className = 'v'; v.textContent = 'Em tempo real';
    memWrap.append(k, v);
  } else if (mem?.dados) {
    const age = performance.now() - mem.dados.timestamp;
    const k1 = document.createElement('div'); k1.className = 'k'; k1.textContent = 'Última memória';
    const v1 = document.createElement('div'); v1.className = 'v'; v1.textContent = fmtTempoAtras(age);
    memWrap.append(k1, v1);
    const k2 = document.createElement('div'); k2.className = 'k'; k2.textContent = 'Dono (memória)';
    const v2 = document.createElement('div'); v2.className = 'v';
    const dot = document.createElement('span');
    dot.className = 'pd-owner-dot';
    dot.style.background = corDono(mem.dados.dados.dono);
    v2.append(dot, document.createTextNode(nomeDono(mem.dados.dados.dono)));
    memWrap.append(k2, v2);
    const k3 = document.createElement('div'); k3.className = 'k'; k3.textContent = 'Naves vistas';
    const v3 = document.createElement('div'); v3.className = 'v'; v3.textContent = String(mem.dados.dados.naves ?? 0);
    memWrap.append(k3, v3);
  } else {
    const k = document.createElement('div'); k.className = 'k'; k.textContent = 'Observação';
    const v = document.createElement('div'); v.className = 'v'; v.textContent = 'Nunca observado';
    memWrap.append(k, v);
  }
  sec.appendChild(memWrap);

  // Batalhas
  const battles = getBattles().filter((b) => b.localPlanetaId === p.id);
  const battlesBlock = document.createElement('div');
  battlesBlock.className = 'pd-lore-block';
  const bLabel = document.createElement('div');
  bLabel.className = 'pd-lore-label';
  bLabel.textContent = `Batalhas aqui (${battles.length})`;
  battlesBlock.appendChild(bLabel);
  if (battles.length === 0) {
    const e = document.createElement('div');
    e.className = 'pd-empty';
    e.textContent = 'Nenhuma batalha registrada.';
    battlesBlock.appendChild(e);
  } else {
    const list = document.createElement('div');
    list.className = 'pd-log-list';
    for (const b of battles.slice(-10).reverse()) {
      const item = document.createElement('div');
      item.className = 'pd-log-item';
      const head = document.createElement('div');
      head.className = 'pd-log-head';
      const left = document.createElement('span');
      left.textContent = b.vencedor === 'atacante' ? 'Atacante venceu'
        : b.vencedor === 'defensor' ? 'Defensor venceu'
        : 'Empate';
      const right = document.createElement('span');
      right.textContent = fmtTempoAtras(agora - b.tempoMs);
      head.append(left, right);
      const body = document.createElement('div');
      body.className = 'pd-log-body';
      body.textContent = `${nomeDono(b.atacante)} × ${nomeDono(b.defensor)} — perdas ${b.perdasAtacante}/${b.perdasDefensor}`;
      item.append(head, body);
      list.appendChild(item);
    }
    battlesBlock.appendChild(list);
  }
  sec.appendChild(battlesBlock);

  // Eventos (filtro por id ou nome do planeta)
  const nome = p.dados.nome.toLowerCase();
  const eventos = getEventos().filter((e) => {
    if (e.texto.toLowerCase().includes(nome)) return true;
    if (e.payload) {
      for (const v of Object.values(e.payload)) {
        if (typeof v === 'string' && (v === p.id || v.toLowerCase() === nome)) return true;
      }
    }
    return false;
  });
  const evBlock = document.createElement('div');
  evBlock.className = 'pd-lore-block';
  const eLabel = document.createElement('div');
  eLabel.className = 'pd-lore-label';
  eLabel.textContent = `Eventos (${eventos.length})`;
  evBlock.appendChild(eLabel);
  if (eventos.length === 0) {
    const e = document.createElement('div');
    e.className = 'pd-empty';
    e.textContent = 'Nada registrado.';
    evBlock.appendChild(e);
  } else {
    const list = document.createElement('div');
    list.className = 'pd-log-list';
    for (const e of eventos.slice(-10).reverse()) {
      const item = document.createElement('div');
      item.className = 'pd-log-item';
      const head = document.createElement('div');
      head.className = 'pd-log-head';
      const left = document.createElement('span'); left.textContent = e.tipo;
      const right = document.createElement('span'); right.textContent = fmtTempoAtras(agora - e.tempoMs);
      head.append(left, right);
      const body = document.createElement('div');
      body.className = 'pd-log-body';
      body.textContent = e.texto;
      item.append(head, body);
      list.appendChild(item);
    }
    evBlock.appendChild(list);
  }
  sec.appendChild(evBlock);

  return sec;
}

function buildSectionOrbita(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Órbita & Geografia';
  sec.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pd-kv-grid';

  const porte = p.dados.tamanho >= 280 ? 'Gigante'
    : p.dados.tamanho >= 220 ? 'Grande'
    : p.dados.tamanho >= 170 ? 'Médio'
    : 'Modesto';

  const o = p._orbita;
  const anguloDeg = (((o.angulo * 180 / Math.PI) % 360) + 360) % 360;
  const velAbs = Math.abs(o.velocidade);
  const periodoMs = velAbs > 0 ? (2 * Math.PI) / velAbs : Infinity;
  const periodoS = isFinite(periodoMs) ? (periodoMs / 1000).toFixed(1) : '∞';
  const sentido = o.velocidade >= 0 ? 'Horário' : 'Anti-horário';

  const sistema = mundo.sistemas[p.dados.sistemaId];
  const sol = sistema?.sol;
  const distSol = sol ? Math.hypot(p.x - sol.x, p.y - sol.y) : null;

  const rows: Array<[string, string]> = [
    ['Sistema', nomeSistema(mundo, p.dados.sistemaId)],
    ['Porte', porte],
    ['Tamanho', `${Math.round(p.dados.tamanho)} u`],
    ['Raio orbital', `${Math.round(o.raio)} u`],
    ['Distância do sol', distSol !== null ? `${Math.round(distSol)} u` : '—'],
    ['Ângulo atual', `${anguloDeg.toFixed(1)}°`],
    ['Velocidade', `${velAbs.toFixed(4)} rad/ms`],
    ['Período', `${periodoS} s`],
    ['Sentido', sentido],
    ['Descoberto', p._descobertoAoJogador ? 'Sim' : 'Não'],
    ['Visão', p._visivelAoJogador ? 'Direta' : 'Memória'],
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

  // Vizinhos no sistema
  const vizinhos = sistema ? sistema.planetas.filter((x) => x !== p) : [];
  const vizWrap = document.createElement('div');
  vizWrap.className = 'pd-lore-block';
  vizWrap.style.marginTop = 'calc(var(--hud-unit) * 0.4)';
  const vizLabel = document.createElement('div');
  vizLabel.className = 'pd-lore-label';
  vizLabel.textContent = `Vizinhos no sistema (${vizinhos.length})`;
  vizWrap.appendChild(vizLabel);
  if (vizinhos.length === 0) {
    const e = document.createElement('div');
    e.className = 'pd-empty';
    e.textContent = 'Único planeta do sistema.';
    vizWrap.appendChild(e);
  } else {
    const chips = document.createElement('div');
    chips.className = 'pd-chips';
    for (const v of vizinhos) {
      const chip = document.createElement('div');
      chip.className = 'pd-chip';
      chip.title = `${nomeTipoPlaneta(v.dados.tipoPlaneta)} · ${nomeDono(v.dados.dono)}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = corDono(v.dados.dono);
      chip.appendChild(dot);
      const label = document.createElement('span');
      label.textContent = v.dados.nome;
      chip.appendChild(label);
      chips.appendChild(chip);
    }
    vizWrap.appendChild(chips);
  }
  sec.appendChild(vizWrap);

  return sec;
}

const PESQ_CATEGORIAS: Array<{ id: string; label: string }> = [
  { id: 'cargueira', label: 'Cargueira' },
  { id: 'batedora', label: 'Batedora' },
  { id: 'torreta', label: 'Torreta' },
  { id: 'fragata', label: 'Fragata' },
];

function buildSectionPesquisaCompleta(p: Planeta): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';
  const title = document.createElement('h3');
  title.className = 'pd-section-title';
  title.textContent = 'Árvore de Pesquisa';
  sec.appendChild(title);

  if (p.dados.pesquisaAtual) {
    const pa = p.dados.pesquisaAtual;
    const pct = 100 - Math.round((pa.tempoRestanteMs / pa.tempoTotalMs) * 100);
    const active = document.createElement('div');
    active.className = 'pd-fila-item is-active';
    const idxEl = document.createElement('div');
    idxEl.className = 'pd-fila-idx';
    idxEl.textContent = '●';
    const nameEl = document.createElement('div');
    nameEl.className = 'pd-fila-name';
    const catLabel = PESQ_CATEGORIAS.find((c) => c.id === pa.categoria)?.label ?? pa.categoria;
    nameEl.textContent = `${catLabel} T${pa.tier}`;
    const pctEl = document.createElement('div');
    pctEl.className = 'pd-fila-pct';
    pctEl.textContent = `${pct}%`;
    const bar = document.createElement('div');
    bar.className = 'pd-fila-bar';
    const fill = document.createElement('div');
    fill.className = 'pd-fila-bar-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    active.append(idxEl, nameEl, pctEl, bar);
    sec.appendChild(active);
  }

  const tree = document.createElement('div');
  tree.className = 'pd-pesq-tree';

  const header = document.createElement('div');
  header.className = 'cat-name';
  header.textContent = '';
  tree.appendChild(header);
  for (let t = 1; t <= 5; t++) {
    const th = document.createElement('div');
    th.className = 'cat-name';
    th.style.textAlign = 'center';
    th.textContent = `T${t}`;
    tree.appendChild(th);
  }

  for (const cat of PESQ_CATEGORIAS) {
    const label = document.createElement('div');
    label.className = 'cat-name';
    label.textContent = cat.label;
    tree.appendChild(label);
    const tiers = p.dados.pesquisas[cat.id] ?? [];
    for (let t = 1; t <= 5; t++) {
      const cell = document.createElement('div');
      cell.className = 'pd-pesq-cell';
      const done = !!tiers[t - 1];
      const active = p.dados.pesquisaAtual?.categoria === cat.id && p.dados.pesquisaAtual?.tier === t;
      if (done) cell.classList.add('done');
      if (active) cell.classList.add('active');
      cell.textContent = done ? '✓' : (active ? '…' : '—');
      tree.appendChild(cell);
    }
  }

  sec.appendChild(tree);
  return sec;
}

function buildSectionHistoria(p: Planeta, mundo: Mundo): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'pd-section';

  const personalidades = getPersonalidades();
  const donoIA = personalidades.find((x) => x.id === p.dados.dono);
  const lore = gerarPlanetaLore({
    planetaId: p.id,
    galaxySeed: mundo.galaxySeed,
    tipo: p.dados.tipoPlaneta,
    dono: p.dados.dono,
    nomePlaneta: p.dados.nome,
    donoNome: donoIA?.nome ?? (p.dados.dono === 'jogador' ? mundo.imperioJogador?.nome : undefined),
    donoArquetipo: donoIA?.arquetipo,
    tamanho: p.dados.tamanho,
    sistemaNome: nomeSistema(mundo, p.dados.sistemaId),
  });

  const slogan = document.createElement('div');
  slogan.className = 'pd-lore-slogan';
  slogan.textContent = lore.slogan;
  sec.appendChild(slogan);

  const blocks: Array<[string, string]> = [
    ['Geologia', lore.geologia],
    ['Paisagens', lore.biomas],
  ];

  if (lore.civOriginal) {
    const c = lore.civOriginal;
    blocks.push([
      'Civilização original',
      `${c.descricao.charAt(0).toUpperCase()}${c.descricao.slice(1)}. Há cerca de ${c.idadeEstimada.toLocaleString('pt-BR')} ciclos, ${c.destino}.`,
    ]);
  }

  if (lore.colonizacao) {
    const co = lore.colonizacao;
    const anoText = co.ano < 0 ? `Há ${Math.abs(co.ano).toLocaleString('pt-BR')} ciclos` : 'Em passado recente';
    blocks.push(['Colonização', `${anoText}, por ${co.fundador}, ${co.motivo}.`]);
  }

  blocks.push(['Costumes', lore.costumes]);
  blocks.push(['Religião', lore.religiao]);
  blocks.push(['Economia', lore.economia]);

  if (lore.profissoesDominantes.length > 0) {
    blocks.push(['Profissões dominantes', lore.profissoesDominantes.join(', ') + '.']);
  }

  if (lore.tensao) {
    blocks.push(['Tensões', lore.tensao]);
  }

  for (const [label, text] of blocks) {
    const block = document.createElement('div');
    block.className = 'pd-lore-block';
    const l = document.createElement('div');
    l.className = 'pd-lore-label';
    l.textContent = label;
    const t = document.createElement('div');
    t.className = 'pd-lore-text';
    t.textContent = text;
    block.append(l, t);
    sec.appendChild(block);
  }

  const nota = document.createElement('div');
  nota.className = 'pd-lore-note';
  nota.textContent = lore.nota;
  sec.appendChild(nota);

  // Highlight personality/objective keywords in the prose with tooltips
  // that trace back to pesos / objetivos / arquétipos.
  aplicarTooltipsLore(sec);

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

  // Mount canvas on the host every call (refreshContent may have
  // detached it via replaceChildren); cheap no-op when already there.
  if (app.canvas.parentElement !== host) {
    host.replaceChildren(app.canvas);
  }

  // Only rebuild the planet mesh when the displayed planet actually
  // changes. Otherwise we keep the same sprite and let the ticker
  // advance its uTime/uRotation uniforms — matching how the real
  // world animates planets.
  if (_portraitForPlanet !== p) {
    if (_portraitSprite) {
      cont.removeChild(_portraitSprite);
      _portraitSprite.destroy({ children: true });
      _portraitSprite = null;
    }
    const size = 220;
    // Use the planet's _visualSeed so the portrait matches the real
    // shader output (same palette, same starting rotation + rotSpeed).
    // Sem isso o modal gera uma paleta/rotação aleatória a cada abertura
    // e o desenho nunca bate com o planeta no mundo.
    const portraitRng = p._visualSeed != null ? rngFromSeed(p._visualSeed) : undefined;
    const sprite = criarPlanetaProceduralSprite(128, 128, size, p.dados.tipoPlaneta, undefined, portraitRng);
    cont.addChild(sprite as unknown as Container);
    _portraitSprite = sprite as unknown as Container;
    _portraitForPlanet = p;
  }

  if (!_portraitTickerCb) {
    _portraitTickerCb = (t: Ticker) => {
      if (!_portraitSprite) return;
      atualizarTempoPlanetas([_portraitSprite], t.deltaMS);
    };
    app.ticker.add(_portraitTickerCb);
  }
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

  // Left: portrait + identity. Keep the portrait host DOM node alive
  // across refreshes so its Pixi canvas child (and ticker animation)
  // stay mounted — rebuilding would remount and reset the spin state.
  const left = _modal.querySelector<HTMLDivElement>('.pd-left');
  if (left) {
    let portrait = left.querySelector<HTMLDivElement>('.pd-portrait');
    if (!portrait) {
      portrait = document.createElement('div');
      portrait.className = 'pd-portrait';
    }
    left.replaceChildren(portrait);
    if (mundo) left.appendChild(buildSectionIdentidade(p, mundo));
    void renderPortrait(portrait, p);
  }

  // Right: tabs bar + content of active tab.
  const tabsEl = _modal.querySelector<HTMLDivElement>('.pd-tabs');
  if (tabsEl) {
    tabsEl.querySelectorAll<HTMLButtonElement>('.pd-tab-btn').forEach((btn) => {
      const id = btn.dataset.tabId as TabId;
      btn.classList.toggle('active', id === _activeTab);
    });
  }

  const content = _modal.querySelector<HTMLDivElement>('.pd-tab-content');
  if (content && mundo) {
    content.replaceChildren();
    switch (_activeTab) {
      case 'resumo':
        content.appendChild(buildSectionRecursos(p));
        content.appendChild(buildSectionInfra(p));
        if (p.dados.dono === 'jogador') {
          content.appendChild(buildSectionFila(p));
          content.appendChild(buildSectionProximoUpgrade(p));
        }
        content.appendChild(buildSectionNavesOrbita(p, mundo));
        content.appendChild(buildSectionNavesTransito(p, mundo));
        break;
      case 'imperio':
        content.appendChild(buildSectionImperio(p, mundo));
        break;
      case 'orbita':
        content.appendChild(buildSectionOrbita(p, mundo));
        break;
      case 'pesquisa':
        if (p.dados.tipoPlaneta !== TIPO_PLANETA.ASTEROIDE) {
          content.appendChild(buildSectionPesquisaCompleta(p));
        } else {
          content.appendChild(buildSectionPesquisa(p));
        }
        break;
      case 'registro':
        content.appendChild(buildSectionRegistro(p, mundo));
        break;
      case 'historia':
        content.appendChild(buildSectionHistoria(p, mundo));
        break;
    }
    applyTooltips(content);
  }
  // Also cover the left pane (identidade) which shares the same key→tooltip map.
  const leftPane = _modal.querySelector<HTMLDivElement>('.pd-left');
  if (leftPane) applyTooltips(leftPane);
}

/**
 * Walks a tab-content subtree and binds custom tooltips to every `.k`
 * (key cell) whose text matches an entry in TOOLTIPS. Uses the custom
 * tooltip module so hover produces a styled floating panel and a
 * dotted underline affordance appears on the target. Native `title`
 * tooltips were felt "horriveis e mal funcionam" by the user.
 */
function applyTooltips(root: HTMLElement): void {
  const keys = root.querySelectorAll<HTMLDivElement>('.pd-kv-grid > .k');
  keys.forEach((kEl) => {
    const text = kEl.textContent?.trim() ?? '';
    const tip = TOOLTIPS[text];
    if (!tip) return;
    attachTooltip(kEl, tip, 'text');
  });
  // Weight rows have their own structure (label + bar + num) but the
  // label text matches TOOLTIPS keys too (Agressão, Expansão, etc.).
  root.querySelectorAll<HTMLDivElement>('.pd-weight-row').forEach((row) => {
    const label = row.querySelector<HTMLDivElement>('.label');
    const text = label?.textContent?.trim() ?? '';
    const tip = TOOLTIPS[text];
    if (!tip) return;
    attachTooltip(row, tip, 'box');
  });
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
  const tabs = document.createElement('div');
  tabs.className = 'pd-tabs';
  tabs.setAttribute('role', 'tablist');
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pd-tab-btn';
    btn.textContent = tab.label;
    btn.dataset.tabId = tab.id;
    btn.setAttribute('role', 'tab');
    attachTooltip(btn, tab.tip, 'box');
    btn.addEventListener('click', () => {
      if (_activeTab === tab.id) return;
      _activeTab = tab.id;
      refreshContent();
      // Re-trigger the enter animation only on tab-switch — tick
      // refreshes reuse the same .pd-tab-content node without the
      // class, so the content doesn't flash on every update.
      const content = _modal?.querySelector<HTMLDivElement>('.pd-tab-content');
      if (content) {
        content.classList.remove('pd-entering');
        void content.offsetWidth; // force reflow so the animation restarts
        content.classList.add('pd-entering');
      }
    });
    tabs.appendChild(btn);
  }
  const tabContent = document.createElement('div');
  tabContent.className = 'pd-tab-content';
  right.append(tabs, tabContent);

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
  // Suppress live refreshes while the user is dragging a fila item —
  // otherwise the tick would rebuild the section and wipe the drag state.
  if (isFilaDragging()) return;
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
  _portraitForPlanet = null;
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
    if (_portraitTickerCb) {
      try { _portraitApp.ticker.remove(_portraitTickerCb); } catch { /* noop */ }
    }
    try { _portraitApp.destroy(true, { children: true, texture: true }); } catch { /* noop */ }
    _portraitApp = null;
    _portraitContainer = null;
  }
  _portraitTickerCb = null;
  _portraitForPlanet = null;
  if (_modal) { _modal.remove(); _modal = null; }
  if (_backdrop) { _backdrop.remove(); _backdrop = null; }
}
