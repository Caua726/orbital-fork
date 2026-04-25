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
import { getConfig, isAnyWeydraSubsystemOn } from './core/config';

let _renderer: Renderer | null = null;
let _rafHandle: number | null = null;
let _resizeAbort: AbortController | null = null;

export function getWeydraRenderer(): Renderer | null {
  return _renderer;
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
 */
function resolveBackend(
  configured: 'auto' | 'webgpu' | 'webgl2',
): 'auto' | 'webgpu' | 'webgl2' {
  if (configured !== 'auto') return configured;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // `Gecko/` + `Firefox/` is the canonical UA fingerprint; Seamonkey/Pale
  // Moon also match, which is fine — they share the same wgpu IPC path.
  const isFirefox = /Gecko\/\d+ Firefox\//.test(ua);
  if (isFirefox) {
    console.info(
      '[weydra] Firefox detected; forcing backend=webgl2 (WebGPU on Firefox release crashes the parent process on AMD adapters — bug 1873431-class).',
    );
    return 'webgl2';
  }
  return 'auto';
}

export async function startWeydra(): Promise<void> {
  if (!anyFlagEnabled()) return;

  const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.warn('[weydra] #weydra-canvas not found in DOM — skipping init');
    return;
  }

  // Match canvas backing-store to its display size so rendering isn't stretched.
  // At first call clientWidth/Height may still be 0 (layout not yet flushed).
  // Fallback to window size, then resize handler corrects it on first paint.
  function currentSize(): { width: number; height: number; dpr: number } {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas!.clientWidth || window.innerWidth;
    const cssH = canvas!.clientHeight || window.innerHeight;
    return { width: Math.max(1, Math.floor(cssW * dpr)), height: Math.max(1, Math.floor(cssH * dpr)), dpr };
  }
  {
    const { width, height } = currentSize();
    canvas.width = width;
    canvas.height = height;
  }

  try {
    await initWeydra();
    const backend = resolveBackend(getConfig().weydra.backend ?? 'auto');
    _renderer = await Renderer.create(canvas, backend);
    if (getConfig().weydra.starfield) {
      _renderer.createStarfield(starfieldWgsl);
    }
    if (getConfig().weydra.planetsLive) {
      _renderer.createPlanetShader(planetWgsl);
    }
    console.info('[weydra] renderer initialized; flags:', getConfig().weydra);
    // Expose for live console debugging — typing __weydraRenderer in
    // DevTools gives access to setCamera/setStarfieldDensity etc.
    (window as any).__weydraRenderer = _renderer;
  } catch (err) {
    console.error('[weydra] init failed:', err);
    return;
  }

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

  const loop = () => {
    if (_renderer) {
      try {
        _renderer.render();
      } catch (err) {
        console.error('[weydra] render error:', err);
      }
    }
    _rafHandle = requestAnimationFrame(loop);
  };
  _rafHandle = requestAnimationFrame(loop);
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
