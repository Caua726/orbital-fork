import { Container, Graphics, Text } from 'pixi.js';
import {
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
  pesquisaTierLiberada,
  textoProducaoCicloPlaneta,
} from '../world/mundo.js';

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

const LABEL_PESQUISA = { torreta: 'Torreta', cargueira: 'Cargueira', batedora: 'Batedora' };

const PAD = 8;
const BTN_H = 28;
const SMALL_BTN = 28;

function formatarTempo(ms) {
  const totalSeg = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

function drawPanelFrame(g, x, y, w, h) {
  g.rect(x, y, w, h / 2).fill({ color: SP.panelBg });
  g.rect(x, y + h / 2, w, h / 2).fill({ color: SP.panelBgDark });
  g.roundRect(x, y, w, h, 4).stroke({ color: SP.panelBorder, width: 2 });
  const s = 10;
  g.moveTo(x, y + s).lineTo(x, y).lineTo(x + s, y).stroke({ color: SP.cornerAccent, width: 2 });
  g.moveTo(x + w - s, y).lineTo(x + w, y).lineTo(x + w, y + s).stroke({ color: SP.cornerAccent, width: 2 });
  g.moveTo(x, y + h - s).lineTo(x, y + h).lineTo(x + s, y + h).stroke({ color: SP.cornerAccent, width: 2 });
  g.moveTo(x + w - s, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - s).stroke({ color: SP.cornerAccent, width: 2 });
}

function drawTitleBar(g, x, y, w, h) {
  g.rect(x + 2, y, w - 4, h).fill({ color: SP.titleBg });
  g.rect(x + 2 + (w - 4) / 3, y, (w - 4) * 2 / 3, h).fill({ color: SP.titleBgLight, alpha: 0.5 });
  g.moveTo(x + 2, y + h).lineTo(x + w - 2, y + h).stroke({ color: SP.panelBorder, width: 1 });
  const dx = x + 10, dy = y + h / 2;
  g.moveTo(dx, dy - 3).lineTo(dx + 3, dy).lineTo(dx, dy + 3).lineTo(dx - 3, dy).lineTo(dx, dy - 3).fill({ color: SP.diamond });
}

function drawInfoField(g, x, y, w, h) {
  g.rect(x, y, w, h).fill({ color: SP.fieldBg });
  g.rect(x, y, w, h).stroke({ color: SP.fieldBorder, width: 1 });
}

// Draw a labeled box container
function drawBox(g, x, y, w, h, label) {
  g.rect(x, y, w, h).fill({ color: SP.boxBg });
  g.roundRect(x, y, w, h, 3).stroke({ color: SP.boxBorder, width: 1 });
}

function drawBtn(g, x, y, w, h, disabled, action, done) {
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

function criarBotaoAcao(parent, textoInicial, acao) {
  const botao = new Container();
  botao.eventMode = 'static';
  botao.cursor = 'pointer';
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

  botao.on('pointertap', () => {
    // Walk up to find the root panel container
    let p = botao.parent;
    while (p && !p._onAcaoPlaneta) p = p.parent;
    if (!p || typeof p._onAcaoPlaneta !== 'function') return;
    if (!p._planetaSelecionado) return;
    if (botao._acao?.startsWith?.('pesquisa_')) {
      const m = botao._acao.match(/^pesquisa_(torreta|cargueira|batedora)_(\d)$/);
      if (m) iniciarPesquisa(p._mundoRef, m[1], Number(m[2]));
      return;
    }
    p._onAcaoPlaneta(botao._acao, p._planetaSelecionado);
  });

  parent.addChild(botao);
  return botao;
}

export function criarPainel(app) {
  const container = new Container();

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
  const infoFields = {};
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
  const boxEdificios = new Container();
  boxEdificios.visible = false;
  infoContainer.addChild(boxEdificios);
  const boxEdBg = new Graphics();
  boxEdificios.addChild(boxEdBg);
  boxEdificios._bg = boxEdBg;
  const lblEd = new Text({ text: 'Edificios', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxEdificios.addChild(lblEd);
  boxEdificios._lbl = lblEd;

  const btnFabrica = criarBotaoAcao(boxEdificios, '', 'fabrica');
  const btnInfra = criarBotaoAcao(boxEdificios, '', 'infraestrutura');

  // Box 2: Naves
  const boxNaves = new Container();
  boxNaves.visible = false;
  infoContainer.addChild(boxNaves);
  const boxNavBg = new Graphics();
  boxNaves.addChild(boxNavBg);
  boxNaves._bg = boxNavBg;
  const lblNav = new Text({ text: 'Naves', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxNaves.addChild(lblNav);
  boxNaves._lbl = lblNav;

  const btnNaves = [];
  const acoesNave = [{ acao: 'nave_colonizadora', label: 'Colonizadora' }];
  for (const tipo of ['cargueira', 'batedora', 'torreta']) {
    for (let t = 1; t <= 5; t++) {
      acoesNave.push({ acao: `nave_${tipo}_${t}`, label: `${LABEL_PESQUISA[tipo] || tipo} T${t}` });
    }
  }
  for (const a of acoesNave) {
    const b = criarBotaoAcao(boxNaves, a.label, a.acao);
    b._labelNave = a.label;
    btnNaves.push(b);
  }

  // Box 3: Pesquisa
  const boxPesquisa = new Container();
  boxPesquisa.visible = false;
  infoContainer.addChild(boxPesquisa);
  const boxPesBg = new Graphics();
  boxPesquisa.addChild(boxPesBg);
  boxPesquisa._bg = boxPesBg;
  const lblPes = new Text({ text: 'Pesquisa', style: { fontSize: 12, fill: SP.sectionText, fontFamily: 'monospace' } });
  boxPesquisa.addChild(lblPes);
  boxPesquisa._lbl = lblPes;

  const btnPesquisa = [];
  const catLabels = {};
  for (const cat of ['torreta', 'cargueira', 'batedora']) {
    const rowLabel = new Text({ text: LABEL_PESQUISA[cat], style: { fontSize: 12, fill: SP.textLabel, fontFamily: 'monospace' } });
    boxPesquisa.addChild(rowLabel);
    catLabels[cat] = rowLabel;
    for (let t = 1; t <= 5; t++) {
      const b = criarBotaoAcao(boxPesquisa, String(t), `pesquisa_${cat}_${t}`);
      btnPesquisa.push({ botao: b, categoria: cat, tier: t });
    }
  }

  // Toggle button
  const btnToggleProducao = new Container();
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

  btnToggleProducao.on('pointertap', () => {
    container._painelProducaoExpandido = !container._painelProducaoExpandido;
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
  container._btnToggleProducao = btnToggleProducao;
  container._barraBg = barraBg;
  container._btnFabrica = btnFabrica;
  container._btnInfra = btnInfra;
  container._btnNaves = btnNaves;
  container._btnPesquisa = btnPesquisa;
  container._planetaSelecionado = null;
  container._onAcaoPlaneta = null;
  container._painelProducaoExpandido = false;
  container._mundoRef = null;

  return container;
}

export function atualizarPainel(painel, mundo, tipoJogador, app) {
  painel._mundoRef = mundo;

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
  let planetaSel = null;
  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === 'jogador') qtdPlanetas++;
    if (planeta.dados.selecionado) planetaSel = planeta;
  }

  const naveSelecionada = obterNaveSelecionada(mundo);
  const totalNaves = mundo.naves.length;
  const r = mundo.recursosJogador || { comum: 0, raro: 0, combustivel: 0 };

  // Update text values
  painel._txtPlanetas.text = `Planetas: ${qtdPlanetas}`;
  painel._txtComum.text = `C: ${Math.floor(r.comum)}`;
  painel._txtRaro.text = `R: ${Math.floor(r.raro)}`;
  painel._txtCombustivel.text = `F: ${Math.floor(r.combustivel)}`;
  painel._txtTipo.text = tipoJogador.nome;
  painel._txtNaves.text = `Naves: ${totalNaves}`;
  painel._txtContador.text = naveSelecionada ? 'Nave selecionada: clique no destino' : '';

  // Draw stat group sunken boxes and position text
  const sg = painel._statGroupBgs;
  sg.clear();
  const sgH = 20;
  const sgY = 4;
  const sgPadX = 6;
  const sgGap = 6;

  // Helper: draw a stat group box and return its right edge x
  function drawStatGroup(x, texts) {
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
  if (naveSelecionada) {
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
  const pesqAtual = getPesquisaAtual(mundo);

  // Build info rows: [label, value, valueColor]
  const f = painel._infoFields;
  const rows = [
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
    const tn = d.producaoNave.tipoNave || d.producaoNave.tipo || 'nave';
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
  const W_EXPANDED = PAD * 2 + 8 + edColW + navColW + pesColW + colGap * 2;
  const W = exp ? Math.max(W_COLLAPSED, W_EXPANDED) : W_COLLAPSED;

  // Compute column heights
  let colH = 0;
  if (mostrarProducao && exp) {
    const edH = 18 + 2 * (BTN_H + 3) + boxPad * 2;

    let visNavCount = 0;
    for (const btn of painel._btnNaves) {
      const parsed = parseAcaoNave(btn._acao);
      if (parsed) {
        if (parsed.tipo === 'colonizadora') { if (d.fabricas >= 1) visNavCount++; }
        else { if (pesquisaTierLiberada(mundo, parsed.tipo, parsed.tier)) visNavCount++; }
      }
    }
    const navH = 18 + Math.max(1, visNavCount) * (BTN_H + 3) + boxPad * 2;
    const pesH = 18 + 3 * (SMALL_BTN + 3) + boxPad * 2;
    colH = Math.max(edH, navH, pesH);
  }

  const toggleH = mostrarProducao ? 30 : 0;
  const prodTotalH = exp ? colH + 8 : 0;
  const H = fieldY + fieldH + 6 + prodTotalH + toggleH + 8;

  // === DRAW PANEL ===
  const bg = painel._infoBg;
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
  for (const b of painel._btnNaves) b.visible = false;
  for (const { botao } of painel._btnPesquisa) botao.visible = false;
  painel._btnFabrica.visible = false;
  painel._btnInfra.visible = false;
  for (const cat in painel._catLabels) painel._catLabels[cat].visible = false;

  if (!mostrarProducao || !exp) return;

  const colY = fieldY + fieldH + 6;
  const colStartX = PAD + 4;

  // ──── COLUMN 1: EDIFICIOS ────
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

  let desab = !custoFabrica || !!d.construcaoAtual;
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
  desab = !custoInfra || !!d.construcaoAtual;
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

  // ──── COLUMN 2: NAVES ────
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
    const parsed = parseAcaoNave(btn._acao);
    if (!parsed) continue;

    let vis = false;
    let desabN = true;
    let sub = '';

    if (parsed.tipo === 'colonizadora') {
      vis = d.fabricas >= 1;
      desabN = d.fabricas < 1 || !!d.producaoNave || !tempoColonizadora;
      sub = formatarTempo(tempoColonizadora);
    } else {
      const lib = pesquisaTierLiberada(mundo, parsed.tipo, parsed.tier);
      vis = lib;
      desabN = !lib || d.fabricas < parsed.tier || !!d.producaoNave || !tempoColonizadora;
      sub = formatarTempo(tempoColonizadora);
    }

    btn.visible = vis;
    if (vis) {
      btn.x = boxPad;
      btn.y = boxPad + 16 + navI * (BTN_H + 3);
      btn._texto.text = `${btn._labelNave}  ${sub}`;
      btn._texto.x = navBtnW / 2;
      btn._texto.y = BTN_H / 2;
      btn._texto.style.wordWrapWidth = navBtnW - 4;
      btn._texto.style.fontSize = 12;
      drawBtn(btn._bg, 0, 0, navBtnW, BTN_H, desabN, false, false);
      navI++;
    }
  }

  // ──── COLUMN 3: PESQUISA ────
  const col3X = colStartX + edColW + colGap + navColW + colGap;
  painel._boxPesquisa.visible = true;
  painel._boxPesquisa.x = col3X;
  painel._boxPesquisa.y = colY;

  const pesBg = painel._boxPesquisa._bg;
  pesBg.clear();
  drawBox(pesBg, 0, 0, pesColW, colH);
  painel._boxPesquisa._lbl.x = boxPad;
  painel._boxPesquisa._lbl.y = boxPad - 2;

  const pesquisaOcupada = !!pesqAtual;
  let pesRow = 0;
  for (const cat of ['torreta', 'cargueira', 'batedora']) {
    const catY = boxPad + 16 + pesRow * (SMALL_BTN + 3);

    const cl = painel._catLabels[cat];
    cl.visible = true;
    cl.x = boxPad;
    cl.y = catY + 5;

    for (const { botao, categoria, tier } of painel._btnPesquisa) {
      if (categoria !== cat) continue;
      botao.visible = true;
      botao.x = boxPad + 72 + (tier - 1) * (SMALL_BTN + 3);
      botao.y = catY;
      botao._texto.text = String(tier);
      botao._texto.x = SMALL_BTN / 2;
      botao._texto.y = SMALL_BTN / 2;
      botao._texto.style.fontSize = 13;

      const ja = pesquisaTierLiberada(mundo, categoria, tier);
      const desabP = ja || pesquisaOcupada || r.raro < 5;
      if (ja) {
        drawBtn(botao._bg, 0, 0, SMALL_BTN, SMALL_BTN, false, false, true);
        botao._texto.style.fill = SP.btnDoneText;
      } else {
        drawBtn(botao._bg, 0, 0, SMALL_BTN, SMALL_BTN, desabP, false, false);
        botao._texto.style.fill = desabP ? SP.btnDisabledText : SP.btnText;
      }
      botao.alpha = 1;
    }
    pesRow++;
  }
}

export function definirAcaoPainel(painel, callback) {
  painel._onAcaoPlaneta = callback;
}
