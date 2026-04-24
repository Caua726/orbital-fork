import {
  Buffer, Container, Geometry, GlProgram, GpuProgram, Mesh,
  RenderTexture, Shader, State, Texture, TilingSprite, UniformGroup,
  type Application,
} from 'pixi.js';
import vertexSrc from '../shaders/starfield.vert?raw';
import fragmentSrc from '../shaders/starfield.frag?raw';
import wgslSrc from '../shaders/starfield.wgsl?raw';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import {
  criarFundoCanvas, atualizarFundoCanvas, getStarfieldCanvasMemoryBytes,
} from './fundo-canvas';
import {
  criarFundoEstatico, atualizarFundoEstatico, getStarfieldEstaticoMemoryBytes,
} from './fundo-estatico';
import { detectarRendererSoftware } from '../core/benchmark';

/**
 * Starfield renderer — one fullscreen Mesh running a procedural
 * fragment shader that draws 3 parallax layers of pixel-perfect
 * stars. Zero textures, ~10 KB GPU memory.
 *
 * The Mesh lives in the scene graph as a child of the FundoContainer
 * and is repositioned every frame to cover the visible viewport in
 * world coords.
 */

interface FundoContainer extends Container {
  _mesh: Mesh<Geometry, Shader>;
  _uniforms: UniformGroup;
  _tempoAcumMs: number;
  // TilingSprite que substitui a camada "far" (cell 200, parallax 0.12,
  // size 2px) que antes rodava no shader. Bakeada uma vez, repete
  // com camera × parallax 0.12. Aditiva por cima do mesh (shader
  // preenche opaco preto + 2 layers procedurais). Ganho: 33% menos
  // ALU por pixel fullscreen no starfield.frag.
  _brightTiles: TilingSprite;
}

/**
 * Approximate bytes held by the starfield renderer. Varies by path:
 * shader (~10 KB), Canvas2D JS port (ImageData + upload), or the
 * static WARP-friendly tiling sprite.
 */
export function getStarfieldMemoryBytes(fundo: Container): number {
  if ((fundo as any)._isCanvasFundo) return getStarfieldCanvasMemoryBytes(fundo);
  if ((fundo as any)._isStaticFundo) return getStarfieldEstaticoMemoryBytes(fundo);
  return 10 * 1024;
}

// Boot wires this so criarFundo can detect Canvas2D mode at creation.
let _appRef: Application | null = null;
export function setAppReferenceForFundo(app: Application): void {
  _appRef = app;
}

function isCanvas2dRenderer(): boolean {
  if (!_appRef) return false;
  const anyR = _appRef.renderer as any;
  const name = anyR.name ?? anyR.type ?? '';
  return typeof name === 'string' && name.toLowerCase().includes('canvas');
}

function isSoftwareRenderer(): boolean {
  if (!_appRef) return false;
  try {
    return detectarRendererSoftware(_appRef).isSoftware;
  } catch {
    return false;
  }
}

// ─── Shared GPU resources ─────────────────────────────────────────

function criarUnitQuadGeometry(): Geometry {
  const positions = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return new Geometry({
    attributes: {
      aPosition: { buffer: new Buffer({ data: positions, usage: 32 | 8 }), format: 'float32x2' },
      aUV: { buffer: new Buffer({ data: uvs, usage: 32 | 8 }), format: 'float32x2' },
    },
    indexBuffer: new Buffer({ data: indices, usage: 16 | 8 }),
  });
}

const sharedQuadGeometry = criarUnitQuadGeometry();

// ─── Bright-layer baked tile ─────────────────────────────────────
// Gera uma vez no primeiro criarFundo() do modo WebGL/WebGPU e é
// reusado entre todos os FundoContainers criados na sessão. Matches
// visualmente a densidade da antiga layer 3 do starfield.frag
// (cellSize 200, density 0.30, size 2px).
const BRIGHT_TILE_SIZE = 1024;
let _sharedBrightTile: Texture | null = null;

