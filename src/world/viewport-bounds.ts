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
export function calcularBoundsViewport(
  camX: number,
  camY: number,
  zoom: number,
  screenW: number,
  screenH: number,
  margemMin: number = 600,
  margemMultiplier: number = 0,
): ViewportBounds {
  const z = zoom || 1;
  const halfW = screenW / (2 * z);
  const halfH = screenH / (2 * z);
  const margem = Math.max(
    margemMin,
    halfW * 0.5,
    margemMultiplier > 0 ? margemMultiplier / z : 0,
  );
  return {
    halfW,
    halfH,
    margem,
    esq: camX - halfW - margem,
    dir: camX + halfW + margem,
    cima: camY - halfH - margem,
    baixo: camY + halfH + margem,
  };
}
