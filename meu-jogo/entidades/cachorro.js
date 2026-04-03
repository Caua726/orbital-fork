import { Graphics } from 'pixi.js';

export function criarCachorro(app, areaJogo) {
  const g = new Graphics();
  g.roundRect(-14, -22, 28, 36, 6).fill({ color: 0x8b5a2b });
  g.roundRect(-18, -8, 10, 8, 3).fill({ color: 0x8b5a2b });
  g.roundRect(8, -8, 10, 8, 3).fill({ color: 0x8b5a2b });
  g.ellipse(0, -26, 10, 8).fill({ color: 0x6b4423 });

  g.x = app.screen.width / 2 - 120;
  g.y = areaJogo.top + areaJogo.height / 2;

  return g;
}

/**
 * Segue o alvo mantendo uma distância mínima (evita sobreposição).
 */
export function atualizarCachorro(cachorro, alvo, areaJogo, velocidade) {
  const dx = alvo.x - cachorro.x;
  const dy = alvo.y - cachorro.y;
  const dist = Math.hypot(dx, dy);
  const distanciaMinima = 48;

  if (dist > distanciaMinima && dist > 0.001) {
    cachorro.x += (dx / dist) * velocidade;
    cachorro.y += (dy / dist) * velocidade;
  }

  const m = 20;
  cachorro.x = Math.max(areaJogo.left + m, Math.min(areaJogo.right - m, cachorro.x));
  cachorro.y = Math.max(areaJogo.top + m, Math.min(areaJogo.bottom - m, cachorro.y));
}
