import { Container, Graphics, Text } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo } from '../types';

interface TutorialContainer extends Container {
  _fadeOut: boolean;
  _alpha: number;
  _targetY: number;
  _slideIn: boolean;
}

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
  textValue: 0x90ccff,
};

export function criarTutorial(app: Application): TutorialContainer {
  const tutorial = new Container() as TutorialContainer;

  const largura = 520;
  const altura = 290;

  const bg = new Graphics();

  bg.rect(-largura / 2, -altura / 2, largura, altura / 2).fill({ color: SP.panelBg });
  bg.rect(-largura / 2, 0, largura, altura / 2).fill({ color: SP.panelBgDark });
  bg.roundRect(-largura / 2, -altura / 2, largura, altura, 4).stroke({ color: SP.panelBorder, width: 2 });

  const hW = largura / 2;
  const hH = altura / 2;
  const s = 10;
  bg.moveTo(-hW, -hH + s).lineTo(-hW, -hH).lineTo(-hW + s, -hH).stroke({ color: SP.cornerAccent, width: 2 });
  bg.moveTo(hW - s, -hH).lineTo(hW, -hH).lineTo(hW, -hH + s).stroke({ color: SP.cornerAccent, width: 2 });
  bg.moveTo(-hW, hH - s).lineTo(-hW, hH).lineTo(-hW + s, hH).stroke({ color: SP.cornerAccent, width: 2 });
  bg.moveTo(hW - s, hH).lineTo(hW, hH).lineTo(hW, hH - s).stroke({ color: SP.cornerAccent, width: 2 });

  bg.rect(-hW + 2, -hH + 2, largura - 4, 22).fill({ color: SP.titleBg });
  bg.rect(-hW + 2 + (largura - 4) / 3, -hH + 2, (largura - 4) * 2 / 3, 22).fill({ color: SP.titleBgLight, alpha: 0.5 });
  bg.moveTo(-hW + 2, -hH + 24).lineTo(hW - 2, -hH + 24).stroke({ color: SP.panelBorder, width: 1 });

  const dx = -hW + 12;
  const dy = -hH + 13;
  bg.moveTo(dx, dy - 3).lineTo(dx + 3, dy).lineTo(dx, dy + 3).lineTo(dx - 3, dy).lineTo(dx, dy - 3).fill({ color: SP.diamond });

  const fx = -hW + 8;
  const fy = -hH + 28;
  const fw = largura - 16;
  const fh = altura - 38;
  bg.rect(fx, fy, fw, fh).fill({ color: SP.fieldBg });
  bg.rect(fx, fy, fw, fh).stroke({ color: SP.fieldBorder, width: 1 });

  tutorial.addChild(bg);

  const titleText = new Text({
    text: 'Tutorial',
    style: { fontSize: 15, fill: SP.titleText, fontFamily: 'monospace' },
  });
  titleText.anchor.set(0, 0.5);
  titleText.x = -hW + 22;
  titleText.y = -hH + 13;
  tutorial.addChild(titleText);

  const linhas = [
    'Clique em um planeta para abrir as opcoes dele',
    'Fabrica T1 libera a colonizadora',
    'Clique na colonizadora e depois em um planeta neutro ou sol',
    'Arraste em area vazia para mover a camera',
    'Scroll para zoom',
  ];

  const estilo = {
    fontSize: 16,
    fill: SP.textValue,
    fontFamily: 'monospace',
    wordWrap: true,
    wordWrapWidth: largura - 50,
  };

  for (let i = 0; i < linhas.length; i++) {
    const t = new Text({ text: `- ${linhas[i]}`, style: estilo });
    t.anchor.set(0.5, 0.5);
    t.x = 0;
    t.y = -hH + 52 + i * 36;
    tutorial.addChild(t);
  }

  const closeBtn = new Container();
  closeBtn.eventMode = 'static';
  closeBtn.cursor = 'pointer';
  const closeBg = new Graphics();
  closeBg.rect(0, 0, 120, 26).fill({ color: 0x1a2848 });
  closeBg.rect(0, 0, 120, 26).stroke({ color: 0x2a4878, width: 1 });
  closeBg.moveTo(4, 0).lineTo(116, 0).stroke({ color: 0x3a6098, width: 1, alpha: 0.4 });
  closeBtn.addChild(closeBg);
  const closeTxt = new Text({
    text: 'Fechar',
    style: { fontSize: 15, fill: SP.textValue, fontFamily: 'monospace' },
  });
  closeTxt.anchor.set(0.5);
  closeTxt.x = 60;
  closeTxt.y = 13;
  closeBtn.addChild(closeTxt);
  closeBtn.x = -60;
  closeBtn.y = hH - 36;
  closeBtn.on('pointertap', () => {
    tutorial._fadeOut = true;
  });
  tutorial.addChild(closeBtn);

  tutorial.x = app.screen.width / 2;
  tutorial.y = app.screen.height / 2;
  tutorial._fadeOut = false;
  tutorial._alpha = 1;

  tutorial._targetY = tutorial.y;
  tutorial.y = tutorial._targetY - 30;
  tutorial._slideIn = true;

  return tutorial;
}

export function atualizarTutorial(tutorial: TutorialContainer, mundo: Mundo): void {
  if (!tutorial.visible) return;

  if (tutorial._slideIn) {
    tutorial.y += (tutorial._targetY - tutorial.y) * 0.08;
    if (Math.abs(tutorial.y - tutorial._targetY) < 0.5) {
      tutorial.y = tutorial._targetY;
      tutorial._slideIn = false;
    }
  }

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
