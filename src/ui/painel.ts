import { Container, Graphics, Text } from 'pixi.js';
import type { Application, Mundo, Planeta, TipoJogador, Pesquisa, AcaoNaveParsed, Nave, Recursos } from '../types';
import {
  capacidadeCargaCargueira,
  calcularCustoTier,
  calcularTempoColonizadoraMs,
  calcularTempoConstrucaoMs,
  calcularTempoRestantePlaneta,
  getPesquisaAtual,
  getTierMax,
  iniciarPesquisa,
  nomeTipoPlaneta,
  obterNaveSelecionada,
  parseAcaoNave,
  pesquisaTierDisponivel,
  pesquisaTierLiberada,
  textoProducaoCicloPlaneta,
} from '../world/mundo';
import { marcarInteracaoUi } from './interacao-ui';
import { CUSTO_NAVE_COMUM, CUSTO_PESQUISA_RARO } from '../world/constantes';
import { getComandoNaveAtual, getTextoComandoNave } from '../core/player';

const SP = {
  panelBg: 0x101830,
  panelBgDark: 0x0a1020,
  panelBorder: 0x2a4070,
  cornerAccent: 0x4a80cc,
  titleBg: 0x1a3060,
  titleBgLight: 0x2a5090,
  titleText: 0xa0d0ff,
  diamond: 0x60ccff,
  fieldBg: 0x060c1a,
  fieldBorder: 0x1a2848,
  textLabel: 0x5070a0,
  textValue: 0x90ccff,
  sectionText: 0x4070a0,
  sectionLine: 0x2a4070,
  btnFace: 0x1a2848,
  btnBorder: 0x2a4878,
  btnText: 0xa0c8ff,
  btnHighlight: 0x3a6098,
  btnActionFace: 0x102838,
  btnActionBorder: 0x28705a,
  btnActionText: 0x60ffa0,
  btnActionHL: 0x309870,
  btnDisabledText: 0x304060,
  btnDisabledBorder: 0x1a2848,
  btnDisabledFace: 0x0e1828,
  btnDoneText: 0x40705a,
  btnDoneBorder: 0x1a3830,
  barBg: 0x1a2040,
  barBorder: 0x3a5080,
  barHighlight: 0x4a6090,
  statCyan: 0x60ccff,
  statGreen: 0x60ff90,
  statAmber: 0xffcc40,
  textDark: 0xc0d8ff,
  boxBg: 0x0c1428,
  boxBorder: 0x1e3458,
  boxLabelBg: 0x101830,
};

const LABEL_PESQUISA: Record<string, string> = { torreta: 'Torreta', cargueira: 'Cargueira', batedora: 'Batedora' };

const PAD = 8;
const BTN_H = 28;
const SMALL_BTN = 28;

interface InfoField {
  lbl: Text;
  val: Text;
}

interface BotaoContainer extends Container {
  _bg: Graphics;
  _texto: Text;
  _acao: string;
  _labelNave?: string;
  /**
   * M7: CSS-pixel bounds of the button as drawn — populated by
   * `atualizarBoundsBotoes()` so the canvas-level pointerdown
   * listener can hit-test. Without this, the action routing stays
   * on the Pixi eventMode + .on('pointertap') path (which still
   * works when weydra.graphics is on, but doesn't survive the M9
   * migration that removes Pixi).
   */
  _bounds?: { left: number; top: number; right: number; bottom: number };
}

interface BoxContainer extends Container {
  _bg: Graphics;
  _lbl: Text;
}

interface PesquisaBotao {
  botao: BotaoContainer;
  categoria: string;
  tier: number;
}

interface AjusteCargaBotao {
  botao: BotaoContainer;
  recurso: keyof Recursos;
  delta: number;
}

export interface PainelContainer extends Container {
  _txtPlanetas: Text;
  _txtComum: Text;
  _txtRaro: Text;
  _txtCombustivel: Text;
  _txtTipo: Text;
  _txtNaves: Text;
  _txtContador: Text;
  _statGroupBgs: Graphics;
  _infoContainer: Container;
  _infoBg: Graphics;
  _infoNome: Text;
  _infoFields: Record<string, InfoField>;
  _boxEdificios: BoxContainer;
  _boxNaves: BoxContainer;
  _boxPesquisa: BoxContainer;
  _catLabels: Record<string, Text>;
  _overlayPesquisa: Container;
  _overlayPesquisaBg: Graphics;
  _txtPesquisaResumo: Text;
  _btnToggleProducao: BotaoContainer;
  _btnAbrirPesquisa: BotaoContainer;
  _barraBg: Graphics;
  _btnFabrica: BotaoContainer;
  _btnInfra: BotaoContainer;
  _btnNaves: BotaoContainer[];
  _btnPesquisa: PesquisaBotao[];
  _btnMoverNave: BotaoContainer;
  _btnCancelarMoverNave: BotaoContainer;
  _btnOrigemCarga: BotaoContainer;
  _btnDestinoCarga: BotaoContainer;
  _btnLoopCarga: BotaoContainer;
  _btnAjusteCarga: AjusteCargaBotao[];
  _txtCargaInfo: Text;
  _boxFila: BoxContainer;
  _txtFilaResumo: Text;
  _btnFilaRepeat: BotaoContainer;
  _btnFilaLimpar: BotaoContainer;
  _planetaSelecionado: Planeta | null;
  _naveSelecionada: Nave | null;
  _onAcaoPlaneta: ((acao: string, planeta: Planeta) => void) | null;
  _onAcaoNave: ((acao: string, nave: Nave) => void) | null;
  _painelProducaoExpandido: boolean;
  _arvorePesquisaAberta: boolean;
  _mundoRef: Mundo | null;
}

function formatarTempo(ms: number | null): string {
  const totalSeg = Math.max(0, Math.ceil((ms ?? 0) / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

function drawPanelFrame(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h / 2).fill({ color: SP.panelBg });
  g.rect(x, y + h / 2, w, h / 2).fill({ color: SP.panelBgDark });
  g.roundRect(x, y, w, h, 4).stroke({ color: SP.panelBorder, width: 2 });
  const s = 10;
  g.moveTo(x, y + s).lineTo(x, y).lineTo(x + s, y).stroke({ color: SP.cornerAccent, width: 2 });
  g.moveTo(x + w - s, y).lineTo(x + w, y).lineTo(x + w, y + s).stroke({ color: SP.cornerAccent, width: 2 });
  g.moveTo(x, y + h - s).lineTo(x, y + h).lineTo(x + s, y + h).stroke({ color: SP.cornerAccent, width: 2 });
  g.moveTo(x + w - s, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - s).stroke({ color: SP.cornerAccent, width: 2 });
}

function drawTitleBar(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x + 2, y, w - 4, h).fill({ color: SP.titleBg });
  g.rect(x + 2 + (w - 4) / 3, y, (w - 4) * 2 / 3, h).fill({ color: SP.titleBgLight, alpha: 0.5 });
  g.moveTo(x + 2, y + h).lineTo(x + w - 2, y + h).stroke({ color: SP.panelBorder, width: 1 });
  const dx = x + 10, dy = y + h / 2;
  g.moveTo(dx, dy - 3).lineTo(dx + 3, dy).lineTo(dx, dy + 3).lineTo(dx - 3, dy).lineTo(dx, dy - 3).fill({ color: SP.diamond });
}

function drawInfoField(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h).fill({ color: SP.fieldBg });
  g.rect(x, y, w, h).stroke({ color: SP.fieldBorder, width: 1 });
}

// Draw a labeled box container
function drawBox(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h).fill({ color: SP.boxBg });
  g.roundRect(x, y, w, h, 3).stroke({ color: SP.boxBorder, width: 1 });
}

