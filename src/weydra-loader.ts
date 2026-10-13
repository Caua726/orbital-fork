/**
 * Loader for the weydra-renderer. Reads `config.weydra.*` flags to decide
 * whether to boot the WASM renderer + which subsystems to register.
 *
 * M2 subsystem: starfield (procedural fullscreen shader). Future milestones
 * add more flags under `weydra.*` — loader registers each when its flag is on.
 *
 * The renderer lives on `#weydra-canvas` (added to index.html in M1) behind
 * the Pixi canvas. An internal rAF loop drives `renderer.render()`; game code
 * pushes uniforms via `setCamera`/`setStarfieldDensity` from its own tick.
 */

import { initWeydra, Renderer } from '@weydra/renderer';
import starfieldWgsl from './shaders/starfield-weydra.wgsl';
import planetWgsl from './shaders/planeta-weydra.wgsl';
import fogWgsl from './shaders/fog.wgsl';
import graphicsWgsl from './shaders/graphics.wgsl';
import { getConfig, isAnyWeydraSubsystemOn } from './core/config';
import { detectarRendererSoftware } from './core/software-gpu';
import { tickOverlays } from './ui/overlay-registry';

let _renderer: Renderer | null = null;
let _rafHandle: number | null = null;
let _lastT: number = 0;
let _firstFrame = true;
let _resizeAbort: AbortController | null = null;

// Render-loop fps cap. 0 = uncapped (rAF paces to the display refresh =
// vsync). When the user picks vsync-off + a cap, we throttle the render
// loop to `1000/cap` ms between painted frames. Replaces the old dead-Pixi
// -ticker path in main.ts (which also leaked a perpetual setTimeout).
let _renderIntervalMs = 0;
let _lastRenderT = 0;
let _renderCanvas: HTMLCanvasElement | null = null;
let _effectiveBackend: 'auto' | 'webgpu' | 'webgl2' | null = null;
// Painted-frame counter for the FPS HUD. Incremented in the render loop
// (NOT the game loop) so the HUD reflects actual painted frames — which is
// what an fps cap throttles. Read+reset via takePaintedFrameCount.
let _paintedFrames = 0;
let _consecutiveRenderFailures = 0;

export function getWeydraRenderer(): Renderer | null {
  return _renderer;
}

/** Set the render-loop fps cap (0 = uncapped). Driven by the graphics
 *  vsync/fpsCap settings via main.ts. */
export function setRenderFpsCap(cap: number): void {
  _renderIntervalMs = cap > 0 ? 1000 / cap : 0;
}

/** Painted frames since the last call; resets the counter. Used by the FPS
 *  HUD so it reports painted frames (cap-aware), not uncapped game ticks. */
export function takePaintedFrameCount(): number {
  const n = _paintedFrames;
  _paintedFrames = 0;
  return n;
}

/** Recompute the canvas backing-store size (applies renderScale) and
 *  resize the weydra surface. Call after a renderScale config change. */
export function aplicarTamanhoRenderizador(): void {
  if (!_renderer || !_renderCanvas) return;
  const { width, height } = computeBackingSize(_renderCanvas);
  _renderCanvas.width = width;
  _renderCanvas.height = height;
  _renderer.resize(width, height);
}

function renderScaleAtual(): number {
  try {
    const s = getConfig().graphics.renderScale ?? 1;
    return s > 0 ? s : 1;
  } catch {
    return 1;
  }
}

// WebGPU's guaranteed `maxTextureDimension2D` is 8192; the real limit comes
// from the device (see `max_texture_dimension_2d` on the Rust side) and is
// copied into `_maxBackingDim` right after the renderer is created. A backing
// store larger than the limit fails `Surface::configure` outright (the canvas
// stays black and, on WebGPU, wgpu treats the validation error as fatal), so
// clamping and letting the browser upscale is far better.
const DEFAULT_MAX_BACKING_DIM = 8192;
let _maxBackingDim = DEFAULT_MAX_BACKING_DIM;

/** Physical backing-store size for the canvas: CSS size × dpr × renderScale,
 *  clamped so neither dimension exceeds the GPU's max texture size. */
function computeBackingSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = (window.devicePixelRatio || 1) * renderScaleAtual();
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  let w = Math.max(1, Math.floor(cssW * dpr));
  let h = Math.max(1, Math.floor(cssH * dpr));
  const over = Math.max(w, h) / _maxBackingDim;
  if (over > 1) {
    w = Math.max(1, Math.floor(w / over));
    h = Math.max(1, Math.floor(h / over));
  }
  return { width: w, height: h };
}

function anyFlagEnabled(): boolean {
  try {
    return isAnyWeydraSubsystemOn(getConfig());
  } catch {
    return false;
  }
}

