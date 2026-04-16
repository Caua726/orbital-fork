import { Mesh, Shader, GlProgram, GpuProgram, UniformGroup, Geometry, Buffer, State, Sprite, Container, Rectangle } from 'pixi.js';
import type { Application } from 'pixi.js';
import vertexSrc from '../shaders/planeta.vert?raw';
import fragmentSrc from '../shaders/planeta.frag?raw';
import wgslSrc from '../shaders/planeta.wgsl?raw';
import { TIPO_PLANETA } from './planeta';
import { getConfig, onConfigChange } from '../core/config';

let _appRef: Application | null = null;

export function setAppReferenceForBake(app: Application): void {
  _appRef = app;
}

interface PaletaPlaneta {
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

// Subtle per-channel variation
function shiftColor(c: RGBA, amount: number): RGBA {
  return [
    Math.max(0, Math.min(1, c[0] + (Math.random() - 0.5) * amount)),
    Math.max(0, Math.min(1, c[1] + (Math.random() - 0.5) * amount)),
    Math.max(0, Math.min(1, c[2] + (Math.random() - 0.5) * amount)),
    c[3],
  ];
}

function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Apply subtle variation to a whole palette (keeps structure, shifts slightly)
function variarPaleta(palette: RGBA[]): RGBA[] {
  return palette.map(c => c[3] === 0 ? c : shiftColor(c, 0.04));
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

function gerarPaletaAleatoria(tipo: string): PaletaPlaneta {
  switch (tipo) {
    case TIPO_PLANETA.COMUM: {
      const colors = variarPaleta(pick(TERRAN_PALETTES));
      return {
        planetType: 0,
        colors,
        riverCutoff: jitter(0.368, 0.1),
        landCutoff: 0.0,
        cloudCover: 0.0,
        stretch: 2.0,
        cloudCurve: 1.3,
        lightBorder1: jitter(0.287, 0.05),
        lightBorder2: jitter(0.476, 0.05),
        octaves: 6,
        size: jitter(4.6, 1.5),
        timeSpeed: 0.1,
        ditherSize: jitter(3.5, 1.0),
        tiles: 1.0,
        cloudAlpha: 0.45 + Math.random() * 0.2, // 0.45=nuvens moderadas, 0.65=poucas nuvens
      };
    }
    case TIPO_PLANETA.MARTE: {
      const colors = variarPaleta(pick(DRY_PALETTES));
      return {
        planetType: 1,
        colors,
        riverCutoff: 0.0,
        landCutoff: 0.0,
        cloudCover: 0.0,
        stretch: 2.0,
        cloudCurve: 1.3,
        lightBorder1: jitter(0.615, 0.06),
        lightBorder2: jitter(0.729, 0.06),
        octaves: 4,
        size: jitter(8.0, 2.0),
        timeSpeed: 0.4,
        ditherSize: 2.0,
        tiles: 1.0,
        cloudAlpha: 0.0,
      };
    }
    case TIPO_PLANETA.GASOSO:
    default: {
      const colors = variarPaleta(pick(GAS_PALETTES));
      return {
        planetType: 3,
        colors,
        riverCutoff: 0.0,
        landCutoff: 0.0,
        cloudCover: jitter(0.45, 0.12),
        stretch: jitter(2.0, 0.5),   // higher stretch = more horizontal bands
        cloudCurve: 1.3,
        lightBorder1: jitter(0.44, 0.06),
        lightBorder2: jitter(0.75, 0.06),
        octaves: 5,
        size: jitter(9.0, 2.0),
        timeSpeed: jitter(0.35, 0.15),
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

function criarUniformsPlaneta(paleta: PaletaPlaneta, seed: number, pixels: number, timeOffset: number): UniformGroup {
  const c = paleta.colors;
  return new UniformGroup({
    uPixels: { value: pixels, type: 'f32' },
    uTime: { value: timeOffset, type: 'f32' },
    uSeed: { value: seed, type: 'f32' },
    uRotation: { value: Math.random() * 6.28, type: 'f32' },
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

function criarShaderPlaneta(tipoPlaneta: string, seed: number): Shader {
  const paleta = gerarPaletaAleatoria(tipoPlaneta);
  const planetUniforms = criarUniformsPlaneta(paleta, seed, 64.0, 0.0);

  return new Shader({
    gpuProgram: sharedGpuProgram,
    glProgram: sharedGlProgram,
    resources: { planetUniforms },
  });
}

export function criarPlanetaProceduralSprite(
  x: number,
  y: number,
  tamanho: number,
  tipoPlaneta: string,
  seed?: number,
): Mesh<Geometry, Shader> {
  const planetSeed = seed ?? (1.0 + Math.random() * 9.0);
  const shader = criarShaderPlaneta(tipoPlaneta, planetSeed);

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
  const rotSpeed = (0.02 + Math.random() * 0.06) * (Math.random() > 0.5 ? 1 : -1);
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

    const texture = _appRef.renderer.generateTexture({
      target: wrapper,
      frame: new Rectangle(0, 0, frameSize, frameSize),
      resolution: 1,
      antialias: true,
    });
    clone.destroy();
    wrapper.destroy();

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = tamanho;
    sprite.height = tamanho;

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
  if (!_shaderLive) {
    // Lazily bake visible planets on first frame after toggle
    for (const planeta of planetas) {
      if (!(planeta as any)._bakedSprite) bakePlaneta(planeta);
      // Keep baked sprite position in sync (planet orbits move it)
      const sprite = (planeta as any)._bakedSprite as Sprite | undefined;
      if (sprite) {
        sprite.x = planeta.x;
        sprite.y = planeta.y;
      }
    }
    return;
  }

  // shaderLive is ON — unbake any baked planets and resume updates
  const deltaSec = deltaMs / 1000;
  for (const planeta of planetas) {
    if ((planeta as any)._bakedSprite) unbakePlaneta(planeta);
    if (!planeta.visible) continue;
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
): Mesh<Geometry, Shader> {
  const seed = 1.0 + Math.random() * 9.0;
  const colors = variarPaleta(pick(STAR_PALETTES));

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
    size: jitter(4.5, 1.0),
    timeSpeed: 0.1,
    ditherSize: 2.0,
    tiles: 1.0,
    cloudAlpha: 0.0,
  };

  const planetUniforms = criarUniformsPlaneta(paleta, seed, 128.0, Math.random() * 100);

  const shader = new Shader({
    gpuProgram: sharedGpuProgram,
    glProgram: sharedGlProgram,
    resources: { planetUniforms },
  });

  const tamanho = raio * 2.9;
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
  (mesh as any)._rotSpeed = 0.005 + Math.random() * 0.01;


  return mesh;
}

export function atualizarLuzPlaneta(planeta: any, solX: number, solY: number): void {
  const shader = (planeta as any)._planetShader as Shader | undefined;
  if (!shader) return;

  // light_origin in UV space: the point ON the planet surface closest to the sun
  // dx > 0 means sun is to the right → light comes from right → light_origin.x < 0.5
  // The shader darkens pixels far from light_origin, so light_origin = illuminated side
  const dx = solX - planeta.x;
  const dy = solY - planeta.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  // Normalize and map: sun direction → UV position (0.2-0.8 range to keep light on the sphere)
  const lx = 0.5 + (dx / dist) * 0.25;
  const ly = 0.5 + (dy / dist) * 0.25;
  const uniforms = (shader.resources as any).planetUniforms.uniforms;
  uniforms.uLightOrigin[0] = lx;
  uniforms.uLightOrigin[1] = ly;
}
