export interface ViewportBounds {
  esq: number;
  dir: number;
  cima: number;
  baixo: number;
  halfW: number;
  halfH: number;
  margem: number;
}

/**
 * Calcula o retângulo de culling no espaço do mundo a partir da posição
 * do centro da câmera e do zoom. O conteúdo fora desse retângulo pode
 * ser considerado off-screen e culled.
 *
 * Assume que a transform do Pixi posiciona `camX/camY` no CENTRO da
 * viewport visível — é o que `src/main.ts:130` faz (`container.x =
 * -camera.x * zoom + screen.width / 2`).
 *
 * @param margemMin  Piso absoluto da margem em world units (default 600).
 * @param margemMultiplier  Se > 0, adiciona um termo `margemMultiplier / zoom`
 *                          à margem efetiva. Usado pelo fog canvas que
 *                          precisa de buffer que cresce com o zoom-out.
 */
/**
 * Callers that hit this per frame should own a persistent ViewportBounds
 * and pass it as `out` to reuse the allocation. Omitting `out` falls back
 * to allocating a fresh object (OK for tests and one-off calls).
 */
export function calcularBoundsViewport(
  camX: number,
  camY: number,
  zoom: number,
  screenW: number,
  screenH: number,
  margemMin: number = 600,
  margemMultiplier: number = 0,
  out?: ViewportBounds,
): ViewportBounds {
  const z = zoom || 1;
  const halfW = screenW / (2 * z);
  const halfH = screenH / (2 * z);
  const margem = Math.max(
    margemMin,
    halfW * 0.5,
    margemMultiplier > 0 ? margemMultiplier / z : 0,
  );
  const b = out ?? ({} as ViewportBounds);
  b.halfW = halfW;
  b.halfH = halfH;
  b.margem = margem;
  b.esq = camX - halfW - margem;
  b.dir = camX + halfW + margem;
  b.cima = camY - halfH - margem;
  b.baixo = camY + halfH + margem;
  return b;
}
