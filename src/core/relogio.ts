/**
 * Wall clock for render-visible timers (fog-memory "há X s" label, ship-ring
 * pulses). Normally `performance.now()`; the render-matrix harness swaps in a
 * virtual clock that only advances with its fixed simulation steps, so those
 * visuals are identical between engines (src/world/render-matrix.ts).
 */
let _virtualMs: number | null = null;

export function agoraMs(): number {
  return _virtualMs ?? performance.now();
}

export function fixarRelogioVirtual(ms: number | null): void {
  _virtualMs = ms;
}
