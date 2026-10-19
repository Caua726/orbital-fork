/**
 * weydra software backend — Canvas2D/CPU implementation of the WASM
 * renderer's API, for browsers without a usable WebGPU/WebGL2 (the weydra
 * counterpart of Pixi's `canvas` backend).
 *
 * `SoftwareInner` exposes the same method names as the wasm-bindgen
 * `Renderer` (`create_sprite`, `graphics_circle`, `render`, …) and owns an
 * `ArrayBuffer` laid out like the wasm pools (sprite SoA, planet uniform
 * slots, fog uniforms, starfield uniforms). The TS bridge (`index.ts`) wraps
 * it exactly like the wasm renderer, so `Sprite`, `PlanetInstance`, `Graphics`,
 * `Text` and `FogLayer` work unchanged — only where pixels come from differs.
 *
 * Draw order and filtering mirror adapters/wasm/src/lib.rs `render()`:
 * starfield → planets → sprites + Graphics interleaved by z (z < FOG_Z) →
 * fog → sprites + Graphics with z ≥ FOG_Z → text, each gated by the
 * diagnostic layer mask. Procedural surfaces (planet shader, starfield) come
 * from CPU rasterizers the game supplies through `SoftwareHooks`, the same
 * way it supplies WGSL to the GPU backends.
 */

// Same TTFs the wasm text atlas bakes; Vite turns these into asset URLs.
const silkscreenUrl = new URL('../core/src/fonts/silkscreen.ttf', import.meta.url).href;
const vt323Url = new URL('../core/src/fonts/vt323.ttf', import.meta.url).href;

/** Planet uniforms of one slot, decoded from the shared buffer. */
export interface PlanetUniformsSnapshot {
  uTime: number;
  uSeed: number;
  uRotation: number;
  uPixels: number;
  uLightOrigin: [number, number];
  uTimeSpeed: number;
  uDitherSize: number;
  uLightBorder1: number;
  uLightBorder2: number;
  uSize: number;
  uOctaves: number;
  uPlanetType: number;
  uRiverCutoff: number;
  uLandCutoff: number;
  uCloudCover: number;
  uStretch: number;
  uCloudCurve: number;
  uTiles: number;
  uCloudAlpha: number;
  colors: [number, number, number, number][];
}

export interface SoftwareCamera {
  x: number;
  y: number;
  /** Viewport in WORLD units (screen / zoom), like the GPU backends. */
  vw: number;
  vh: number;
  time: number;
}

/** CPU stand-ins for the WGSL shaders the GPU backends compile. */
export interface SoftwareHooks {
  /** Rasterize one planet/star into a `size × size` RGBA buffer
   *  (straight alpha), quad UV 0..1 like the planet shader. */
  rasterPlanet(dst: Uint8ClampedArray, size: number, u: PlanetUniformsSnapshot): void;
  /** Draw the procedural starfield for the given camera onto the frame
   *  (black underneath, identity transform). Optional. */
  drawStarfield?(ctx: CanvasRenderingContext2D, w: number, h: number, cam: SoftwareCamera, density: number): void;
}

// ─── Shared-buffer layout (mirrors the wasm pools) ──────────────────────
const SPRITE_CAPACITY = 10_000;
const PLANET_CAPACITY = 256;
const PLANET_STRIDE = 256; // bytes, like the aligned GPU stride
const FOG_MAX_SOURCES = 64;
const FOG_SIZE = 16 + FOG_MAX_SOURCES * 16;

const OFF_TRANSFORMS = 0;
const OFF_UVS = OFF_TRANSFORMS + SPRITE_CAPACITY * 16;
const OFF_COLORS = OFF_UVS + SPRITE_CAPACITY * 16;
const OFF_Z = OFF_COLORS + SPRITE_CAPACITY * 4;
const OFF_FLAGS = OFF_Z + SPRITE_CAPACITY * 4;
const OFF_PLANETS = OFF_FLAGS + SPRITE_CAPACITY; // 10_000 B keeps 16-B alignment
const OFF_FOG = OFF_PLANETS + PLANET_CAPACITY * PLANET_STRIDE;
const OFF_STARFIELD = OFF_FOG + FOG_SIZE;
const BUFFER_SIZE = OFF_STARFIELD + 16;

