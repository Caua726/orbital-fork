/**
 * weydra-renderer TypeScript bridge.
 *
 * Wraps the WASM-exported Renderer with an idiomatic TypeScript API.
 *
 * Shared-memory convention (spec "Convenção de views sobre WASM memory",
 * válida de M2 em diante):
 *
 *   1. `WebAssembly.Memory.buffer` detaches on any `memory.grow()` — cached
 *      typed-array views over the old buffer become silent no-ops.
 *   2. The Rust side bumps `mem_version` after every op that may grow
 *      memory (texture upload, pipeline construction, …).
 *   3. TS revalidates via DUAL check: `mem_version` AND
 *      `_wasm.memory.buffer` identity. Either mismatch rebuilds the views.
 *
 * Hot-path setters (Sprite.x = …) skip revalidate because they do not
 * allocate; one revalidate per setup op (create/destroy/upload) suffices
 * so long as render() is also treated as a revalidate checkpoint.
 */

import init, { Renderer as WasmRenderer, type InitOutput } from 'weydra-renderer-wasm';

let _initPromise: Promise<InitOutput> | null = null;
let _wasm: InitOutput | null = null;

/**
 * Load the WASM module. Must be awaited before creating any Renderer.
 * Concurrent calls share the same in-flight promise, so the module is
 * only initialised once.
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
 * Pool views — one typed-array per pointer-exposed SoA field on the
 * Rust side. Rebuilt on `revalidate()` when `mem_version` or the
 * underlying `ArrayBuffer` changed.
 */
interface PoolViews {
  transforms: Float32Array; // N × 4 (x, y, scale_x, scale_y)
  uvs: Float32Array;        // N × 4 (u, v, w, h)
  colors: Uint32Array;      // N × 1 — 0xRRGGBBAA
  flags: Uint8Array;        // N × 1 — bit 0 = visible
  zOrder: Float32Array;     // N × 1
}

/**
 * The weydra-renderer instance. Bound to a specific HTMLCanvasElement.
 */
export class Renderer {
  private readonly inner: WasmRenderer;
  private _views: PoolViews | null = null;
  private _lastMemVersion = 0;
  private _lastBuffer: ArrayBuffer | null = null;

  private constructor(inner: WasmRenderer) {
    this.inner = inner;
  }

  /**
   * Create a new Renderer on the given canvas.
   *
   * `backend` selects the wgpu backend:
   *  - `'auto'` lets wgpu pick. WebGPU when navigator.gpu is present,
   *    WebGL2 otherwise.
   *  - `'webgpu'` requires WebGPU.
   *  - `'webgl2'` requires WebGL2. Implemented by hiding navigator.gpu
   *    during instance creation so wgpu's auto-detection goes through
   *    the wgpu-core/cfg(webgl) path. The original navigator.gpu is
   *    restored afterward; existing references stay valid.
   *
   * Must call `initWeydra()` first.
   */
  static async create(
    canvas: HTMLCanvasElement,
    backend: 'auto' | 'webgpu' | 'webgl2' = 'auto',
  ): Promise<Renderer> {
    if (!_initPromise) {
      throw new Error('initWeydra() must be called before Renderer.create()');
    }
    await _initPromise;
    const code = backend === 'webgpu' ? 1 : 0;
    if (backend === 'webgl2' && typeof navigator !== 'undefined') {
      const nav = navigator as Navigator & { gpu?: unknown };
      const original = nav.gpu;
      // delete nav.gpu — descriptor may be non-configurable on some
      // browsers, so use defineProperty to override before instance
      // creation, then restore.
      try {
        Object.defineProperty(nav, 'gpu', { value: undefined, configurable: true });
      } catch { /* fallthrough — wgpu may still detect undefined gpu */ }
      try {
        const inner = await WasmRenderer.create(canvas, code);
        return new Renderer(inner);
      } finally {
        if (original !== undefined) {
          try { Object.defineProperty(nav, 'gpu', { value: original, configurable: true }); }
          catch { /* tolerate immutable descriptor */ }
        }
      }
    }
    const inner = await WasmRenderer.create(canvas, code);
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
    // Spec "Convenção de views" lists render() as a revalidate checkpoint —
    // future milestones (M7 lyon tessellation) can grow wasm memory mid-frame.
    // Cost is dominated by one `mem_version()` call; skipped views rebuild
    // when nothing changed.
    if (this._views !== null) this.revalidate();
  }

  /**
   * Push camera uniforms. `vw`/`vh` are WORLD UNITS (screen / zoom per
   * the M2 convention) — shaders stay zoom-agnostic.
   */
  setCamera(x: number, y: number, vw: number, vh: number, time: number): void {
    this.inner.set_camera(x, y, vw, vh, time);
  }

  // ─── Starfield (M2) ───────────────────────────────────────────────────

  createStarfield(wgslSource: string): void {
    this.inner.create_starfield(wgslSource);
    this.revalidate();
  }

  setStarfieldDensity(v: number): void {
    if (!_wasm) return;
    const ptr = this.inner.starfield_uniforms_ptr();
    if (ptr === 0) return;
    new Float32Array(_wasm.memory.buffer, ptr, 4)[0] = v;
  }

  // ─── Sprite batcher (M3) ─────────────────────────────────────────────

  /**
   * Upload RGBA8 pixel bytes as a GPU texture with ClampToEdge sampling.
   * Returns an opaque handle suitable for `createSprite`. Length must be
   * `width * height * 4`.
   */
  uploadTexture(bytes: Uint8Array, width: number, height: number): bigint {
    const handle = this.inner.upload_texture(bytes, width, height);
    this.revalidate();
    return handle;
  }

