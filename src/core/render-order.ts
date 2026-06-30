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
