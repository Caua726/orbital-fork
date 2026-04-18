import { Container, Mesh, Rectangle } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Planeta } from '../types';
import { registerPlanetPanel, unregisterPlanetPanel } from './hud-layout';
import { marcarInteracaoUi } from './interacao-ui';
import { calcularTempoRestantePlaneta, getPesquisaAtual, getTierMax, limparSelecoes, nomeTipoPlaneta, obterProducaoNaturalCiclo } from '../world/mundo';
import { t } from '../core/i18n/t';
import { getPersonalidades } from '../world/ia-decisao';
import { formatarLore } from '../world/lore-faccao';
import { comTooltipHover } from './tooltip';
import { gerarPlanetaLore } from '../world/lore/planeta-lore';
import { gerarImperioLore } from '../world/lore/imperio-lore';
import { abrirImperioLore, abrirPlanetaLore } from './lore-modal';

const THUMB_REFRESH_MS = 1200;
const THUMB_SCALE = 0.45;

let _container: HTMLDivElement | null = null;
let _styleInjected = false;
let _nameEl: HTMLDivElement | null = null;
let _statusEl: HTMLDivElement | null = null;
let _rowsEl: HTMLDivElement | null = null;
let _footerEl: HTMLDivElement | null = null;
let _portraitCanvas: HTMLCanvasElement | null = null;
let _mundoRef: Mundo | null = null;
let _selectedPlanet: Planeta | null = null;
let _metaKey = '';
let _rowsKey = '';
let _footerKey = '';
let _lastThumbPlanet: Planeta | null = null;
let _lastThumbAt = 0;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .planet-panel {
      --pp-portrait: calc(var(--hud-unit) * 3.6);
      width: clamp(240px, 22vmin, 320px);
      padding: 0;
      box-sizing: border-box;
      color: var(--hud-text);
      overflow: hidden;
      font-family: var(--hud-font-body);

      top: 50%;
      right: var(--hud-margin);
      transform: translate(calc(var(--hud-unit) * 1.4), -50%);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 240ms;
    }

    .planet-panel.visible {
      transform: translate(0, -50%);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    @media (prefers-reduced-motion: reduce) {
      .planet-panel,
      .planet-panel.visible {
        transition: none;
      }
    }

    .planet-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: calc(var(--hud-unit) * 0.55) calc(var(--hud-unit) * 0.8);
      border-bottom: 1px solid var(--hud-line);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      line-height: 1;
      color: var(--hud-text-dim);
    }

    .planet-panel-close {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: var(--hud-text-md);
      line-height: 1;
      padding: 0;
      width: calc(var(--hud-unit) * 1.1);
      height: calc(var(--hud-unit) * 1.1);
      cursor: pointer;
    }

    .planet-panel-close:hover {
      color: #fff;
    }

    .planet-panel-body {
      padding: calc(var(--hud-unit) * 0.8);
    }

    .planet-panel-summary {
      display: grid;
      grid-template-columns: var(--pp-portrait) 1fr;
      gap: calc(var(--hud-unit) * 0.7);
      align-items: center;
      margin-bottom: calc(var(--hud-unit) * 0.7);
      padding-bottom: calc(var(--hud-unit) * 0.7);
      border-bottom: 1px solid var(--hud-line);
    }

    .planet-panel-portrait-wrap {
      width: var(--pp-portrait);
      height: var(--pp-portrait);
      border-radius: 50%;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--hud-line);
      background: rgba(255,255,255,0.03);
    }

    .planet-panel-portrait {
      width: 100%;
      height: 100%;
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .planet-panel-meta {
      min-width: 0;
    }

    .planet-panel-name {
      font-family: var(--hud-font-display);
      font-size: var(--hud-text-md);
      line-height: 1.2;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: calc(var(--hud-unit) * 0.25);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--hud-text);
    }

    .planet-panel-owner {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      line-height: 1;
      color: var(--hud-text-dim);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .planet-panel-owner.is-player { color: #60ccff; }
    .planet-panel-owner.is-enemy { color: #ff6666; }

    .planet-panel-rows {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.35);
    }

    .planet-panel-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: calc(var(--hud-unit) * 0.5);
      align-items: center;
    }

    .planet-panel-label {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      line-height: 1;
    }

    .planet-panel-value-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: calc(var(--hud-unit) * 0.3);
      min-width: 0;
    }

    .planet-panel-value {
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      line-height: 1;
      color: var(--hud-text);
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .planet-panel-resources {
      display: flex;
      gap: calc(var(--hud-unit) * 0.6);
      margin-top: calc(var(--hud-unit) * 0.55);
      padding-top: calc(var(--hud-unit) * 0.55);
      border-top: 1px solid var(--hud-line);
    }

    .planet-panel-resource {
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.25);
      flex: 1;
      min-width: 0;
    }

    .planet-panel-resource-icon {
      width: calc(var(--hud-unit) * 0.9);
      height: calc(var(--hud-unit) * 0.9);
      color: var(--hud-text-dim);
      flex: 0 0 auto;
    }

    .planet-panel-resource-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .planet-panel-resource-value {
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      line-height: 1;
      color: var(--hud-text);
      font-variant-numeric: tabular-nums;
    }

    .planet-panel-footer {
      margin-top: calc(var(--hud-unit) * 0.6);
      padding-top: calc(var(--hud-unit) * 0.55);
      border-top: 1px solid var(--hud-line);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      line-height: 1.5;
      color: var(--hud-text-dim);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: pre-line;
      min-height: calc(var(--hud-unit) * 1.1);
    }

    .planet-panel-footer.is-idle {
      color: var(--hud-text-faint);
    }
  `;
  document.head.appendChild(style);
}

function iconSvg(pathD: string | string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  const paths = Array.isArray(pathD) ? pathD : [pathD];

  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }

  return svg;
}

function oreIcon(): SVGSVGElement {
  return iconSvg([
    'M12 2l-3 5h6l-3-5z',
    'M6 8l-2 5 5 2 1-5-4-2z',
    'M18 8l2 5-5 2-1-5 4-2z',
    'M9 15l3 6 3-6-3-1-3 1z',
  ]);
}

function rareIcon(): SVGSVGElement {
  return iconSvg('M3 9l4-4h10l4 4-4 10H7L3 9z');
}

function fuelIcon(): SVGSVGElement {
  return iconSvg('M12 2.5c-3 4.5-6 8-6 11.5a6 6 0 0012 0c0-3.5-3-7-6-11.5z');
}

function getSelectedPlanet(mundo: Mundo): Planeta | null {
  return mundo.planetas.find((planeta) => planeta.dados.selecionado) ?? null;
}

type OwnerKind = 'player' | 'neutral' | 'enemy';

function ownerKind(owner: string): OwnerKind {
  if (owner === 'jogador') return 'player';
  if (owner === 'neutro') return 'neutral';
  return 'enemy';
}

function ownerLabel(owner: string): string {
  switch (ownerKind(owner)) {
    case 'player': return t('planet_panel.owner_player');
    case 'neutral': return t('planet_panel.owner_neutral');
    case 'enemy': return t('planet_panel.owner_enemy');
  }
}

function planetName(planeta: Planeta): string {
  return planeta.dados.nome || nomeTipoPlaneta(planeta.dados.tipoPlaneta);
}

function fmtCompact(n: number): string {
  const v = Math.floor(n);
  if (v >= 10000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTier(current: number): string {
  return `${current} / ${getTierMax()}`;
}

const NOME_NAVE_KEY: Record<string, string> = {
  colonizadora: 'nave.colonizadora',
  cargueira: 'nave.cargueira',
  combate: 'planet_panel.nave_combate',
  exploradora: 'planet_panel.nave_exploradora',
};

function nomeTipoNave(tipo: string): string {
  const key = NOME_NAVE_KEY[tipo];
  return key ? t(key) : tipo;
}

function createRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'planet-panel-row';

  const labelEl = document.createElement('div');
  labelEl.className = 'planet-panel-label';
  labelEl.textContent = label;

  const valueWrap = document.createElement('div');
  valueWrap.className = 'planet-panel-value-wrap';

  const valueEl = document.createElement('div');
  valueEl.className = 'planet-panel-value';
  valueEl.textContent = value;
  valueWrap.appendChild(valueEl);

  row.append(labelEl, valueWrap);
  return row;
}

function createResourceCell(icon: SVGSVGElement, value: number): HTMLDivElement {
  const cell = document.createElement('div');
  cell.className = 'planet-panel-resource';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'planet-panel-resource-icon';
  iconWrap.appendChild(icon);
  cell.appendChild(iconWrap);

  const valueEl = document.createElement('div');
  valueEl.className = 'planet-panel-resource-value';
  valueEl.textContent = fmtCompact(value);
  cell.appendChild(valueEl);

  return cell;
}

function renderRows(planeta: Planeta): void {
  if (!_rowsEl) return;
  _rowsEl.replaceChildren();

  const d = planeta.dados;
  const base = obterProducaoNaturalCiclo(planeta);
  const mult = d.producao || 1;
  const totalProd = (base.comum + base.raro + base.combustivel) * mult;
  const nextTickValue = formatMs(calcularTempoRestantePlaneta(planeta));

  _rowsEl.append(
    createRow(t('planet_panel.tipo'), nomeTipoPlaneta(d.tipoPlaneta)),
    createRow(t('planet_panel.fabrica'), formatTier(d.fabricas)),
    createRow(t('planet_panel.infra'), formatTier(d.infraestrutura)),
    createRow(t('planet_panel.naves'), String(d.naves)),
    createRow(t('planet_panel.producao'), t('planet_panel.producao_valor', { valor: fmtRate(totalProd) })),
    createRow(t('planet_panel.prox_ciclo'), nextTickValue),
  );

  const resources = document.createElement('div');
  resources.className = 'planet-panel-resources';
  resources.append(
    createResourceCell(oreIcon(), d.recursos.comum),
    createResourceCell(rareIcon(), d.recursos.raro),
    createResourceCell(fuelIcon(), d.recursos.combustivel),
  );
  _rowsEl.appendChild(resources);
}

function renderFooter(planeta: Planeta): void {
  if (!_footerEl) return;

  const lines: string[] = [];
  const construcao = planeta.dados.construcaoAtual;
  const producaoNave = planeta.dados.producaoNave;
  const pesquisa = getPesquisaAtual(planeta);

  if (construcao) {
    lines.push(t('planet_panel.obra', { tipo: construcao.tipo, tier: construcao.tierDestino, tempo: formatMs(construcao.tempoRestanteMs) }));
  }
  if (producaoNave) {
    lines.push(t('planet_panel.nave_producao', { tipo: nomeTipoNave(producaoNave.tipoNave), tier: producaoNave.tier, tempo: formatMs(producaoNave.tempoRestanteMs) }));
  }
  if (pesquisa) {
    lines.push(t('planet_panel.pesquisa', { categoria: pesquisa.categoria, tier: pesquisa.tier, tempo: formatMs(pesquisa.tempoRestanteMs) }));
  }
  if (planeta.dados.filaProducao.length > 0) {
    const n = planeta.dados.filaProducao.length;
    lines.push(planeta.dados.repetirFilaProducao ? t('planet_panel.fila_loop', { n }) : t('planet_panel.fila', { n }));
  }

  if (lines.length > 0) {
    _footerEl.classList.remove('is-idle');
    _footerEl.textContent = lines.join('\n');
  } else {
    _footerEl.classList.add('is-idle');
    _footerEl.textContent = t('planet_panel.sem_atividade');
  }
}

function getMetaKey(planeta: Planeta): string {
  return `${planetName(planeta)}|${ownerKind(planeta.dados.dono)}`;
}

function getRowsKey(planeta: Planeta): string {
  const d = planeta.dados;
  return [
    d.tipoPlaneta,
    d.fabricas,
    d.infraestrutura,
    d.naves,
    d.producao,
    Math.floor(d.recursos.comum),
    Math.floor(d.recursos.raro),
    Math.floor(d.recursos.combustivel),
    formatMs(calcularTempoRestantePlaneta(planeta)),
  ].join('|');
}

function getFooterKey(planeta: Planeta): string {
  const pesquisa = getPesquisaAtual(planeta);

  return [
    planeta.dados.construcaoAtual?.tipo ?? '',
    planeta.dados.construcaoAtual?.tierDestino ?? '',
    planeta.dados.construcaoAtual ? formatMs(planeta.dados.construcaoAtual.tempoRestanteMs) : '',
    planeta.dados.producaoNave?.tipoNave ?? '',
    planeta.dados.producaoNave?.tier ?? '',
    planeta.dados.producaoNave ? formatMs(planeta.dados.producaoNave.tempoRestanteMs) : '',
    pesquisa?.categoria ?? '',
    pesquisa?.tier ?? '',
    pesquisa ? formatMs(pesquisa.tempoRestanteMs) : '',
    planeta.dados.filaProducao.length,
    planeta.dados.repetirFilaProducao ? '1' : '0',
  ].join('|');
}

function resetPanelCache(): void {
  _selectedPlanet = null;
  _metaKey = '';
  _rowsKey = '';
  _footerKey = '';
  _lastThumbPlanet = null;
  _lastThumbAt = 0;
}

function criarCloneRetrato(planeta: Planeta): { target: Container; frame: Rectangle } | null {
  const original = planeta as unknown as Mesh;
  const geometry = original.geometry;
  const shader = original.shader;
  const state = original.state;

  if (!geometry || !shader || !state) return null;

  const tamanho = planeta.dados.tamanho;
  const frameSize = Math.max(64, tamanho * 1.08);

  const clone = new Mesh({
    geometry,
    shader,
    state,
  });

  clone.scale.set(tamanho, tamanho);
  clone.position.set(frameSize / 2, frameSize / 2);

  const wrapper = new Container();
  wrapper.addChild(clone);

  return {
    target: wrapper,
    frame: new Rectangle(0, 0, frameSize, frameSize),
  };
}

function renderPortrait(app: Application, planeta: Planeta): void {
  if (!_portraitCanvas) return;

  const now = performance.now();
  if (_lastThumbPlanet === planeta && now - _lastThumbAt < THUMB_REFRESH_MS) return;

  _lastThumbPlanet = planeta;
  _lastThumbAt = now;

  const dpr = window.devicePixelRatio || 1;
  const cssSize = Math.max(46, _portraitCanvas.clientWidth || 46);
  const targetSize = Math.round(cssSize * dpr);
  _portraitCanvas.width = targetSize;
  _portraitCanvas.height = targetSize;

  const ctx = _portraitCanvas.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, targetSize, targetSize);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.arc(targetSize / 2, targetSize / 2, targetSize / 2 - 1, 0, Math.PI * 2);
  ctx.fill();

  // Canvas2D mode: planet is a Sprite backed by a local canvas
  // (_canvasRender.canvas). Draw that directly — the Mesh-based
  // clone path below doesn't work without a WebGL renderer anyway.
  if ((planeta as any)._isCanvasPlanet) {
    const cs = (planeta as any)._canvasRender as { canvas: HTMLCanvasElement } | undefined;
    if (!cs?.canvas) return;
    const scale = Math.min(
      (targetSize * 0.82) / cs.canvas.width,
      (targetSize * 0.82) / cs.canvas.height,
    );
    const drawW = cs.canvas.width * scale;
    const drawH = cs.canvas.height * scale;
    const dx = (targetSize - drawW) / 2;
    const dy = (targetSize - drawH) / 2;
    ctx.drawImage(cs.canvas, dx, dy, drawW, drawH);
    return;
  }

  const cloneData = criarCloneRetrato(planeta);
  if (!cloneData) return;

  try {
    const texture = app.renderer.generateTexture({
      target: cloneData.target,
      frame: cloneData.frame,
      resolution: THUMB_SCALE,
      antialias: true,
      clearColor: '#00000000',
    });
    const extracted = app.renderer.texture.generateCanvas(texture) as unknown as HTMLCanvasElement;

    const scale = Math.min((targetSize * 0.82) / extracted.width, (targetSize * 0.82) / extracted.height);
    const drawW = extracted.width * scale;
    const drawH = extracted.height * scale;
    const dx = (targetSize - drawW) / 2;
    const dy = (targetSize - drawH) / 2;

    ctx.drawImage(extracted, dx, dy, drawW, drawH);
    extracted.width = 0;
    extracted.height = 0;
    texture.destroy(true);
  } finally {
    // The clone shares geometry/shader/state with the live planet mesh, so we must
    // not call destroy on it — that would tear down GPU resources still in use.
    cloneData.target.removeChildren();
  }
}

export function criarPlanetPanel(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const panel = document.createElement('div');
  panel.className = 'hud-panel planet-panel';
  panel.setAttribute('data-ui', 'true');
  panel.style.pointerEvents = 'auto';
  panel.addEventListener('pointerdown', () => {
    marcarInteracaoUi();
  });

  const header = document.createElement('div');
  header.className = 'planet-panel-header';

  const title = document.createElement('div');
  title.textContent = t('planet_panel.titulo');
  header.appendChild(title);

  const close = document.createElement('button');
  close.className = 'planet-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', t('planet_panel.fechar'));
  header.appendChild(close);

  const body = document.createElement('div');
  body.className = 'planet-panel-body';

  const summary = document.createElement('div');
  summary.className = 'planet-panel-summary';

  const portraitWrap = document.createElement('div');
  portraitWrap.className = 'planet-panel-portrait-wrap';

  const portrait = document.createElement('canvas');
  portrait.className = 'planet-panel-portrait';
  portraitWrap.appendChild(portrait);
  _portraitCanvas = portrait;

  const meta = document.createElement('div');
  meta.className = 'planet-panel-meta';

  const name = document.createElement('div');
  name.className = 'planet-panel-name';
  meta.appendChild(name);
  _nameEl = name;

  // Hover on the planet name shows a brief cultural + geological lore
  // tooltip. Clicking opens the full archive in the save-modal.
  name.style.cursor = 'pointer';
  comTooltipHover(name, () => {
    const p = _selectedPlanet;
    if (!p || !_mundoRef) return '';
    const ia = getPersonalidades().find((x) => x.id === p.dados.dono);
    const lore = gerarPlanetaLore({
      planetaId: p.id,
      galaxySeed: _mundoRef.galaxySeed,
      tipo: p.dados.tipoPlaneta,
      dono: p.dados.dono,
      nomePlaneta: p.dados.nome,
      donoNome: ia?.nome,
      donoArquetipo: ia?.arquetipo,
      tamanho: p.dados.tamanho,
    });
    return `${lore.slogan}\n\n${lore.biomas}\n\n(clique pra arquivo completo)`;
  });
  name.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const p = _selectedPlanet;
    if (!p || !_mundoRef) return;
    const ia = getPersonalidades().find((x) => x.id === p.dados.dono);
    const lore = gerarPlanetaLore({
      planetaId: p.id,
      galaxySeed: _mundoRef.galaxySeed,
      tipo: p.dados.tipoPlaneta,
      dono: p.dados.dono,
      nomePlaneta: p.dados.nome,
      donoNome: ia?.nome,
      donoArquetipo: ia?.arquetipo,
      tamanho: p.dados.tamanho,
    });
    void abrirPlanetaLore(lore, p.dados.nome);
  });

  const status = document.createElement('div');
  status.className = 'planet-panel-owner';
  meta.appendChild(status);
  _statusEl = status;

  // Hovering the owner label for enemy planets shows that faction's lore
  // (archetype + backstory + motto). Player/neutro hover returns empty →
  // tooltip stays hidden.
  comTooltipHover(status, () => {
    const p = _selectedPlanet;
    if (!p || ownerKind(p.dados.dono) !== 'enemy') return '';
    const ia = getPersonalidades().find((x) => x.id === p.dados.dono);
    if (!ia) return '';
    const header = `${ia.nome}  —  ${ia.arquetipo}\n(clique pra arquivo completo)`;
    return ia.lore ? `${header}\n\n${formatarLore(ia.lore)}` : header;
  });

  // Clicking the owner label opens the full empire archive modal.
  status.style.cursor = 'pointer';
  status.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const p = _selectedPlanet;
    if (!p || ownerKind(p.dados.dono) !== 'enemy') return;
    const ia = getPersonalidades().find((x) => x.id === p.dados.dono);
    if (!ia) return;
    const seed = _mundoRef?.galaxySeed ?? 0;
    const lore = gerarImperioLore({
      empireId: ia.id,
      galaxySeed: seed,
      personalidade: ia,
      nomeImperio: ia.nome,
    });
    void abrirImperioLore(lore);
  });

  summary.append(portraitWrap, meta);

  const rows = document.createElement('div');
  rows.className = 'planet-panel-rows';
  _rowsEl = rows;

  const footer = document.createElement('div');
  footer.className = 'planet-panel-footer';
  _footerEl = footer;

  body.append(summary, rows, footer);
  panel.append(header, body);
  document.body.appendChild(panel);
  registerPlanetPanel(panel);

  _container = panel;

  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    marcarInteracaoUi();
    if (_mundoRef) limparSelecoes(_mundoRef);
    _container?.classList.remove('visible');
    _lastThumbPlanet = null;
  });

  return panel;
}

export function atualizarPlanetPanel(mundo: Mundo, app: Application): void {
  if (!_container || !_nameEl || !_statusEl) return;
  _mundoRef = mundo;

  const planeta = getSelectedPlanet(mundo);
  if (!planeta) {
    _container.classList.remove('visible');
    resetPanelCache();
    return;
  }

  if (_selectedPlanet !== planeta) {
    resetPanelCache();
    _selectedPlanet = planeta;
  }

  _container.classList.add('visible');
  const metaKey = getMetaKey(planeta);
  if (metaKey !== _metaKey) {
    _nameEl.textContent = planetName(planeta);
    _statusEl.textContent = ownerLabel(planeta.dados.dono);
    const kind = ownerKind(planeta.dados.dono);
    _statusEl.classList.toggle('is-player', kind === 'player');
    _statusEl.classList.toggle('is-enemy', kind === 'enemy');
    _metaKey = metaKey;
  }

  const rowsKey = getRowsKey(planeta);
  if (rowsKey !== _rowsKey) {
    renderRows(planeta);
    _rowsKey = rowsKey;
  }

  const footerKey = getFooterKey(planeta);
  if (footerKey !== _footerKey) {
    renderFooter(planeta);
    _footerKey = footerKey;
  }

  renderPortrait(app, planeta);
}

export function destruirPlanetPanel(): void {
  if (_container) {
    unregisterPlanetPanel();
    _container.remove();
    _container = null;
  }
  _nameEl = null;
  _statusEl = null;
  _rowsEl = null;
  _footerEl = null;
  _portraitCanvas = null;
  _mundoRef = null;
  resetPanelCache();
}