  /**
   * Like `uploadTexture` but with Repeat sampling on U/V. Use for tiling
   * sprites (bright star layer, parallax backdrops) where the sprite sets
   * `uv_rect.w/h` > 1 so the texture repeats across the quad.
   */
  uploadTextureTiled(bytes: Uint8Array, width: number, height: number): bigint {
    const handle = this.inner.upload_texture_tiled(bytes, width, height);
    this.revalidate();
    return handle;
  }

  /**
   * Allocate a sprite in the pool. `displayW`/`displayH` are the quad
   * size in world units; the initial tint is white and the sub-frame
   * defaults to the full texture (use `Sprite.setUv` to pick a sheet cell).
   */
  createSprite(texture: bigint, displayW: number, displayH: number): Sprite {
    const h = this.inner.create_sprite(texture, displayW, displayH);
    this.revalidate();
    return new Sprite(h, this);
  }

  destroySprite(s: Sprite): void {
    this.inner.destroy_sprite(s.handle);
    // No revalidate: destroy does not grow memory. Views stay live and
    // readers will see `flags[slot] === 0` — a no-op in the render loop.
  }

  /**
   * Direct accessor for Sprite setters — no revalidate, no wasm-bindgen
   * boundary crossing. Spec "<50ns hot path" depends on this skipping
   * `mem_version()`. All setup ops (uploadTexture, createSprite, etc.)
   * revalidate explicitly before the next hot-path write.
   *
   * `_` prefix marks this package-internal; external callers should use
   * the setup ops, not peek at views directly.
   */
  get _rawViews(): PoolViews {
    if (this._views === null) {
      // Should never happen — first upload_texture or createSprite
      // populates _views via revalidate().
      throw new Error('weydra: _rawViews accessed before any sprite op');
    }
    return this._views;
  }

  /**
   * Rebuild typed-array views over the current wasm memory if the buffer
   * detached or the Rust side bumped mem_version. Cheap to call — usually
   * just two integer/reference compares.
   */
  private revalidate(): void {
    if (!_wasm) {
      throw new Error('weydra: initWeydra() must have resolved before revalidate');
    }
    const version = this.inner.mem_version();
    const buffer = _wasm.memory.buffer;
    if (
      this._views !== null
      && version === this._lastMemVersion
      && buffer === this._lastBuffer
    ) {
      return;
    }
    const cap = this.inner.sprite_capacity();
    this._views = {
      transforms: new Float32Array(buffer, this.inner.sprite_transforms_ptr(), cap * 4),
      uvs: new Float32Array(buffer, this.inner.sprite_uvs_ptr(), cap * 4),
      colors: new Uint32Array(buffer, this.inner.sprite_colors_ptr(), cap),
      flags: new Uint8Array(buffer, this.inner.sprite_flags_ptr(), cap),
      zOrder: new Float32Array(buffer, this.inner.sprite_z_ptr(), cap),
    };
    this._lastMemVersion = version;
    this._lastBuffer = buffer;
  }
}

/**
 * Handle to one sprite. Setters write directly into WASM memory via the
 * shared `views` on the owning Renderer — no wasm-bindgen boundary crossings
 * in the hot path.
 *
 * The `handle` is a `(slot, generation)` pair packed into a `bigint` by
 * `Handle::to_u64` on the Rust side. Only the lower 32 bits (slot) are used
 * to index the views; the generation stays on the Rust side as a safety
 * check when the handle is passed back into `destroy_sprite`.
 */
export class Sprite {
  constructor(public readonly handle: bigint, private readonly r: Renderer) {}

  /** Lower 32 bits of the u64 handle = slot index into the SoA views. */
  private get slot(): number {
    return Number(this.handle & 0xFFFFFFFFn);
  }

  set x(v: number) {
    this.r._rawViews.transforms[this.slot * 4 + 0] = v;
  }
  get x(): number {
    return this.r._rawViews.transforms[this.slot * 4 + 0];
  }
  set y(v: number) {
    this.r._rawViews.transforms[this.slot * 4 + 1] = v;
  }
  get y(): number {
    return this.r._rawViews.transforms[this.slot * 4 + 1];
  }
  set scaleX(v: number) {
    this.r._rawViews.transforms[this.slot * 4 + 2] = v;
  }
  set scaleY(v: number) {
    this.r._rawViews.transforms[this.slot * 4 + 3] = v;
  }

  /** RGBA8 packed as `0xRR_GG_BB_AA`. Use `>>> 0` on the caller side for
   *  unsigned normalisation if building from signed int ops. */
  set tint(v: number) {
    this.r._rawViews.colors[this.slot] = v >>> 0;
  }
  get tint(): number {
    return this.r._rawViews.colors[this.slot];
  }

  set visible(v: boolean) {
    // bit 0 is FLAG_VISIBLE; preserve other bits once they get meaning.
    const mask = this.r._rawViews.flags[this.slot] & ~1;
    this.r._rawViews.flags[this.slot] = mask | (v ? 1 : 0);
  }
  get visible(): boolean {
    return (this.r._rawViews.flags[this.slot] & 1) !== 0;
  }

  set zOrder(v: number) {
    this.r._rawViews.zOrder[this.slot] = v;
  }
  get zOrder(): number {
    return this.r._rawViews.zOrder[this.slot];
  }

  /** Pick a sub-rect of the source texture (spritesheet cells). All four
   *  values are normalised to 0..1 of the parent texture. */
  setUv(u: number, v: number, w: number, h: number): void {
    const b = this.slot * 4;
    const uvs = this.r._rawViews.uvs;
    uvs[b + 0] = u;
    uvs[b + 1] = v;
    uvs[b + 2] = w;
    uvs[b + 3] = h;
  }
}

export type { };
