/**
 * Render pacing shared by both engines: the FPS cap and the painted-frame
 * count the FPS readouts show.
 *
 * Both engines paint from a requestAnimationFrame loop (weydra-loader's render
 * loop; main.ts paints Pixi after each game tick), and each frame asks
 * `devePintar(t)`. The cap applies with vsync on too — the settings promise a
 * limit "on top of vsync".
 */
let _intervaloMs = 0;
let _ultimoMs = 0;
let _pintados = 0;
let _janelaInicio = 0;
let _fps = 0;

/** FPS cap; 0 = uncapped (paint every display refresh). */
export function setLimiteFps(cap: number): void {
  _intervaloMs = cap > 0 ? 1000 / cap : 0;
  _ultimoMs = 0;
}

/** Whether the frame at rAF time `t` should be painted under the cap. */
export function devePintar(t: number): boolean {
  if (_intervaloMs === 0) return true;
  const dt = t - _ultimoMs;
  // rAF timestamps jitter around the display period. A strict `dt >= interval`
  // skipped every other frame whenever the cap matched the refresh rate
  // (60 on a 60 Hz screen painted 30), so allow 1 ms of slack.
  if (dt < _intervaloMs - 1) return false;
  // Keep the phase (no drift); resync after a stall instead of bursting.
  _ultimoMs = dt > _intervaloMs * 2 ? t : _ultimoMs + _intervaloMs;
  return true;
}

/** Counts one painted frame (call right after the engine renders). */
export function registrarQuadroPintado(): void {
  _pintados++;
  const agora = performance.now();
  if (_janelaInicio === 0) _janelaInicio = agora;
  const dt = agora - _janelaInicio;
  if (dt >= 500) {
    _fps = (_pintados * 1000) / dt;
    _pintados = 0;
    _janelaInicio = agora;
  }
}

/** Painted frames per second over the last ~500 ms window — what the FPS
 *  readouts show (cap-aware, engine-agnostic). */
export function fpsAtual(): number {
  // No frame for a whole window (paused tab, stalled renderer) reads as 0.
  if (_janelaInicio !== 0 && performance.now() - _janelaInicio > 1000) return 0;
  return _fps;
}
