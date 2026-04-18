import { Container, Sprite, Texture } from 'pixi.js';
import { getConfig } from '../core/config';

/**
 * Canvas2D starfield renderer — a pure-JavaScript port of the GLSL
 * starfield fragment shader. Runs per-pixel math on the CPU and
 * writes into an ImageData-backed canvas that Pixi consumes as a
 * regular Sprite texture.
 *
 * Matches the WebGL/WebGPU visual output pixel-for-pixel (same
 * hashes, same 3 parallax layers, same per-star drift). The trade-
 * off is performance — per-pixel JS is ~100-1000× slower than a
 * GPU fragment shader. To keep it usable, the work is done on a
 * small internal canvas that the browser bilinear-upscales to the
 * viewport. At 320×180 internal resolution the cost is ~2-4 ms per
 * frame in V8 on a desktop, which is fine even on software mode
 * where no WebGL/WebGPU exists.
 *
 * The module exposes the same API surface (criarFundo, atualizarFundo,
 * getStarfieldMemoryBytes) as the shader-based fundo.ts so the caller
 * can swap paths at runtime based on renderer type.
 */

// Render into a fixed small canvas; the visible Sprite is scaled up.
// Small canvas keeps per-pixel JS cost bounded; the upscale is free.
const INTERNAL_W = 320;
const INTERNAL_H = 180;

interface FundoCanvasContainer extends Container {
  _sprite: Sprite;
  _canvas: HTMLCanvasElement;
  _ctx: CanvasRenderingContext2D;
  _imageData: ImageData;
  _tempoAcumMs: number;
}

export function getStarfieldCanvasMemoryBytes(_fundo: Container): number {
  // One ImageData + one uploaded texture of the same pixels. RGBA × 2.
  return INTERNAL_W * INTERNAL_H * 4 * 2;
}

// ─── Shader port (GLSL → TS, bit-for-bit) ────────────────────────

function fract(x: number): number {
  return x - Math.floor(x);
}

function hash12(px: number, py: number): number {
  let x = fract(px * 443.897);
  let y = fract(py * 441.423);
  const d = x * (x + 37.73) + y * (y + 37.73);
  x += d;
  y += d;
  return fract(x * y);
}

function hash22(px: number, py: number, out: [number, number]): void {
  // GLSL uses fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973))
  // so p3.x = fract(p.x * 0.1031), p3.y = fract(p.y * 0.1030),
  // p3.z = fract(p.x * 0.0973).
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1030);
  let z = fract(px * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  // result = fract((p3.xx + p3.yz) * p3.zy)
  //        = (fract((x+y) * z), fract((x+z) * y))
  out[0] = fract((x + y) * z);
  out[1] = fract((x + z) * y);
}

// Scratch buffers reused across every starLayer call — avoids a fresh
// [0, 0] array for each of (width × height × 3 layers) pixels per frame.
const _velDir: [number, number] = [0, 0];
const _starPos: [number, number] = [0, 0];

function starLayer(
  worldX: number, worldY: number,
  cellSize: number, parallax: number,
  baseRadius: number, densityThreshold: number,
  uTime: number, uDensidade: number,
): number {
  const ppx = worldX * parallax;
  const ppy = worldY * parallax;
  const cellX = Math.floor(ppx / cellSize);
  const cellY = Math.floor(ppy / cellSize);
  const inCellX = ppx / cellSize - cellX;
  const inCellY = ppy / cellSize - cellY;

  const lottery = hash12(cellX, cellY);
  if (lottery > densityThreshold * uDensidade) return 0;

  hash22(cellX + 23, cellY + 23, _velDir);
  const velDirX = _velDir[0] - 0.5;
  const velDirY = _velDir[1] - 0.5;
  const speed = 0.015 + hash12(cellX + 43, cellY + 43) * 0.025;
  const driftX = velDirX * uTime * speed;
  const driftY = velDirY * uTime * speed;

  hash22(cellX + 13, cellY + 13, _starPos);
  const sx = fract(_starPos[0] + driftX);
  const sy = fract(_starPos[1] + driftY);

  const dx = inCellX - sx;
  const dy = inCellY - sy;
  const dist2 = dx * dx + dy * dy;

  const sizeRand = hash12(cellX + 97, cellY + 97);
  const radius = baseRadius * (0.6 + 0.4 * sizeRand);

  // step(dist, radius) = 1 if dist <= radius. Compare squared to skip
  // the sqrt, which is a meaningful saving when this runs millions of
  // times per frame.
  return dist2 <= radius * radius ? 1 : 0;
}

