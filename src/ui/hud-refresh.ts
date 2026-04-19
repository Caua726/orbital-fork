/**
 * Shared HUD refresh throttle.
 *
 * Heavy HUD surfaces (planet details modal, empire modal, build panel)
 * rebuild their full DOM on every HUD tick (~30 Hz) — which is both
 * wasteful on desktop and visibly janky on mobile. Numbers updating
 * at 30 Hz aren't perceptibly smoother than 5 Hz to the eye anyway,
 * but the DOM churn is 6× higher.
 *
 * Each caller gets its own monotonic gate via `shouldRefresh(key)`.
 * The key identifies the surface (modal / panel name) and keeps state
 * between calls.
 *
 * Usage:
 *   export function atualizarMyPanel(): void {
 *     if (!shouldRefresh('my-panel')) return;
 *     // ... rebuild ...
 *   }
 */

const INTERVAL_MS = 200; // ~5 Hz — same desktop + mobile
const _last: Record<string, number> = {};

export function shouldRefresh(key: string): boolean {
  const now = performance.now();
  const prev = _last[key] ?? 0;
  if (now - prev < INTERVAL_MS) return false;
  _last[key] = now;
  return true;
}

/** Force the next shouldRefresh(key) call to pass. Useful when a
 *  controller wants an immediate update (e.g. after opening a modal
 *  or switching planets). */
export function forceRefresh(key: string): void {
  _last[key] = 0;
}
