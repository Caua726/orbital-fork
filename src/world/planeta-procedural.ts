import { Mesh, Shader, GlProgram, GpuProgram, UniformGroup, Geometry, Buffer, State, Sprite, Container, Rectangle, RenderTexture, Texture } from 'pixi.js';
import { renderPlanetParaImageData, type PlanetRenderState } from './planeta-canvas';
import type { Application } from 'pixi.js';
import vertexSrc from '../shaders/planeta.vert?raw';
import fragmentSrc from '../shaders/planeta.frag?raw';
import wgslSrc from '../shaders/planeta.wgsl?raw';
import { TIPO_PLANETA } from './planeta';
import { getConfig, onConfigChange } from '../core/config';
import { getZoom } from '../core/player';
import { getWeydraRenderer } from '../weydra-loader';
import type { Sprite as WeydraSprite, PlanetInstance } from '@weydra/renderer';
import { Z } from '../core/render-order';

let _appRef: Application | null = null;

export function setAppReferenceForBake(app: Application): void {
  _appRef = app;
}

/**
 * Force the planet shader program to compile + link NOW, before any real
 * planet first renders. In Pixi v8 the GL/GPU program is compiled lazily
 * on first draw, which produced a visible 100-400ms hitch the first time
 * a world became visible (player sees "loaded" then FPS tanks as the
 * driver compiles mid-frame). Calling this during the load/menu screen
 * amortises that cost into the loading phase where the user expects a
 * pause anyway.
 *
 * Safe to call multiple times — the GPU driver caches the linked program.
 */
export async function precompilarShadersPlaneta(app: Application): Promise<void> {
  // Canvas2D mode has no GLSL/WGSL program to compile.
  if (isCanvas2dRenderer()) return;
  let warmup: Container | null = null;
  let target: RenderTexture | null = null;
  try {
    warmup = new Container();
    const tipos = Object.values(TIPO_PLANETA);
    for (const tipo of tipos) {
      const mesh = criarPlanetaProceduralSprite(0, 0, 8, tipo, 1.0);
      warmup.addChild(mesh);
    }
    const solMesh = criarEstrelaProcedural(0, 0, 8);
    warmup.addChild(solMesh);

    // Render into an 8×8 RenderTexture — forces the driver to compile
    // + link the shared GlProgram without flashing anything onto the
    // visible canvas.
    target = RenderTexture.create({ width: 8, height: 8 });
    app.renderer.render({ container: warmup, target });

    // One RAF for the GPU to settle; two to be safe across drivers.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  } catch (err) {
    console.warn('[planeta-procedural] shader warmup failed (non-fatal):', err);
  } finally {
    try { warmup?.destroy({ children: true }); } catch { /* noop */ }
    try { target?.destroy(true); } catch { /* noop */ }
  }
}

export interface PaletaPlaneta {
  planetType: number;
  colors: [number, number, number, number][];
  riverCutoff: number;
  landCutoff: number;
  cloudCover: number;
  stretch: number;
  cloudCurve: number;
  lightBorder1: number;
  lightBorder2: number;
  octaves: number;
  size: number;
  timeSpeed: number;
  ditherSize: number;
  tiles: number;
  cloudAlpha: number;
}


type RGBA = [number, number, number, number];

// All "random" helpers accept an rng source so planet visuals can be
// deterministic when a seed is provided (needed for save/load: the
// planet's palette + shader uniforms are restored from a per-entity
// `visualSeed`, not re-rolled from Math.random each load).
type Rng = () => number;

// Subtle per-channel variation
function shiftColor(c: RGBA, amount: number, rng: Rng): RGBA {
  return [
    Math.max(0, Math.min(1, c[0] + (rng() - 0.5) * amount)),
    Math.max(0, Math.min(1, c[1] + (rng() - 0.5) * amount)),
    Math.max(0, Math.min(1, c[2] + (rng() - 0.5) * amount)),
    c[3],
  ];
}

