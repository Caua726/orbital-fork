import { Container, Sprite, Texture } from 'pixi.js';
import { getConfig } from '../core/config';
import { getZoom } from '../core/player';
import { desenharStarfieldCpu } from './starfield-cpu';

/**
 * Canvas2D starfield for the Pixi `canvas` backend: the per-star CPU port
 * (starfield-cpu.ts) drawn at screen resolution into a canvas that Pixi
 * shows as a Sprite. Same API surface as the shader path in fundo.ts.
 */

interface FundoCanvasContainer extends Container {
  _sprite: Sprite;
  _canvas: HTMLCanvasElement;
  _ctx: CanvasRenderingContext2D;
  _tempoAcumMs: number;
  /** Bright-star tile (fundo.ts gerarBrightTile), repeated with parallax. */
  _brightCanvas?: HTMLCanvasElement;
  _brightPattern?: CanvasPattern | null;
  /** Layers to draw — set by the render-matrix layer mask (both layers live
   *  in this one canvas). Undefined = both. */
  _camadas?: { starfield: boolean; bright: boolean };
}

/** Parallax of the bright layer — same as fundo.ts (TilingSprite path). */
const BRIGHT_PARALLAX = 0.12;

export function getStarfieldCanvasMemoryBytes(fundo: Container): number {
  const c = (fundo as FundoCanvasContainer)._canvas;
  // Canvas pixels + the texture Pixi keeps of them. RGBA × 2.
  return c ? c.width * c.height * 4 * 2 : 0;
}

// ─── Public API ──────────────────────────────────────────────────

export function criarFundoCanvas(_tamanhoMundo: number): FundoCanvasContainer {
  const container = new Container() as FundoCanvasContainer;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('[fundo-canvas] 2D context unavailable');

  const sprite = new Sprite(Texture.from(canvas));
  sprite.eventMode = 'none';
  sprite.texture.source.scaleMode = 'nearest';

  container.addChild(sprite);
  container._sprite = sprite;
  container._canvas = canvas;
  container._ctx = ctx;
  container._tempoAcumMs = 0;

  return container;
}

/**
 * Redraws the starfield for the camera. `tempoSeg` is the shared starfield
 * clock (fundo.ts — pinned by the render-matrix harness).
 */
export function atualizarFundoCanvas(
  fundo: FundoCanvasContainer,
  jogadorX: number,
  jogadorY: number,
  telaW: number,
  telaH: number,
  tempoSeg: number,
): void {
  // One canvas pixel per screen pixel (canvas backend renders at resolution 1).
  const zoom = getZoom() || 1;
  const cw = Math.max(1, Math.round(telaW * zoom));
  const ch = Math.max(1, Math.round(telaH * zoom));
  const canvas = fundo._canvas;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
    fundo._sprite.texture.source.resize(cw, ch);
  }
  const ctx = fundo._ctx;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  const camadas = fundo._camadas ?? { starfield: true, bright: true };
  if (camadas.starfield) {
    desenharStarfieldCpu(ctx, cw, ch, jogadorX, jogadorY, telaW, telaH, tempoSeg, getConfig().graphics.densidadeStarfield);
  }
  if (camadas.bright && fundo._brightCanvas) {
    // A TilingSprite with tilePosition = -camera·(1-parallax) samples the
    // tile at (local + camera·(1-parallax)); one world unit = `zoom` px.
    fundo._brightPattern ??= ctx.createPattern(fundo._brightCanvas, 'repeat');
    const pattern = fundo._brightPattern;
    if (pattern) {
      // Canvas px u shows tile texel u/zoom + camera·(1-parallax).
      pattern.setTransform(new DOMMatrix([zoom, 0, 0, zoom,
        -jogadorX * (1 - BRIGHT_PARALLAX) * zoom,
        -jogadorY * (1 - BRIGHT_PARALLAX) * zoom]));
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cw, ch);
    }
  }
  // Force Pixi to re-upload the texture for this frame.
  fundo._sprite.texture.source.update();

  // Position + scale the display sprite to cover the viewport.
  const sprite = fundo._sprite;
  sprite.x = jogadorX - telaW * 0.5;
  sprite.y = jogadorY - telaH * 0.5;
  sprite.width = telaW;
  sprite.height = telaH;
}

/** Release backing resources. */
export function destruirFundoCanvas(fundo: FundoCanvasContainer): void {
  try { fundo._sprite.texture.destroy(true); } catch { /* noop */ }
  try { fundo._sprite.destroy(); } catch { /* noop */ }
  // ImageData + canvas are GC'd normally once container unmounts.
}