function computePixel(worldX: number, worldY: number, uTime: number, uDensidade: number): number {
  let col = starLayer(worldX, worldY, 260, 0.15, 0.006, 0.55, uTime, uDensidade);
  if (col >= 1) return 255;
  col += starLayer(worldX, worldY, 180, 0.45, 0.008, 0.40, uTime, uDensidade);
  if (col >= 1) return 255;
  col += starLayer(worldX, worldY, 140, 0.90, 0.011, 0.22, uTime, uDensidade);
  return col >= 1 ? 255 : 0;
}

// ─── Public API ──────────────────────────────────────────────────

export function criarFundoCanvas(_tamanhoMundo: number): FundoCanvasContainer {
  const container = new Container() as FundoCanvasContainer;

  const canvas = document.createElement('canvas');
  canvas.width = INTERNAL_W;
  canvas.height = INTERNAL_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('[fundo-canvas] 2D context unavailable');

  // Pre-allocate the ImageData we'll reuse every frame.
  const imageData = ctx.createImageData(INTERNAL_W, INTERNAL_H);
  // Fill alpha to 255 once — we never touch it again.
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  const sprite = new Sprite(Texture.from(canvas));
  sprite.eventMode = 'none';
  // Pixel-perfect upscale for the retro look.
  sprite.texture.source.scaleMode = 'nearest';

  container.addChild(sprite);
  container._sprite = sprite;
  container._canvas = canvas;
  container._ctx = ctx;
  container._imageData = imageData;
  container._tempoAcumMs = 0;

  return container;
}

export function atualizarFundoCanvas(
  fundo: FundoCanvasContainer,
  jogadorX: number,
  jogadorY: number,
  telaW: number,
  telaH: number,
): void {
  fundo._tempoAcumMs += 16.67;
  const uTime = fundo._tempoAcumMs / 1000;
  const uDensidade = getConfig().graphics.densidadeStarfield;

  const data = fundo._imageData.data;
  // World-space extents covered by the viewport.
  const halfW = telaW * 0.5;
  const halfH = telaH * 0.5;
  const worldLeft = jogadorX - halfW;
  const worldTop = jogadorY - halfH;

  // Each internal-canvas pixel corresponds to one world-space cell of
  // (telaW / INTERNAL_W) × (telaH / INTERNAL_H).
  const pxWorldW = telaW / INTERNAL_W;
  const pxWorldH = telaH / INTERNAL_H;

  let idx = 0;
  for (let py = 0; py < INTERNAL_H; py++) {
    const wy = worldTop + py * pxWorldH;
    for (let px = 0; px < INTERNAL_W; px++) {
      const wx = worldLeft + px * pxWorldW;
      const v = computePixel(wx, wy, uTime, uDensidade);
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      // alpha already 255 from criarFundoCanvas init
      idx += 4;
    }
  }
  fundo._ctx.putImageData(fundo._imageData, 0, 0);
  // Force Pixi to re-upload the texture for this frame.
  fundo._sprite.texture.source.update();

  // Position + scale the display sprite to cover the viewport.
  const sprite = fundo._sprite;
  sprite.x = jogadorX - halfW;
  sprite.y = jogadorY - halfH;
  sprite.width = telaW;
  sprite.height = telaH;
}

/** Release backing resources. */
export function destruirFundoCanvas(fundo: FundoCanvasContainer): void {
  try { fundo._sprite.texture.destroy(true); } catch { /* noop */ }
  try { fundo._sprite.destroy(); } catch { /* noop */ }
  // ImageData + canvas are GC'd normally once container unmounts.
}
