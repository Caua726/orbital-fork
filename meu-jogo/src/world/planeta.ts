import { Assets, AnimatedSprite, Rectangle, Texture } from 'pixi.js';

export const TIPO_PLANETA: Record<string, string> = {
  COMUM: 'comum',
  MARTE: 'marte',
  ROXO: 'roxo',
  GASOSO: 'gasoso',
};

export const SPRITE_PLANETA_POR_TIPO: Record<string, string> = {
  [TIPO_PLANETA.COMUM]: '/assets/planeta-comum.png',
  [TIPO_PLANETA.MARTE]: '/assets/planeta-rochoso.png',
  [TIPO_PLANETA.ROXO]: '/assets/planeta-habitavel.png',
  [TIPO_PLANETA.GASOSO]: '/assets/planeta-gasoso.png',
};

export function aplicarAparenciaTipoPlaneta(sprite: AnimatedSprite, tipoPlaneta: string): void {
  sprite.tint = 0xffffff;
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

const FRAME_W = 64;
const FRAME_H = 64;
const TOTAL_FRAMES = 128;

export type TexturasPlaneta = Record<string, Texture[]>;

export function criarFramesSpriteStrip(texture: Texture, frameW: number = FRAME_W, frameH: number = FRAME_H): Texture[] {
  const frames: Texture[] = [];
  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    frames.push(
      new Texture({
        source: texture.source,
        frame: new Rectangle(frame * frameW, 0, frameW, frameH),
      })
    );
  }
  return frames;
}

export async function criarPlaneta(): Promise<TexturasPlaneta> {
  const entradas = await Promise.all(
    Object.entries(SPRITE_PLANETA_POR_TIPO).map(async ([tipo, path]) => {
      const texture: Texture = await Assets.load(path);
      texture.source.scaleMode = 'nearest';
      return [tipo, criarFramesSpriteStrip(texture)] as const;
    })
  );
  return Object.fromEntries(entradas);
}

export function criarPlanetaSprite(texturas: TexturasPlaneta, x: number, y: number, tamanho: number, tipoPlaneta: string = TIPO_PLANETA.COMUM): AnimatedSprite {
  const frames = texturas[tipoPlaneta] ?? texturas[TIPO_PLANETA.COMUM];
  const sprite = new AnimatedSprite(frames);
  sprite.animationSpeed = 0.08 + Math.random() * 0.025;
  sprite.gotoAndPlay(Math.floor(Math.random() * frames.length));
  sprite.anchor.set(0.5);
  sprite.width = tamanho;
  sprite.height = tamanho;
  sprite.x = x;
  sprite.y = y;
  aplicarAparenciaTipoPlaneta(sprite, tipoPlaneta);
  return sprite;
}
