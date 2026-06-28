/**
 * DOM helpers shared by M9 UI overlays. Weydra canvas is drawn in
 * physical pixels (canvas.width = cssWidth * devicePixelRatio);
 * Graphics + Text coords passed in are physical pixels.
 * `PointerEvent.clientX/Y` are CSS pixels — `toCanvasXY` converts.
 */

/** Convert a PointerEvent's CSS-pixel clientX/Y into canvas-physical
 *  pixels (multiplies by devicePixelRatio). Use this for every
 *  weydra hit-test before bounds comparison. */
export function toCanvasXY(
  ev: PointerEvent,
  canvas: HTMLCanvasElement,
): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return [(ev.clientX - rect.left) * dpr, (ev.clientY - rect.top) * dpr];
}

/** Pack `0xRRGGBB` + alpha (0..1) into a u32 laid out as
 *  `0xRR_GG_BB_AA`. The Rust side unpacks in the same order
 *  (matches the unpack_rgba helper in adapters/wasm/src/lib.rs).
 *  `>>> 0` is required — JS bitwise ops are int32-signed and
 *  `(0xFF << 24)` becomes negative; wasm-bindgen rejects negative
 *  i32 at the u32 boundary. */
export function rgbaWithAlpha(rgb: number, alpha01: number): number {
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  return (((rgb & 0xFFFFFF) << 8) | a) >>> 0;
}
