import { Container, Graphics, Text, Assets, Texture, Rectangle, AnimatedSprite } from 'pixi.js';

const TIPOS = [
  {
    nome: 'Industrial',
    desc: 'Producao +50%',
    cor: 0xffaa00,
    bonus: { producao: 1.5 },
  },
  {
    nome: 'Militar',
    desc: 'Infraestrutura inicial +1',
    cor: 0xff4444,
    bonus: { infraestruturaInicial: 1 },
  },
  {
    nome: 'Expansionista',
    desc: 'Fabrica inicial T1',
    cor: 0x44ff88,
    bonus: { fabricasIniciais: 1 },
  },
];

export function getTipos() {
  return TIPOS;
}

async function carregarFramesPlaneta() {
  const texture = await Assets.load('/assets/planeta.png');
  const frames = [];
  const fw = 250;
  const fh = 250;
  const cols = 5;
  const rows = 6;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      frames.push(
        new Texture({
          source: texture.source,
          frame: new Rectangle(col * fw, row * fh, fw, fh),
        })
      );
    }
  }
  return frames;
}

export function criarTelaSelecao(app) {
  return new Promise(async (resolve) => {
    const frames = await carregarFramesPlaneta();

    const overlay = new Container();

    const bg = new Graphics();
    bg.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0a0a18, alpha: 0.92 });
    overlay.addChild(bg);

    const titulo = new Text({
      text: 'Escolha seu Imperio',
      style: {
        fontSize: 44,
        fill: 0xffffff,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        dropShadow: true,
        dropShadowColor: 0x000000,
        dropShadowDistance: 3,
      },
    });
    titulo.anchor.set(0.5);
    titulo.x = app.screen.width / 2;
    titulo.y = 80;
    overlay.addChild(titulo);

    const subtitulo = new Text({
      text: 'O tipo define os bonus do seu imperio',
      style: { fontSize: 16, fill: 0x888888, fontFamily: 'monospace' },
    });
    subtitulo.anchor.set(0.5);
    subtitulo.x = app.screen.width / 2;
    subtitulo.y = 130;
    overlay.addChild(subtitulo);

    const largCard = 300;
    const altCard = 320;
    const gap = 50;
    const totalW = TIPOS.length * largCard + (TIPOS.length - 1) * gap;
    const startX = (app.screen.width - totalW) / 2;
    const cardY = app.screen.height / 2 - altCard / 2 + 20;

    TIPOS.forEach((tipo, i) => {
      const card = new Container();
      card.x = startX + i * (largCard + gap);
      card.y = cardY;
      card.eventMode = 'static';
      card.cursor = 'pointer';

      const fundo = new Graphics();
      const drawCard = (hover) => {
        fundo.clear();
        fundo.roundRect(0, 0, largCard, altCard, 14).fill({ color: hover ? 0x1e1e3a : 0x12122a });
        fundo.roundRect(0, 0, largCard, altCard, 14).stroke({
          color: tipo.cor,
          width: hover ? 3 : 1.5,
          alpha: hover ? 1 : 0.5,
        });
      };
      drawCard(false);
      card.addChild(fundo);

      const glow = new Graphics();
      glow.circle(largCard / 2, 80, 50).fill({ color: tipo.cor, alpha: 0.12 });
      glow.circle(largCard / 2, 80, 35).fill({ color: tipo.cor, alpha: 0.08 });
      card.addChild(glow);

      const planeta = new AnimatedSprite(frames);
      planeta.anchor.set(0.5);
      planeta.x = largCard / 2;
      planeta.y = 80;
      planeta.width = 90;
      planeta.height = 90;
      planeta.animationSpeed = 0.08 + i * 0.02;
      planeta.gotoAndPlay(i * 10);
      planeta.tint = tipo.cor;
      card.addChild(planeta);

      const sep = new Graphics();
      sep.moveTo(30, 145).lineTo(largCard - 30, 145).stroke({ color: tipo.cor, width: 1, alpha: 0.3 });
      card.addChild(sep);

      const nome = new Text({
        text: tipo.nome,
        style: {
          fontSize: 24,
          fill: tipo.cor,
          fontFamily: 'monospace',
          fontWeight: 'bold',
        },
      });
      nome.anchor.set(0.5);
      nome.x = largCard / 2;
      nome.y = 170;
      card.addChild(nome);

      const desc = new Text({
        text: tipo.desc,
        style: {
          fontSize: 13,
          fill: 0xbbbbbb,
          fontFamily: 'monospace',
          wordWrap: true,
          wordWrapWidth: largCard - 40,
          align: 'center',
          lineHeight: 20,
        },
      });
      desc.anchor.set(0.5);
      desc.x = largCard / 2;
      desc.y = 230;
      card.addChild(desc);

      const hint = new Text({
        text: 'Clique para selecionar',
        style: { fontSize: 11, fill: 0x666666, fontFamily: 'monospace' },
      });
      hint.anchor.set(0.5);
      hint.x = largCard / 2;
      hint.y = altCard - 20;
      card.addChild(hint);

      card.on('pointerover', () => {
        drawCard(true);
        hint.style.fill = tipo.cor;
      });

      card.on('pointerout', () => {
        drawCard(false);
        hint.style.fill = 0x666666;
      });

      card.on('pointertap', () => {
        overlay.children.forEach((c) => {
          if (c._planeta) c._planeta.stop();
        });
        planeta.stop();
        app.stage.removeChild(overlay);
        resolve(tipo);
      });

      card._planeta = planeta;
      overlay.addChild(card);
    });

    app.stage.addChild(overlay);
  });
}
