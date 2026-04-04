import { Assets, AnimatedSprite, Spritesheet, SCALE_MODES } from 'pixi.js';

export const TIPO_PLANETA = {
  COMUM: 'comum',
  MARTE: 'marte',
  ROXO: 'roxo',
  GASOSO: 'gasoso',
};

const TINT_POR_TIPO = {
  [TIPO_PLANETA.COMUM]: 0xffffff,
  [TIPO_PLANETA.MARTE]: 0xd4785a,
  [TIPO_PLANETA.ROXO]: 0x9b5cff,
  [TIPO_PLANETA.GASOSO]: 0xa8e0ff,
};

export function aplicarAparenciaTipoPlaneta(sprite, tipoPlaneta) {
  sprite.tint = TINT_POR_TIPO[tipoPlaneta] ?? 0xffffff;
}

const FRAME_W = 250;
const FRAME_H = 250;
const COLUNAS = 5;
const LINHAS = 6;

export async function criarPlaneta(app) {
  const texture = await Assets.load('/assets/planeta.png');
  texture.source.scaleMode = SCALE_MODES.NEAREST;

  const frames = {};
  const animFrames = [];

  for (let linha = 0; linha < LINHAS; linha++) {
    for (let col = 0; col < COLUNAS; col++) {
      const id = `planeta_${linha}_${col}`;
      frames[id] = {
        frame: { x: col * FRAME_W, y: linha * FRAME_H, w: FRAME_W, h: FRAME_H },
        sourceSize: { w: FRAME_W, h: FRAME_H },
        spriteSourceSize: { x: 0, y: 0, w: FRAME_W, h: FRAME_H },
      };
      animFrames.push(id);
    }
  }

  const sheet = new Spritesheet(texture, {
    frames,
    meta: { scale: 1 },
    animations: { rotacao: animFrames },
  });
  await sheet.parse();

  return sheet;
}

export function criarPlanetaSprite(sheet, x, y, tamanho, tipoPlaneta = TIPO_PLANETA.COMUM) {
  const sprite = new AnimatedSprite(sheet.animations['rotacao']);
  sprite.animationSpeed = 0.02 + Math.random() * 0.08;
  sprite.gotoAndStop(Math.floor(Math.random() * 30));
  sprite.anchor.set(0.5);
  sprite.width = tamanho;
  sprite.height = tamanho;
  sprite.x = x;
  sprite.y = y;
  aplicarAparenciaTipoPlaneta(sprite, tipoPlaneta);
  return sprite;
}
