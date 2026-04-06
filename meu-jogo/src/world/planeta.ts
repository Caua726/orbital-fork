import { Assets, AnimatedSprite, Spritesheet, Texture } from 'pixi.js';

export const TIPO_PLANETA: Record<string, string> = {
  COMUM: 'comum',
  MARTE: 'marte',
  ROXO: 'roxo',
  GASOSO: 'gasoso',
};

const TINT_POR_TIPO: Record<string, number> = {
  [TIPO_PLANETA.COMUM]: 0xffffff,
  [TIPO_PLANETA.MARTE]: 0xd4785a,
  [TIPO_PLANETA.ROXO]: 0x9b5cff,
  [TIPO_PLANETA.GASOSO]: 0xa8e0ff,
};

export function aplicarAparenciaTipoPlaneta(sprite: AnimatedSprite, tipoPlaneta: string): void {
  sprite.tint = TINT_POR_TIPO[tipoPlaneta] ?? 0xffffff;
}

export function nomeTipoPlaneta(tipo: string): string {
  switch (tipo) {
    case TIPO_PLANETA.COMUM:
      return 'Comum';
    case TIPO_PLANETA.MARTE:
      return 'Marte';
    case TIPO_PLANETA.ROXO:
      return 'Roxo';
    case TIPO_PLANETA.GASOSO:
      return 'Gasoso';
    default:
      return tipo || '?';
  }
}

const FRAME_W = 250;
const FRAME_H = 250;
const COLUNAS = 5;
const LINHAS = 6;

interface FrameData {
  frame: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
}

export async function criarPlaneta(): Promise<Spritesheet> {
  const texture: Texture = await Assets.load('/assets/planeta.png');
  texture.source.scaleMode = 'nearest';

  const frames: Record<string, FrameData> = {};
  const animFrames: string[] = [];

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

export function criarPlanetaSprite(sheet: Spritesheet, x: number, y: number, tamanho: number, tipoPlaneta: string = TIPO_PLANETA.COMUM): AnimatedSprite {
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
