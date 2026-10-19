/**
 * Canonical Z-order layers for the weydra-renderer. Lower z renders first
 * (drawn further back). Shared across Pixi + weydra so coexistence during
 * migration keeps the same stacking order.
 *
 * Source: spec "Convenção de Z-order" — canonical from M3.
 */
export const Z = Object.freeze({
  STARFIELD: 0,
  STARFIELD_BRIGHT: 1,
  PLANET_BAKED: 10,
  PLANET_LIVE: 11,
  ORBITS: 20,
  ROUTES: 25,
  SHIP_TRAILS: 28,
  SHIPS: 30,
  BEAMS: 35,
  FOG: 40,
  // Fog-of-war memory ghosts (remembered enemy planets shown in
  // fogged regions). Drawn in the graphics/text passes, which run after
  // the fog texture, so the dim ring + intel label stay legible over the
  // darkened area. Above FOG, below the UI band.
  FOG_MEMORY: 42,
  UI_BACKGROUND: 50,
  UI_GRAPHICS: 51,
  UI_TEXT: 52,
  UI_HOVER: 55,
});

export type ZLayer = typeof Z[keyof typeof Z];

/**
 * Diagnostic layer bits — one per Z band (each band runs up to the next
 * Z value). Mirrors `LAYER_*` / `layer_bit` in
 * weydra-renderer/adapters/wasm/src/lib.rs; the render-matrix harness
 * (src/world/render-matrix.ts) uses it to draw one layer at a time in
 * either engine.
 */
export const LAYER_BIT = Object.freeze({
  STARFIELD: 1 << 0,
  STARFIELD_BRIGHT: 1 << 1,
  PLANETS: 1 << 2,
  ORBITS: 1 << 3,
  ROUTES: 1 << 4,
  SHIP_TRAILS: 1 << 5,
  SHIPS: 1 << 6,
  BEAMS: 1 << 7,
  FOG: 1 << 8,
  FOG_MEMORY: 1 << 9,
  UI: 1 << 10,
});

export const LAYER_ALL = 0xffffffff;

export function layerBitForZ(z: number): number {
  if (z < Z.STARFIELD_BRIGHT) return LAYER_BIT.STARFIELD;
  if (z < Z.PLANET_BAKED) return LAYER_BIT.STARFIELD_BRIGHT;
  if (z < Z.ORBITS) return LAYER_BIT.PLANETS;
  if (z < Z.ROUTES) return LAYER_BIT.ORBITS;
  if (z < Z.SHIP_TRAILS) return LAYER_BIT.ROUTES;
  if (z < Z.SHIPS) return LAYER_BIT.SHIP_TRAILS;
  if (z < Z.BEAMS) return LAYER_BIT.SHIPS;
  if (z < Z.FOG) return LAYER_BIT.BEAMS;
  if (z < Z.FOG_MEMORY) return LAYER_BIT.FOG;
  if (z < Z.UI_BACKGROUND) return LAYER_BIT.FOG_MEMORY;
  return LAYER_BIT.UI;
}
