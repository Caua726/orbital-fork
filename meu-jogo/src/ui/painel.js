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

const CORES_DONO = {
  neutro: 0x888888,
  jogador: 0x44aaff,
};

const LABEL_PESQUISA = {
  torreta: 'Torreta',
  cargueira: 'Cargueira',
  batedora: 'Batedora',
};

const NAV_BTN_W = 76;
const NAV_BTN_H = 26;

function formatarTempo(ms) {
  const totalSeg = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

function criarBotaoAcao(parent, x, y, w, h, textoInicial, acao) {
  const botao = new Container();
  botao.x = x;
  botao.y = y;
  botao.eventMode = 'static';
  botao.cursor = 'pointer';
  botao._acao = acao;

  const bg = new Graphics();
  botao.addChild(bg);
  botao._bg = bg;

  const texto = new Text({
    text: textoInicial,
    style: { fontSize: 9, fill: 0xffffff, fontFamily: 'monospace', align: 'center', wordWrap: true, wordWrapWidth: w - 4 },
  });
  texto.anchor.set(0.5);
  texto.x = w / 2;
  texto.y = h / 2;
  botao.addChild(texto);
  botao._texto = texto;

  botao.on('pointertap', () => {
    const painel = botao.parent?.parent?.parent?.parent;
    if (!painel || typeof painel._onAcaoPlaneta !== 'function') return;
    if (!painel._planetaSelecionado) return;
    if (botao._acao?.startsWith?.('pesquisa_')) {
      const m = botao._acao.match(/^pesquisa_(torreta|cargueira|batedora)_(\d)$/);
      if (m) iniciarPesquisa(painel._mundoRef, m[1], Number(m[2]));
      return;
    }
    painel._onAcaoPlaneta(botao._acao, painel._planetaSelecionado);
  });

  parent.addChild(botao);
  return botao;
}

function redesenharBotao(botao, w, h, desabilitado) {
  const bg = botao._bg;
  bg.clear();
  bg.roundRect(0, 0, w, h, 5).fill({ color: desabilitado ? 0x333333 : 0x1c3048, alpha: 0.95 });
  bg.roundRect(0, 0, w, h, 5).stroke({ color: desabilitado ? 0x666666 : 0x5da9ff, width: 1 });
}

export function criarPainel(app) {
  const container = new Container();

  const barraBg = new Graphics();
  barraBg.rect(0, 0, app.screen.width, 40).fill({ color: 0x000000, alpha: 0.5 });
  container.addChild(barraBg);

  const txtPlanetas = new Text({
    text: '',
    style: { fontSize: 14, fill: 0x44aaff, fontFamily: 'monospace' },
  });
  txtPlanetas.x = 15;
  txtPlanetas.y = 10;
  container.addChild(txtPlanetas);

  const txtRecursos = new Text({
    text: '',
    style: { fontSize: 14, fill: 0x44ff88, fontFamily: 'monospace' },
  });
  txtRecursos.x = 200;
  txtRecursos.y = 10;
  container.addChild(txtRecursos);

  const txtTipo = new Text({
    text: '',
    style: { fontSize: 14, fill: 0xffaa00, fontFamily: 'monospace' },
  });
  txtTipo.x = 420;
  txtTipo.y = 10;
  container.addChild(txtTipo);

  const txtContador = new Text({
    text: '',
    style: { fontSize: 14, fill: 0xffffff, fontFamily: 'monospace' },
  });
  txtContador.x = 650;
  txtContador.y = 10;
  container.addChild(txtContador);

  const infoContainer = new Container();
  infoContainer.visible = false;

  const infoBg = new Graphics();
  infoContainer.addChild(infoBg);

  const infoNome = new Text({
    text: '',
    style: { fontSize: 16, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  infoNome.x = 12;
  infoNome.y = 10;
  infoContainer.addChild(infoNome);

  const infoDetalhes = new Text({
    text: '',
    style: { fontSize: 12, fill: 0xcccccc, fontFamily: 'monospace', lineHeight: 15 },
  });
  infoDetalhes.x = 12;
  infoDetalhes.y = 36;
  infoContainer.addChild(infoDetalhes);

  const colExpand = new Container();
  colExpand.visible = false;
  colExpand.y = 118;
  infoContainer.addChild(colExpand);

  const col1 = new Container();
  col1.x = 10;
  const titulo1 = new Text({
    text: 'Edificios',
    style: { fontSize: 11, fill: 0x88ccff, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  titulo1.y = 0;
  col1.addChild(titulo1);

  const col2 = new Container();
  col2.x = 178;
  const titulo2 = new Text({
    text: 'Naves',
    style: { fontSize: 11, fill: 0x88ccff, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  titulo2.y = 0;
  col2.addChild(titulo2);

  const col3 = new Container();
  col3.x = 346;
  const titulo3 = new Text({
    text: 'Pesquisa',
    style: { fontSize: 11, fill: 0x88ccff, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  titulo3.y = 0;
  col3.addChild(titulo3);

  colExpand.addChild(col1);
  colExpand.addChild(col2);
  colExpand.addChild(col3);

  const btnFabrica = criarBotaoAcao(col1, 0, 18, 150, 44, '', 'fabrica');
  const btnInfra = criarBotaoAcao(col1, 0, 68, 150, 44, '', 'infraestrutura');

  const btnNaves = [];
  const acoesNave = [{ acao: 'nave_colonizadora', label: 'Colonizadora' }];
  for (const tipo of ['cargueira', 'batedora', 'torreta']) {
    for (let t = 1; t <= 5; t++) {
      acoesNave.push({
        acao: `nave_${tipo}_${t}`,
        label: `${LABEL_PESQUISA[tipo] || tipo} T${t}`,
      });
    }
  }
  const colsNav = 2;
  const navW = 76;
  const navH = 26;
  for (let i = 0; i < acoesNave.length; i++) {
    const col = i % colsNav;
    const row = Math.floor(i / colsNav);
    const b = criarBotaoAcao(col2, col * (navW + 4), 18 + row * (navH + 4), navW, navH, acoesNave[i].label, acoesNave[i].acao);
    b._labelNave = acoesNave[i].label;
    b._texto.style.wordWrapWidth = navW - 2;
    btnNaves.push(b);
  }

  const btnPesquisa = [];
  let py = 18;
  for (const cat of ['torreta', 'cargueira', 'batedora']) {
    const rowLabel = new Text({
      text: LABEL_PESQUISA[cat],
      style: { fontSize: 9, fill: 0x999999, fontFamily: 'monospace' },
    });
    rowLabel.x = 0;
    rowLabel.y = py;
    col3.addChild(rowLabel);
    py += 14;
    for (let t = 1; t <= 5; t++) {
      const b = criarBotaoAcao(col3, (t - 1) * 32, py, 28, 22, String(t), `pesquisa_${cat}_${t}`);
      b._texto.style.fontSize = 10;
      btnPesquisa.push({ botao: b, categoria: cat, tier: t });
    }
    py += 28;
  }

  const btnToggleProducao = new Container();
  btnToggleProducao.eventMode = 'static';
  btnToggleProducao.cursor = 'pointer';
  const bgToggle = new Graphics();
  btnToggleProducao.addChild(bgToggle);
  btnToggleProducao._bg = bgToggle;
  const txtToggle = new Text({
    text: 'Producao',
    style: { fontSize: 12, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  txtToggle.anchor.set(0.5);
  txtToggle.x = 80;
  txtToggle.y = 16;
  btnToggleProducao.addChild(txtToggle);
  btnToggleProducao._texto = txtToggle;
  infoContainer.addChild(btnToggleProducao);

  btnToggleProducao.on('pointertap', () => {
    container._painelProducaoExpandido = !container._painelProducaoExpandido;
    colExpand.visible = container._painelProducaoExpandido;
  });

  container.addChild(infoContainer);

  container._txtPlanetas = txtPlanetas;
  container._txtRecursos = txtRecursos;
  container._txtTipo = txtTipo;
  container._txtContador = txtContador;
  container._infoContainer = infoContainer;
  container._infoBg = infoBg;
  container._infoNome = infoNome;
  container._infoDetalhes = infoDetalhes;
  container._colExpand = colExpand;
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
  painel._barraBg.clear();
  painel._barraBg.rect(0, 0, app.screen.width, 40).fill({ color: 0x000000, alpha: 0.5 });

  let qtdPlanetas = 0;
  let planetaSel = null;

  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === 'jogador') qtdPlanetas++;
    if (planeta.dados.selecionado) planetaSel = planeta;
  }

  const naveSelecionada = obterNaveSelecionada(mundo);
  const totalNaves = mundo.naves.length;

  const r = mundo.recursosJogador || { comum: 0, raro: 0, combustivel: 0 };
  painel._txtPlanetas.text = `Planetas: ${qtdPlanetas}`;
  painel._txtRecursos.text = `C:${Math.floor(r.comum)} R:${Math.floor(r.raro)} F:${Math.floor(r.combustivel)}`;
  painel._txtTipo.text = `Tipo: ${tipoJogador.nome} | Naves: ${totalNaves}`;
  painel._txtContador.text = naveSelecionada
    ? 'Nave selecionada: clique no mapa (destino) ou planeta/sol'
    : '';

  const info = painel._infoContainer;
  if (!planetaSel) {
    info.visible = false;
    painel._planetaSelecionado = null;
    return;
  }

  info.visible = true;
  painel._planetaSelecionado = planetaSel;

  const exp = painel._painelProducaoExpandido;
  const W = exp ? 532 : 340;
  const H = exp ? 430 : 268;
  info.x = 15;
  info.y = app.screen.height - H - 18;

  const bg = painel._infoBg;
  bg.clear();
  bg.roundRect(0, 0, W, H, 8).fill({ color: 0x000000, alpha: 0.78 });
  bg.roundRect(0, 0, W, H, 8).stroke({ color: 0x444444, width: 1 });

  const d = planetaSel.dados;
  const cor = CORES_DONO[d.dono] || 0x888888;
  const tempoRestanteSeg = (calcularTempoRestantePlaneta(planetaSel) / 1000).toFixed(1);
  const custoFabrica = calcularCustoTier(d.fabricas);
  const custoInfra = calcularCustoTier(d.infraestrutura);
  const tempoFabrica = calcularTempoConstrucaoMs(d.fabricas);
  const tempoInfra = calcularTempoConstrucaoMs(d.infraestrutura);
  const tempoColonizadora = calcularTempoColonizadoraMs(planetaSel);
  const pesqAtual = getPesquisaAtual(mundo);

  painel._infoNome.text =
    d.dono === 'jogador'
      ? `Seu planeta (${nomeTipoPlaneta(d.tipoPlaneta)})`
      : `Planeta neutro (${nomeTipoPlaneta(d.tipoPlaneta)})`;
  painel._infoNome.style.fill = cor;

  const linhas = [
    `Dono: ${d.dono}`,
    `Tipo: ${nomeTipoPlaneta(d.tipoPlaneta)}`,
    `Proximo ciclo: ${tempoRestanteSeg}s`,
    `Producao/ciclo: ${textoProducaoCicloPlaneta(planetaSel)}`,
    `Fabrica: ${d.fabricas}/${getTierMax()} | Infra: ${d.infraestrutura}/${getTierMax()}`,
    `Colonizadoras em voo: ${d.naves}`,
  ];

  if (pesqAtual) {
    linhas.push(
      `Pesquisa: ${LABEL_PESQUISA[pesqAtual.categoria] || pesqAtual.categoria} T${pesqAtual.tier} (${formatarTempo(pesqAtual.tempoRestanteMs)})`
    );
  }

  if (d.construcaoAtual) {
    linhas.push(`Obra: ${d.construcaoAtual.tipo} T${d.construcaoAtual.tierDestino} (${formatarTempo(d.construcaoAtual.tempoRestanteMs)})`);
  }

  if (d.producaoNave) {
    const tn = d.producaoNave.tipoNave || d.producaoNave.tipo || 'nave';
    const tr = d.producaoNave.tier || 1;
    const nome =
      tn === 'colonizadora'
        ? 'Colonizadora'
        : `${LABEL_PESQUISA[tn] || tn} T${tr}`;
    linhas.push(`Fila nave: ${nome} (${formatarTempo(d.producaoNave.tempoRestanteMs)})`);
  }

  painel._infoDetalhes.text = linhas.join('\n');

  const toggle = painel._btnToggleProducao;
  toggle.x = 12;
  toggle.y = H - 38;
  toggle._texto.text = exp ? 'Recolher' : 'Producao';
  toggle._bg.clear();
  toggle._bg.roundRect(0, 0, 160, 32, 6).fill({ color: 0x2a3f5c, alpha: 0.95 });
  toggle._bg.roundRect(0, 0, 160, 32, 6).stroke({ color: 0x5da9ff, width: 1 });
  toggle._texto.x = 80;
  toggle._texto.y = 16;

  painel._colExpand.visible = exp;

  const mostrarProducao = d.dono === 'jogador';

  for (const b of [painel._btnFabrica, painel._btnInfra, ...painel._btnNaves, ...painel._btnPesquisa.map((x) => x.botao)]) {
    b.visible = mostrarProducao && exp;
  }
  toggle.visible = mostrarProducao;

  if (!mostrarProducao || !exp) {
    return;
  }

  let desab;

  desab = !custoFabrica || !!d.construcaoAtual;
  painel._btnFabrica._texto.text = custoFabrica
    ? `Fabrica T${d.fabricas + 1}\n${custoFabrica} C | ${formatarTempo(tempoFabrica)}`
    : 'Fabrica max';
  redesenharBotao(painel._btnFabrica, 150, 44, desab);

  desab = !custoInfra || !!d.construcaoAtual;
  painel._btnInfra._texto.text = custoInfra
    ? `Infra T${d.infraestrutura + 1}\n${custoInfra} C | ${formatarTempo(tempoInfra)}`
    : 'Infra max';
  redesenharBotao(painel._btnInfra, 150, 44, desab);

  const pesquisaOcupada = !!pesqAtual;
  for (const { botao, categoria, tier } of painel._btnPesquisa) {
    const ja = pesquisaTierLiberada(mundo, categoria, tier);
    const desabP = ja || pesquisaOcupada || r.raro < 5;
    botao._texto.text = String(tier);
    redesenharBotao(botao, 28, 22, desabP);
    botao.alpha = ja ? 0.45 : 1;
  }

  for (const btn of painel._btnNaves) {
    const acao = btn._acao;
    const parsed = parseAcaoNave(acao);
    let vis = false;
    let desabN = true;
    let sub = '';

    if (parsed) {
      if (parsed.tipo === 'colonizadora') {
        vis = d.fabricas >= 1;
        desabN = d.fabricas < 1 || !!d.producaoNave || !tempoColonizadora;
        sub = `20 C | ${formatarTempo(tempoColonizadora)}`;
      } else {
        const lib = pesquisaTierLiberada(mundo, parsed.tipo, parsed.tier);
        vis = lib;
        desabN =
          !lib ||
          d.fabricas < parsed.tier ||
          !!d.producaoNave ||
          !tempoColonizadora;
        sub = `20 C | ${formatarTempo(tempoColonizadora)}`;
      }
    }

    btn.visible = vis;
    if (vis) {
      btn._texto.text = `${btn._labelNave}\n${sub}`;
      redesenharBotao(btn, NAV_BTN_W, NAV_BTN_H, desabN);
    }
  }
}

export function definirAcaoPainel(painel, callback) {
  painel._onAcaoPlaneta = callback;
}
