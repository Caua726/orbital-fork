import { Container, Graphics, Text } from 'pixi.js';
import {
  calcularCustoTier,
  calcularTempoColonizadoraMs,
  calcularTempoConstrucaoMs,
  calcularTempoRestantePlaneta,
  getTierMax,
  obterNaveSelecionada,
} from '../world/mundo.js';

const CORES_DONO = {
  neutro: 0x888888,
  jogador: 0x44aaff,
};

function formatarTempo(ms) {
  const totalSeg = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
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
  infoBg.roundRect(0, 0, 340, 260, 8).fill({ color: 0x000000, alpha: 0.7 });
  infoBg.roundRect(0, 0, 340, 260, 8).stroke({ color: 0x444444, width: 1 });
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
    style: { fontSize: 13, fill: 0xcccccc, fontFamily: 'monospace' },
  });
  infoDetalhes.x = 12;
  infoDetalhes.y = 35;
  infoContainer.addChild(infoDetalhes);

  const botoesContainer = new Container();
  botoesContainer.y = 156;
  infoContainer.addChild(botoesContainer);

  function criarBotao(rotulo, x, y, acao) {
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
      text: rotulo,
      style: { fontSize: 11, fill: 0xffffff, fontFamily: 'monospace', align: 'center' },
    });
    texto.anchor.set(0.5);
    texto.x = 78;
    texto.y = 24;
    botao.addChild(texto);
    botao._texto = texto;

    botao.on('pointertap', () => {
      if (typeof container._onAcaoPlaneta === 'function' && container._planetaSelecionado) {
        container._onAcaoPlaneta(botao._acao, container._planetaSelecionado);
      }
    });

    botoesContainer.addChild(botao);
    return botao;
  }

  const btnFabrica = criarBotao('Criar fabrica', 0, 0, 'fabrica');
  const btnInfra = criarBotao('Criar infraestrutura', 168, 0, 'infraestrutura');
  const btnColonizadora = criarBotao('Criar colonizadora', 0, 58, 'colonizadora');

  container.addChild(infoContainer);

  container._txtPlanetas = txtPlanetas;
  container._txtRecursos = txtRecursos;
  container._txtTipo = txtTipo;
  container._txtContador = txtContador;
  container._infoContainer = infoContainer;
  container._infoNome = infoNome;
  container._infoDetalhes = infoDetalhes;
  container._barraBg = barraBg;
  container._botoes = [btnFabrica, btnInfra, btnColonizadora];
  container._planetaSelecionado = null;
  container._onAcaoPlaneta = null;

  return container;
}

export function atualizarPainel(painel, mundo, tipoJogador, app) {
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

  painel._txtPlanetas.text = `Planetas: ${qtdPlanetas}`;
  painel._txtRecursos.text = `Recursos: ${Math.floor(mundo.recursosJogador || 0)}`;
  painel._txtTipo.text = `Tipo: ${tipoJogador.nome} | Naves: ${totalNaves}`;
  painel._txtContador.text = naveSelecionada
    ? 'Colonizadora selecionada: clique em planeta ou sol'
    : '';

  const info = painel._infoContainer;
  if (!planetaSel) {
    info.visible = false;
    painel._planetaSelecionado = null;
    return;
  }

  info.visible = true;
  painel._planetaSelecionado = planetaSel;
  info.x = 15;
  info.y = app.screen.height - 275;

  const d = planetaSel.dados;
  const cor = CORES_DONO[d.dono] || 0x888888;
  const tempoRestanteSeg = (calcularTempoRestantePlaneta(planetaSel) / 1000).toFixed(1);
  const custoFabrica = calcularCustoTier(d.fabricas);
  const custoInfra = calcularCustoTier(d.infraestrutura);
  const tempoFabrica = calcularTempoConstrucaoMs(d.fabricas);
  const tempoInfra = calcularTempoConstrucaoMs(d.infraestrutura);
  const tempoColonizadora = calcularTempoColonizadoraMs(planetaSel);

  painel._infoNome.text = d.dono === 'jogador' ? 'Seu planeta' : 'Planeta neutro';
  painel._infoNome.style.fill = cor;

  const linhas = [
    `Dono: ${d.dono}`,
    `Proximo recurso: ${tempoRestanteSeg}s`,
    `Recursos/ciclo: ${1 + d.infraestrutura}`,
    `Fabrica Tier: ${d.fabricas}/${getTierMax()}`,
    `Infra Tier: ${d.infraestrutura}/${getTierMax()}`,
    `Colonizadoras ativas: ${d.naves}`,
  ];

  if (d.construcaoAtual) {
    linhas.push(`Obra: ${d.construcaoAtual.tipo} T${d.construcaoAtual.tierDestino} (${formatarTempo(d.construcaoAtual.tempoRestanteMs)})`);
  }

  if (d.producaoNave) {
    linhas.push(`Nave: colonizadora (${formatarTempo(d.producaoNave.tempoRestanteMs)})`);
  }

  painel._infoDetalhes.text = linhas.join('\n');

  const mostrarBotoes = d.dono === 'jogador';
  for (const botao of painel._botoes) {
    botao.visible = mostrarBotoes;
    if (!mostrarBotoes) continue;

    let desabilitado = false;

    if (botao._acao === 'fabrica') {
      desabilitado = !custoFabrica || !!d.construcaoAtual;
      botao._texto.text = custoFabrica
        ? `Fabrica T${d.fabricas + 1}\n${custoFabrica} rec | ${formatarTempo(tempoFabrica)}`
        : 'Fabrica\nTier max';
    } else if (botao._acao === 'infraestrutura') {
      desabilitado = !custoInfra || !!d.construcaoAtual;
      botao._texto.text = custoInfra
        ? `Infra T${d.infraestrutura + 1}\n${custoInfra} rec | ${formatarTempo(tempoInfra)}`
        : 'Infra\nTier max';
    } else if (botao._acao === 'colonizadora') {
      desabilitado = d.fabricas < 1 || !!d.producaoNave;
      botao._texto.text = d.fabricas < 1
        ? 'Colonizadora\nRequer Fabrica T1'
        : `Colonizadora\n${20} rec | ${formatarTempo(tempoColonizadora)}`;
    }

    const bg = botao._bg;
    bg.clear();
    bg.roundRect(0, 0, 156, 48, 6).fill({ color: desabilitado ? 0x333333 : 0x1c3048, alpha: 0.95 });
    bg.roundRect(0, 0, 156, 48, 6).stroke({ color: desabilitado ? 0x666666 : 0x5da9ff, width: 1 });
  }
}

export function definirAcaoPainel(painel, callback) {
  painel._onAcaoPlaneta = callback;
}
