import { Graphics } from 'pixi.js';

/**
 * Céu + gramado verde (terreno jogável na parte inferior).
 */
export function criarTerreno(app) {
  const g = new Graphics();
  const w = app.screen.width;
  const h = app.screen.height;
  const alturaCeus = h * 0.60;

  g.rect(0, 0, w, alturaCeus).fill({ color: 0x87ceeb });
  g.rect(0, alturaCeus, w, h - alturaCeus).fill({ color: 0x3d8c40 });

  return g;
}