/**
 * Backend selection with a Firefox-release guard.
 *
 * Firefox 149 release ships WebGPU but the parent-process IPC path
 * (`wgpu_bindings::server::wgpu_server_pack_free_swap_chain_buffer_ids`)
 * panics with `TryFromSliceError` on `WebGPUParent::SwapChainDrop`,
 * which kills the entire browser (not just the tab) because the crash
 * lands in the parent process. Confirmed against AMD Baffin (RX 460/560)
 * on Arch Linux 6.19; reproducible by reloading any page that ever
 * created a WebGPU swap chain.
 *
 * Firefox marks WebGPU as experimental in release, so silently demoting
 * `auto` to `webgl2` matches the user's intent ("pick something that
 * works") without overriding an explicit `webgpu` pick — anyone using
 * Firefox Nightly with a working driver and an explicit `webgpu` config
 * still gets WebGPU.
 *
 * Caveat: an explicit `webgpu` config on Firefox **release** bypasses
 * this guard and is still vulnerable to the parent-process crash; the
 * opt-in is intentional (Nightly + working driver) but the policy is
 * "your config, your risk", not "we mitigated the crash for you".
 */
function resolveBackend(
  configured: 'auto' | 'webgpu' | 'webgl2',
): 'auto' | 'webgpu' | 'webgl2' {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // `Gecko/` + `Firefox/` is the canonical UA fingerprint; Seamonkey/Pale
  // Moon also match, which is fine — they share the same wgpu IPC path.
  const isFirefox = /Gecko\/\d+ Firefox\//.test(ua);

  // An explicit `webgpu` config on Firefox **release** bypasses the
  // auto→webgl2 demotion below and is still vulnerable to the parent-
  // process crash. Warn once at boot so the choice is observable in
  // DevTools instead of silently killing the browser tab later. The
  // policy is still "your config, your risk" — Nightly + working driver
  // is the legitimate use case — but the user should know.
  if (configured === 'webgpu' && isFirefox) {
    console.warn(
      '[weydra] backend=webgpu forced on Firefox release is known to crash the parent process on some AMD adapters (bug 1873431-class). To switch to webgl2, set localStorage.orbital_config → weydra.backend = "webgl2" then reload.',
    );
  }

  if (configured !== 'auto') return configured;
  if (isFirefox) {
    console.info(
      '[weydra] Firefox detected; forcing backend=webgl2 (WebGPU on Firefox release crashes the parent process on AMD adapters — bug 1873431-class).',
    );
    return 'webgl2';
  }
  return 'auto';
}

export interface WeydraStartResult {
  requestedBackend: 'auto' | 'webgpu' | 'webgl2';
  effectiveBackend: 'auto' | 'webgpu' | 'webgl2';
}