// PlanetUniforms field offsets (f32 index) — same table as index.ts OFF.
const P = {
  time: 0, seed: 1, rotation: 2, pixels: 3, light: 4, timeSpeed: 6, dither: 7,
  border1: 8, border2: 9, size: 10, octaves: 11, type: 12, river: 13, land: 14,
  cloudCover: 15, stretch: 16, cloudCurve: 17, tiles: 18, cloudAlpha: 19,
  worldPos: 20, worldSize: 22, colors: 24, alpha: 48,
} as const;

// Layer bits — keep in sync with LAYER_* in lib.rs / LAYER_BIT in the game.
const FOG_Z = 40;
const L_STARFIELD = 1 << 0;
const L_PLANETS = 1 << 2;
const L_FOG = 1 << 8;
function layerBit(z: number): number {
  if (z < 1) return 1 << 0;
  if (z < 10) return 1 << 1;
  if (z < 20) return 1 << 2;
  if (z < 25) return 1 << 3;
  if (z < 28) return 1 << 4;
  if (z < 30) return 1 << 5;
  if (z < 35) return 1 << 6;
  if (z < FOG_Z) return 1 << 7;
  if (z < 42) return 1 << 8;
  if (z < 50) return 1 << 9;
  return 1 << 10;
}

const COLOR_NONE = 0x80000000;
const FOG_DOWNSCALE = 4;

function rgbaCss(c: number): string {
  return `rgba(${(c >>> 24) & 255},${(c >>> 16) & 255},${(c >>> 8) & 255},${(c & 255) / 255})`;
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('weydra software: 2D context unavailable');
  return [c, ctx];
}

/** Generational slot allocator; handles are `generation << 32 | slot`. */
class Slots<T> {
  private readonly items: (T | undefined)[] = [];
  private readonly gens: number[] = [];
  private readonly free: number[] = [];
  /** Live entries (slots are reused, so the highest slot < size + free). */
  get size(): number { return this.items.length - this.free.length; }
  insert(v: T): bigint {
    const slot = this.free.pop() ?? this.items.length;
    this.items[slot] = v;
    this.gens[slot] = (this.gens[slot] ?? 0) + 1;
    return (BigInt(this.gens[slot]) << 32n) | BigInt(slot);
  }
  get(h: bigint): T | undefined {
    const slot = Number(h & 0xFFFFFFFFn);
    return this.gens[slot] === Number(h >> 32n) ? this.items[slot] : undefined;
  }
  remove(h: bigint): T | undefined {
    const v = this.get(h);
    if (v === undefined) return undefined;
    const slot = Number(h & 0xFFFFFFFFn);
    this.items[slot] = undefined;
    this.free.push(slot);
    return v;
  }
  *values(): Generator<T> {
    for (const v of this.items) if (v !== undefined) yield v;
  }
  *entries(): Generator<[number, T]> {
    for (let i = 0; i < this.items.length; i++) {
      const v = this.items[i];
      if (v !== undefined) yield [i, v];
    }
  }
}

interface Tex {
  canvas: HTMLCanvasElement;
  tiled: boolean;
  tints: Map<number, HTMLCanvasElement>;
}

interface SpriteMeta { tex: bigint; dw: number; dh: number }

type Shape =
  | { k: 'circle'; x: number; y: number; r: number; fill: number; stroke: number; w: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: number; stroke: number; sw: number }
  | { k: 'rrect'; x: number; y: number; w: number; h: number; r: number; fill: number; stroke: number; sw: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; c: number }
  | { k: 'arc'; x: number; y: number; r: number; a0: number; a1: number; w: number; c: number };

interface Gfx {
  world: boolean;
  shapes: Shape[];
  z: number;
  tx: number;
  ty: number;
  alpha: number;
  visible: boolean;
}

interface TextNode {
  font: number;
  world: boolean;
  content: string;
  x: number;
  y: number;
  color: number;
  visible: boolean;
  z: number;
  scale: number;
}

