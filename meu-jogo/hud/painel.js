import { Container, Graphics, Text } from 'pixi.js';

const CORES_DONO = {
  neutro: 0x888888,
  jogador: 0x44aaff,
  inimigo1: 0xff4444,
  inimigo2: 0xffaa00,
  inimigo3: 0xaa44ff,
};

export function criarPainel(app) {
  const container = new Container();

  // Barra superior
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

  const txtTropas = new Text({
    text: '',
    style: { fontSize: 14, fill: 0x44ff88, fontFamily: 'monospace' },
  });
  txtTropas.x = 200;
  txtTropas.y = 10;
  container.addChild(txtTropas);

  const txtTipo = new Text({
    text: '',
    style: { fontSize: 14, fill: 0xffaa00, fontFamily: 'monospace' },
  });
  txtTipo.x = 420;
  txtTipo.y = 10;
  container.addChild(txtTipo);

  // Painel de info (inferior esquerdo)
  const infoContainer = new Container();
  infoContainer.visible = false;

  const infoBg = new Graphics();
  infoBg.roundRect(0, 0, 260, 110, 8).fill({ color: 0x000000, alpha: 0.7 });
  infoBg.roundRect(0, 0, 260, 110, 8).stroke({ color: 0x444444, width: 1 });
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

  container.addChild(infoContainer);

  container._txtPlanetas = txtPlanetas;
  container._txtTropas = txtTropas;
  container._txtTipo = txtTipo;
  container._infoContainer = infoContainer;
  container._infoNome = infoNome;
  container._infoDetalhes = infoDetalhes;
  container._barraBg = barraBg;

  return container;
}

export function atualizarPainel(painel, mundo, tipoJogador, app) {
  painel._barraBg.clear();
  painel._barraBg.rect(0, 0, app.screen.width, 40).fill({ color: 0x000000, alpha: 0.5 });

  let qtdPlanetas = 0;
  let totalTropas = 0;
  let planetaSel = null;

  for (const p of mundo.planetas) {
    if (p.dados.dono === 'jogador') {
      qtdPlanetas++;
      totalTropas += Math.floor(p.dados.tropas);
    }
    if (p.dados.selecionado) planetaSel = p;
  }

  painel._txtPlanetas.text = `Planetas: ${qtdPlanetas}`;
  painel._txtTropas.text = `Tropas totais: ${totalTropas}`;
  painel._txtTipo.text = `Tipo: ${tipoJogador.nome}`;

  // Info do selecionado
  const info = painel._infoContainer;
  if (planetaSel) {
    info.visible = true;
    info.x = 15;
    info.y = app.screen.height - 125;

    const d = planetaSel.dados;
    const donoNome =
      d.dono === 'jogador' ? 'Seu planeta' :
      d.dono === 'neutro' ? 'Planeta neutro' :
      'Planeta inimigo';
    const cor = CORES_DONO[d.dono] || 0x888888;

    painel._infoNome.text = donoNome;
    painel._infoNome.style.fill = cor;
    painel._infoDetalhes.text =
      `Dono: ${d.dono}\nTropas: ${Math.floor(d.tropas)}\nProdução: ${d.producao.toFixed(1)}/s`;
  } else {
    info.visible = false;
  }
}
