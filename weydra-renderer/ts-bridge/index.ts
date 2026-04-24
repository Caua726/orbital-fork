/**
 * weydra-renderer TypeScript bridge.
 *
 * Wraps the WASM-exported Renderer with an idiomatic TypeScript API.
 * Hot-path ops (setStarfieldDensity, etc.) write directly into WASM memory
 * via typed-array views reconstructed per call — caching `wasm.memory.buffer`
 * across frames is unsafe because any `memory.grow()` detaches the old
 * ArrayBuffer silently (M2 spec "Convenção de views sobre WASM memory").
 */

import init, { Renderer as WasmRenderer, type InitOutput } from 'weydra-renderer-wasm';

let _initPromise: Promise<InitOutput> | null = null;
let _wasm: InitOutput | null = null;

/**
 * Load the WASM module. Must be awaited before creating any Renderer.
 * Safe to call multiple times — concurrent calls share the same in-flight
 * promise, so the module is only initialized once.
 */
export function initWeydra(): Promise<InitOutput> {
  if (_initPromise) return _initPromise;
  const p = init().then((out) => {
    _wasm = out;
    return out;
  });
  _initPromise = p;
  return p;
}

/**
 * The weydra-renderer instance. Bound to a specific HTMLCanvasElement.
 */
export class Renderer {
  private readonly inner: WasmRenderer;

  private constructor(inner: WasmRenderer) {
    this.inner = inner;
  }

  /**
   * Create a new Renderer on the given canvas.
   * Must call `initWeydra()` first.
   */
  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!_initPromise) {
      throw new Error('initWeydra() must be called before Renderer.create()');
    }
    await _initPromise;
    const inner = await WasmRenderer.create(canvas);
    return new Renderer(inner);
  }

  resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`weydra resize: invalid dimensions ${width}x${height}`);
    }
    try {
      this.inner.resize(width, height);
    } catch (e) {
      throw new Error(`weydra resize failed: ${String(e)}`);
    }
  }

  render(): void {
    try {
      this.inner.render();
    } catch (e) {
      throw new Error(`weydra render failed: ${String(e)}`);
    }
  }

  /**
   * Push camera uniforms. `vw`/`vh` are WORLD UNITS (screen / zoom per M2
   * convention). Shaders consume these directly and stay zoom-agnostic.
   */
  setCamera(x: number, y: number, vw: number, vh: number, time: number): void {
    this.inner.set_camera(x, y, vw, vh, time);
  }

  /**
   * Register the starfield shader + allocate its uniform pool. Call once
   * after Renderer.create. Source comes from the `.wgsl` default import
   * emitted by the Vite plugin.
   */
  createStarfield(wgslSource: string): void {
    this.inner.create_starfield(wgslSource);
  }

  /**
   * Write starfield.density via shared WASM memory. Rebuilds the view each
   * call — `wasm.memory.buffer` detaches silently on any `memory.grow()`.
   * Cost ~50ns, no call boundary crossing for the payload.
   */
  setStarfieldDensity(v: number): void {
    if (!_wasm) return;
    const ptr = this.inner.starfield_uniforms_ptr();
    if (ptr === 0) return;
    // StarfieldUniforms = 16 bytes = 4 f32 slots; density is slot 0.
    new Float32Array(_wasm.memory.buffer, ptr, 4)[0] = v;
  }
}

export type { };