const FONTS = [
  { family: 'WeydraSilkscreen', px: 12 },
  { family: 'WeydraSilkscreen', px: 16 },
  { family: 'WeydraVT323', px: 24 },
];
let _fontsLoaded: Promise<void> | null = null;
function carregarFontes(): Promise<void> {
  _fontsLoaded ??= (async () => {
    const faces = [
      new FontFace('WeydraSilkscreen', `url(${silkscreenUrl})`),
      new FontFace('WeydraVT323', `url(${vt323Url})`),
    ];
    await Promise.all(faces.map(async (f) => {
      try { document.fonts.add(await f.load()); } catch { /* fallback font */ }
    }));
  })();
  return _fontsLoaded;
}

export class SoftwareInner {
  readonly buffer = new ArrayBuffer(BUFFER_SIZE);
  private readonly f32 = new Float32Array(this.buffer);
  private readonly i32 = new Int32Array(this.buffer);
  private readonly u32 = new Uint32Array(this.buffer);
  private readonly u8 = new Uint8Array(this.buffer);
  private readonly ctx: CanvasRenderingContext2D;
  private cam: SoftwareCamera = { x: 0, y: 0, vw: 1, vh: 1, time: 0 };
  private mask = 0xFFFFFFFF;

  private readonly textures = new Slots<Tex>();
  private readonly sprites = new Slots<SpriteMeta>();
  private readonly planets = new Slots<true>();
  private readonly graphics = new Slots<Gfx>();
  private readonly texts = new Slots<TextNode>();
  private starfield = false;
  private planetsOn = false;
  private fogOn = false;
  private readonly planetCanvases = new Map<number, {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    img: ImageData;
    /** Pose of the last raster (see rasterPlanet). */
    pose: { seed: number; time: number; rot: number; lx: number; ly: number } | null;
  }>();
  private fogCanvas: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;
  private planetLayer: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;
  /** Text measuring context (and its canvas, kept alive with it). */
  private readonly measure: CanvasRenderingContext2D;
  private readonly measureCanvas: HTMLCanvasElement;

