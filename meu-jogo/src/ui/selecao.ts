import { Container, Graphics, Text, Assets, Texture, AnimatedSprite } from 'pixi.js';
import type { Application, TipoJogador } from '../types';
import { criarFramesSpriteStrip, SPRITE_PLANETA_POR_TIPO, TIPO_PLANETA } from '../world/planeta';

interface AnimatedCard extends Container {
  _baseY: number;
  _animDelay: number;
  _animDone: boolean;
  _planeta: AnimatedSprite;
}

const W95 = {
  bg: 0xd4d0c8,
  bgLight: 0xdfdfdf,
  bgDark: 0x404040,
  border: 0x808080,
  white: 0xffffff,
  black: 0x000000,
  titleLeft: 0x0a246a,
  titleRight: 0x3a6ea5,
  field: 0xffffff,
  textDark: 0x222222,
  textLabel: 0x666666,
  btnFace: 0xd4d0c8,
};

const TIPOS: TipoJogador[] = [
  {
    nome: 'Industrial',
    desc: 'Producao +50%',
    cor: 0xcc6600,
    bonus: { producao: 1.5 },
  },
  {
    nome: 'Militar',
    desc: 'Infraestrutura inicial +1',
    cor: 0xcc0000,
    bonus: { infraestruturaInicial: 1 },
  },
  {
    nome: 'Expansionista',
    desc: 'Fabrica inicial T1',
    cor: 0x008844,
    bonus: { fabricasIniciais: 1 },
  },
];

export function getTipos(): TipoJogador[] {
  return TIPOS;
}

async function carregarFramesPlaneta(): Promise<Texture[]> {
  const texture: Texture = await Assets.load(SPRITE_PLANETA_POR_TIPO[TIPO_PLANETA.COMUM]);
  texture.source.scaleMode = 'nearest';
  return criarFramesSpriteStrip(texture);
}

