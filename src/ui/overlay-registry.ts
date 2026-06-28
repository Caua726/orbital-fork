/**
 * Module-level registry of UI overlays. Each overlay registers at
 * creation, desregisters on destroy. The game loop calls
 * `tickOverlays(dtSec)` once per frame to drive per-overlay
 * animations (slide-in, fade-out, etc).
 *
 * `destruir` is called by the world-destroy path. Listener leaks
 * (canvas.addEventListener without removeEventListener) are the
 * single biggest source of M7/M9 bugs — every overlay is required
 * to clean up its listeners + weydra handles in `destruir`.
 */
type Overlay = {
  tick?: (dtSec: number) => void;
  destruir: () => void;
};

const overlays: Set<Overlay> = new Set();

export function registerOverlay(o: Overlay): () => void {
  overlays.add(o);
  return () => {
    overlays.delete(o);
  };
}

export function tickOverlays(dtSec: number): void {
  for (const o of overlays) o.tick?.(dtSec);
}

export function destruirTodosOverlays(): void {
  for (const o of overlays) o.destruir();
  overlays.clear();
}