function drawBtn(g: Graphics, x: number, y: number, w: number, h: number, disabled: boolean, action: boolean, done: boolean): void {
  g.clear();
  if (disabled) {
    g.rect(x, y, w, h).fill({ color: SP.btnDisabledFace });
    g.rect(x, y, w, h).stroke({ color: SP.btnDisabledBorder, width: 1 });
  } else if (done) {
    g.rect(x, y, w, h).fill({ color: 0x0a1820 });
    g.rect(x, y, w, h).stroke({ color: SP.btnDoneBorder, width: 1 });
  } else if (action) {
    g.rect(x, y, w, h).fill({ color: SP.btnActionFace });
    g.rect(x, y, w, h).stroke({ color: SP.btnActionBorder, width: 1 });
    g.moveTo(x + 4, y).lineTo(x + w - 4, y).stroke({ color: SP.btnActionHL, width: 1, alpha: 0.5 });
  } else {
    g.rect(x, y, w, h).fill({ color: SP.btnFace });
    g.rect(x, y, w, h).stroke({ color: SP.btnBorder, width: 1 });
    g.moveTo(x + 4, y).lineTo(x + w - 4, y).stroke({ color: SP.btnHighlight, width: 1, alpha: 0.4 });
  }
}

/**
 * M7: Module-level registry of action buttons + their action
 * callbacks. The factory `criarBotaoAcao` calls `registrarBotao()`
 * with a closure that captures the root PainelContainer (the
 * original Pixi `pointertap` handler walked the parent chain at
 * fire time; closures capture the root once at creation). A single
 * canvas pointerdown listener iterates the registry for hit-tests.
 */
interface BotaoRegistrado {
  botao: BotaoContainer;
  /** Fires the action — captured closure over the painel + acao. */
  handler: () => void;
  /** CSS-pixel bounds refreshed via atualizarBoundsBotoes(). */
  bounds: () => { left: number; top: number; right: number; bottom: number };
}
const _botoesRegistrados: BotaoRegistrado[] = [];

function registrarBotao(
  botao: BotaoContainer,
  painel: PainelContainer,
): void {
  botao.eventMode = 'static';
  botao.cursor = 'pointer';

  const handler = (): void => {
    const acao = botao._acao;
    if (acao === 'toggle_pesquisa') {
      painel._arvorePesquisaAberta = !painel._arvorePesquisaAberta;
      return;
    }
    if (acao?.startsWith?.('pesquisa_')) {
      if (!painel._planetaSelecionado) return;
      const m = acao.match(/^pesquisa_(torreta|cargueira|batedora)_(\d)$/);
      if (m) iniciarPesquisa(painel._planetaSelecionado, m[1], Number(m[2]));
      return;
    }
    if (acao.startsWith('comando_nave_') || acao.startsWith('config_cargo_')) {
      if (!painel._naveSelecionada) return;
      painel._onAcaoNave?.(acao, painel._naveSelecionada);
      return;
    }
    if (!painel._planetaSelecionado) return;
    painel._onAcaoPlaneta?.(acao, painel._planetaSelecionado);
  };

  // Pixi eventMode path — still works when weydra.graphics is on
  // because Pixi stays transparent over the weydra canvas. The DOM
  // path (below) is the M7 replacement that survives M9 (Pixi removal).
  botao.on('pointertap', () => {
    handler();
  });
  botao.on('pointerdown', () => {
    marcarInteracaoUi();
  });

  _botoesRegistrados.push({
    botao,
    handler,
    bounds: () => botao._bounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
  });
}

/**
 * Compute the CSS-pixel bounds of every registered button. Called
 * each frame after the panel's `atualizarPaineis` positions them.
 * The DOM hit-test uses these bounds directly.
 */
export function atualizarBoundsBotoes(): void {
  for (const reg of _botoesRegistrados) {
    const b = reg.botao;
    reg.botao._bounds = {
      left: b.x,
      top: b.y,
      right: b.x + b.width,
      bottom: b.y + b.height,
    };
  }
}

/**
 * M7: DOM canvas pointerdown listener. Hit-tests every registered
 * button and fires the matching handler. Mounted once at panel
 * creation; unmounted via `abortarListenersPainel()` on world destroy.
 */
let _painelAbort: AbortController | null = null;
export function ativarListenersPainel(app: Application): void {
  if (_painelAbort) _painelAbort.abort();
  _painelAbort = new AbortController();
  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    for (const reg of _botoesRegistrados) {
      if (reg.botao.destroyed) continue;
      const b = reg.bounds();
      if (e.clientX < b.left || e.clientX > b.right) continue;
      if (e.clientY < b.top || e.clientY > b.bottom) continue;
      marcarInteracaoUi();
      reg.handler();
      return;
    }
  }, { signal: _painelAbort.signal });
}

export function abortarListenersPainel(): void {
  _painelAbort?.abort();
  _painelAbort = null;
  _botoesRegistrados.length = 0;
}

function criarBotaoAcao(
  parent: Container,
  textoInicial: string,
  acao: string,
  painel: PainelContainer,
): BotaoContainer {
  const botao = new Container() as BotaoContainer;
  botao._acao = acao;

  const bg = new Graphics();
  botao.addChild(bg);
  botao._bg = bg;

  const texto = new Text({
    text: textoInicial,
    style: { fontSize: 12, fill: SP.btnText, fontFamily: 'monospace', align: 'center' },
  });
  texto.anchor.set(0.5);
  botao.addChild(texto);
  botao._texto = texto;

  registrarBotao(botao, painel);

  parent.addChild(botao);
  return botao;
}