export async function criarTelaSelecao(app: Application): Promise<TipoJogador> {
  const frames = await carregarFramesPlaneta();
  return new Promise<TipoJogador>((resolve) => {

    const overlay = new Container();

    // Dark space background
    const bg = new Graphics();
    bg.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0a0a18, alpha: 0.95 });
    overlay.addChild(bg);

    // Main dialog window
    const largCard = 220;
    const altCard = 280;
    const gap = 20;
    const dialogPad = 30;
    const totalCardsW = TIPOS.length * largCard + (TIPOS.length - 1) * gap;
    const dialogW = totalCardsW + dialogPad * 2;
    const dialogH = altCard + 120;
    const dialogX = (app.screen.width - dialogW) / 2;
    const dialogY = (app.screen.height - dialogH) / 2;

    const dialog = new Container();
    dialog.x = dialogX;
    dialog.y = dialogY;

    // Window frame
    const dialogBg = new Graphics();
    dialogBg.rect(0, 0, dialogW, dialogH).fill({ color: W95.bg });
    dialogBg.moveTo(0, dialogH).lineTo(0, 0).lineTo(dialogW, 0).stroke({ color: W95.bgLight, width: 2 });
    dialogBg.moveTo(dialogW, 0).lineTo(dialogW, dialogH).lineTo(0, dialogH).stroke({ color: W95.bgDark, width: 2 });
    // Title bar
    dialogBg.rect(4, 3, dialogW - 8, 22).fill({ color: W95.titleLeft });
    dialogBg.rect(4 + (dialogW - 8) / 3, 3, (dialogW - 8) * 2 / 3, 22).fill({ color: W95.titleRight, alpha: 0.7 });
    dialog.addChild(dialogBg);

    const titulo = new Text({
      text: 'Escolha seu Imperio',
      style: { fontSize: 16, fill: W95.white, fontFamily: 'monospace', fontWeight: 'bold' },
    });
    titulo.x = 10;
    titulo.y = 5;
    dialog.addChild(titulo);

    const subtitulo = new Text({
      text: 'O tipo define os bonus do seu imperio',
      style: { fontSize: 14, fill: W95.textLabel, fontFamily: 'monospace' },
    });
    subtitulo.anchor.set(0.5);
    subtitulo.x = dialogW / 2;
    subtitulo.y = 42;
    dialog.addChild(subtitulo);

    // Slide-in animation state
    dialog.alpha = 0;
    (dialog as Container & { _animTime: number })._animTime = 0;
    const targetY = dialogY;
    dialog.y = dialogY + 30;

    const cardStartX = dialogPad;
    const cardY = 60;

    TIPOS.forEach((tipo, i) => {
      const card = new Container() as AnimatedCard;
      card.x = cardStartX + i * (largCard + gap);
      card.y = cardY;
      card.eventMode = 'static';
      card.cursor = 'pointer';

      // Card initial offset for staggered animation
      card._baseY = cardY;
      card._animDelay = i * 0.15;
      card._animDone = false;
      card.alpha = 0;
      card.y = cardY + 20;

      const fundo = new Graphics();
      const drawCard = (hover: boolean): void => {
        fundo.clear();
        // Outset card
        fundo.rect(0, 0, largCard, altCard).fill({ color: hover ? 0xe8e8e8 : W95.bg });
        fundo.moveTo(0, altCard).lineTo(0, 0).lineTo(largCard, 0).stroke({ color: W95.bgLight, width: 2 });
        fundo.moveTo(largCard, 0).lineTo(largCard, altCard).lineTo(0, altCard).stroke({ color: W95.bgDark, width: 2 });
        // Colored accent line at top
        fundo.rect(4, 4, largCard - 8, 3).fill({ color: tipo.cor });
      };
      drawCard(false);
      card.addChild(fundo);

      // Planet in a sunken field
      const planetField = new Graphics();
      planetField.rect(largCard / 2 - 45, 20, 90, 90).fill({ color: 0xf8f8f8 });
      planetField.moveTo(largCard / 2 - 45, 110).lineTo(largCard / 2 - 45, 20).lineTo(largCard / 2 + 45, 20).stroke({ color: W95.bgDark, width: 1 });
      planetField.moveTo(largCard / 2 + 45, 20).lineTo(largCard / 2 + 45, 110).lineTo(largCard / 2 - 45, 110).stroke({ color: W95.bgLight, width: 1 });
      card.addChild(planetField);

      const planeta = new AnimatedSprite(frames);
      planeta.anchor.set(0.5);
      planeta.x = largCard / 2;
      planeta.y = 65;
      planeta.width = 70;
      planeta.height = 70;
      planeta.animationSpeed = 0.05 + i * 0.012;
      planeta.gotoAndPlay(i * 10);
      planeta.tint = tipo.cor;
      card.addChild(planeta);

      // Groove separator
      const sep = new Graphics();
      sep.moveTo(12, 120).lineTo(largCard - 12, 120).stroke({ color: W95.border, width: 1 });
      sep.moveTo(12, 121).lineTo(largCard - 12, 121).stroke({ color: W95.white, width: 1 });
      card.addChild(sep);

      const nome = new Text({
        text: tipo.nome,
        style: { fontSize: 18, fill: tipo.cor, fontFamily: 'monospace', fontWeight: 'bold' },
      });
      nome.anchor.set(0.5);
      nome.x = largCard / 2;
      nome.y = 145;
      card.addChild(nome);

      const desc = new Text({
        text: tipo.desc,
        style: {
          fontSize: 14,
          fill: W95.textDark,
          fontFamily: 'monospace',
          wordWrap: true,
          wordWrapWidth: largCard - 30,
          align: 'center',
          lineHeight: 20,
        },
      });
      desc.anchor.set(0.5);
      desc.x = largCard / 2;
      desc.y = 195;
      card.addChild(desc);

      // Win95-style button at bottom
      const btnW = largCard - 40;
      const btnH = 28;
      const btnX = 20;
      const btnY = altCard - 42;
      const btnBg = new Graphics();
      const drawBtn = (pressed: boolean): void => {
        btnBg.clear();
        btnBg.rect(btnX, btnY, btnW, btnH).fill({ color: W95.btnFace || W95.bg });
        if (pressed) {
          btnBg.moveTo(btnX, btnY + btnH).lineTo(btnX, btnY).lineTo(btnX + btnW, btnY).stroke({ color: W95.bgDark, width: 2 });
          btnBg.moveTo(btnX + btnW, btnY).lineTo(btnX + btnW, btnY + btnH).lineTo(btnX, btnY + btnH).stroke({ color: W95.bgLight, width: 2 });
        } else {
          btnBg.moveTo(btnX, btnY + btnH).lineTo(btnX, btnY).lineTo(btnX + btnW, btnY).stroke({ color: W95.bgLight, width: 2 });
          btnBg.moveTo(btnX + btnW, btnY).lineTo(btnX + btnW, btnY + btnH).lineTo(btnX, btnY + btnH).stroke({ color: W95.bgDark, width: 2 });
        }
      };
      drawBtn(false);
      card.addChild(btnBg);

      const hint = new Text({
        text: 'Selecionar',
        style: { fontSize: 14, fill: W95.textDark, fontFamily: 'monospace' },
      });
      hint.anchor.set(0.5);
      hint.x = largCard / 2;
      hint.y = btnY + btnH / 2;
      card.addChild(hint);

      card.on('pointerover', () => {
        drawCard(true);
        drawBtn(false);
        hint.style.fill = tipo.cor;
      });

      card.on('pointerout', () => {
        drawCard(false);
        drawBtn(false);
        hint.style.fill = W95.textDark;
      });

      card.on('pointerdown', () => {
        drawBtn(true);
      });

      card.on('pointerup', () => {
        drawBtn(false);
      });

      card.on('pointertap', () => {
        // Close animation
        let closeAlpha = 1;
        const closeTicker = (): void => {
          closeAlpha -= 0.05;
          dialog.alpha = Math.max(0, closeAlpha);
          dialog.y += 2;
          if (closeAlpha <= 0) {
            app.ticker.remove(closeTicker);
            overlay.children.forEach((c) => {
              if ((c as AnimatedCard)._planeta) (c as AnimatedCard)._planeta.stop();
            });
            planeta.stop();
            app.stage.removeChild(overlay);
            resolve(tipo);
          }
        };
        app.ticker.add(closeTicker);
      });

      card._planeta = planeta;
      dialog.addChild(card);
    });

    overlay.addChild(dialog);

    // Animate dialog in
    let animTime = 0;
    const animIn = (): void => {
      animTime += 1 / 60;

      // Dialog fade + slide
      const dialogProgress = Math.min(1, animTime * 3);
      const ease = 1 - Math.pow(1 - dialogProgress, 3);
      dialog.alpha = ease;
      dialog.y = targetY + 30 * (1 - ease);

      // Staggered cards
      for (let i = 0; i < dialog.children.length; i++) {
        const child = dialog.children[i] as Partial<AnimatedCard> & Container;
        if (child._animDelay !== undefined && !child._animDone) {
          const cardTime = animTime - child._animDelay;
          if (cardTime > 0) {
            const cp = Math.min(1, cardTime * 4);
            const ce = 1 - Math.pow(1 - cp, 3);
            child.alpha = ce;
            child.y = (child._baseY ?? 0) + 20 * (1 - ce);
            if (cp >= 1) child._animDone = true;
          }
        }
      }

      if (animTime > 1.5) {
        app.ticker.remove(animIn);
      }
    };
    app.ticker.add(animIn);

    app.stage.addChild(overlay);
  });
}
