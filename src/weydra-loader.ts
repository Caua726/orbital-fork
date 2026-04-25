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
import { getConfig } from './core/config';

let _renderer: Renderer | null = null;
let _rafHandle: number | null = null;

export function getWeydraRenderer(): Renderer | null {
  return _renderer;
}

function anyFlagEnabled(): boolean {
  try {
    const w = getConfig().weydra;
    if (!w) return false;
    // Any subsystem flag should boot the renderer. Previously only
    // `starfield` was checked here, so a player enabling `ships` or
    // `planetsBaked` in isolation never saw the weydra canvas init.
    return !!(
      w.starfield
      || w.ships
      || w.shipTrails
      || w.starfieldBright
      || w.planetsBaked
    );
  } catch {
    return false;
  }
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
    _renderer = await Renderer.create(canvas);
    if (getConfig().weydra.starfield) {
      _renderer.createStarfield(starfieldWgsl);
    }
    console.info('[weydra] renderer initialized; flags:', getConfig().weydra);
    // Expose for live console debugging — typing __weydraRenderer in
    // DevTools gives access to setCamera/setStarfieldDensity etc.
    (window as any).__weydraRenderer = _renderer;
  } catch (err) {
    console.error('[weydra] init failed:', err);
    return;
  }

  // Resize on window resize. Re-read devicePixelRatio each call —
  // moving window between monitors with different DPI changes it.
  window.addEventListener('resize', () => {
    if (!_renderer) return;
    const { width, height } = currentSize();
    canvas.width = width;
    canvas.height = height;
    _renderer.resize(width, height);
  });

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