export function criarPainel(app: Application): PainelContainer {
  const container = new Container() as PainelContainer;

  // === TOP BAR ===
  const barraBg = new Graphics();
  container.addChild(barraBg);

  // Stat group backgrounds (drawn per frame)
  const statGroupBgs = new Graphics();
  container.addChild(statGroupBgs);

  const txtPlanetas = new Text({ text: '', style: { fontSize: 13, fill: SP.statCyan, fontFamily: 'monospace' } });
  container.addChild(txtPlanetas);

  const txtComum = new Text({ text: '', style: { fontSize: 13, fill: SP.statGreen, fontFamily: 'monospace' } });
  container.addChild(txtComum);

  const txtRaro = new Text({ text: '', style: { fontSize: 13, fill: SP.statAmber, fontFamily: 'monospace' } });
  container.addChild(txtRaro);

  const txtCombustivel = new Text({ text: '', style: { fontSize: 13, fill: 0xff6090, fontFamily: 'monospace' } });
  container.addChild(txtCombustivel);

  const txtTipo = new Text({ text: '', style: { fontSize: 13, fill: SP.statAmber, fontFamily: 'monospace' } });
  container.addChild(txtTipo);

  const txtNaves = new Text({ text: '', style: { fontSize: 13, fill: SP.statCyan, fontFamily: 'monospace' } });
  container.addChild(txtNaves);

  const txtContador = new Text({ text: '', style: { fontSize: 12, fill: SP.textDark, fontFamily: 'monospace' } });
  container.addChild(txtContador);

  // === PLANET INFO PANEL ===
  const infoContainer = new Container();
  infoContainer.visible = false;

  const infoBg = new Graphics();
  infoContainer.addChild(infoBg);

  const infoNome = new Text({ text: '', style: { fontSize: 15, fill: SP.titleText, fontFamily: 'monospace' } });
  infoNome.x = 20; infoNome.y = 4;
  infoContainer.addChild(infoNome);

  // Individual info rows (label + value pairs)
  const infoFields: Record<string, InfoField> = {};
  const fieldNames = ['dono', 'tipo', 'ciclo', 'prod', 'fabrica', 'infra', 'navesVoo', 'pesquisa', 'obra', 'filaNave'];
  for (const name of fieldNames) {
    const lbl = new Text({ text: '', style: { fontSize: 13, fill: SP.textLabel, fontFamily: 'monospace' } });
    const val = new Text({ text: '', style: { fontSize: 13, fill: SP.textValue, fontFamily: 'monospace' } });
    infoContainer.addChild(lbl);
    infoContainer.addChild(val);
    infoFields[name] = { lbl, val };
  }

  // === 3 PRODUCTION CONTAINERS ===

  // Box 1: Edificios
  const boxEdificios = new Container() as BoxContainer;
  boxEdificios.visible = false;
  infoContainer.addChild(boxEdificios);
  const boxEdBg = new Graphics();
  boxEdificios.addChild(boxEdBg);
  boxEdificios._bg = boxEdBg;
  const lblEd = new Text({ text: 'Edificios', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxEdificios.addChild(lblEd);
  boxEdificios._lbl = lblEd;

  // `painel` is created mid-function; closures capture the binding so
  // the buttons can resolve `_onAcaoPlaneta` lazily once the variable
  // is assigned below.
  let painel: PainelContainer | null = null;

  // Local helper: binds criarBotaoAcao to this painel so call sites
  // stay 3-arg as before. The closure captures `painel` by reference.
  const btn = (parent: Container, textoInicial: string, acao: string): BotaoContainer =>
    criarBotaoAcao(parent, textoInicial, acao, painel!);

  const btnFabrica = btn(boxEdificios, '', 'fabrica');
  const btnInfra = btn(boxEdificios, '', 'infraestrutura');

  // Box 2: Naves
  const boxNaves = new Container() as BoxContainer;
  boxNaves.visible = false;
  infoContainer.addChild(boxNaves);
  const boxNavBg = new Graphics();
  boxNaves.addChild(boxNavBg);
  boxNaves._bg = boxNavBg;
  const lblNav = new Text({ text: 'Naves', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxNaves.addChild(lblNav);
  boxNaves._lbl = lblNav;

  const btnNaves: BotaoContainer[] = [];
  const acoesNave: { acao: string; label: string }[] = [{ acao: 'nave_colonizadora', label: 'Colonizadora' }];
  for (const tipo of ['cargueira', 'batedora', 'torreta']) {
    for (let t = 1; t <= 5; t++) {
      acoesNave.push({ acao: `nave_${tipo}_${t}`, label: `${LABEL_PESQUISA[tipo] || tipo} T${t}` });
    }
  }
  for (const a of acoesNave) {
    const b = btn(boxNaves, a.label, a.acao);
    b._labelNave = a.label;
    btnNaves.push(b);
  }

  // Box 3: Pesquisa
  const boxPesquisa = new Container() as BoxContainer;
  boxPesquisa.visible = false;
  infoContainer.addChild(boxPesquisa);
  const boxPesBg = new Graphics();
  boxPesquisa.addChild(boxPesBg);
  boxPesquisa._bg = boxPesBg;
  const lblPes = new Text({ text: 'Pesquisa', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxPesquisa.addChild(lblPes);
  boxPesquisa._lbl = lblPes;

  const txtPesquisaResumo = new Text({ text: '', style: { fontSize: 11, fill: SP.textLabel, fontFamily: 'monospace' } });
  boxPesquisa.addChild(txtPesquisaResumo);

  const btnAbrirPesquisa = btn(boxPesquisa, 'Abrir arvore', 'toggle_pesquisa');

  const btnPesquisa: PesquisaBotao[] = [];
  const catLabels: Record<string, Text> = {};
  for (const cat of ['torreta', 'cargueira', 'batedora']) {
    const rowLabel = new Text({ text: LABEL_PESQUISA[cat], style: { fontSize: 12, fill: SP.textLabel, fontFamily: 'monospace' } });
    rowLabel.visible = false;
    catLabels[cat] = rowLabel;
    for (let t = 1; t <= 5; t++) {
      const b = btn(infoContainer, String(t), `pesquisa_${cat}_${t}`);
      b.visible = false;
      btnPesquisa.push({ botao: b, categoria: cat, tier: t });
    }
  }

  const overlayPesquisa = new Container();
  overlayPesquisa.visible = false;
  const overlayPesquisaBg = new Graphics();
  overlayPesquisa.addChild(overlayPesquisaBg);
  for (const cat of ['torreta', 'cargueira', 'batedora']) overlayPesquisa.addChild(catLabels[cat]);
  for (const { botao } of btnPesquisa) overlayPesquisa.addChild(botao);
  infoContainer.addChild(overlayPesquisa);

  const btnMoverNave = btn(infoContainer, 'Mover', 'comando_nave_mover');
  const btnCancelarMoverNave = btn(infoContainer, 'Cancelar', 'comando_nave_cancelar');
  const btnOrigemCarga = btn(infoContainer, 'Origem', 'comando_nave_origem');
  const btnDestinoCarga = btn(infoContainer, 'Destino', 'comando_nave_destino');
  const btnLoopCarga = btn(infoContainer, 'Loop', 'comando_nave_loop');
  const txtCargaInfo = new Text({ text: '', style: { fontSize: 11, fill: SP.textValue, fontFamily: 'monospace' } });
  infoContainer.addChild(txtCargaInfo);
  const btnAjusteCarga: AjusteCargaBotao[] = [];
  for (const recurso of ['comum', 'raro', 'combustivel'] as const) {
    btnAjusteCarga.push({ botao: btn(infoContainer, '-', `config_cargo_${recurso}_menos`), recurso, delta: -5 });
    btnAjusteCarga.push({ botao: btn(infoContainer, '+', `config_cargo_${recurso}_mais`), recurso, delta: 5 });
  }

  const boxFila = new Container() as BoxContainer;
  boxFila.visible = false;
  infoContainer.addChild(boxFila);
  const boxFilaBg = new Graphics();
  boxFila.addChild(boxFilaBg);
  boxFila._bg = boxFilaBg;
  const lblFila = new Text({ text: 'Fila', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxFila.addChild(lblFila);
  boxFila._lbl = lblFila;
  const txtFilaResumo = new Text({ text: '', style: { fontSize: 11, fill: SP.textValue, fontFamily: 'monospace' } });
  boxFila.addChild(txtFilaResumo);
  const btnFilaRepeat = btn(boxFila, 'Repetir', 'fila_toggle_repeat');
  const btnFilaLimpar = btn(boxFila, 'Limpar', 'fila_limpar');

  // Toggle button
  const btnToggleProducao = new Container() as BotaoContainer;
  btnToggleProducao.eventMode = 'static';
  btnToggleProducao.cursor = 'pointer';
  const bgToggle = new Graphics();
  btnToggleProducao.addChild(bgToggle);
  btnToggleProducao._bg = bgToggle;
  const txtToggle = new Text({ text: 'Producao', style: { fontSize: 14, fill: SP.btnText, fontFamily: 'monospace' } });
  txtToggle.anchor.set(0.5);
  txtToggle.x = 75; txtToggle.y = 12;
  btnToggleProducao.addChild(txtToggle);
  btnToggleProducao._texto = txtToggle;
  infoContainer.addChild(btnToggleProducao);
  // M7: cache CSS-pixel bounds for DOM hit-test.
  btnToggleProducao._bounds = { left: btnToggleProducao.x, top: btnToggleProducao.y, right: btnToggleProducao.x + 150, bottom: btnToggleProducao.y + 24 };

  btnToggleProducao.on('pointertap', () => {
    container._painelProducaoExpandido = !container._painelProducaoExpandido;
  });
  btnToggleProducao.on('pointerdown', () => {
    marcarInteracaoUi();
  });

  container.addChild(infoContainer);

  container._txtPlanetas = txtPlanetas;
  container._txtComum = txtComum;
  container._txtRaro = txtRaro;
  container._txtCombustivel = txtCombustivel;
  container._txtTipo = txtTipo;
  container._txtNaves = txtNaves;
  container._txtContador = txtContador;
  container._statGroupBgs = statGroupBgs;
  container._infoContainer = infoContainer;
  container._infoBg = infoBg;
  container._infoNome = infoNome;
  container._infoFields = infoFields;
  container._boxEdificios = boxEdificios;
  container._boxNaves = boxNaves;
  container._boxPesquisa = boxPesquisa;
  container._catLabels = catLabels;
  container._overlayPesquisa = overlayPesquisa;
  container._overlayPesquisaBg = overlayPesquisaBg;
  container._txtPesquisaResumo = txtPesquisaResumo;
  container._btnToggleProducao = btnToggleProducao;
  container._btnAbrirPesquisa = btnAbrirPesquisa;
  container._barraBg = barraBg;
  container._btnFabrica = btnFabrica;
  container._btnInfra = btnInfra;
  container._btnNaves = btnNaves;
  container._btnPesquisa = btnPesquisa;
  container._btnMoverNave = btnMoverNave;
  container._btnCancelarMoverNave = btnCancelarMoverNave;
  container._btnOrigemCarga = btnOrigemCarga;
  container._btnDestinoCarga = btnDestinoCarga;
  container._btnLoopCarga = btnLoopCarga;
  container._btnAjusteCarga = btnAjusteCarga;
  container._txtCargaInfo = txtCargaInfo;
  container._boxFila = boxFila;
  container._txtFilaResumo = txtFilaResumo;
  container._btnFilaRepeat = btnFilaRepeat;
  container._btnFilaLimpar = btnFilaLimpar;
  container._planetaSelecionado = null;
  container._naveSelecionada = null;
  container._onAcaoPlaneta = null;
  container._onAcaoNave = null;
  container._painelProducaoExpandido = false;
  container._arvorePesquisaAberta = false;
  container._mundoRef = null;

  // M7: late-bind the painel variable so the closures captured by
  // btn() above can resolve _onAcaoPlaneta / _arvorePesquisaAberta
  // at action time. Updating the bound `let` is the simplest way to
  // share the container with the registered action handlers.
  painel = container;

  // M7: install the canvas-level pointerdown listener that hit-tests
  // every registered button. AbortController-backed so destruirMundo
  // can release it via abortarListenersPainel().
  ativarListenersPainel(app);

  return container;
}

export function atualizarPainel(painel: PainelContainer, mundo: Mundo, tipoJogador: TipoJogador, app: Application): void {
  painel._mundoRef = mundo;

  // M7: refresh CSS-pixel bounds for every registered button. Buttons
  // move every frame (panel scroll, state changes) — the DOM hit-test
  // uses these bounds, so they must be in sync with the rendered x/y.
  atualizarBoundsBotoes();

  // === TOP BAR ===
  const barH = 28;
  const sw = app.screen.width;
  const barra = painel._barraBg;
  barra.clear();

  // Bar background gradient
  barra.rect(0, 0, sw, barH).fill({ color: SP.barBg });
  barra.rect(0, 0, sw, 1).fill({ color: SP.barHighlight, alpha: 0.4 });
  barra.moveTo(0, barH).lineTo(sw, barH).stroke({ color: SP.barBorder, width: 1 });
  barra.moveTo(0, barH + 1).lineTo(sw, barH + 1).stroke({ color: 0x080c18, width: 1 });

  let qtdPlanetas = 0;
  let planetaSel: Planeta | null = null;
  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === 'jogador') qtdPlanetas++;
    if (planeta.dados.selecionado) planetaSel = planeta;
  }

  const naveSelecionada = obterNaveSelecionada(mundo);
  const totalNaves = mundo.naves.length;
  const r = planetaSel?.dados.recursos || { comum: 0, raro: 0, combustivel: 0 };

  // Update text values
  painel._txtPlanetas.text = `Planetas: ${qtdPlanetas}`;
  painel._txtComum.text = `C: ${Math.floor(r.comum)}`;
  painel._txtRaro.text = `R: ${Math.floor(r.raro)}`;
  painel._txtCombustivel.text = `F: ${Math.floor(r.combustivel)}`;
  painel._txtTipo.text = tipoJogador.nome;
  painel._txtNaves.text = `Naves: ${totalNaves}`;
  painel._txtContador.text = getTextoComandoNave();

  // Draw stat group sunken boxes and position text
  const sg = painel._statGroupBgs;
  sg.clear();
  const sgH = 20;
  const sgY = 4;
  const sgPadX = 6;
  const sgGap = 6;

  // Helper: draw a stat group box and return its right edge x
  function drawStatGroup(x: number, texts: Text[]): number {
    // Measure total width
    let totalW = sgPadX;
    for (const t of texts) totalW += t.width + 8;
    totalW += sgPadX - 8;

    // Sunken box
    sg.rect(x, sgY, totalW, sgH).fill({ color: 0x0c1428 });
    sg.rect(x, sgY, totalW, sgH).stroke({ color: SP.boxBorder, width: 1 });

    // Position texts inside
    let tx = x + sgPadX;
    for (const t of texts) {
      t.x = tx;
      t.y = sgY + 3;
      tx += t.width + 8;
    }

    return x + totalW + sgGap;
  }

  // Left side: planets + resources
  let cx = 8;
  cx = drawStatGroup(cx, [painel._txtPlanetas]);
  cx = drawStatGroup(cx, [painel._txtComum, painel._txtRaro, painel._txtCombustivel]);

  // Center: ship selected message
  if (painel._txtContador.text) {
    painel._txtContador.x = cx + 4;
    painel._txtContador.y = sgY + 4;
    painel._txtContador.visible = true;
  } else {
    painel._txtContador.visible = false;
  }

  // Right side: type + naves
  // Draw from right edge
  const rightTexts1 = [painel._txtNaves];
  let rw1 = sgPadX;
  for (const t of rightTexts1) rw1 += t.width + 8;
  rw1 += sgPadX - 8;
  const rx1 = sw - rw1 - 8;

  const rightTexts0 = [painel._txtTipo];
  let rw0 = sgPadX;
  for (const t of rightTexts0) rw0 += t.width + 8;
  rw0 += sgPadX - 8;
  const rx0 = rx1 - rw0 - sgGap;

  drawStatGroup(rx0, rightTexts0);
  drawStatGroup(rx1, rightTexts1);

  // Divider line between left and right groups
  const divX = Math.floor((cx + rx0) / 2);
  sg.moveTo(divX, sgY + 3).lineTo(divX, sgY + sgH - 3).stroke({ color: SP.sectionLine, width: 1, alpha: 0.3 });

  const info = painel._infoContainer;
  const bg = painel._infoBg;
  const f = painel._infoFields;
  painel._boxEdificios.visible = false;
  painel._boxNaves.visible = false;
  painel._boxPesquisa.visible = false;
  painel._boxFila.visible = false;
  painel._overlayPesquisa.visible = false;
  painel._btnToggleProducao.visible = false;
  painel._btnFabrica.visible = false;
  painel._btnInfra.visible = false;
  painel._btnAbrirPesquisa.visible = false;
  painel._btnFilaRepeat.visible = false;
  painel._btnFilaLimpar.visible = false;
  for (const b of painel._btnNaves) b.visible = false;
  for (const { botao } of painel._btnPesquisa) botao.visible = false;
  for (const cat in painel._catLabels) painel._catLabels[cat].visible = false;
  for (const b of [painel._btnMoverNave, painel._btnCancelarMoverNave, painel._btnOrigemCarga, painel._btnDestinoCarga, painel._btnLoopCarga]) b.visible = false;
  for (const ajuste of painel._btnAjusteCarga) ajuste.botao.visible = false;
  painel._txtCargaInfo.visible = false;

  if (naveSelecionada) {
    painel._naveSelecionada = naveSelecionada;
    painel._planetaSelecionado = null;
    info.visible = true;
    const comandoAtual = getComandoNaveAtual();
    const planejandoMovimento = comandoAtual?.tipo === 'mover' && comandoAtual.nave === naveSelecionada;
    const qtdPontosPlanejados = planejandoMovimento ? comandoAtual.pontos.length : 0;
    const temRotaManual = naveSelecionada.estado === 'viajando' || naveSelecionada.rotaManual.length > 0 || naveSelecionada.alvo?._tipoAlvo === 'ponto';

    const tipoNome = naveSelecionada.tipo === 'colonizadora'
      ? 'Colonizadora'
      : `${LABEL_PESQUISA[naveSelecionada.tipo] || naveSelecionada.tipo} T${naveSelecionada.tier}`;
    const rows: { key: string; label: string; value: string; color: number }[] = [
      { key: 'dono', label: 'Nave', value: tipoNome, color: SP.statCyan },
      { key: 'tipo', label: 'Estado', value: naveSelecionada.estado, color: SP.textValue },
      { key: 'ciclo', label: 'Posicao', value: `${Math.floor(naveSelecionada.x)} / ${Math.floor(naveSelecionada.y)}`, color: SP.statAmber },
      { key: 'prod', label: 'Carga', value: `C:${naveSelecionada.carga.comum} R:${naveSelecionada.carga.raro} F:${naveSelecionada.carga.combustivel}`, color: SP.statGreen },
      { key: 'pesquisa', label: 'Rota', value: planejandoMovimento ? `planejando ${qtdPontosPlanejados}/5 pontos` : (temRotaManual ? `${(naveSelecionada.alvo?._tipoAlvo === 'ponto' ? 1 : 0) + naveSelecionada.rotaManual.length} pontos restantes` : 'sem rota manual'), color: SP.textValue },
    ];
    if (naveSelecionada.tipo === 'cargueira') {
      rows.push({ key: 'fabrica', label: 'Capacidade', value: `${capacidadeCargaCargueira(naveSelecionada.tier)}`, color: SP.textValue });
      rows.push({ key: 'infra', label: 'Config', value: `C:${naveSelecionada.configuracaoCarga.comum} R:${naveSelecionada.configuracaoCarga.raro} F:${naveSelecionada.configuracaoCarga.combustivel}`, color: SP.textValue });
      rows.push({ key: 'navesVoo', label: 'Rota', value: `${naveSelecionada.rotaCargueira?.origem ? 'origem ok' : 'sem origem'} / ${naveSelecionada.rotaCargueira?.destino ? 'destino ok' : 'sem destino'}`, color: SP.statCyan });
    }

    for (const name in f) {
      f[name].lbl.visible = false;
      f[name].val.visible = false;
    }

    const lineH = 18;
    const fieldX = 8, fieldY = 28, fieldPad = 8;
    const lblW = 80;
    let maxRowW = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const field = f[row.key];
      field.lbl.visible = true;
      field.val.visible = true;
      field.lbl.text = row.label;
      field.lbl.style.fill = SP.textLabel;
      field.lbl.x = fieldX + fieldPad;
      field.lbl.y = fieldY + fieldPad + i * lineH;
      field.val.text = row.value;
      field.val.style.fill = row.color;
      field.val.x = fieldX + fieldPad + lblW;
      field.val.y = fieldY + fieldPad + i * lineH;
      maxRowW = Math.max(maxRowW, lblW + field.val.width);
    }

    const fieldH = rows.length * lineH + fieldPad * 2;
    const minW = naveSelecionada.tipo === 'cargueira'
      ? (temRotaManual ? 414 : 316)
      : (temRotaManual ? 218 : 120);
    const W = Math.max(330, minW + 24, maxRowW + fieldX * 2 + fieldPad * 2 + 20);
    const extraH = naveSelecionada.tipo === 'cargueira' ? 150 : 52;
    const H = fieldY + fieldH + extraH;
    bg.clear();
    drawPanelFrame(bg, 0, 0, W, H);
    drawTitleBar(bg, 0, 0, W, 22);
    drawInfoField(bg, fieldX, fieldY, W - fieldX * 2, fieldH);
    const sepX = fieldX + fieldPad + lblW - 6;
    bg.moveTo(sepX, fieldY + 4).lineTo(sepX, fieldY + fieldH - 4).stroke({ color: SP.sectionLine, width: 1, alpha: 0.3 });
    info.x = 16;
    info.y = app.screen.height - H - 18;
    painel._infoNome.text = `Nave selecionada — ${tipoNome}`;
    painel._infoNome.x = 18; painel._infoNome.y = 3;

    const cmdY = fieldY + fieldH + 8;
    const cmdW = 92;
    painel._btnMoverNave.visible = true;
    painel._btnMoverNave.x = 12;
    painel._btnMoverNave.y = cmdY;
    painel._btnMoverNave._texto.text = planejandoMovimento ? `Iniciar ${qtdPontosPlanejados}/5` : 'Mover';
    painel._btnMoverNave._texto.x = cmdW / 2;
    painel._btnMoverNave._texto.y = BTN_H / 2;
    drawBtn(painel._btnMoverNave._bg, 0, 0, cmdW, BTN_H, false, true, false);
    painel._btnMoverNave._texto.style.fill = SP.btnActionText;

    painel._btnCancelarMoverNave.visible = temRotaManual;
    if (temRotaManual) {
      painel._btnCancelarMoverNave.x = 110;
      painel._btnCancelarMoverNave.y = cmdY;
      painel._btnCancelarMoverNave._texto.text = 'Cancelar';
      painel._btnCancelarMoverNave._texto.x = cmdW / 2;
      painel._btnCancelarMoverNave._texto.y = BTN_H / 2;
      drawBtn(painel._btnCancelarMoverNave._bg, 0, 0, cmdW, BTN_H, false, false, false);
      painel._btnCancelarMoverNave._texto.style.fill = SP.btnText;
    }

    if (naveSelecionada.tipo === 'cargueira') {
      painel._btnOrigemCarga.visible = true;
      painel._btnDestinoCarga.visible = true;
      painel._btnLoopCarga.visible = true;
      painel._btnOrigemCarga.x = temRotaManual ? 208 : 110;
      painel._btnOrigemCarga.y = cmdY;
      painel._btnOrigemCarga._texto.text = 'Origem';
      painel._btnOrigemCarga._texto.x = cmdW / 2;
      painel._btnOrigemCarga._texto.y = BTN_H / 2;
      drawBtn(painel._btnOrigemCarga._bg, 0, 0, cmdW, BTN_H, false, true, false);
      painel._btnOrigemCarga._texto.style.fill = SP.btnActionText;

      painel._btnDestinoCarga.x = temRotaManual ? 306 : 208;
      painel._btnDestinoCarga.y = cmdY;
      painel._btnDestinoCarga._texto.text = 'Destino';
      painel._btnDestinoCarga._texto.x = cmdW / 2;
      painel._btnDestinoCarga._texto.y = BTN_H / 2;
      drawBtn(painel._btnDestinoCarga._bg, 0, 0, cmdW, BTN_H, false, true, false);
      painel._btnDestinoCarga._texto.style.fill = SP.btnActionText;

      painel._btnLoopCarga.x = 12;
      painel._btnLoopCarga.y = cmdY + BTN_H + 6;
      painel._btnLoopCarga._texto.text = naveSelecionada.rotaCargueira?.loop ? 'Loop ON' : 'Loop OFF';
      painel._btnLoopCarga._texto.x = cmdW / 2;
      painel._btnLoopCarga._texto.y = BTN_H / 2;
      drawBtn(painel._btnLoopCarga._bg, 0, 0, cmdW, BTN_H, false, naveSelecionada.rotaCargueira?.loop ?? false, false);
      painel._btnLoopCarga._texto.style.fill = (naveSelecionada.rotaCargueira?.loop ?? false) ? SP.btnActionText : SP.btnText;

      painel._txtCargaInfo.visible = true;
      painel._txtCargaInfo.x = 12;
      painel._txtCargaInfo.y = cmdY + BTN_H * 2 + 18;
      const origemTxt = naveSelecionada.rotaCargueira?.origem ? 'origem definida' : 'origem pendente';
      const destinoTxt = naveSelecionada.rotaCargueira?.destino ? 'destino definido' : 'destino pendente';
      painel._txtCargaInfo.text = `Transferencia por viagem\n${origemTxt} | ${destinoTxt}\nC:${naveSelecionada.configuracaoCarga.comum}  R:${naveSelecionada.configuracaoCarga.raro}  F:${naveSelecionada.configuracaoCarga.combustivel}`;

      const labels: Array<[keyof Recursos, string]> = [['comum', 'C'], ['raro', 'R'], ['combustivel', 'F']];
      labels.forEach(([recurso, sigla], idx) => {
        const baseY = cmdY + BTN_H * 2 + 42 + idx * 28;
        const menos = painel._btnAjusteCarga[idx * 2];
        const mais = painel._btnAjusteCarga[idx * 2 + 1];
        menos.botao.visible = true;
        mais.botao.visible = true;
        menos.botao.x = 130;
        menos.botao.y = baseY;
        mais.botao.x = 266;
        mais.botao.y = baseY;
        menos.botao._texto.text = '-';
        mais.botao._texto.text = '+';
        menos.botao._texto.x = SMALL_BTN / 2;
        menos.botao._texto.y = SMALL_BTN / 2;
        mais.botao._texto.x = SMALL_BTN / 2;
        mais.botao._texto.y = SMALL_BTN / 2;
        drawBtn(menos.botao._bg, 0, 0, SMALL_BTN, SMALL_BTN, false, false, false);
        drawBtn(mais.botao._bg, 0, 0, SMALL_BTN, SMALL_BTN, false, false, false);
        menos.botao.x = 130;
        mais.botao.x = 266;
        menos.botao.y = baseY;
        mais.botao.y = baseY;
        painel._txtCargaInfo.text += `\n${sigla}: ${naveSelecionada.configuracaoCarga[recurso]}`;
      });
    }
    return;
  }

  painel._naveSelecionada = null;
  if (!planetaSel) {
    info.visible = false;
    painel._planetaSelecionado = null;
    return;
  }

  info.visible = true;
  painel._planetaSelecionado = planetaSel;
  const d = planetaSel.dados;
  const exp = painel._painelProducaoExpandido;
  const mostrarProducao = d.dono === 'jogador';

  // === INFO DATA ===
  const tempoRestanteSeg = (calcularTempoRestantePlaneta(planetaSel) / 1000).toFixed(1);
  const custoFabrica = calcularCustoTier(d.fabricas);
  const custoInfra = calcularCustoTier(d.infraestrutura);
  const tempoFabrica = calcularTempoConstrucaoMs(d.fabricas);
  const tempoInfra = calcularTempoConstrucaoMs(d.infraestrutura);
  const tempoColonizadora = calcularTempoColonizadoraMs(planetaSel);
  const pesqAtual: Pesquisa | null = getPesquisaAtual(planetaSel);
  const filaCheia = d.filaProducao.length >= 5;

  // Build info rows: [label, value, valueColor]
  const rows: { key: string; label: string; value: string; color: number }[] = [
    { key: 'dono', label: 'Dono', value: d.dono, color: d.dono === 'jogador' ? SP.statCyan : 0x888888 },
    { key: 'tipo', label: 'Tipo', value: nomeTipoPlaneta(d.tipoPlaneta), color: SP.textValue },
    { key: 'ciclo', label: 'Ciclo', value: `${tempoRestanteSeg}s`, color: SP.statAmber },
    { key: 'prod', label: 'Producao', value: textoProducaoCicloPlaneta(planetaSel), color: SP.statGreen },
    { key: 'fabrica', label: 'Fabrica', value: `${d.fabricas} / ${getTierMax()}`, color: SP.textValue },
    { key: 'infra', label: 'Infra', value: `${d.infraestrutura} / ${getTierMax()}`, color: SP.textValue },
    { key: 'navesVoo', label: 'Naves voo', value: `${d.naves}`, color: SP.statCyan },
  ];

  // Optional rows
  if (pesqAtual) {
    rows.push({ key: 'pesquisa', label: 'Pesquisa', value: `${LABEL_PESQUISA[pesqAtual.categoria] || pesqAtual.categoria} T${pesqAtual.tier} (${formatarTempo(pesqAtual.tempoRestanteMs)})`, color: 0xcc88ff });
  }
  if (d.construcaoAtual) {
    rows.push({ key: 'obra', label: 'Obra', value: `${d.construcaoAtual.tipo} T${d.construcaoAtual.tierDestino} (${formatarTempo(d.construcaoAtual.tempoRestanteMs)})`, color: SP.statAmber });
  }
  if (d.producaoNave) {
    const tn = d.producaoNave.tipoNave || 'nave';
    const tr = d.producaoNave.tier || 1;
    const nome = tn === 'colonizadora' ? 'Colonizadora' : `${LABEL_PESQUISA[tn] || tn} T${tr}`;
    rows.push({ key: 'filaNave', label: 'Nave', value: `${nome} (${formatarTempo(d.producaoNave.tempoRestanteMs)})`, color: SP.statCyan });
  }

  // Hide all info fields first
  for (const name in f) {
    f[name].lbl.visible = false;
    f[name].val.visible = false;
  }

  // === LAYOUT ===
  const lineH = 18;
  const fieldX = 8, fieldY = 28, fieldPad = 8;
  const lblW = 80; // fixed label column width
  const fieldH = rows.length * lineH + fieldPad * 2;
  const boxPad = 6;
  const colGap = 4;

  // Position info fields and measure width
  let maxRowW = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const field = f[row.key];
    field.lbl.visible = true;
    field.val.visible = true;

    field.lbl.text = row.label;
    field.lbl.style.fill = SP.textLabel;
    field.lbl.x = fieldX + fieldPad;
    field.lbl.y = fieldY + fieldPad + i * lineH;

    field.val.text = row.value;
    field.val.style.fill = row.color;
    field.val.x = fieldX + fieldPad + lblW;
    field.val.y = fieldY + fieldPad + i * lineH;

    const rowW = lblW + field.val.width;
    if (rowW > maxRowW) maxRowW = rowW;
  }

  const W_COLLAPSED = Math.max(280, maxRowW + fieldX * 2 + fieldPad * 2 + 10);

  // Column widths for production
  const edColW = 160;
  const navColW = 170;
  const pesColW = boxPad * 2 + 72 + 5 * (SMALL_BTN + 3);
  const filaColW = 170;
  const W_EXPANDED = PAD * 2 + 8 + edColW + navColW + pesColW + filaColW + colGap * 3;
  const W = exp ? Math.max(W_COLLAPSED, W_EXPANDED) : W_COLLAPSED;

  // Compute column heights
  let colH = 0;
  if (mostrarProducao && exp) {
    const edH = 18 + 2 * (BTN_H + 3) + boxPad * 2;

    let visNavCount = 0;
    for (const btn of painel._btnNaves) {
      const parsed: AcaoNaveParsed | null = parseAcaoNave(btn._acao);
      if (parsed) {
        if (parsed.tipo === 'colonizadora') { if (d.fabricas >= 1) visNavCount++; }
        else { if (pesquisaTierLiberada(planetaSel, parsed.tipo, parsed.tier)) visNavCount++; }
      }
    }
    const navH = 18 + Math.max(1, visNavCount) * (BTN_H + 3) + boxPad * 2;
    const pesH = 18 + 3 * (SMALL_BTN + 3) + boxPad * 2;
    const filaH = 150;
    colH = Math.max(edH, navH, pesH, filaH);
  }

  const toggleH = mostrarProducao ? 30 : 0;
  const prodTotalH = exp ? colH + 8 : 0;
  const H = fieldY + fieldH + 6 + prodTotalH + toggleH + 8;

  // === DRAW PANEL ===
  bg.clear();
  drawPanelFrame(bg, 0, 0, W, H);
  drawTitleBar(bg, 0, 0, W, 22);

  // Draw info field container with inner decoration
  drawInfoField(bg, fieldX, fieldY, W - fieldX * 2, fieldH);
  // Separator line between labels and values
  const sepX = fieldX + fieldPad + lblW - 6;
  bg.moveTo(sepX, fieldY + 4).lineTo(sepX, fieldY + fieldH - 4).stroke({ color: SP.sectionLine, width: 1, alpha: 0.3 });
  // Row separators
  for (let i = 1; i < rows.length; i++) {
    const ry = fieldY + fieldPad + i * lineH - 2;
    bg.moveTo(fieldX + 4, ry).lineTo(fieldX + W - fieldX * 2 - 4, ry).stroke({ color: SP.fieldBorder, width: 1, alpha: 0.4 });
  }

  info.x = 16;
  info.y = app.screen.height - H - 18;

  painel._infoNome.text = d.dono === 'jogador'
    ? `Seu planeta — ${nomeTipoPlaneta(d.tipoPlaneta)}`
    : `Planeta neutro — ${nomeTipoPlaneta(d.tipoPlaneta)}`;
  painel._infoNome.x = 18; painel._infoNome.y = 3;

  // === TOGGLE BUTTON ===
  const toggle = painel._btnToggleProducao;
  toggle.visible = mostrarProducao;
  toggle.x = PAD + 4;
  toggle.y = H - toggleH - 4;
  toggle._texto.text = exp ? 'Recolher' : 'Producao';
  drawBtn(toggle._bg, 0, 0, 150, 24, false, false, false);
  toggle._texto.style.fill = SP.btnText;
  toggle._texto.x = 75; toggle._texto.y = 12;

  // === PRODUCTION COLUMNS ===
  painel._boxEdificios.visible = false;
  painel._boxNaves.visible = false;
  painel._boxPesquisa.visible = false;
  painel._overlayPesquisa.visible = false;
  for (const b of painel._btnNaves) b.visible = false;
  for (const { botao } of painel._btnPesquisa) botao.visible = false;
  painel._btnFabrica.visible = false;
  painel._btnInfra.visible = false;
  painel._btnAbrirPesquisa.visible = false;
  for (const cat in painel._catLabels) painel._catLabels[cat].visible = false;

  if (!mostrarProducao || !exp) return;

  const colY = fieldY + fieldH + 6;
  const colStartX = PAD + 4;

  // ---- COLUMN 1: EDIFICIOS ----
  const col1X = colStartX;
  painel._boxEdificios.visible = true;
  painel._boxEdificios.x = col1X;
  painel._boxEdificios.y = colY;

  const edBg = painel._boxEdificios._bg;
  edBg.clear();
  drawBox(edBg, 0, 0, edColW, colH);
  painel._boxEdificios._lbl.x = boxPad;
  painel._boxEdificios._lbl.y = boxPad - 2;

  const edBtnW = edColW - boxPad * 2;
  let edBtnY = boxPad + 16;

  let desab = !custoFabrica || d.recursos.comum < custoFabrica || filaCheia;
  painel._btnFabrica.visible = true;
  painel._btnFabrica.x = boxPad;
  painel._btnFabrica.y = edBtnY;
  painel._btnFabrica._texto.text = custoFabrica ? `Fab T${d.fabricas + 1} ${custoFabrica}C ${formatarTempo(tempoFabrica)}` : 'Fab max';
  painel._btnFabrica._texto.x = edBtnW / 2;
  painel._btnFabrica._texto.y = BTN_H / 2;
  painel._btnFabrica._texto.style.wordWrapWidth = edBtnW - 6;
  painel._btnFabrica._texto.style.fontSize = 12;
  drawBtn(painel._btnFabrica._bg, 0, 0, edBtnW, BTN_H, desab, !desab, false);
  painel._btnFabrica._texto.style.fill = desab ? SP.btnDisabledText : SP.btnActionText;

  edBtnY += BTN_H + 3;
  desab = !custoInfra || d.recursos.comum < custoInfra || filaCheia;
  painel._btnInfra.visible = true;
  painel._btnInfra.x = boxPad;
  painel._btnInfra.y = edBtnY;
  painel._btnInfra._texto.text = custoInfra ? `Inf T${d.infraestrutura + 1} ${custoInfra}C ${formatarTempo(tempoInfra)}` : 'Inf max';
  painel._btnInfra._texto.x = edBtnW / 2;
  painel._btnInfra._texto.y = BTN_H / 2;
  painel._btnInfra._texto.style.wordWrapWidth = edBtnW - 6;
  painel._btnInfra._texto.style.fontSize = 12;
  drawBtn(painel._btnInfra._bg, 0, 0, edBtnW, BTN_H, desab, !desab, false);
  painel._btnInfra._texto.style.fill = desab ? SP.btnDisabledText : SP.btnActionText;

  // ---- COLUMN 2: NAVES ----
  const col2X = colStartX + edColW + colGap;
  painel._boxNaves.visible = true;
  painel._boxNaves.x = col2X;
  painel._boxNaves.y = colY;

  const navBg = painel._boxNaves._bg;
  navBg.clear();
  drawBox(navBg, 0, 0, navColW, colH);
  painel._boxNaves._lbl.x = boxPad;
  painel._boxNaves._lbl.y = boxPad - 2;

  const navBtnW = navColW - boxPad * 2;
  let navI = 0;
  for (const btn of painel._btnNaves) {
    const parsed: AcaoNaveParsed | null = parseAcaoNave(btn._acao);
    if (!parsed) continue;

    let vis: boolean, desabN: boolean, sub: string;

    if (parsed.tipo === 'colonizadora') {
      vis = d.fabricas >= 1;
      desabN = d.fabricas < 1 || !tempoColonizadora || d.recursos.comum < CUSTO_NAVE_COMUM || filaCheia;
      sub = formatarTempo(tempoColonizadora);
    } else {
      const lib = pesquisaTierLiberada(planetaSel, parsed.tipo, parsed.tier);
      vis = lib;
      desabN = !lib || d.fabricas < parsed.tier || !tempoColonizadora || d.recursos.comum < CUSTO_NAVE_COMUM || filaCheia;
      sub = formatarTempo(tempoColonizadora);
    }

    btn.visible = vis;
    if (vis) {
      btn.x = boxPad;
      btn.y = boxPad + 16 + navI * (BTN_H + 3);
      const cargaTxt = parsed.tipo === 'cargueira' ? ` ${capacidadeCargaCargueira(parsed.tier)}R` : '';
      btn._texto.text = `${btn._labelNave}${cargaTxt}  ${sub}`;
      btn._texto.x = navBtnW / 2;
      btn._texto.y = BTN_H / 2;
      btn._texto.style.wordWrapWidth = navBtnW - 4;
      btn._texto.style.fontSize = 12;
      drawBtn(btn._bg, 0, 0, navBtnW, BTN_H, desabN, false, false);
      navI++;
    }
  }

  // ---- COLUMN 3: PESQUISA ----
  const col3X = colStartX + edColW + colGap + navColW + colGap;
  painel._boxPesquisa.visible = true;
  painel._boxPesquisa.x = col3X;
  painel._boxPesquisa.y = colY;

  const pesBg = painel._boxPesquisa._bg;
  pesBg.clear();
  drawBox(pesBg, 0, 0, pesColW, colH);
  painel._boxPesquisa._lbl.x = boxPad;
  painel._boxPesquisa._lbl.y = boxPad - 2;

  const pesBtnW = pesColW - boxPad * 2;
  painel._txtPesquisaResumo.text = pesqAtual
    ? `${LABEL_PESQUISA[pesqAtual.categoria] || pesqAtual.categoria} T${pesqAtual.tier}\n${formatarTempo(pesqAtual.tempoRestanteMs)} restante`
    : 'Abra a arvore para pesquisar\nDesbloqueia naves por planeta';
  painel._txtPesquisaResumo.x = boxPad;
  painel._txtPesquisaResumo.y = boxPad + 18;
  painel._txtPesquisaResumo.style.fill = pesqAtual ? 0xcc88ff : SP.textLabel;
  painel._txtPesquisaResumo.style.wordWrap = true;
  painel._txtPesquisaResumo.style.wordWrapWidth = pesBtnW;

  painel._btnAbrirPesquisa.visible = true;
  painel._btnAbrirPesquisa.x = boxPad;
  painel._btnAbrirPesquisa.y = colH - BTN_H - boxPad;
  painel._btnAbrirPesquisa._texto.text = painel._arvorePesquisaAberta ? 'Fechar arvore' : 'Abrir arvore';
  painel._btnAbrirPesquisa._texto.x = pesBtnW / 2;
  painel._btnAbrirPesquisa._texto.y = BTN_H / 2;
  painel._btnAbrirPesquisa._texto.style.fontSize = 12;
  painel._btnAbrirPesquisa._texto.style.wordWrapWidth = pesBtnW - 6;
  drawBtn(painel._btnAbrirPesquisa._bg, 0, 0, pesBtnW, BTN_H, false, true, false);
  painel._btnAbrirPesquisa._texto.style.fill = SP.btnActionText;

  if (painel._arvorePesquisaAberta) {
    const overlay = painel._overlayPesquisa;
    const overlayBg = painel._overlayPesquisaBg;
    overlay.visible = true;

    const treeLabelW = 92;
    const treeNode = 38;
    const treeGap = 18;
    const treeRow = 44;
    const treeW = 22 + treeLabelW + 5 * treeNode + 4 * treeGap + 22;
    const treeH = 42 + 3 * treeRow + 24;
    overlay.x = Math.max(8, Math.floor((W - treeW) / 2));
    overlay.y = -treeH - 12;

    overlayBg.clear();
    drawPanelFrame(overlayBg, 0, 0, treeW, treeH);
    drawTitleBar(overlayBg, 0, 0, treeW, 22);
    drawInfoField(overlayBg, 10, 28, treeW - 20, treeH - 38);

    const pesquisaOcupada = !!pesqAtual;
    const xBaseNode = 18 + treeLabelW;
    const yBaseNode = 44;
    for (let i = 0; i < 4; i++) {
      const x1 = xBaseNode + i * (treeNode + treeGap) + treeNode;
      const x2 = xBaseNode + (i + 1) * (treeNode + treeGap);
      for (let row = 0; row < 3; row++) {
        const y = yBaseNode + row * treeRow + treeNode / 2;
        overlayBg.moveTo(x1 + 3, y).lineTo(x2 - 3, y).stroke({ color: SP.sectionLine, width: 1, alpha: 0.45 });
      }
    }

    let rowIndex = 0;
    for (const cat of ['cargueira', 'batedora', 'torreta']) {
      const rowY = yBaseNode + rowIndex * treeRow;
      const cl = painel._catLabels[cat];
      cl.visible = true;
      cl.x = 18;
      cl.y = rowY + 9;
      cl.style.fill = cat === 'cargueira' ? SP.statCyan : SP.textLabel;

      for (const { botao, categoria, tier } of painel._btnPesquisa) {
        if (categoria !== cat) continue;
        botao.visible = true;
        botao.x = xBaseNode + (tier - 1) * (treeNode + treeGap);
        botao.y = rowY;
        botao._texto.text = String(tier);
        botao._texto.x = treeNode / 2;
        botao._texto.y = treeNode / 2;
        botao._texto.style.fontSize = 13;

        const concluida = pesquisaTierLiberada(planetaSel, categoria, tier);
        const emPesquisa = !!pesqAtual && pesqAtual.categoria === categoria && pesqAtual.tier === tier;
        const disponivel = pesquisaTierDisponivel(planetaSel, categoria, tier);
        const semRaro = r.raro < CUSTO_PESQUISA_RARO;
        const desabP = !concluida && !emPesquisa && (!disponivel || pesquisaOcupada || semRaro);

        if (concluida) {
          drawBtn(botao._bg, 0, 0, treeNode, treeNode, false, false, true);
          botao._texto.style.fill = SP.btnDoneText;
        } else if (emPesquisa) {
          drawBtn(botao._bg, 0, 0, treeNode, treeNode, false, true, false);
          botao._texto.style.fill = SP.btnActionText;
        } else {
          drawBtn(botao._bg, 0, 0, treeNode, treeNode, desabP, disponivel, false);
          botao._texto.style.fill = desabP ? SP.btnDisabledText : (categoria === 'cargueira' ? SP.statCyan : SP.btnText);
        }
      }
      rowIndex++;
    }
  }

  // ---- COLUMN 4: FILA ----
  const col4X = colStartX + edColW + colGap + navColW + colGap + pesColW + colGap;
  painel._boxFila.visible = true;
  painel._boxFila.x = col4X;
  painel._boxFila.y = colY;
  const filaBg = painel._boxFila._bg;
  filaBg.clear();
  drawBox(filaBg, 0, 0, filaColW, colH);
  painel._boxFila._lbl.x = boxPad;
  painel._boxFila._lbl.y = boxPad - 2;
  const atualFila = d.filaProducao.map((item, idx) => {
      const parsed = parseAcaoNave(item.acao);
      const prefixo = idx === 0 && (d.construcaoAtual || d.producaoNave) ? '>> ' : `${idx + 1}. `;
      if (parsed) return `${prefixo}${parsed.tipo === 'colonizadora' ? 'Colonizadora' : `${LABEL_PESQUISA[parsed.tipo] || parsed.tipo} T${parsed.tier}`}`;
      return `${prefixo}${item.acao === 'fabrica' ? 'Fabrica' : 'Infraestrutura'}`;
    }).slice(0, 5);
  const resumoFila = [
    atualFila.length ? atualFila.join('\n') : 'Fila vazia',
    '',
    `Slots: ${d.filaProducao.length}/5`,
    `Loop: ${d.repetirFilaProducao ? 'ligado' : 'desligado'}`,
  ];
  painel._txtFilaResumo.text = resumoFila.join('\n');
  painel._txtFilaResumo.x = boxPad;
  painel._txtFilaResumo.y = boxPad + 18;
  painel._txtFilaResumo.style.wordWrap = true;
  painel._txtFilaResumo.style.wordWrapWidth = filaColW - boxPad * 2;

  const filaBtnW = filaColW - boxPad * 2;
  painel._btnFilaRepeat.visible = true;
  painel._btnFilaRepeat.x = boxPad;
  painel._btnFilaRepeat.y = colH - BTN_H * 2 - boxPad - 4;
  painel._btnFilaRepeat._texto.text = d.repetirFilaProducao ? 'Repeticao ON' : 'Repeticao OFF';
  painel._btnFilaRepeat._texto.x = filaBtnW / 2;
  painel._btnFilaRepeat._texto.y = BTN_H / 2;
  drawBtn(painel._btnFilaRepeat._bg, 0, 0, filaBtnW, BTN_H, false, d.repetirFilaProducao, false);
  painel._btnFilaRepeat._texto.style.fill = d.repetirFilaProducao ? SP.btnActionText : SP.btnText;

  painel._btnFilaLimpar.visible = true;
  painel._btnFilaLimpar.x = boxPad;
  painel._btnFilaLimpar.y = colH - BTN_H - boxPad;
  painel._btnFilaLimpar._texto.text = 'Limpar fila';
  painel._btnFilaLimpar._texto.x = filaBtnW / 2;
  painel._btnFilaLimpar._texto.y = BTN_H / 2;
  drawBtn(painel._btnFilaLimpar._bg, 0, 0, filaBtnW, BTN_H, false, false, false);
  painel._btnFilaLimpar._texto.style.fill = SP.btnText;
}

export function definirAcaoPainel(painel: PainelContainer, callback: (acao: string, planeta: Planeta) => void): void {
  painel._onAcaoPlaneta = callback;
}

export function definirAcaoNavePainel(painel: PainelContainer, callback: (acao: string, nave: Nave) => void): void {
  painel._onAcaoNave = callback;
}
