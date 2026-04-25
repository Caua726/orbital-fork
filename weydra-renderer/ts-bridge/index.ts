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
 * Field offsets within a single planet's stride window, in f32 indices.
 * Computed from the canonical PlanetUniforms byte layout
 * (weydra-renderer/core/src/pools/planet.rs). The Rust struct's
 * compile-time `offset_of!` test pins the byte offsets; if the struct
 * order ever changes here we must change there too — keep this table
 * the single source of truth on the TS side.
 */
const OFF = Object.freeze({
  u_time:           0 / 4,
  u_seed:           4 / 4,
  u_rotation:       8 / 4,
  u_pixels:        12 / 4,
  u_light_origin:  16 / 4, // vec2 — occupies +0, +1
  u_time_speed:    24 / 4,
  u_dither_size:   28 / 4,
  u_light_border1: 32 / 4,
  u_light_border2: 36 / 4,
  u_size:          40 / 4,
  u_octaves:       44 / 4, // i32
  u_planet_type:   48 / 4, // i32
  u_river_cutoff:  52 / 4,
  u_land_cutoff:   56 / 4,
  u_cloud_cover:   60 / 4,
  u_stretch:       64 / 4,
  u_cloud_curve:   68 / 4,
  u_tiles:         72 / 4,
  u_cloud_alpha:   76 / 4,
  u_world_pos:     80 / 4, // vec2 — occupies +0, +1
  u_world_size:    88 / 4, // vec2 — occupies +0, +1
  u_colors:        96 / 4, // 6 × vec4 — start of array; element N occupies +N*4..+N*4+3
} as const);

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

  // ─── Planet shared-memory views ───────────────────────────────────────
  /** @internal — public for PlanetInstance via underscore convention. */
  _planetUniformsView!: Float32Array;
  /** @internal — same buffer as _planetUniformsView, i32 reinterpretation. */
  _planetUniformsIView!: Int32Array;
  /** @internal — aligned stride in bytes (rounded up to wgpu adapter's
   *  min_uniform_buffer_offset_alignment). */
  planetUniformsStride = 0;
  /** @internal — base pointer of the planet uniform region in WASM memory. */
  planetUniformsPtr = 0;
  /** @internal — number of slots in the planet pool. */
  planetUniformsCapacity = 0;

  private constructor(inner: WasmRenderer) {
    this.inner = inner;
  }

  /**
   * Create a new Renderer on the given canvas.
   *
   * `backend` selects the wgpu backend on the Rust side — see
   * `WasmRenderer::create` doc for the int code mapping. The TS layer is
   * pure pass-through; no navigator mutation.
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
    const code = backend === 'webgpu' ? 1 : backend === 'webgl2' ? 2 : 0;
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

  // ─── Planet pool ──────────────────────────────────────────────────────

  createPlanetShader(wgslSource: string): void {
    this.inner.create_planet_shader(wgslSource);
    // The Rust side bumps mem_version after this call; revalidate() picks
    // up the new buffer/version pair AND rebuilds the planet views in the
    // same dual-check branch — no explicit refreshPlanetViews() needed
    // here.
    this.revalidate();
    // Cover the edge case where revalidate's dual-check decided no
    // rebuild was necessary (e.g. mem_version somehow unchanged) but the
    // pool was just freshly created — without this call _planetUniformsView
    // would be undefined.
    if (!this._planetUniformsView) this.refreshPlanetViews();
  }

  createPlanetInstance(): PlanetInstance {
    const h = this.inner.create_planet_instance();
    this.revalidate();
    return new PlanetInstance(h, this);
  }

  destroyPlanetInstance(p: PlanetInstance): void {
    this.inner.destroy_planet_instance(p.handle);
  }

  /**
   * Render the given PlanetInstance into a baked texture and return its
   * sprite-compatible texture handle. Caller can then `createSprite`
   * with that handle to draw the planet as a static sprite.
   *
   * Replaces the M4 hybrid path (Pixi `extract.canvas` → readback bytes
   * → `uploadTexture`) — the bake stays entirely on the GPU.
   */
  bakePlanet(p: PlanetInstance, size: number): bigint {
    const h = this.inner.bake_planet(p.handle, size);
    this.revalidate();
    return h;
  }

  /**
   * Repopulates planetUniformsPtr/Stride/Capacity and rebuilds the f32
   * + i32 views over the shared region. Called from createPlanetShader
   * and from revalidate() when mem_version or the underlying buffer
   * identity changed (the M2 dual-check pattern).
   */
  private refreshPlanetViews(): void {
    if (!_wasm) return;
    this.planetUniformsPtr = this.inner.planet_uniforms_ptr();
    this.planetUniformsStride = this.inner.planet_uniforms_stride();
    this.planetUniformsCapacity = this.inner.planet_uniforms_capacity();
    if (this.planetUniformsPtr === 0 || this.planetUniformsStride === 0) {
      // Pool not created yet — nothing to view.
      return;
    }
    const totalF32 = (this.planetUniformsCapacity * this.planetUniformsStride) / 4;
    const buffer = _wasm.memory.buffer;
    this._planetUniformsView = new Float32Array(buffer, this.planetUniformsPtr, totalF32);
    this._planetUniformsIView = new Int32Array(buffer, this.planetUniformsPtr, totalF32);
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
    // Planet views share the same wasm memory and detach on the same
    // memory.grow() events; rebuild them in lock-step with sprite views.
    // Skip if the planet shader hasn't been registered yet — refreshPlanetViews
    // also early-returns on a zero pointer, but the explicit guard avoids the
    // wasm-bindgen calls.
    if (this.planetUniformsPtr !== 0) {
      this.refreshPlanetViews();
    }
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

/**
 * One live planet driven by the procedural planet shader. Setters write
 * into the shared WASM memory directly via the cached Renderer typed-
 * array views — no wasm-bindgen call boundary in the hot path. Each
 * setter is a single typed-array store, ~3-5 ns.
 *
 * Integer setters (`uOctaves`, `uPlanetType`) coerce floats to int32 via
 * `| 0` so callers passing accidental floats like `1.9999...` from
 * accumulated math don't store an off-by-one truncation that would
 * dispatch the wrong planet type body.
 */
export class PlanetInstance {
  /** f32 base offset of this slot inside the shared uniform buffer. */
  private readonly base: number;

  constructor(public readonly handle: bigint, private readonly r: Renderer) {
    const slot = Number(handle & 0xFFFFFFFFn);
    // Stride is ALIGNED bytes; divide by 4 for f32 index. Each planet
    // occupies stride/4 f32 slots in the shared view, even if the actual
    // PlanetUniforms struct is smaller (192 B vs 256 B stride on most
    // adapters — the shader's min_binding_size guards against reading
    // past 192).
    this.base = slot * (this.r.planetUniformsStride / 4);
  }

  // Float views are cached on the Renderer and revalidated when WASM
  // memory grows. NEVER reconstruct typed arrays here — the f32 and i32
  // views must agree on which ArrayBuffer they point at.
  private get f(): Float32Array { return this.r._planetUniformsView; }
  private get i(): Int32Array { return this.r._planetUniformsIView; }

  set uTime(v: number)         { this.f[this.base + OFF.u_time] = v; }
  set uSeed(v: number)         { this.f[this.base + OFF.u_seed] = v; }
  set uRotation(v: number)     { this.f[this.base + OFF.u_rotation] = v; }
  set uPixels(v: number)       { this.f[this.base + OFF.u_pixels] = v; }
  set uTimeSpeed(v: number)    { this.f[this.base + OFF.u_time_speed] = v; }
  set uDitherSize(v: number)   { this.f[this.base + OFF.u_dither_size] = v; }
  set uLightBorder1(v: number) { this.f[this.base + OFF.u_light_border1] = v; }
  set uLightBorder2(v: number) { this.f[this.base + OFF.u_light_border2] = v; }
  set uSize(v: number)         { this.f[this.base + OFF.u_size] = v; }
  set uOctaves(v: number)      { this.i[this.base + OFF.u_octaves] = Math.round(v) | 0; }
  set uPlanetType(v: number)   { this.i[this.base + OFF.u_planet_type] = Math.round(v) | 0; }
  set uRiverCutoff(v: number)  { this.f[this.base + OFF.u_river_cutoff] = v; }
  set uLandCutoff(v: number)   { this.f[this.base + OFF.u_land_cutoff] = v; }
  set uCloudCover(v: number)   { this.f[this.base + OFF.u_cloud_cover] = v; }
  set uStretch(v: number)      { this.f[this.base + OFF.u_stretch] = v; }
  set uCloudCurve(v: number)   { this.f[this.base + OFF.u_cloud_curve] = v; }
  set uTiles(v: number)        { this.f[this.base + OFF.u_tiles] = v; }
  set uCloudAlpha(v: number)   { this.f[this.base + OFF.u_cloud_alpha] = v; }

  setLightOrigin(x: number, y: number): void {
    const off = this.base + OFF.u_light_origin;
    this.f[off] = x;
    this.f[off + 1] = y;
  }

  setWorldPos(x: number, y: number): void {
    const off = this.base + OFF.u_world_pos;
    this.f[off] = x;
    this.f[off + 1] = y;
  }

  setWorldSize(w: number, h: number): void {
    const off = this.base + OFF.u_world_size;
    this.f[off] = w;
    this.f[off + 1] = h;
  }

  /** Set palette slot 0..5 to RGBA (0..1 floats). */
  setColor(idx: number, r: number, g: number, b: number, a: number): void {
    const off = this.base + OFF.u_colors + idx * 4;
    this.f[off + 0] = r;
    this.f[off + 1] = g;
    this.f[off + 2] = b;
    this.f[off + 3] = a;
  }
}

export type { };