  private constructor(private readonly canvas: HTMLCanvasElement, private readonly hooks: SoftwareHooks) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('weydra software: canvas has no 2D context (already bound to WebGL/WebGPU?)');
    this.ctx = ctx;
    [this.measureCanvas, this.measure] = canvas2d(1, 1);
  }

  static async create(canvas: HTMLCanvasElement, hooks: SoftwareHooks): Promise<SoftwareInner> {
    await carregarFontes();
    return new SoftwareInner(canvas, hooks);
  }

  // ─── Device / frame ────────────────────────────────────────────────
  max_texture_dimension_2d(): number { return 16384; }
  mem_version(): number { return 0; }
  set_layer_mask(m: number): void { this.mask = m >>> 0; }
  resize(w: number, h: number): void {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }
  set_camera(x: number, y: number, vw: number, vh: number, time: number): void {
    this.cam = { x, y, vw: vw || 1, vh: vh || 1, time };
  }

  // ─── Starfield / fog / graphics "shaders" ──────────────────────────
  create_starfield(_wgsl: string): void { this.starfield = true; this.f32[OFF_STARFIELD / 4] = 1; }
  starfield_uniforms_ptr(): number { return this.starfield ? OFF_STARFIELD : 0; }
  create_fog_shader(_wgsl: string): void { this.fogOn = true; }
  fog_max_sources(): number { return FOG_MAX_SOURCES; }
  fog_uniforms_size(): number { return FOG_SIZE; }
  fog_uniforms_ptr(): number { return OFF_FOG; }
  create_graphics_shader(_wgsl: string): void { /* Canvas2D paths need no pipeline */ }

  // ─── Textures / sprites ────────────────────────────────────────────
  private uploadTex(bytes: Uint8Array, w: number, h: number, tiled: boolean): bigint {
    const [c, ctx] = canvas2d(w, h);
    const img = ctx.createImageData(w, h);
    img.data.set(bytes.subarray(0, w * h * 4));
    ctx.putImageData(img, 0, 0);
    return this.textures.insert({ canvas: c, tiled, tints: new Map() });
  }
  upload_texture(bytes: Uint8Array, w: number, h: number): bigint { return this.uploadTex(bytes, w, h, false); }
  upload_texture_tiled(bytes: Uint8Array, w: number, h: number): bigint { return this.uploadTex(bytes, w, h, true); }
  destroy_texture(h: bigint): void { this.textures.remove(h); }

  sprite_capacity(): number { return SPRITE_CAPACITY; }
  sprite_transforms_ptr(): number { return OFF_TRANSFORMS; }
  sprite_uvs_ptr(): number { return OFF_UVS; }
  sprite_colors_ptr(): number { return OFF_COLORS; }
  sprite_flags_ptr(): number { return OFF_FLAGS; }
  sprite_z_ptr(): number { return OFF_Z; }

  create_sprite(tex: bigint, dw: number, dh: number): bigint {
    if (this.sprites.size >= SPRITE_CAPACITY) throw new Error('weydra software: sprite pool full');
    const h = this.sprites.insert({ tex, dw, dh });
    const s = Number(h & 0xFFFFFFFFn);
    this.f32.set([0, 0, 1, 1], OFF_TRANSFORMS / 4 + s * 4);
    this.f32.set([0, 0, 1, 1], OFF_UVS / 4 + s * 4);
    this.u32[OFF_COLORS / 4 + s] = 0xFFFFFFFF;
    this.u8[OFF_FLAGS + s] = 1;
    this.f32[OFF_Z / 4 + s] = 0;
    return h;
  }
  destroy_sprite(h: bigint): void {
    if (this.sprites.remove(h)) this.u8[OFF_FLAGS + Number(h & 0xFFFFFFFFn)] = 0;
  }

  // ─── Planets ───────────────────────────────────────────────────────
  create_planet_shader(_wgsl: string): void { this.planetsOn = true; }
  planet_uniforms_ptr(): number { return this.planetsOn ? OFF_PLANETS : 0; }
  planet_uniforms_stride(): number { return this.planetsOn ? PLANET_STRIDE : 0; }
  planet_uniforms_capacity(): number { return PLANET_CAPACITY; }
  create_planet_instance(): bigint {
    if (this.planets.size >= PLANET_CAPACITY) throw new Error('weydra software: planet pool full');
    const h = this.planets.insert(true);
    const slot = Number(h & 0xFFFFFFFFn);
    const b = this.planetBase(slot);
    this.f32.fill(0, b, b + PLANET_STRIDE / 4);
    this.f32[b + P.alpha] = 1;
    return h;
  }
  destroy_planet_instance(h: bigint): void {
    if (this.planets.remove(h)) this.planetCanvases.delete(Number(h & 0xFFFFFFFFn));
  }
  private planetBase(slot: number): number { return OFF_PLANETS / 4 + slot * (PLANET_STRIDE / 4); }
  private planetSnapshot(slot: number): PlanetUniformsSnapshot {
    const b = this.planetBase(slot);
    const f = this.f32;
    const colors: [number, number, number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const o = b + P.colors + i * 4;
      colors.push([f[o], f[o + 1], f[o + 2], f[o + 3]]);
    }
    return {
      uTime: f[b + P.time], uSeed: f[b + P.seed], uRotation: f[b + P.rotation], uPixels: f[b + P.pixels],
      uLightOrigin: [f[b + P.light], f[b + P.light + 1]], uTimeSpeed: f[b + P.timeSpeed],
      uDitherSize: f[b + P.dither], uLightBorder1: f[b + P.border1], uLightBorder2: f[b + P.border2],
      uSize: f[b + P.size], uOctaves: this.i32[b + P.octaves], uPlanetType: this.i32[b + P.type],
      uRiverCutoff: f[b + P.river], uLandCutoff: f[b + P.land], uCloudCover: f[b + P.cloudCover],
      uStretch: f[b + P.stretch], uCloudCurve: f[b + P.cloudCurve], uTiles: f[b + P.tiles],
      uCloudAlpha: f[b + P.cloudAlpha], colors,
    };
  }
  private rasterPlanet(slot: number): HTMLCanvasElement {
    const u = this.planetSnapshot(slot);
    const size = Math.max(8, Math.min(256, Math.round(u.uPixels) || 64));
    let entry = this.planetCanvases.get(slot);
    if (!entry || entry.canvas.width !== size) {
      const [canvas, ctx] = canvas2d(size, size);
      entry = { canvas, ctx, img: ctx.createImageData(size, size), pose: null };
      this.planetCanvases.set(slot, entry);
    }
    // A CPU raster of a sun costs ~40 ms; the surface drifts far less than a
    // pixel of its 64/128 grid per frame, so only redraw when the pose moved
    // visibly (still every frame at 10 Hz-ish animation rates).
    const p = entry.pose;
    if (p && p.seed === u.uSeed && Math.abs(u.uTime - p.time) < 0.1
      && Math.abs(u.uRotation - p.rot) < 0.002
      && Math.abs(u.uLightOrigin[0] - p.lx) < 0.002 && Math.abs(u.uLightOrigin[1] - p.ly) < 0.002) {
      return entry.canvas;
    }
    entry.pose = { seed: u.uSeed, time: u.uTime, rot: u.uRotation, lx: u.uLightOrigin[0], ly: u.uLightOrigin[1] };
    entry.img.data.fill(0);
    this.hooks.rasterPlanet(entry.img.data, size, u);
    entry.ctx.putImageData(entry.img, 0, 0);
    return entry.canvas;
  }
  bake_planet(h: bigint, size: number): bigint {
    const slot = Number(h & 0xFFFFFFFFn);
    const src = this.rasterPlanet(slot);
    const [c, ctx] = canvas2d(size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, size, size);
    return this.textures.insert({ canvas: c, tiled: false, tints: new Map() });
  }

  // ─── Graphics ──────────────────────────────────────────────────────
  create_graphics(world: boolean): bigint {
    return this.graphics.insert({ world, shapes: [], z: 0, tx: 0, ty: 0, alpha: 1, visible: true });
  }
  destroy_graphics(h: bigint): void { this.graphics.remove(h); }
  graphics_set_z_order(h: bigint, z: number): void { const g = this.graphics.get(h); if (g) g.z = z; }
  graphics_set_translation(h: bigint, x: number, y: number): void {
    const g = this.graphics.get(h);
    if (g) { g.tx = x; g.ty = y; }
  }
  graphics_set_visible(h: bigint, v: boolean): void { const g = this.graphics.get(h); if (g) g.visible = v; }
  graphics_set_alpha(h: bigint, a: number): void { const g = this.graphics.get(h); if (g) g.alpha = a; }
  graphics_clear(h: bigint): void { const g = this.graphics.get(h); if (g) g.shapes.length = 0; }
  graphics_circle(h: bigint, x: number, y: number, r: number, fill: number, stroke: number, w: number): void {
    this.graphics.get(h)?.shapes.push({ k: 'circle', x, y, r, fill, stroke, w });
  }
  graphics_rect(h: bigint, x: number, y: number, w: number, hh: number, fill: number, stroke: number, sw: number): void {
    this.graphics.get(h)?.shapes.push({ k: 'rect', x, y, w, h: hh, fill, stroke, sw });
  }
  graphics_round_rect(h: bigint, x: number, y: number, w: number, hh: number, r: number, fill: number, stroke: number, sw: number): void {
    this.graphics.get(h)?.shapes.push({ k: 'rrect', x, y, w, h: hh, r, fill, stroke, sw });
  }
  graphics_line(h: bigint, x1: number, y1: number, x2: number, y2: number, w: number, c: number): void {
    this.graphics.get(h)?.shapes.push({ k: 'line', x1, y1, x2, y2, w, c });
  }
  graphics_arc(h: bigint, x: number, y: number, r: number, a0: number, a1: number, w: number, c: number): void {
    this.graphics.get(h)?.shapes.push({ k: 'arc', x, y, r, a0, a1, w, c });
  }

  // ─── Text ──────────────────────────────────────────────────────────
  create_text(font: number, _capacity: number, world: boolean): bigint {
    return this.texts.insert({ font, world, content: '', x: 0, y: 0, color: 0xFFFFFFFF, visible: true, z: 0, scale: 1 });
  }
  destroy_text(h: bigint): void { this.texts.remove(h); }
  set_text_content(h: bigint, s: string): void { const t = this.texts.get(h); if (t) t.content = s; }
  set_text_position(h: bigint, x: number, y: number): void { const t = this.texts.get(h); if (t) { t.x = x; t.y = y; } }
  set_text_color(h: bigint, c: number): void { const t = this.texts.get(h); if (t) t.color = c >>> 0; }
  set_text_visible(h: bigint, v: boolean): void { const t = this.texts.get(h); if (t) t.visible = v; }
  set_text_z_order(h: bigint, z: number): void { const t = this.texts.get(h); if (t) t.z = z; }
  set_text_scale(h: bigint, s: number): void { const t = this.texts.get(h); if (t) t.scale = s; }
  private fontFor(t: TextNode): { family: string; px: number } { return FONTS[t.font] ?? FONTS[0]; }
  /** Widest line in node units (atlas px × scale), like text.rs. */
  get_text_width(h: bigint): number {
    const t = this.texts.get(h);
    if (!t) return 0;
    const f = this.fontFor(t);
    this.measure.font = `${f.px}px ${f.family}`;
    let max = 0;
    for (const line of t.content.split('\n')) max = Math.max(max, this.measure.measureText(line).width);
    return max * t.scale;
  }

  // ─── Render ────────────────────────────────────────────────────────
  render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cam = this.cam;
    const sx = W / cam.vw;
    const sy = H / cam.vh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (this.starfield && this.mask & L_STARFIELD && this.hooks.drawStarfield) {
      this.hooks.drawStarfield(ctx, W, H, cam, this.f32[OFF_STARFIELD / 4]);
    }
    if (this.planetsOn && this.mask & L_PLANETS) this.drawPlanets(W, H, sx, sy);

    // Sprites + Graphics, merged by z and split at the fog like lib.rs.
    type Item = { z: number; draw: () => void };
    const pre: Item[] = [];
    const post: Item[] = [];
    for (const [slot, meta] of this.sprites.entries()) {
      if ((this.u8[OFF_FLAGS + slot] & 1) === 0) continue;
      const z = this.f32[OFF_Z / 4 + slot];
      if ((layerBit(z) & this.mask) === 0) continue;
      const tex = this.textures.get(meta.tex);
      if (!tex) continue;
      (z < FOG_Z ? pre : post).push({ z, draw: () => this.drawSprite(slot, meta, tex, W, H, sx, sy) });
    }
    for (const [, g] of this.graphics.entries()) {
      if (!g.visible || g.shapes.length === 0 || (layerBit(g.z) & this.mask) === 0) continue;
      (g.z < FOG_Z ? pre : post).push({ z: g.z, draw: () => this.drawGraphics(g, W, H, sx, sy) });
    }
    const byZ = (a: Item, b: Item): number => a.z - b.z;
    pre.sort(byZ);
    post.sort(byZ);
    for (const it of pre) it.draw();
    if (this.fogOn && this.mask & L_FOG) this.drawFog(W, H, sx, sy);
    for (const it of post) it.draw();

    const texts = [...this.texts.values()]
      .filter((t) => t.visible && t.content && (layerBit(t.z) & this.mask) !== 0)
      .sort((a, b) => a.z - b.z);
    for (const t of texts) this.drawText(t, W, H, sx, sy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** World → canvas pixels (worldSpace) or screen-space units → pixels. */
  private setSpace(world: boolean, W: number, H: number, sx: number, sy: number): void {
    if (world) this.ctx.setTransform(sx, 0, 0, sy, W / 2 - this.cam.x * sx, H / 2 - this.cam.y * sy);
    else this.ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }

  /**
   * Planets go through a half-resolution layer composited with bilinear
   * filtering — the same pipeline as the GPU backends (Pixi half-res filter,
   * weydra planet target), so small planets alias and soften identically.
   */
  private drawPlanets(W: number, H: number, sx: number, sy: number): void {
    const lw = Math.ceil(W / 2), lh = Math.ceil(H / 2);
    if (!this.planetLayer || this.planetLayer[0].width !== lw || this.planetLayer[0].height !== lh) {
      this.planetLayer = canvas2d(lw, lh);
    }
    const [layer, ctx] = this.planetLayer;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, lw, lh);
    // World → half-res layer pixels.
    ctx.setTransform(sx / 2, 0, 0, sy / 2, (W / 2 - this.cam.x * sx) / 2, (H / 2 - this.cam.y * sy) / 2);
    ctx.imageSmoothingEnabled = false;
    let algum = false;
    const halfW = this.cam.vw / 2;
    const halfH = this.cam.vh / 2;
    for (const [slot] of this.planets.entries()) {
      const b = this.planetBase(slot);
      const alpha = this.f32[b + P.alpha];
      if (alpha <= 0) continue;
      const x = this.f32[b + P.worldPos];
      const y = this.f32[b + P.worldPos + 1];
      const w = this.f32[b + P.worldSize];
      const h = this.f32[b + P.worldSize + 1];
      if (x + w / 2 < this.cam.x - halfW || x - w / 2 > this.cam.x + halfW
        || y + h / 2 < this.cam.y - halfH || y - h / 2 > this.cam.y + halfH) continue;
      const src = this.rasterPlanet(slot);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(src, x - w / 2, y - h / 2, w, h);
      algum = true;
    }
    ctx.globalAlpha = 1;
    if (!algum) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    // Exactly 2× (the layer may be one pixel wider than half the frame).
    this.ctx.drawImage(layer, 0, 0, lw * 2, lh * 2);
  }

  private tinted(tex: Tex, rgb: number): HTMLCanvasElement {
    if (rgb === 0xFFFFFF) return tex.canvas;
    let c = tex.tints.get(rgb);
    if (!c) {
      // Bounded: a texture with endlessly varying tints must not grow forever.
      if (tex.tints.size >= 32) tex.tints.clear();
      const [tc, tctx] = canvas2d(tex.canvas.width, tex.canvas.height);
      tctx.drawImage(tex.canvas, 0, 0);
      tctx.globalCompositeOperation = 'multiply';
      tctx.fillStyle = `#${rgb.toString(16).padStart(6, '0')}`;
      tctx.fillRect(0, 0, tc.width, tc.height);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(tex.canvas, 0, 0);
      tex.tints.set(rgb, tc);
      c = tc;
    }
    return c;
  }

  private drawSprite(slot: number, meta: SpriteMeta, tex: Tex, W: number, H: number, sx: number, sy: number): void {
    const ctx = this.ctx;
    const t = OFF_TRANSFORMS / 4 + slot * 4;
    const u = OFF_UVS / 4 + slot * 4;
    const x = this.f32[t], y = this.f32[t + 1], scx = this.f32[t + 2], scy = this.f32[t + 3];
    const color = this.u32[OFF_COLORS / 4 + slot];
    const a = (color & 255) / 255;
    if (a <= 0) return;
    const img = this.tinted(tex, color >>> 8);
    const tw = img.width, th = img.height;
    const uu = this.f32[u], vv = this.f32[u + 1], uw = this.f32[u + 2], vh = this.f32[u + 3];
    const dw = meta.dw * scx;
    const dh = meta.dh * scy;
    this.setSpace(true, W, H, sx, sy);
    ctx.translate(x, y);
    ctx.scale(Math.sign(dw) || 1, Math.sign(dh) || 1);
    const aw = Math.abs(dw), ah = Math.abs(dh);
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = false;
    if (tex.tiled && (uw > 1 || vh > 1 || uu !== 0 || vv !== 0)) {
      // Repeat sampling: the quad shows uv_rect of an endlessly tiled texture.
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        const kx = aw / (uw * tw);
        const ky = ah / (vh * th);
        pattern.setTransform(new DOMMatrix([kx, 0, 0, ky, -aw / 2 - uu * tw * kx, -ah / 2 - vv * th * ky]));
        ctx.fillStyle = pattern;
        ctx.fillRect(-aw / 2, -ah / 2, aw, ah);
      }
    } else {
      ctx.drawImage(img, uu * tw, vv * th, uw * tw, vh * th, -aw / 2, -ah / 2, aw, ah);
    }
    ctx.globalAlpha = 1;
  }

  private drawGraphics(g: Gfx, W: number, H: number, sx: number, sy: number): void {
    const ctx = this.ctx;
    this.setSpace(g.world, W, H, sx, sy);
    ctx.translate(g.tx, g.ty);
    ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha));
    const paint = (fill: number, stroke: number, width: number): void => {
      if (fill !== COLOR_NONE) { ctx.fillStyle = rgbaCss(fill); ctx.fill(); }
      if (stroke !== COLOR_NONE && width > 0) { ctx.strokeStyle = rgbaCss(stroke); ctx.lineWidth = width; ctx.stroke(); }
    };
    for (const s of g.shapes) {
      ctx.beginPath();
      switch (s.k) {
        case 'circle': ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); paint(s.fill, s.stroke, s.w); break;
        case 'rect': ctx.rect(s.x, s.y, s.w, s.h); paint(s.fill, s.stroke, s.sw); break;
        case 'rrect': ctx.roundRect(s.x, s.y, s.w, s.h, s.r); paint(s.fill, s.stroke, s.sw); break;
        case 'line': ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); paint(COLOR_NONE, s.c, s.w); break;
        case 'arc': ctx.arc(s.x, s.y, s.r, s.a0, s.a1); paint(COLOR_NONE, s.c, s.w); break;
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFog(W: number, H: number, sx: number, sy: number): void {
    const base = this.f32[OFF_FOG / 4];
    const count = Math.min(this.u32[OFF_FOG / 4 + 1], FOG_MAX_SOURCES);
    if (count === 0) return;
    const fw = Math.ceil(W / FOG_DOWNSCALE);
    const fh = Math.ceil(H / FOG_DOWNSCALE);
    if (!this.fogCanvas || this.fogCanvas[0].width !== fw || this.fogCanvas[0].height !== fh) {
      this.fogCanvas = canvas2d(fw, fh);
    }
    const [fc, fctx] = this.fogCanvas;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = 'copy';
    fctx.fillStyle = `rgba(2,5,16,${base})`;
    fctx.fillRect(0, 0, fw, fh);
    // Vision holes: cleared to the full radius with the same thin rim as
    // fog.wgsl (smoothstep 0.94r → r).
    fctx.globalCompositeOperation = 'destination-out';
    fctx.setTransform(sx / FOG_DOWNSCALE, 0, 0, sy / FOG_DOWNSCALE,
      (W / 2 - this.cam.x * sx) / FOG_DOWNSCALE, (H / 2 - this.cam.y * sy) / FOG_DOWNSCALE);
    for (let i = 0; i < count; i++) {
      const o = (OFF_FOG + 16 + i * 16) / 4;
      const x = this.f32[o], y = this.f32[o + 1], r = this.f32[o + 2];
      if (r <= 0) continue;
      const grad = fctx.createRadialGradient(x, y, r * 0.94, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = grad;
      fctx.beginPath();
      fctx.arc(x, y, r, 0, Math.PI * 2);
      fctx.fill();
    }
    fctx.globalCompositeOperation = 'source-over';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(fc, 0, 0, W, H);
  }

  private drawText(t: TextNode, W: number, H: number, sx: number, sy: number): void {
    const ctx = this.ctx;
    const f = this.fontFor(t);
    this.setSpace(t.world, W, H, sx, sy);
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    ctx.font = `${f.px}px ${f.family}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgbaCss(t.color);
    ctx.imageSmoothingEnabled = false;
    const lines = t.content.split('\n');
    const widths = lines.map((l) => ctx.measureText(l).width);
    const block = Math.max(...widths);
    const lineH = f.px * 1.2;
    // Baseline one px_size below the top; lines centred in the block
    // (text.rs: Pixi `align: 'center'`).
    lines.forEach((line, i) => ctx.fillText(line, (block - widths[i]) / 2, f.px + i * lineH));
  }
}
