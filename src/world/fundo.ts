import {
  Buffer, Container, Geometry, GlProgram, GpuProgram, Mesh,
  RenderTexture, Shader, Sprite, State, UniformGroup,
  type Application,
} from 'pixi.js';
import vertexSrc from '../shaders/starfield.vert?raw';
import fragmentSrc from '../shaders/starfield.frag?raw';
import wgslSrc from '../shaders/starfield.wgsl?raw';
import { getConfig } from '../core/config';

/**
 * Starfield renderer.
 *
 * The shader-based approach (~10 KB GPU vs. ~400 MB of the old tile
 * cache) now runs through a low-res RenderTexture with nearest-
 * neighbor upscale. This cuts the per-frame pixel count to ~1/4th
 * (width/2 × height/2) while also giving the stars a crisp retro
 * pixel-art look — each star is 1-2 RT pixels, which becomes a clean
 * 2-4-screen-pixel block after the upscale.
 *
 *   - Internal Mesh runs the starfield fragment shader into an RT
 *     sized at (screenW/2, screenH/2).
 *   - A display Sprite bound to that RT is placed in world space to
 *     exactly cover the viewport. Its TextureSource uses scaleMode
 *     = 'nearest' so the upscale is chunky, not blurred.
 *   - Each frame atualizarFundo updates uniforms, resizes the RT if
 *     the window was resized, renders Mesh→RT, and repositions the
 *     display Sprite.
 */

const RES_DIVISOR = 2; // Render at 1/2 res → 4× less GPU pixel work.

interface FundoContainer extends Container {
  _mesh: Mesh<Geometry, Shader>;
  _sprite: Sprite;
  _rt: RenderTexture;
  _uniforms: UniformGroup;
  _tempoAcumMs: number;
  _rtPxW: number;
  _rtPxH: number;
}

/**
 * Approximate bytes held by the starfield renderer — the low-res RT
 * plus the shader programs. Typically tiny (~0.5 MB at 960×540 RT).
 */
export function getStarfieldMemoryBytes(fundo: Container): number {
  const f = fundo as FundoContainer;
  const rtBytes = f._rtPxW && f._rtPxH ? f._rtPxW * f._rtPxH * 4 : 0;
  return 10 * 1024 + rtBytes;
}

// ─── App reference ────────────────────────────────────────────────
// Needed because atualizarFundo has to call `renderer.render()` to
// draw the internal Mesh into the RT. Set once at boot from main.ts.

let _appRef: Application | null = null;

export function setAppReferenceForFundo(app: Application): void {
  _appRef = app;
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

function criarStarfieldMesh(): Mesh<Geometry, Shader> {
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
  // Stash the uniform group on the mesh so we can grab it back later
  // without having to parse shader.resources again.
  (mesh as any)._uniformsGroup = uniforms;
  return mesh;
}

/**
 * Force the starfield shader program to compile + link NOW.
 * Called once at boot so the first real render doesn't pay the GL
 * link cost mid-frame.
 */
export async function precompilarShaderStarfield(
  app: { renderer: { render: (opts: { container: Container; target: any }) => void } },
): Promise<void> {
  let mesh: Mesh<Geometry, Shader> | null = null;
  let target: RenderTexture | null = null;
  try {
    mesh = criarStarfieldMesh();
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

export function criarFundo(_tamanhoMundo: number): FundoContainer {
  const container = new Container() as FundoContainer;

  const mesh = criarStarfieldMesh();
  // Mesh is NOT added to the container — it renders into the RT
  // off-screen, and the container holds only the display Sprite.

  // Placeholder RT — resized to half the canvas on the first
  // atualizarFundo() call.
  const rt = RenderTexture.create({ width: 8, height: 8 });
  // Nearest-neighbor upscale preserves the hard pixel edges produced
  // by the step() in the shader.
  rt.source.scaleMode = 'nearest';

  const sprite = new Sprite(rt);
  sprite.eventMode = 'none';
  container.addChild(sprite);

  container._mesh = mesh;
  container._sprite = sprite;
  container._rt = rt;
  container._uniforms = (mesh as any)._uniformsGroup as UniformGroup;
  container._tempoAcumMs = 0;
  container._rtPxW = 8;
  container._rtPxH = 8;

  return container;
}

/**
 * Renders the starfield shader into its low-res RT for this frame and
 * positions the display Sprite to cover the viewport in world coords.
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
  const app = _appRef;
  if (!app) return; // Warmup not yet wired — skip this frame silently.

  // Resize RT to match current canvas divided by the resolution
  // divisor. Use screen pixels (not world units) so the RT always has
  // a predictable per-pixel detail level regardless of zoom.
  const dpr = (app.renderer as any).resolution ?? 1;
  const targetRtW = Math.max(8, Math.ceil(app.screen.width * dpr / RES_DIVISOR));
  const targetRtH = Math.max(8, Math.ceil(app.screen.height * dpr / RES_DIVISOR));
  if (fundo._rtPxW !== targetRtW || fundo._rtPxH !== targetRtH) {
    fundo._rt.resize(targetRtW, targetRtH);
    fundo._rtPxW = targetRtW;
    fundo._rtPxH = targetRtH;
    // Scale the unit quad to fill the RT in RT-local pixel space.
    fundo._mesh.scale.set(targetRtW, targetRtH);
  }

  // Cosmetic drift runs on a simple accumulator — real deltaMs isn't
  // needed since the effect is purely visual and tolerates jitter.
  fundo._tempoAcumMs += 16.67;

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

  // Draw the Mesh into the low-res RT. This is a tiny workload
  // compared to rendering the same shader at full viewport res.
  app.renderer.render({ container: fundo._mesh, target: fundo._rt });

  // Place the display Sprite in world space to exactly cover the
  // viewport. Nearest-neighbor filtering on the RT source makes the
  // upscale crunchy, matching the game's retro pixel aesthetic.
  const sprite = fundo._sprite;
  sprite.x = jogadorX - telaW / 2;
  sprite.y = jogadorY - telaH / 2;
  sprite.width = telaW;
  sprite.height = telaH;
}