function gerarBrightTile(): Texture {
  if (_sharedBrightTile) return _sharedBrightTile;
  const canvas = document.createElement('canvas');
  canvas.width = BRIGHT_TILE_SIZE;
  canvas.height = BRIGHT_TILE_SIZE;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    // Fallback extremo — textura vazia. Pixi não crasha em Texture.from
    // de um canvas sem ctx, mas a tile fica preta; aceitável para o
    // caso de "contexto 2D indisponível".
    _sharedBrightTile = Texture.from(canvas);
    return _sharedBrightTile;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BRIGHT_TILE_SIZE, BRIGHT_TILE_SIZE);

  // Densidade da layer 3 antiga: cellSize=200, density=0.30 →
  // 0.30 stars por célula de 200². Tile 1024² tem ~25 stars visíveis
  // (nem toda célula "ganha" star pelo teste de lottery). Aqui
  // replicamos o mesmo lattice determinístico (LCG) pra manter
  // consistência visual entre sessões.
  let seed = 0x1fabcd17;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const cellSize = 200;
  const cellsX = Math.floor(BRIGHT_TILE_SIZE / cellSize);
  const cellsY = Math.floor(BRIGHT_TILE_SIZE / cellSize);
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      // density = 0.30 igual layer 3 do shader.
      if (rand() > 0.30) continue;
      // Posição dentro da célula (floor pra grid inteiro).
      const sx = Math.floor(cx * cellSize + rand() * cellSize);
      const sy = Math.floor(cy * cellSize + rand() * cellSize);
      // Brilho varia 0.35..1.0 × 1.00 maxBrightness, igual shader.
      const bmod = 0.35 + 0.65 * rand();
      const v = Math.floor(bmod * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      // 2×2 como layer 3 (sizePx=2).
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  _sharedBrightTile = tex;
  return tex;
}

const sharedGlProgram = GlProgram.from({
  vertex: vertexSrc,
  fragment: fragmentSrc,
  name: 'starfield-shader',
});

const sharedGpuProgram = GpuProgram.from({
  vertex: { source: wgslSrc, entryPoint: 'mainVertex' },
  fragment: { source: wgslSrc, entryPoint: 'mainFragment' },
  name: 'starfield-shader',
});