function jitter(base: number, range: number, rng: Rng): number {
  return base + (rng() - 0.5) * range;
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Apply subtle variation to a whole palette (keeps structure, shifts slightly)
function variarPaleta(palette: RGBA[], rng: Rng): RGBA[] {
  return palette.map(c => c[3] === 0 ? c : shiftColor(c, 0.04, rng));
}

// === REALISTIC PALETTES ===

// Terran: earth-like with green land and blue water
const TERRAN_PALETTES: RGBA[][] = [
  // Earth classic (from Godot)
  [[0.39, 0.67, 0.25, 1], [0.23, 0.49, 0.31, 1], [0.18, 0.34, 0.33, 1], [0.16, 0.21, 0.25, 1], [0.31, 0.64, 0.72, 1], [0.25, 0.29, 0.45, 1]],
  // Lush tropical
  [[0.42, 0.72, 0.22, 1], [0.28, 0.52, 0.25, 1], [0.18, 0.36, 0.28, 1], [0.12, 0.20, 0.20, 1], [0.22, 0.52, 0.75, 1], [0.16, 0.28, 0.50, 1]],
  // Temperate cool
  [[0.35, 0.58, 0.30, 1], [0.22, 0.42, 0.28, 1], [0.15, 0.30, 0.25, 1], [0.10, 0.18, 0.18, 1], [0.28, 0.58, 0.68, 1], [0.20, 0.32, 0.48, 1]],
];

// Dry: barren rocky moons and dead worlds
const DRY_PALETTES: RGBA[][] = [
  // Moon grey (from Godot)
  [[0.64, 0.65, 0.76, 1], [0.30, 0.41, 0.52, 1], [0.23, 0.25, 0.37, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
  // Mars rust
  [[0.72, 0.42, 0.24, 1], [0.52, 0.28, 0.16, 1], [0.34, 0.18, 0.12, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
  // Mercury grey-brown
  [[0.62, 0.58, 0.54, 1], [0.42, 0.38, 0.36, 1], [0.26, 0.24, 0.22, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
];

// Gas: banded gas giants (Jupiter, Saturn, Neptune inspired)
const GAS_PALETTES: RGBA[][] = [
  // Jupiter orange/brown (from Godot)
  [[0.94, 0.71, 0.25, 1], [0.81, 0.46, 0.17, 1], [0.67, 0.32, 0.19, 1], [0.49, 0.22, 0.20, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
  // Jupiter variant warm
  [[0.90, 0.75, 0.35, 1], [0.75, 0.50, 0.22, 1], [0.58, 0.35, 0.18, 1], [0.40, 0.20, 0.15, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
  // Saturn cream/gold
  [[0.88, 0.82, 0.55, 1], [0.75, 0.65, 0.38, 1], [0.55, 0.45, 0.28, 1], [0.38, 0.30, 0.18, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
  // Neptune blue
  [[0.35, 0.50, 0.80, 1], [0.22, 0.35, 0.65, 1], [0.14, 0.22, 0.48, 1], [0.08, 0.12, 0.32, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
  // Uranus teal
  [[0.45, 0.72, 0.75, 1], [0.30, 0.55, 0.60, 1], [0.18, 0.38, 0.42, 1], [0.10, 0.22, 0.28, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
];

export function gerarPaletaAleatoria(tipo: string, rng: Rng = Math.random): PaletaPlaneta {
  switch (tipo) {
    case TIPO_PLANETA.COMUM: {
      const colors = variarPaleta(pick(TERRAN_PALETTES, rng), rng);
      return {
        planetType: 0,
        colors,
        riverCutoff: jitter(0.368, 0.1, rng),
        landCutoff: 0.0,
        cloudCover: 0.0,
        stretch: 2.0,
        cloudCurve: 1.3,
        lightBorder1: jitter(0.287, 0.05, rng),
        lightBorder2: jitter(0.476, 0.05, rng),
        octaves: 6,
        size: jitter(4.6, 1.5, rng),
        timeSpeed: 0.1,
        ditherSize: jitter(3.5, 1.0, rng),
        tiles: 1.0,
        cloudAlpha: 0.45 + rng() * 0.2, // 0.45=nuvens moderadas, 0.65=poucas nuvens
      };
    }
    case TIPO_PLANETA.MARTE: {
      const colors = variarPaleta(pick(DRY_PALETTES, rng), rng);
      return {
        planetType: 1,
        colors,
        riverCutoff: 0.0,
        landCutoff: 0.0,
        cloudCover: 0.0,
        stretch: 2.0,
        cloudCurve: 1.3,
        lightBorder1: jitter(0.615, 0.06, rng),
        lightBorder2: jitter(0.729, 0.06, rng),
        octaves: 4,
        size: jitter(8.0, 2.0, rng),
        timeSpeed: 0.4,
        ditherSize: 2.0,
        tiles: 1.0,
        cloudAlpha: 0.0,
      };
    }
    case TIPO_PLANETA.GASOSO:
    default: {
      const colors = variarPaleta(pick(GAS_PALETTES, rng), rng);
      return {
        planetType: 3,
        colors,
        riverCutoff: 0.0,
        landCutoff: 0.0,
        cloudCover: jitter(0.45, 0.12, rng),
        stretch: jitter(2.0, 0.5, rng),   // higher stretch = more horizontal bands
        cloudCurve: 1.3,
        lightBorder1: jitter(0.44, 0.06, rng),
        lightBorder2: jitter(0.75, 0.06, rng),
        octaves: 5,
        size: jitter(9.0, 2.0, rng),
        timeSpeed: jitter(0.35, 0.15, rng),
        ditherSize: 2.0,
        tiles: 1.0,
        cloudAlpha: 0.0,
      };
    }
  }
}

// Simple quad geometry: two triangles, UVs go 0..1 (like Godot's canvas_item)
function criarQuadGeometry(): Geometry {
  // positions: unit quad centered at origin (-0.5 to 0.5)
  const positions = new Float32Array([
    -0.5, -0.5,
     0.5, -0.5,
     0.5,  0.5,
    -0.5,  0.5,
  ]);
  // UVs: 0..1 like Godot's UV
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: new Buffer({ data: positions, usage: 32 | 8 }), format: 'float32x2' },
      aUV: { buffer: new Buffer({ data: uvs, usage: 32 | 8 }), format: 'float32x2' },
    },
    indexBuffer: new Buffer({ data: indices, usage: 16 | 8 }),
  });

  return geometry;
}

const quadGeometry = criarQuadGeometry();

// Shared programs — created once, reused by all planets/stars
const sharedGlProgram = GlProgram.from({
  vertex: vertexSrc,
  fragment: fragmentSrc,
  name: 'planet-shader',
});

const sharedGpuProgram = GpuProgram.from({
  vertex: { source: wgslSrc, entryPoint: 'mainVertex' },
  fragment: { source: wgslSrc, entryPoint: 'mainFragment' },
  name: 'planet-shader',
});

function criarUniformsPlaneta(paleta: PaletaPlaneta, seed: number, pixels: number, timeOffset: number, rng: Rng = Math.random): UniformGroup {
  const c = paleta.colors;
  return new UniformGroup({
    uPixels: { value: pixels, type: 'f32' },
    uTime: { value: timeOffset, type: 'f32' },
    uSeed: { value: seed, type: 'f32' },
    uRotation: { value: rng() * 6.28, type: 'f32' },
    uLightOrigin: { value: new Float32Array([0.39, 0.39]), type: 'vec2<f32>' },
    uTimeSpeed: { value: paleta.timeSpeed, type: 'f32' },
    uDitherSize: { value: paleta.ditherSize, type: 'f32' },
    uLightBorder1: { value: paleta.lightBorder1, type: 'f32' },
    uLightBorder2: { value: paleta.lightBorder2, type: 'f32' },
    uSize: { value: paleta.size, type: 'f32' },
    uOctaves: { value: paleta.octaves, type: 'i32' },
    uPlanetType: { value: paleta.planetType, type: 'i32' },
    uRiverCutoff: { value: paleta.riverCutoff, type: 'f32' },
    uLandCutoff: { value: paleta.landCutoff, type: 'f32' },
    uCloudCover: { value: paleta.cloudCover, type: 'f32' },
    uStretch: { value: paleta.stretch, type: 'f32' },
    uCloudCurve: { value: paleta.cloudCurve, type: 'f32' },
    uColors0: { value: new Float32Array(c[0]), type: 'vec4<f32>' },
    uColors1: { value: new Float32Array(c[1]), type: 'vec4<f32>' },
    uColors2: { value: new Float32Array(c[2]), type: 'vec4<f32>' },
    uColors3: { value: new Float32Array(c[3]), type: 'vec4<f32>' },
    uColors4: { value: new Float32Array(c[4]), type: 'vec4<f32>' },
    uColors5: { value: new Float32Array(c[5]), type: 'vec4<f32>' },
    uTiles: { value: paleta.tiles, type: 'f32' },
    uCloudAlpha: { value: paleta.cloudAlpha, type: 'f32' },
  });
}

function criarShaderPlaneta(tipoPlaneta: string, seed: number, rng: Rng = Math.random): Shader {
  const paleta = gerarPaletaAleatoria(tipoPlaneta, rng);
  const planetUniforms = criarUniformsPlaneta(paleta, seed, 64.0, 0.0, rng);

  return new Shader({
    gpuProgram: sharedGpuProgram,
    glProgram: sharedGlProgram,
    resources: { planetUniforms },
  });
}

// Canvas2D planet state stashed on the display object when running
// in software mode. Each frame atualizarTempoPlanetas re-renders the
// procedural shader on the CPU into `data`, puts it back into the
// canvas, and triggers a texture upload on the Pixi source.
export interface CanvasPlanetState {
  paleta: PaletaPlaneta;
  seed: number;
  uPixels: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  state: PlanetRenderState;
  // Force a re-render on next tick even if time didn't advance (e.g.
  // when light source moves). Cheap micro-optim; setting this to
  // false on static frames skips the ImageData loop.
  dirty: boolean;
}

function criarPlanetaCanvasSprite(
  x: number, y: number, tamanho: number,
  paleta: PaletaPlaneta, seed: number,
  uPixelsArg: number = 64,
  rng: Rng = Math.random,
): Sprite {
  // Internal resolution matches the pixelization grid the shader uses.
  // Default uPixels=64 for planets, callers pass 128 for stars (same
  // values the GLSL path uses).
  const uPixels = uPixelsArg;
  const W = uPixels;
  const H = uPixels;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx2d = canvas.getContext('2d', { alpha: true });
  if (!ctx2d) throw new Error('[planeta-canvas] 2D context unavailable');
  const imageData = ctx2d.createImageData(W, H);

  const renderState: PlanetRenderState = {
    uTime: 0,
    uRotation: rng() * 6.28,
    uLightOriginX: 0.39,
    uLightOriginY: 0.39,
  };

  // Initial frame so the Sprite has something sensible before the
  // first atualizarTempoPlanetas tick.
  renderPlanetParaImageData(imageData.data, W, H, paleta, renderState, uPixels, seed);
  ctx2d.putImageData(imageData, 0, 0);

  const sprite = new Sprite(Texture.from(canvas));
  sprite.texture.source.scaleMode = 'nearest';
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  // Match the Mesh scale semantics: unit quad → tamanho world units.
  // Sprite uses pixel-sized texture, so scale = tamanho / W.
  sprite.scale.set(tamanho / W);
  sprite.eventMode = 'none';

  const rotSpeed = (0.02 + rng() * 0.06) * (rng() > 0.5 ? 1 : -1);
  const canvasState: CanvasPlanetState = {
    paleta, seed, uPixels, canvas, ctx: ctx2d, imageData,
    state: renderState, dirty: true,
  };
  (sprite as any)._canvasRender = canvasState;
  (sprite as any)._rotSpeed = rotSpeed;
  // Used by atualizarTempoPlanetas to know this uses the CPU path.
  (sprite as any)._isCanvasPlanet = true;

  return sprite;
}

/**
 * Detect whether we're running in the Canvas2D renderer mode. In
 * that mode we cannot create Mesh+Shader — the GPU path simply
 * doesn't exist — so criarPlanetaProceduralSprite routes to the
 * CPU JS-port path instead.
 */
function isCanvas2dRenderer(): boolean {
  if (!_appRef) return false;
  const anyR = _appRef.renderer as any;
  const name = anyR.name ?? anyR.type ?? '';
  return typeof name === 'string' && name.toLowerCase().includes('canvas');
}

export function criarPlanetaProceduralSprite(
  x: number,
  y: number,
  tamanho: number,
  tipoPlaneta: string,
  seed?: number,
  rng: Rng = Math.random,
): Mesh<Geometry, Shader> {
  const planetSeed = seed ?? (1.0 + rng() * 9.0);

  if (isCanvas2dRenderer()) {
    const paleta = gerarPaletaAleatoria(tipoPlaneta, rng);
    return criarPlanetaCanvasSprite(x, y, tamanho, paleta, planetSeed, 64, rng) as unknown as Mesh<Geometry, Shader>;
  }

  // M5 — weydra live shader path. When planetsLive is on AND the
  // renderer is up, allocate a PlanetInstance from the shared pool and
  // stash it on a tiny Pixi Container so the rest of the game graph
  // (parents, addChild for ring overlays, hit-testing, save/load) keeps
  // working unchanged. The Container itself draws nothing — the weydra
  // renderer paints the planet pixels into its own canvas behind Pixi.
  {
    const r = getWeydraRenderer();
    if (getConfig().weydra.planetsLive && r) {
      const paleta = gerarPaletaAleatoria(tipoPlaneta, rng);
      const initialRotation = rng() * 6.28;
      const rotSpeed = (0.02 + rng() * 0.06) * (rng() > 0.5 ? 1 : -1);
      const instance = r.createPlanetInstance();
      instance.uSeed = planetSeed;
      instance.uPlanetType = paleta.planetType;
      instance.uOctaves = paleta.octaves;
      instance.uPixels = 64;
      instance.uTime = 0;
      instance.uRotation = initialRotation;
      instance.uTimeSpeed = paleta.timeSpeed;
      instance.uDitherSize = paleta.ditherSize;
      instance.uLightBorder1 = paleta.lightBorder1;
      instance.uLightBorder2 = paleta.lightBorder2;
      instance.uSize = paleta.size;
      instance.uRiverCutoff = paleta.riverCutoff;
      instance.uLandCutoff = paleta.landCutoff;
      instance.uCloudCover = paleta.cloudCover;
      instance.uStretch = paleta.stretch;
      instance.uCloudCurve = paleta.cloudCurve;
      instance.uTiles = paleta.tiles;
      instance.uCloudAlpha = paleta.cloudAlpha;
      // Default light origin matches criarUniformsPlaneta (0.39, 0.39).
      instance.setLightOrigin(0.39, 0.39);
      instance.setWorldPos(x, y);
      instance.setWorldSize(tamanho, tamanho);
      for (let i = 0; i < 6; i++) {
        const c = paleta.colors[i];
        instance.setColor(i, c[0], c[1], c[2], c[3]);
      }
      const stub = new Container() as unknown as Mesh<Geometry, Shader>;
      stub.x = x;
      stub.y = y;
      // Match Mesh scale semantics so any caller that reads
      // (planeta as any).scale.x to compute world size still gets
      // tamanho. Container.scale is a Pixi ObservablePoint, not a
      // plain object — set via .set() to keep the observer happy.
      (stub as unknown as Container).scale.set(tamanho);
      (stub as any)._weydraPlanet = instance;
      (stub as any)._rotSpeed = rotSpeed;
      (stub as any)._uTime = 0;
      (stub as any)._uRotation = initialRotation;
      (stub as any)._planetaTipo = tipoPlaneta;
      (stub as any)._planetSeed = planetSeed;
      (stub as any)._planetPaleta = paleta;
      // Hook destroy so freeing the planet returns its slot to the pool.
      const origDestroy = (stub as unknown as Container).destroy.bind(stub);
      (stub as unknown as Container).destroy = ((opts?: any) => {
        try {
          const inst = (stub as any)._weydraPlanet as PlanetInstance | null;
          if (inst) {
            r.destroyPlanetInstance(inst);
            (stub as any)._weydraPlanet = null;
          }
        } catch (err) {
          console.warn('[planeta-procedural] weydra planet destroy failed:', err);
        }
        return origDestroy(opts);
      }) as Container['destroy'];
      return stub;
    }
  }

  const shader = criarShaderPlaneta(tipoPlaneta, planetSeed, rng);

  const state = State.for2d();
  state.blend = true;

  const mesh = new Mesh({
    geometry: quadGeometry,
    shader,
    state,
  });

  // Scale the unit quad (-0.5..0.5) to the desired size
  mesh.scale.set(tamanho);
  mesh.x = x;
  mesh.y = y;

  // Store shader reference and rotation speed for time/light updates
  const rotSpeed = (0.02 + rng() * 0.06) * (rng() > 0.5 ? 1 : -1);
  (mesh as any)._planetShader = shader;
  (mesh as any)._rotSpeed = rotSpeed;

  return mesh;
}

// Cached shaderLive flag — initialized from config and updated by observer
let _shaderLive = getConfig().graphics.shaderLive;
onConfigChange((cfg) => { _shaderLive = cfg.graphics.shaderLive; });

/**
 * Lazily bake a planet/star mesh into a static Sprite. The mesh is hidden
 * (not destroyed) so we can swap back when shaderLive is re-enabled.
 * The baked sprite is stored as `_bakedSprite` on the mesh.
 */
function bakePlaneta(planeta: any): void {
  if (!_appRef) return;
  // Canvas2D renderer has no generateTexture / shader pipeline —
  // bake is meaningless there. Belt-and-suspenders guard in case a
  // future code path ever calls this with a canvas planet.
  if (isCanvas2dRenderer()) return;
  if ((planeta as any)._bakedSprite) return; // already baked
  const mesh = planeta as Mesh;
  const shader = (mesh as any)._planetShader as Shader | undefined;
  if (!shader) return;

  try {
    const tamanho = mesh.scale.x;
    const frameSize = Math.max(64, tamanho * 1.08);

    const clone = new Mesh({ geometry: quadGeometry, shader, state: mesh.state });
    clone.scale.set(tamanho);
    clone.position.set(frameSize / 2, frameSize / 2);
    const wrapper = new Container();
    wrapper.addChild(clone);

    // Terran normalmente roda 6 octaves de FBM pra detalhe visível na
    // superfície em zoom alto. No bake (64px ou menor) o olho não
    // resolve os 2 octaves de maior frequência — eles viram ruído
    // sub-pixel indistinguível. Rebaixa pra 4 só durante o render do
    // bake e restaura depois, pro caso de unbake futuro reusar o
    // shader no modo live.
    const uniforms = (shader.resources as any).planetUniforms.uniforms;
    const octavesOriginal = uniforms.uOctaves;
    const isTerran = uniforms.uPlanetType === 0;
    if (isTerran && octavesOriginal > 4) {
      uniforms.uOctaves = 4;
    }

    const texture = _appRef.renderer.generateTexture({
      target: wrapper,
      frame: new Rectangle(0, 0, frameSize, frameSize),
      resolution: 1,
      // Planetas já têm dither/pixelização intencional via uPixels no
      // shader. MSAA no bake não produz benefício visual e encarece
      // a geração (4× pixels resolvidos).
      antialias: false,
    });

    if (isTerran && octavesOriginal > 4) {
      uniforms.uOctaves = octavesOriginal;
    }

    clone.destroy();
    wrapper.destroy();

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    // Display size precisa bater com o frameSize da textura, não com
    // tamanho. A textura é frameSize×frameSize e o disco dentro ocupa
    // tamanho (centralizado). Se display=tamanho, o sprite escala a
    // textura por tamanho/frameSize e o disco encolhe — visível pra
    // planetas pequenos (frameSize=64 mínimo, então tamanho=30 →
    // disco aparece em 30/64 = 47% do tamanho esperado). Ajustar pra
    // frameSize mantém o disco com raio tamanho/2 igual ao mesh live.
    sprite.width = frameSize;
    sprite.height = frameSize;

    // Add baked sprite as sibling, hide the mesh
    (planeta as any)._bakedSprite = sprite;
    if (mesh.parent) {
      mesh.parent.addChildAt(sprite, mesh.parent.getChildIndex(mesh));
      sprite.x = mesh.x;
      sprite.y = mesh.y;
    }
    mesh.visible = false;
    sprite.visible = true;
  } catch (err) {
    console.warn('[planeta-procedural] bake failed:', err);
  }
}

/**
 * Render a small snapshot of the planet's live shader (current uTime,
 * rotation, uniforms) into the caller-provided destination canvas.
 *
 * Reuses a single set of Pixi resources (clone Mesh + wrapper + an
 * internal extract canvas) across calls — only rebuilt when the
 * target mesh or size changes. Earlier version created+destroyed a
 * RenderTexture every call, which accumulated GPU memory at ~2 Hz
 * and tanked FPS after a minute of an open drawer. Returns true on
 * success so callers can fall back to a placeholder on failure.
 */
let _portraitCache: {
  sourceMesh: Mesh<Geometry, Shader>;
  tamanho: number;
  clone: Mesh<Geometry, Shader>;
  wrapper: Container;
} | null = null;

function destroyPortraitCache(): void {
  if (!_portraitCache) return;
  try {
    _portraitCache.clone.destroy();
    _portraitCache.wrapper.destroy();
  } catch {
    // Ignore — best-effort cleanup.
  }
  _portraitCache = null;
}

export function renderPlanetaParaCanvas(planeta: any, tamanho = 96): HTMLCanvasElement | null {
  // Canvas2D mode: the planet already owns an HTMLCanvasElement with
  // the current frame. Return an upscaled copy so the drawer portrait
  // has a fresh element of the requested size.
  if ((planeta as any)._isCanvasPlanet) {
    const cs = (planeta as any)._canvasRender as { canvas: HTMLCanvasElement } | undefined;
    if (!cs?.canvas) return null;
    const out = document.createElement('canvas');
    out.width = tamanho;
    out.height = tamanho;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.imageSmoothingEnabled = false;
    octx.drawImage(cs.canvas, 0, 0, tamanho, tamanho);
    return out;
  }

  if (!_appRef) return null;
  // Past this point we use renderer.extract.canvas() which Canvas2D
  // mode doesn't implement. Caller already returns early for canvas
  // planets via _isCanvasPlanet; this guard covers edge cases where
  // the planet lost that flag (e.g. DTO reconstruction bug).
  if (isCanvas2dRenderer()) return null;
  const mesh = planeta as Mesh;
  const shader = (mesh as any)._planetShader as Shader | undefined;
  if (!shader) return null;

  try {
    // Rebuild the cache if the target mesh changed (player clicked a
    // different planet) or the size changed.
    if (!_portraitCache || _portraitCache.sourceMesh !== mesh || _portraitCache.tamanho !== tamanho) {
      destroyPortraitCache();
      const clone = new Mesh({ geometry: quadGeometry, shader, state: mesh.state });
      clone.scale.set(tamanho);
      clone.position.set(tamanho / 2, tamanho / 2);
      const wrapper = new Container();
      wrapper.addChild(clone);
      _portraitCache = { sourceMesh: mesh, tamanho, clone, wrapper };
    }

    // extract.canvas handles the render + readback internally and
    // returns a fresh HTMLCanvasElement — no intermediate RenderTexture
    // to leak. The underlying framebuffer is pooled by Pixi.
    const canvas = _appRef.renderer.extract.canvas({
      target: _portraitCache.wrapper,
      frame: new Rectangle(0, 0, tamanho, tamanho),
      resolution: 1,
      antialias: true,
    }) as HTMLCanvasElement;
    return canvas;
  } catch (err) {
    console.warn('[planeta-procedural] portrait render failed:', err);
    destroyPortraitCache();
    return null;
  }
}

/**
 * Rough bytes held by all canvas-backed planets. Each sprite owns
 * a small ImageData + uploaded texture. Called by the RAM HUD so
 * the memory readout stays accurate in Canvas2D mode.
 */
export function getCanvasPlanetsMemoryBytes(planetas: any[]): number {
  let total = 0;
  for (const p of planetas) {
    const cs = (p as any)._canvasRender as { canvas: HTMLCanvasElement } | undefined;
    if (!cs?.canvas) continue;
    // ImageData + GPU upload of the same pixels.
    total += cs.canvas.width * cs.canvas.height * 4 * 2;
  }
  return total;
}

/** Caller-invokable teardown for when the drawer closes. */
export function liberarPortraitPlaneta(): void {
  destroyPortraitCache();
}

/**
 * Iterate planetas e bake cada um que estaria abaixo de AUTO_BAKE_PX
 * no zoom passado. Roda durante o loading em vez de lazy no gameplay —
 * antes os primeiros 50 frames pagavam 2-4ms cada de generateTexture
 * + driver stall enquanto os planetas pequenos bakeavam sob demanda.
 * Frontload movido pra fase onde o usuário já espera.
 *
 * `onProgress(i, total)` é opcional pra atualizar label de loading.
 * Yielda via await 0 a cada 4 planetas pra não bloquear a UI.
 */
export async function precompilarBakesPlanetas(
  planetas: any[],
  zoom: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!_appRef) return;
  if (isCanvas2dRenderer()) return;

  const AUTO_BAKE_PX = 40;
  const total = planetas.length;
  const weydraBaked = getConfig().weydra.planetsBaked;
  for (let i = 0; i < planetas.length; i++) {
    const planeta = planetas[i];
    if ((planeta as any)._bakedSprite || (planeta as any)._weydraBakedSprite) continue;
    if ((planeta as any)._isCanvasPlanet) continue;
    const tamWorld = (planeta as any).scale?.x ?? 1;
    const tamPx = tamWorld * zoom;
    if (tamPx < AUTO_BAKE_PX) {
      if (weydraBaked) {
        await bakePlanetaWeydra(planeta);
        const s = (planeta as any)._weydraBakedSprite as WeydraSprite | undefined;
        if (s) { s.x = planeta.x; s.y = planeta.y; }
      } else {
        bakePlaneta(planeta);
        // Mantém sprite posicionado antes do primeiro frame — senão
        // aparece em (0,0) por um frame antes do gameplay rodar o loop
        // que sincroniza posição.
        const sprite = (planeta as any)._bakedSprite as Sprite | undefined;
        if (sprite) {
          sprite.x = planeta.x;
          sprite.y = planeta.y;
        }
      }
    }
    if (onProgress && i % 4 === 0) onProgress(i + 1, total);
    // Yield a cada 4 bakes pro browser atualizar a loading screen.
    if (i % 4 === 3) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  if (onProgress) onProgress(total, total);
}

// A baked planet's pixels are still produced by the Pixi shader (via
// renderer.extract.canvas), but the resulting bitmap lives in the weydra
// sprite pool. Full-weydra bake — rendering the shader directly into a
// RenderTarget — waits for the shader to port over.
//
// Queue scheduler runs one bake per frame. Fire-and-forget bakes during
// zoom-out would stack extract.canvas stalls (10-50ms each, synchronous)
// into the same frame. With the queue, each frame absorbs at most one
// readback.

const _bakeQueue: any[] = [];
// Strong-ref Set (not WeakSet): the entry must outlive the sync portion
// of processBakeQueueWeydra and stay until bakePlanetaWeydra resolves, so
// re-entry from atualizarTempoPlanetas during the async gap skips the
// planet. resetBakeQueueWeydra clears both collections on world teardown.
const _bakeSet = new Set<object>();

export function enqueueBakeWeydra(planeta: any): void {
  if (_bakeSet.has(planeta)) return;
  _bakeSet.add(planeta);
  _bakeQueue.push(planeta);
}

/** Drain one planet from the bake queue. Safe to call every frame even
 *  when the queue is empty; cost is a single `shift()`. */
export function processBakeQueueWeydra(): void {
  const planeta = _bakeQueue.shift();
  if (!planeta) return;
  // Keep the planet in `_bakeSet` until bake finishes. Deleting here
  // synchronously would let the next frame's atualizarTempoPlanetas re-enqueue
  // the same planet (sprite isn't set yet) and stack a second in-flight bake,
  // which would leak the first sprite+texture.
  void bakePlanetaWeydra(planeta).finally(() => _bakeSet.delete(planeta));
}

/** Drop queue + in-flight guard. Called from destruirMundo so stale
 *  references to destroyed meshes don't resurface on the next world. */
export function resetBakeQueueWeydra(): void {
  _bakeQueue.length = 0;
  _bakeSet.clear();
}

/** Destroy any weydra baked sprite attached to planetas. Weydra sprites
 *  live in the renderer's pool, outside the Pixi container tree, so
 *  `container.destroy({ children: true })` alone would leak them across
 *  world reloads. */
export function destroyAllWeydraBakedSprites(planetas: any[]): void {
  for (const p of planetas) {
    if ((p as any)._weydraBakedSprite) unbakePlanetaWeydra(p);
  }
}

async function bakePlanetaWeydra(planeta: any): Promise<void> {
  const r = getWeydraRenderer();
  if (!r || !_appRef) return;
  if (isCanvas2dRenderer()) return;
  if ((planeta as any)._weydraBakedSprite) return;
  // Invisible planets (culled, post-destruirMundo, fog-hidden) don't need a
  // bake. Firing extract.canvas on a destroyed mesh would throw; catching
  // invisibility here also prevents stale positions on planets that cull
  // mid-queue.
  if (!(planeta as any).visible) return;

  // M5 fast path: planet was created with weydra.planetsLive on, so it
  // already has a PlanetInstance in the pool. Bake directly to a
  // RenderTarget — no Pixi readback round-trip. Visually identical to
  // the live render at this snapshot since both paths reuse the same
  // pipeline + uniform slot.
  const liveInstance = (planeta as any)._weydraPlanet as PlanetInstance | undefined;
  if (liveInstance) {
    try {
      const tamanhoLive = (planeta as any).scale?.x ?? 1;
      const frameSizeLive = Math.max(64, Math.ceil(tamanhoLive * 1.08));
      const texHandle = r.bakePlanet(liveInstance, frameSizeLive);
      const sprite = r.createSprite(texHandle, frameSizeLive, frameSizeLive);
      sprite.x = planeta.x;
      sprite.y = planeta.y;
      sprite.zOrder = Z.PLANET_BAKED;
      sprite.visible = true;
      (planeta as any)._weydraBakedSprite = sprite;
      // Keep liveInstance alive — auto-unbake on zoom-in flips back to
      // the live render path without re-allocating the pool slot. Live
      // shader keeps drawing into the same pool slot but at tamPx<40 the
      // baked sprite covers it in z-order; the wasted cycles are a
      // documented trade-off (deferred: pool-level visibility flag).
    } catch (err) {
      console.warn('[planeta-procedural] weydra full bake failed:', err);
    }
    return;
  }

  // M4 hybrid path (Pixi-extract → upload) for legacy mesh planets that
  // don't carry a _weydraPlanet handle (weydra.planetsLive off, or shader
  // mode without weydra-live).
  const mesh = planeta as Mesh;
  const shader = (mesh as any)._planetShader as Shader | undefined;
  if (!shader) return;

  try {
    const tamanho = mesh.scale.x;
    const frameSize = Math.max(64, tamanho * 1.08);

    const uniforms = (shader.resources as any).planetUniforms.uniforms;
    const octavesOriginal = uniforms.uOctaves;
    const isTerran = uniforms.uPlanetType === 0;
    if (isTerran && octavesOriginal > 4) {
      uniforms.uOctaves = 4;
    }

    const clone = new Mesh({ geometry: quadGeometry, shader, state: mesh.state });
    clone.scale.set(tamanho);
    clone.position.set(frameSize / 2, frameSize / 2);
    const wrapper = new Container();
    wrapper.addChild(clone);

    const canvas = _appRef.renderer.extract.canvas({
      target: wrapper,
      frame: new Rectangle(0, 0, frameSize, frameSize),
      resolution: 1,
      antialias: false,
    }) as HTMLCanvasElement;

    if (isTerran && octavesOriginal > 4) {
      uniforms.uOctaves = octavesOriginal;
    }

    clone.destroy();
    wrapper.destroy();

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    // Uint8ClampedArray.buffer can carry a non-zero byteOffset when it
    // aliases a larger underlying buffer. Passing `.buffer` alone would
    // upload whatever happens to live before the image bytes.
    const rgba = new Uint8Array(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    );
    const texHandle = r.uploadTexture(rgba, canvas.width, canvas.height);

    const sprite = r.createSprite(texHandle, frameSize, frameSize);
    sprite.x = planeta.x;
    sprite.y = planeta.y;
    sprite.zOrder = Z.PLANET_BAKED;
    sprite.visible = true;
    (planeta as any)._weydraBakedSprite = sprite;

    mesh.visible = false;
  } catch (err) {
    console.warn('[planeta-procedural] weydra bake failed:', err);
  }
}

function unbakePlanetaWeydra(planeta: any): void {
  const r = getWeydraRenderer();
  const sprite = (planeta as any)._weydraBakedSprite as WeydraSprite | undefined;
  if (!sprite || !r) return;
  r.destroySprite(sprite);
  (planeta as any)._weydraBakedSprite = null;
  (planeta as any).visible = true;
}

/** Swap back from baked sprite to live mesh. */
function unbakePlaneta(planeta: any): void {
  const sprite = (planeta as any)._bakedSprite as Sprite | undefined;
  if (!sprite) return;
  sprite.visible = false;
  if (sprite.parent) sprite.parent.removeChild(sprite);
  const tex = sprite.texture;
  sprite.destroy();
  tex.destroy(true);
  (planeta as any)._bakedSprite = null;
  (planeta as any).visible = true; // restore mesh; culling will correct it later this frame
}

export function atualizarTempoPlanetas(planetas: any[], deltaMs: number): void {
  const deltaSec = deltaMs / 1000;

  // Canvas2D planets MUST animate every frame regardless of any other
  // flag — they're our equivalent of the live shader, rendered on the
  // CPU. Previously this branch sat inside the !shaderLive guard, so
  // in Canvas2D mode (which forces shaderLive=false during boot), the
  // animation loop for canvas planets never ran: every sun/planet was
  // frozen at the construction-time frame.
  let anyCanvas = false;
  for (const planeta of planetas) {
    if (!(planeta as any)._isCanvasPlanet) continue;
    anyCanvas = true;
    if (!planeta.visible) continue;
    const cs = (planeta as any)._canvasRender as CanvasPlanetState | undefined;
    if (!cs) continue;
    cs.state.uTime += deltaSec;
    const rotSpeed = (planeta as any)._rotSpeed ?? 0;
    cs.state.uRotation += rotSpeed * deltaSec;
    renderPlanetParaImageData(
      cs.imageData.data,
      cs.canvas.width, cs.canvas.height,
      cs.paleta, cs.state, cs.uPixels, cs.seed,
    );
    cs.ctx.putImageData(cs.imageData, 0, 0);
    const src = (planeta as any).texture?.source;
    if (src && typeof src.update === 'function') src.update();
  }
  // If we're in the canvas dispatcher's world (any canvas planet seen),
  // the shader-mode bake/unbake logic below doesn't apply — skip it so
  // we don't run generateTexture on non-existent Meshes.
  if (anyCanvas) return;

  const weydraBaked = getConfig().weydra.planetsBaked;

  if (!_shaderLive) {
    // Bulk-bake path (quality preset "minimo"): all planets render as
    // static sprites. Weydra path enqueues; the scheduler drains one
    // per frame so the first post-toggle frame doesn't stall.
    for (const planeta of planetas) {
      // Weydra-live planet: shader IS the live render path; the
      // "minimo" preset's bulk-bake doesn't apply (we'd need a
      // bake-from-PlanetInstance pipeline for that, deferred to M7).
      // Keep animating uniforms so it doesn't freeze visually.
      if ((planeta as any)._weydraPlanet) {
        const u = (planeta as any)._weydraPlanet as PlanetInstance;
        const rotSpeedW = (planeta as any)._rotSpeed ?? 0;
        const newTime = ((planeta as any)._uTime ?? 0) + deltaSec;
        const newRot = ((planeta as any)._uRotation ?? 0) + rotSpeedW * deltaSec;
        u.uTime = newTime;
        u.uRotation = newRot;
        (planeta as any)._uTime = newTime;
        (planeta as any)._uRotation = newRot;
        u.setWorldPos(planeta.x, planeta.y);
        continue;
      }
      if (weydraBaked) {
        if (!(planeta as any)._weydraBakedSprite) enqueueBakeWeydra(planeta);
        const s = (planeta as any)._weydraBakedSprite as WeydraSprite | undefined;
        if (s) { s.x = planeta.x; s.y = planeta.y; }
      } else {
        if (!(planeta as any)._bakedSprite) bakePlaneta(planeta);
        const sprite = (planeta as any)._bakedSprite as Sprite | undefined;
        if (sprite) { sprite.x = planeta.x; sprite.y = planeta.y; }
      }
    }
    return;
  }

  // shaderLive is ON — per-planet auto-bake: when a planet's on-
  // screen footprint is small, the live shader's detail is below the
  // perceivable threshold anyway, so we bake it to a static sprite
  // and skip the ALU-heavy per-pixel shader entirely.
  const AUTO_BAKE_PX = 40;
  const AUTO_UNBAKE_PX = 55;
  const zoom = getZoom() || 1;

  for (const planeta of planetas) {
    if (!planeta.visible) {
      if ((planeta as any)._bakedSprite) unbakePlaneta(planeta);
      if ((planeta as any)._weydraBakedSprite) unbakePlanetaWeydra(planeta);
      continue;
    }
    // Canvas planets already animated at the top of this function.
    if ((planeta as any)._isCanvasPlanet) continue;

    // Weydra-live planet: skip the Pixi-side auto-bake / shader-update
    // path entirely. PlanetInstance uniforms drive the weydra render;
    // bake/unbake is decided independently via planetsBaked (M4) and
    // never touches a _weydraPlanet stub (it has no _planetShader so
    // bakePlaneta would early-return anyway).
    if ((planeta as any)._weydraPlanet) {
      const u = (planeta as any)._weydraPlanet as PlanetInstance;
      const rotSpeedW = (planeta as any)._rotSpeed ?? 0;
      const newTime = ((planeta as any)._uTime ?? 0) + deltaSec;
      const newRot = ((planeta as any)._uRotation ?? 0) + rotSpeedW * deltaSec;
      u.uTime = newTime;
      u.uRotation = newRot;
      (planeta as any)._uTime = newTime;
      (planeta as any)._uRotation = newRot;
      u.setWorldPos(planeta.x, planeta.y);
      continue;
    }

    const tamWorld = (planeta as any).scale?.x ?? 1;
    const tamPx = tamWorld * zoom;

    if (weydraBaked) {
      const alreadyBaked = !!(planeta as any)._weydraBakedSprite;
      if (alreadyBaked && tamPx > AUTO_UNBAKE_PX) {
        unbakePlanetaWeydra(planeta);
      } else if (!alreadyBaked && tamPx < AUTO_BAKE_PX) {
        enqueueBakeWeydra(planeta);
      }
      if ((planeta as any)._weydraBakedSprite) {
        const s = (planeta as any)._weydraBakedSprite as WeydraSprite;
        s.x = planeta.x;
        s.y = planeta.y;
        continue;
      }
    } else {
      const alreadyBaked = !!(planeta as any)._bakedSprite;
      if (alreadyBaked && tamPx > AUTO_UNBAKE_PX) {
        unbakePlaneta(planeta);
      } else if (!alreadyBaked && tamPx < AUTO_BAKE_PX) {
        bakePlaneta(planeta);
      }
      if ((planeta as any)._bakedSprite) {
        const sprite = (planeta as any)._bakedSprite as Sprite;
        sprite.x = planeta.x;
        sprite.y = planeta.y;
        continue;
      }
    }

    const shader = (planeta as any)._planetShader as Shader | undefined;
    if (shader) {
      const uniforms = (shader.resources as any).planetUniforms.uniforms;
      uniforms.uTime += deltaSec;
      const rotSpeed = (planeta as any)._rotSpeed ?? 0;
      uniforms.uRotation += rotSpeed * deltaSec;
    }
  }
}

// Star palettes — weighted towards yellow (most common star type)
const STAR_PALETTES: RGBA[][] = [
  // Yellow/orange (most common — repeated for weighting)
  [[1.0, 1.0, 0.85, 1], [1.0, 0.85, 0.45, 1], [0.90, 0.55, 0.20, 1], [0.55, 0.25, 0.10, 1]],
  [[1.0, 0.98, 0.80, 1], [0.95, 0.80, 0.40, 1], [0.85, 0.50, 0.18, 1], [0.50, 0.22, 0.08, 1]],
  [[1.0, 1.0, 0.90, 1], [1.0, 0.90, 0.50, 1], [0.92, 0.60, 0.25, 1], [0.60, 0.30, 0.12, 1]],
  // Classic teal/blue (rare)
  [[0.96, 1.0, 0.91, 1], [0.47, 0.84, 0.76, 1], [0.11, 0.57, 0.65, 1], [0.01, 0.24, 0.37, 1]],
  // Red dwarf (uncommon)
  [[1.0, 0.90, 0.80, 1], [0.95, 0.55, 0.35, 1], [0.75, 0.25, 0.15, 1], [0.40, 0.10, 0.08, 1]],
  // Blue giant (rare)
  [[0.95, 0.97, 1.0, 1], [0.60, 0.75, 1.0, 1], [0.30, 0.45, 0.85, 1], [0.10, 0.15, 0.50, 1]],
];

export function criarEstrelaProcedural(
  x: number,
  y: number,
  raio: number,
  rng: Rng = Math.random,
): Mesh<Geometry, Shader> {
  const seed = 1.0 + rng() * 9.0;
  const colors = variarPaleta(pick(STAR_PALETTES, rng), rng);

  const paleta: PaletaPlaneta = {
    planetType: 4,
    colors: [...colors, [0, 0, 0, 1], [0, 0, 0, 1]],
    riverCutoff: 0.0,
    landCutoff: 0.0,
    cloudCover: 0.0,
    stretch: 1.0,
    cloudCurve: 1.3,
    lightBorder1: 0.5,
    lightBorder2: 0.7,
    octaves: 4,
    size: jitter(4.5, 1.0, rng),
    timeSpeed: 0.1,
    ditherSize: 2.0,
    tiles: 1.0,
    cloudAlpha: 0.0,
  };

  const tamanho = raio * 2.9;

  // Canvas2D mode: JS-port path. uPixels=128 matches the shader.
  if (isCanvas2dRenderer()) {
    const sprite = criarPlanetaCanvasSprite(x, y, tamanho, paleta, seed, 128, rng);
    (sprite as any)._rotSpeed = 0.005 + rng() * 0.01;
    return sprite as unknown as Mesh<Geometry, Shader>;
  }

  const planetUniforms = criarUniformsPlaneta(paleta, seed, 128.0, rng() * 100, rng);

  const shader = new Shader({
    gpuProgram: sharedGpuProgram,
    glProgram: sharedGlProgram,
    resources: { planetUniforms },
  });

  const state = State.for2d();
  state.blend = true;

  const mesh = new Mesh({
    geometry: quadGeometry,
    shader,
    state,
  });

  mesh.scale.set(tamanho);
  mesh.x = x;
  mesh.y = y;
  (mesh as any)._planetShader = shader;
  (mesh as any)._rotSpeed = 0.005 + rng() * 0.01;


  return mesh;
}

export function atualizarLuzPlaneta(planeta: any, solX: number, solY: number): void {
  // Same direction math for ALL paths — sun → UV position on the disc.
  // Bit-exact across Canvas2D, Pixi shader, and weydra live shader so
  // visual parity holds when toggling the planetsLive flag.
  const dx = solX - planeta.x;
  const dy = solY - planeta.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const lx = 0.5 + (dx / dist) * 0.25;
  const ly = 0.5 + (dy / dist) * 0.25;

  if ((planeta as any)._isCanvasPlanet) {
    const cs = (planeta as any)._canvasRender as CanvasPlanetState | undefined;
    if (!cs) return;
    cs.state.uLightOriginX = lx;
    cs.state.uLightOriginY = ly;
    return;
  }

  if ((planeta as any)._weydraPlanet) {
    const u = (planeta as any)._weydraPlanet as PlanetInstance;
    u.setLightOrigin(lx, ly);
    return;
  }

  const shader = (planeta as any)._planetShader as Shader | undefined;
  if (!shader) return;
  const uniforms = (shader.resources as any).planetUniforms.uniforms;
  uniforms.uLightOrigin[0] = lx;
  uniforms.uLightOrigin[1] = ly;
}