export async function startWeydra(): Promise<WeydraStartResult> {
  if (!anyFlagEnabled()) {
    throw new Error('Weydra solicitado sem subsistemas ativos.');
  }
  // Double-init guard: a second call would stack a second renderer, a
  // second rAF render loop, and a second (un-aborted) resize listener.
  // The current single caller is correct, but HMR / future callers must
  // be safe.
  if (_renderer) {
    return {
      requestedBackend: getConfig().rendering.weydra.backend,
      effectiveBackend: _effectiveBackend ?? getConfig().rendering.weydra.backend,
    };
  }

  const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.warn('[weydra] #weydra-canvas not found in DOM — skipping init');
    throw new Error('[weydra] #weydra-canvas not found in DOM');
  }
  _renderCanvas = canvas;

  // Match canvas backing-store to its display size so rendering isn't stretched.
  // At first call clientWidth/Height may still be 0 (layout not yet flushed).
  // Fallback to window size, then resize handler corrects it on first paint.
  // `renderScale` (graphics setting) scales the backing store below display
  // density to trade sharpness for fill-rate on weak GPUs.
  function currentSize(): { width: number; height: number } {
    return computeBackingSize(canvas!);
  }
  {
    const { width, height } = currentSize();
    canvas.width = width;
    canvas.height = height;
  }

  const requestedBackend = getConfig().rendering.weydra.backend ?? 'auto';
  const firstBackend = resolveBackend(requestedBackend);
  const candidates = ([firstBackend, 'webgpu', 'webgl2'] as const)
    .filter((v, i, all) => all.indexOf(v) === i);
  const errors: string[] = [];
  // Software rasterizers (SwiftShader/WARP/LLVMpipe) can't afford the 3-layer
  // procedural starfield: the Pixi path already swaps to a static tile in that
  // case (fundo.ts). Keep the bright-tile layer (starfieldBright) so the sky
  // isn't empty, skip the fullscreen shader. Detection is engine-agnostic
  // (software-gpu.ts) — before this, the weydra engine never noticed.
  const software = detectarRendererSoftware(null).isSoftware;
  if (software) {
    console.info('[weydra] GPU por software detectada — starfield procedural desligado (tiles estáticos).');
  }
  await initWeydra();
  for (const backend of candidates) {
    try {
      _renderer = await Renderer.create(canvas, backend);
      _effectiveBackend = backend;
      if (getConfig().weydra.starfield && !software) {
        _renderer.createStarfield(starfieldWgsl);
      }
      if (getConfig().weydra.planetsLive) {
        _renderer.createPlanetShader(planetWgsl);
      }
      if (getConfig().weydra.fog) {
        _renderer.createFogShader(fogWgsl);
      }
      if (getConfig().weydra.graphics || getConfig().weydra.ui) {
        // UI overlays reuse the graphics pipeline: both are non-world-space
        // 2D primitives with the same alpha blending contract.
        _renderer.createGraphicsShader(graphicsWgsl);
      }
      console.info(`[weydra] renderer initialized (${backend}); flags:`, getConfig().weydra);
      (window as any).__weydraRenderer = _renderer;
      break;
    } catch (err) {
      _renderer = null;
      errors.push(`${backend}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!_renderer || !_effectiveBackend) {
    _renderCanvas = null;
    throw new Error(`Weydra não inicializou em nenhum backend: ${errors.join(' | ')}`);
  }

  // The device's real texture limit is only known now: a canvas sized with the
  // 8192 default would exceed it on adapters that report less (and the surface
  // configure would fail). Re-apply the backing size with the actual limit.
  _maxBackingDim = _renderer.maxTextureDimension2d || DEFAULT_MAX_BACKING_DIM;
  aplicarTamanhoRenderizador();

  // Re-read DPR each call — moving the window across monitors changes it.
  // AbortController lets stopWeydra detach so re-init doesn't stack listeners.
  _resizeAbort = new AbortController();
  window.addEventListener('resize', () => {
    if (!_renderer) return;
    const { width, height } = currentSize();
    canvas.width = width;
    canvas.height = height;
    _renderer.resize(width, height);
  }, { signal: _resizeAbort.signal });

  const loop = (t: number) => {
    if (_renderer) {
      // fps cap: skip painting (but keep the rAF chain alive) until the
      // configured inter-frame interval has elapsed. Uncapped when 0.
      const due = _renderIntervalMs === 0 || (t - _lastRenderT) >= _renderIntervalMs;
      if (due) {
        _lastRenderT = t;
        _paintedFrames++;
        try {
          // First frame: seed _lastT to `t` so the overlay delta is 0
          // instead of the multi-second page-load timestamp (which would
          // fast-forward the first slide-in/fade animation).
          if (_firstFrame) {
            _lastT = t;
            _firstFrame = false;
          }
          // Tick UI overlays (slide-in, fade-out) before the render pass
          // so per-frame state (alpha, offsetY) is in sync with the draw.
          tickOverlays((t - _lastT) / 1000);
          _lastT = t;
          _renderer.render();
          _consecutiveRenderFailures = 0;
        } catch (err) {
          _consecutiveRenderFailures++;
          console.error('[weydra] render error:', err);
          if (_consecutiveRenderFailures >= 3) {
            const rendererError = err instanceof Error ? err : new Error(String(err));
            stopWeydra();
            window.dispatchEvent(new CustomEvent('orbital:renderer-fatal', {
              detail: { engine: 'weydra', error: rendererError },
            }));
            return;
          }
        }
      }
    }
    _rafHandle = requestAnimationFrame(loop);
  };
  _rafHandle = requestAnimationFrame(loop);
  return { requestedBackend, effectiveBackend: _effectiveBackend };
}

/** Backwards-compat alias so existing bootstrap callers keep working. */
export const startWeydraM1 = startWeydra;

export function stopWeydra(): void {
  if (_rafHandle !== null) {
    cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
  }
  if (_resizeAbort !== null) {
    _resizeAbort.abort();
    _resizeAbort = null;
  }
  _renderer = null;
  _effectiveBackend = null;
  _renderCanvas = null;
  // Reset frame timing so a re-init reseeds the overlay delta cleanly
  // instead of replaying the boot-time jump.
  _firstFrame = true;
  _lastRenderT = 0;
  _consecutiveRenderFailures = 0;
}

export const stopWeydraM1 = stopWeydra;

// Dev helper — digitar no console: __weydra('starfield', true) liga o flag
// e recarrega; __weydra('starfield', false) desliga; __weydraStatus() mostra
// o estado atual. Fica só em dev/preview — remove antes de prod se incomodar.
if (typeof window !== 'undefined') {
  (window as any).__weydra = (key: string, value: boolean): void => {
    try {
      const raw = localStorage.getItem('orbital_config');
      const cfg = raw ? JSON.parse(raw) : {};
      cfg.weydra = { ...(cfg.weydra || {}), [key]: value };
      localStorage.setItem('orbital_config', JSON.stringify(cfg));
      console.info(`[weydra] ${key} = ${value}; reloading…`);
      location.reload();
    } catch (err) {
      console.error('[weydra] __weydra helper failed:', err);
    }
  };
  (window as any).__weydraStatus = (): Record<string, unknown> => {
    try {
      const raw = localStorage.getItem('orbital_config');
      const cfg = raw ? JSON.parse(raw) : {};
      return cfg.weydra ?? {};
    } catch {
      return {};
    }
  };
}
