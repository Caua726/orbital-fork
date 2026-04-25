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
import { Z } from '../core/render-order';
import type { Sprite as WeydraSprite } from '@weydra/renderer';
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
/** Cached RGBA8 bytes of the generated bright tile — extracted from the
 *  same canvas that feeds the Pixi Texture. Lets the weydra path upload
 *  the tile without re-rasterising. Populated inside `gerarBrightTile`. */
let _sharedBrightBytes: Uint8Array | null = null;
let _weydraBrightTexture: bigint | null = null;
let _weydraBrightSprite: WeydraSprite | null = null;

function gerarBrightTile(): Texture {
  if (_sharedBrightTile) return _sharedBrightTile;
  const canvas = document.createElement('canvas');
  canvas.width = BRIGHT_TILE_SIZE;
  canvas.height = BRIGHT_TILE_SIZE;
  // alpha:true — tile tem fundo transparente. Com blendMode='normal' no
  // TilingSprite, pixels sem star (alpha=0) não cobrem o canvas Pixi.
  // Antes era alpha:false + fundo preto opaco + blend 'add' — isso
  // fazia o Pixi canvas virar opaco via blendFunc(ONE,ONE) escrevendo
  // alpha=1 em todo pixel, bloqueando weydra por trás (z-index 0).
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    _sharedBrightTile = Texture.from(canvas);
    return _sharedBrightTile;
  }
  // NÃO preenche fundo preto — fica transparente onde não tem star.

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

  // Stash RGBA8 bytes before handing the canvas to Pixi — getImageData
  // is cheap now (canvas still hot) and avoids redecoding the PNG path
  // later on the weydra side.
  try {
    const data = ctx.getImageData(0, 0, BRIGHT_TILE_SIZE, BRIGHT_TILE_SIZE).data;
    _sharedBrightBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } catch { /* tainted canvas — unlikely with local generation, but safe */ }

  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  _sharedBrightTile = tex;
  return tex;
}

/**
 * Lazily upload the bright-tile bytes to weydra and allocate one sprite
 * configured as a tiling fullscreen quad. `uploadTextureTiled` gets us
 * Repeat sampling so uv_rect.zw > 1 wraps the texture across the viewport.
 * Position + UV offset are set per-frame in atualizarFundo.
 */
function garantirWeydraBrightSprite(): WeydraSprite | null {
  if (_weydraBrightSprite) return _weydraBrightSprite;
  const r = getWeydraRenderer();
  if (!r) return null;
  if (!_sharedBrightBytes) {
    // Canvas hasn't been generated yet (criarFundo order) — caller retries.
    gerarBrightTile();
    if (!_sharedBrightBytes) return null;
  }
  if (_weydraBrightTexture == null) {
    _weydraBrightTexture = r.uploadTextureTiled(
      _sharedBrightBytes, BRIGHT_TILE_SIZE, BRIGHT_TILE_SIZE,
    );
  }
  // display = (1, 1); the per-frame scale does the viewport sizing. That
  // way the sprite tracks viewport resizes without reallocation.
  const sp = r.createSprite(_weydraBrightTexture, 1, 1);
  sp.zOrder = Z.STARFIELD_BRIGHT;
  _weydraBrightSprite = sp;
  return sp;
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
  // Normal blend (respeita alpha do tile) em vez de 'add' — 'add' escreve
  // alpha=1 em todo pixel do canvas via blendFunc(ONE,ONE), tornando
  // Pixi canvas opaco e bloqueando weydra atrás. Como o tile agora é
  // alpha:true com fundo transparente, 'normal' compõe certo: stars
  // aparecem, fundo não escreve.
  brightTiles.blendMode = 'normal';
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
  // Camera uniforms feed every weydra subsystem (starfield, planet, fog),
  // so push them whenever the renderer is up — independent of which
  // particular Pixi background path the player is on. Without this the
  // weydra fog shader runs with a zero camera/viewport on the static
  // and canvas fundo branches: fog appears anchored at world (0, 0)
  // and never moves with the player, creating a black overlay anywhere
  // off-origin. The shared time field is taken from this fundo even if
  // its mesh isn't being driven this frame so the starfield ticker
  // doesn't desync between branches.
  const r = getWeydraRenderer();
  if (r !== null) {
    fundo._tempoAcumMs += 16.67;
    r.setCamera(jogadorX, jogadorY, telaW, telaH, fundo._tempoAcumMs / 1000);
  }

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

  // _tempoAcumMs is now advanced above (in the renderer-up branch) to
  // keep weydra's `uTime` continuous across fundo paths. When weydra
  // is off, advance it here so the Pixi shader path keeps its tick.
  if (r === null) {
    fundo._tempoAcumMs += 16.67;
  }
  // Hide the Pixi starfield mesh ONLY when weydra is actually rendering
  // it. If the player flipped `weydra.starfield` on but the renderer
  // failed to init (no WebGPU adapter, browser unsupported, etc.), keep
  // the Pixi path so the fallback isn't a black screen.
  const weydraOn = !!getConfig().weydra?.starfield && r !== null;

  if (weydraOn) {
    // weydra assumiu só a camada procedural (2 layers, mesmo algoritmo).
    // brightTiles Pixi permanece visible — tile agora tem bg transparente
    // + blend 'normal', então compõe corretamente com weydra atrás (não
    // bloqueia alpha). Visual idêntico ao Pixi puro.
    mesh.visible = false;
    r!.setStarfieldDensity(getConfig().graphics.densidadeStarfield);
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
  const parallax = 0.12;
  // Same fallback logic as above: skip the weydra path when the renderer
  // didn't actually come up.
  const weydraBrightOn = !!getConfig().weydra?.starfieldBright && r !== null;
  if (weydraBrightOn) {
    brightTiles.visible = false;
    const sp = garantirWeydraBrightSprite();
    if (sp) {
      // Sprite is created with display = (1, 1); scaling to (telaW, telaH)
      // grows the quad to cover the viewport. Center at camera so the quad
      // always sits in front of the player regardless of world pan.
      sp.x = jogadorX;
      sp.y = jogadorY;
      sp.scaleX = telaW;
      sp.scaleY = telaH;
      // Tiling UVs: zw = how many tile repeats the quad spans, xy = offset
      // into the tile, both normalised to tile size. The Repeat sampler
      // wraps UVs past 1 so the texture tiles seamlessly.
      const tilesX = telaW / BRIGHT_TILE_SIZE;
      const tilesY = telaH / BRIGHT_TILE_SIZE;
      const offsetX = -jogadorX * (1 - parallax) / BRIGHT_TILE_SIZE;
      const offsetY = -jogadorY * (1 - parallax) / BRIGHT_TILE_SIZE;
      sp.setUv(offsetX, offsetY, tilesX, tilesY);
    }
  } else {
    brightTiles.visible = true;
    brightTiles.x = mesh.x;
    brightTiles.y = mesh.y;
    brightTiles.width = telaW;
    brightTiles.height = telaH;
    brightTiles.tilePosition.x = -jogadorX * (1 - parallax);
    brightTiles.tilePosition.y = -jogadorY * (1 - parallax);
  }
}
