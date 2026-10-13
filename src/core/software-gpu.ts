/**
 * Software-rasterizer detection, engine-agnostic.
 *
 * Lives in its own module (instead of `benchmark.ts`) because the weydra loader
 * needs it at boot: `benchmark.ts` pulls in the planet/star builders, which
 * import the weydra loader back, and a cycle there would be a boot-order
 * hazard. This module depends on nothing but the Pixi type.
 *
 * Why the scratch context: the active engine doesn't always expose GL info.
 * On weydra `app` is a shim with no renderer at all, and Pixi/WebGPU has no
 * `gl` either — which is why the SwiftShader/WARP/LLVMpipe warning and the
 * static-background fallback only ever fired on Pixi/WebGL. A throwaway WebGL
 * context reports the machine's unmasked strings regardless of the engine in
 * use (verified: SwiftShader and RADV strings both come through).
 */

export interface SoftwareDetection {
  isSoftware: boolean;
  kind: 'warp' | 'swiftshader' | 'llvmpipe' | 'canvas2d' | 'outro' | 'nenhum';
  /** Friendly name to show in the report / toast. */
  friendlyName: string;
}

/** Qualquer objeto com um `renderer` do Pixi (o profiler passa um shape solto de
 *  propósito, para não depender dos tipos do pixi.js). */
export type AppComRenderer = { renderer?: unknown } | null;

export interface RendererInfo {
  name: string;
  vendor: string;
  renderer: string;
}

const DESCONHECIDO: RendererInfo = { name: 'desconhecido', vendor: 'desconhecido', renderer: 'desconhecido' };

let _infoDescartavel: RendererInfo | null = null;

/** Renderer strings from a throwaway WebGL context (cached; context released). */
export function infoRendererDescartavel(): RendererInfo {
  if (_infoDescartavel) return _infoDescartavel;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    if (!gl) {
      _infoDescartavel = DESCONHECIDO;
      return DESCONHECIDO;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info: RendererInfo = {
      name: 'webgl-descartavel',
      vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : 'desconhecido',
      renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'desconhecido',
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    _infoDescartavel = info;
    return info;
  } catch {
    _infoDescartavel = DESCONHECIDO;
    return DESCONHECIDO;
  }
}

/** Renderer info from the live Pixi application (GL context or WebGPU adapter). */
export function coletarInfoRenderer(app: AppComRenderer): RendererInfo {
  const r = app?.renderer as
    | { name?: string; type?: string; gl?: WebGLRenderingContext; gpu?: { adapter?: GPUAdapter } }
    | undefined;
  let name = String(r?.name ?? r?.type ?? 'desconhecido');
  let vendor = 'desconhecido';
  let renderer = 'desconhecido';
  const gl = r?.gl;
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      vendor = (gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string) ?? vendor;
      renderer = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) ?? renderer;
    }
  }
  const adapter = r?.gpu?.adapter;
  if (adapter?.info) {
    vendor = adapter.info.vendor || vendor;
    renderer = adapter.info.description || adapter.info.device || adapter.info.architecture || renderer;
  }
  if (vendor === 'desconhecido' && renderer === 'desconhecido') {
    const alt = infoRendererDescartavel();
    if (name === 'desconhecido') name = alt.name;
    vendor = alt.vendor;
    renderer = alt.renderer;
  }
  return { name, vendor, renderer };
}

/**
 * Detect whether the active renderer is CPU-based software rasterization
 * (WARP on Windows, SwiftShader on Chromium, LLVMpipe on Linux Mesa, or the
 * Canvas2D fallback). These can't reach gameplay-viable framerates on anything
 * except extreme-low-res, so callers warn the user and pick cheaper paths.
 *
 * `app` may be null — the scratch-context fallback still answers for engines
 * that have no Pixi renderer (weydra).
 */
export function detectarRendererSoftware(app: AppComRenderer): SoftwareDetection {
  const info = coletarInfoRenderer(app);
  const name = info.name.toLowerCase();
  const renderer = info.renderer.toLowerCase();
  const vendor = info.vendor.toLowerCase();

  if (name.includes('canvas')) {
    return { isSoftware: true, kind: 'canvas2d', friendlyName: 'Canvas2D (CPU)' };
  }
  // Microsoft WARP — what Chrome on Windows falls back to when GPU
  // acceleration is disabled or the driver is blacklisted. The
  // string always contains 'Basic Render Driver'.
  if (renderer.includes('basic render driver') || renderer.includes('warp')) {
    return { isSoftware: true, kind: 'warp', friendlyName: 'Microsoft WARP' };
  }
  // Chromium's own software backend.
  if (renderer.includes('swiftshader') || vendor.includes('swiftshader') || vendor.includes('google swiftshader')) {
    return { isSoftware: true, kind: 'swiftshader', friendlyName: 'Google SwiftShader' };
  }
  // Linux Mesa software path.
  if (renderer.includes('llvmpipe') || renderer.includes('softpipe')) {
    return { isSoftware: true, kind: 'llvmpipe', friendlyName: 'Mesa LLVMpipe' };
  }
  // Generic "software" hint — rare but covers corner cases.
  if (renderer.includes('software') || vendor.includes('software')) {
    return { isSoftware: true, kind: 'outro', friendlyName: 'renderizador por software' };
  }
  return { isSoftware: false, kind: 'nenhum', friendlyName: '' };
}
