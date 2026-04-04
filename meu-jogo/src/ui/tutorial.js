import { Container, Graphics, Text } from 'pixi.js';

export function criarTutorial(app) {
  const tutorial = new Container();

  const bg = new Graphics();
  const largura = 520;
  const altura = 200;
  bg.roundRect(-largura / 2, -altura / 2, largura, altura, 12)
    .fill({ color: 0x000000, alpha: 0.7 });
  tutorial.addChild(bg);

  const linhas = [
    'Clique em um planeta para abrir as opcoes dele',
    'Fabrica T1 libera a colonizadora',
    'Clique na colonizadora e depois em um planeta neutro ou sol',
    'Arraste em area vazia para mover a camera',
    'Scroll para zoom',
  ];

  const estilo = {
    fontSize: 14,
    fill: 0xffffff,
    fontFamily: 'monospace',
    wordWrap: true,
    wordWrapWidth: largura - 40,
  };

  for (let i = 0; i < linhas.length; i++) {
    const t = new Text({ text: `- ${linhas[i]}`, style: estilo });
    t.anchor.set(0.5, 0.5);
    t.x = 0;
    t.y = -altura / 2 + 35 + i * 42;
    tutorial.addChild(t);
  }

  tutorial.x = app.screen.width / 2;
  tutorial.y = app.screen.height / 2;
  tutorial._fadeOut = false;
  tutorial._alpha = 1;

  return tutorial;
}

export function atualizarTutorial(tutorial, mundo) {
  if (!tutorial.visible) return;

  const temPlanetaSelecionado = mundo.planetas.some((p) => p.dados.selecionado);
  const temNaveSelecionada = mundo.naves?.some((n) => n.selecionado);
  if (!tutorial._fadeOut && (temPlanetaSelecionado || temNaveSelecionada)) {
    tutorial._fadeOut = true;
  }

  if (tutorial._fadeOut) {
    tutorial._alpha -= 1 / 60;
    if (tutorial._alpha <= 0) {
      tutorial.visible = false;
      tutorial._alpha = 0;
    }
    tutorial.alpha = tutorial._alpha;
  }
}