function criarUniforms(): UniformGroup {
  return new UniformGroup({
    uCamera:    { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
    uViewport:  { value: new Float32Array([1920, 1080]), type: 'vec2<f32>' },
    uTime:      { value: 0, type: 'f32' },
    uDensidade: { value: 1.0, type: 'f32' },
  });
}

function criarStarfieldMesh(): { mesh: Mesh<Geometry, Shader>; uniforms: UniformGroup } {
  const uniforms = criarUniforms();
  const shader = new Shader({
    gpuProgram: sharedGpuProgram,
    glProgram: sharedGlProgram,
    resources: { starUniforms: uniforms },
  });
  const state = State.for2d();
  state.blend = false;
  const mesh = new Mesh({ geometry: sharedQuadGeometry, shader, state });
  mesh.eventMode = 'none';
  return { mesh, uniforms };
}

/**
 * Force the starfield shader program to compile + link NOW.
 */
export async function precompilarShaderStarfield(
  app: { renderer: { render: (opts: { container: Container; target: any }) => void } },
): Promise<void> {
  // Canvas2D mode has no GLSL/WGSL program to compile.
  if (isCanvas2dRenderer()) return;
  let mesh: Mesh<Geometry, Shader> | null = null;
  let target: RenderTexture | null = null;
  try {
    const made = criarStarfieldMesh();
    mesh = made.mesh;
    target = RenderTexture.create({ width: 8, height: 8 });
    app.renderer.render({ container: mesh, target });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  } catch (err) {
    console.warn('[fundo] starfield shader warmup failed (non-fatal):', err);
  } finally {
    try { mesh?.destroy(); } catch { /* noop */ }
    try { target?.destroy(true); } catch { /* noop */ }
  }
}

export function criarFundo(tamanhoMundo: number): FundoContainer {
  // Software (WARP / SwiftShader / LLVMpipe) → static tiling sprite.
  // No per-frame shader, no per-pixel compute; just a pre-baked
  // canvas tile that pans with the camera. Expect ~20 ms/frame back
  // compared to the procedural shader on CPU-rasterized WebGL.
  if (isSoftwareRenderer() && !isCanvas2dRenderer()) {
    const staticFundo = criarFundoEstatico(tamanhoMundo) as unknown as FundoContainer;
    (staticFundo as any)._isStaticFundo = true;
    return staticFundo;
  }
  if (isCanvas2dRenderer()) {
    const canvasFundo = criarFundoCanvas(tamanhoMundo) as unknown as FundoContainer;
    (canvasFundo as any)._isCanvasFundo = true;
    return canvasFundo;
  }
  const container = new Container() as FundoContainer;
  const { mesh, uniforms } = criarStarfieldMesh();
  container.addChild(mesh);

  // TilingSprite das bright 2×2 aditiva por cima. Black-bg + add blend
  // descarta o preto do tile e soma as estrelas brancas no resultado
  // do shader (que ali é 0 pro pixel sem star, então add == put).
  const brightTex = gerarBrightTile();
  const brightTiles = new TilingSprite({
    texture: brightTex,
    width: BRIGHT_TILE_SIZE,
    height: BRIGHT_TILE_SIZE,
  });
  brightTiles.eventMode = 'none';
  brightTiles.blendMode = 'add';
  container.addChild(brightTiles);

  container._mesh = mesh;
  container._uniforms = uniforms;
  container._tempoAcumMs = 0;
  container._brightTiles = brightTiles;
  return container;
}

/**
 * Repositions the fullscreen starfield quad to cover the current
 * viewport in world coords and pushes camera + time uniforms to the
 * shader.
 *
 * @param fundo   Container retornado por criarFundo()
 * @param jogadorX Centro X da viewport em world units
 * @param jogadorY Centro Y da viewport em world units
 * @param telaW   Largura da viewport em world units
 * @param telaH   Altura da viewport em world units
 */
export function atualizarFundo(
  fundo: FundoContainer,
  jogadorX: number,
  jogadorY: number,
  telaW: number,
  telaH: number,
): void {
  if ((fundo as any)._isStaticFundo) {
    atualizarFundoEstatico(fundo as any, jogadorX, jogadorY, telaW, telaH);
    return;
  }
  if ((fundo as any)._isCanvasFundo) {
    atualizarFundoCanvas(fundo as any, jogadorX, jogadorY, telaW, telaH);
    return;
  }
  const mesh = fundo._mesh;
  mesh.x = jogadorX - telaW / 2;
  mesh.y = jogadorY - telaH / 2;
  mesh.scale.set(telaW, telaH);

  fundo._tempoAcumMs += 16.67;
  const weydraOn = !!getConfig().weydra?.starfield;

  if (weydraOn) {
    // weydra assumiu a camada procedural (2 layers). Pixi mesh invisível;
    // TilingSprite bright continua em Pixi até M3 migrar o sprite pool.
    mesh.visible = false;
    const r = getWeydraRenderer();
    if (r) {
      r.setCamera(jogadorX, jogadorY, telaW, telaH, fundo._tempoAcumMs / 1000);
      r.setStarfieldDensity(getConfig().graphics.densidadeStarfield);
    }
  } else {
    mesh.visible = true;
    const uniforms = fundo._uniforms.uniforms as {
      uCamera: Float32Array;
      uViewport: Float32Array;
      uTime: number;
      uDensidade: number;
    };
    uniforms.uCamera[0] = jogadorX;
    uniforms.uCamera[1] = jogadorY;
    uniforms.uViewport[0] = telaW;
    uniforms.uViewport[1] = telaH;
    uniforms.uTime = fundo._tempoAcumMs / 1000;
    uniforms.uDensidade = getConfig().graphics.densidadeStarfield;
  }

  // Bright layer: ocupa a viewport (mesma posição/tamanho do mesh) e
  // offset de tile replica o parallax 0.12 da antiga layer 3 do
  // shader. A fórmula `worldPos - camera * (1-parallax)` do shader
  // corresponde a um offset `-camera * (1-0.12)` aplicado ao tile —
  // em TilingSprite basta setar tilePosition = -camera * (1-parallax).
  const brightTiles = fundo._brightTiles;
  brightTiles.x = mesh.x;
  brightTiles.y = mesh.y;
  brightTiles.width = telaW;
  brightTiles.height = telaH;
  const parallax = 0.12;
  brightTiles.tilePosition.x = -jogadorX * (1 - parallax);
  brightTiles.tilePosition.y = -jogadorY * (1 - parallax);
}
