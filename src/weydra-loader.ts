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
import { criarSoftwareHooks } from './world/weydra-software-hooks';
import { devePintar, registrarQuadroPintado } from './core/frame-pacer';
import type { WeydraBackend } from './core/config';
import starfieldWgsl from './shaders/starfield-weydra.wgsl';
import planetWgsl from './shaders/planeta-weydra.wgsl';
import fogWgsl from './shaders/fog.wgsl';
import graphicsWgsl from './shaders/graphics.wgsl';
import { getConfig, isAnyWeydraSubsystemOn } from './core/config';
import { tickOverlays } from './ui/overlay-registry';

let _renderer: Renderer | null = null;
let _rafHandle: number | null = null;
let _lastT: number = 0;
let _firstFrame = true;
let _resizeAbort: AbortController | null = null;

let _renderCanvas: HTMLCanvasElement | null = null;
let _effectiveBackend: WeydraBackend | null = null;
/** Canvases that already handed out a rendering context (see startWeydra). */
const _canvasUsados = new WeakSet<HTMLCanvasElement>();
let _consecutiveRenderFailures = 0;

export function getWeydraRenderer(): Renderer | null {
  return _renderer;
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
function resolveBackend(configured: WeydraBackend): WeydraBackend {
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
  requestedBackend: WeydraBackend;
  effectiveBackend: WeydraBackend;
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

  let canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement | null;
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
  // 'software' (Canvas2D/CPU) is the last resort, like Pixi's canvas backend.
  const candidates = ([firstBackend, 'webgpu', 'webgl2', 'software'] as const)
    .filter((v, i, all) => all.indexOf(v) === i);
  const errors: string[] = [];
  // The software backend doesn't need wasm: a module that fails to load must
  // still leave the Canvas2D fallback available.
  let wasmErro: unknown = null;
  try { await initWeydra(); } catch (err) { wasmErro = err; }
  for (const backend of candidates) {
    try {
      if (backend !== 'software' && wasmErro) throw wasmErro;
      // A canvas keeps the first context type it handed out (2D, WebGL2 or
      // WebGPU) for life, so a failed attempt or an earlier session on another
      // backend would make every later getContext() return null. Each attempt
      // on a used canvas gets a fresh element in its place.
      if (_canvasUsados.has(canvas)) {
        const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
        fresh.width = canvas.width;
        fresh.height = canvas.height;
        canvas.replaceWith(fresh);
        canvas = fresh;
        _renderCanvas = fresh;
      }
      _canvasUsados.add(canvas);
      _renderer = backend === 'software'
        ? await Renderer.create(canvas, 'software', criarSoftwareHooks())
        : await Renderer.create(canvas, backend);
      _effectiveBackend = backend;
      // Same sky on every backend: software rasterizers keep the starfield
      // shader (2 cheap hash layers) instead of dropping to a black sky.
      if (getConfig().weydra.starfield) {
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
      // fps cap (frame-pacer.ts): skip painting but keep the rAF chain alive.
      if (devePintar(t)) {
        registrarQuadroPintado();
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
