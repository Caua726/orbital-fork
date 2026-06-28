import { Text as PixiText } from 'pixi.js';
import { Text as WeydraText, FONT_SMALL, FONT_MEDIUM, FONT_LARGE } from '@weydra/renderer';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';

/**
 * M8 text helper. `criarText(content, fontSize, color)` returns an
 * object that mimics the Pixi `Text` API surface (text/x/y/visible
 * getters+setters) but routes writes to either the Pixi Graphics
 * path OR the weydra Text primitive, depending on `cfg.weydra.text`.
 *
 * The shape returned has a `_weydra` field with the underlying
 * weydra Text when applicable (so addChild/parent integration with
 * Pixi containers still works on the fallback path; on the weydra
 * path, the Text renders in its own render pass and doesn't need a
 * Pixi parent).
 */
export interface TextLike {
  text: string;
  x: number;
  y: number;
  visible: boolean;
  alpha: number;
  /**
   * Pixi-only getters. On the weydra path these return 0 (the text
   * atlas has no fixed per-string metrics — the layout is baked at
   * tessellation time). Used by `nevoa.ts` to size the info-bg
   * background and by the zoom scaler.
   */
  width?: number;
  height?: number;
  scale?: { set: (v: number) => void };
  /**
   * Pixi Text style — exposed as a property so call sites that
   * mutate `style.fill` etc. work on the Pixi fallback. On the
   * weydra path there's no runtime style (color is set at create
   * time), so this returns undefined and writes are no-ops.
   */
  style?: { fill?: number; fontSize?: number; fontFamily?: string };
  _weydra?: WeydraText;
  _pixi?: PixiText;
}

function fontIdxFor(fontSize: number): number {
  if (fontSize <= 13) return FONT_SMALL;
  if (fontSize <= 18) return FONT_MEDIUM;
  return FONT_LARGE;
}

export function criarText(
  content: string,
  fontSize: number,
  color: number,
): TextLike {
  if (getConfig().weydra.text) {
    const r = getWeydraRenderer();
    if (r) {
      const fontIdx = fontIdxFor(fontSize);
      // RGBA8 (with full alpha) — pack R/G/B/A into u32.
      const r8 = (color >> 16) & 0xff;
      const g8 = (color >> 8) & 0xff;
      const b8 = color & 0xff;
      const packed = ((r8 << 24) | (g8 << 16) | (b8 << 8) | 0xff) >>> 0;
      const t = r.createText(fontIdx, Math.max(64, content.length + 16), false);
      t.text = content;
      t.color = packed;
      // TextLike proxy with getters/setters that route to weydra.
      let _x = 0, _y = 0;
      const proxy: TextLike = {
        get text() { return t.text; },
        set text(v: string) { t.text = v; },
        get x() { return _x; },
        set x(v: number) { _x = v; t.x = v; },
        get y() { return _y; },
        set y(v: number) { _y = v; t.y = v; },
        get visible() { return t.visible; },
        set visible(v: boolean) { t.visible = v; },
        get alpha() { return 1; },  // weydra text ignores alpha (per-vertex color.a baked)
        set alpha(_v: number) { /* no-op — weydra text alpha comes from per-vertex color */ },
        _weydra: t,
      };
      return proxy;
    }
  }
  // Pixi fallback path. Identical to the pre-M8 `new Text({...})`.
  const pixiT = new PixiText({
    text: content,
    style: { fontSize, fill: color, fontFamily: 'monospace' },
  });
  const proxy: TextLike = {
    get text() { return pixiT.text; },
    set text(v: string) { pixiT.text = v; },
    get x() { return pixiT.x; },
    set x(v: number) { pixiT.x = v; },
    get y() { return pixiT.y; },
    set y(v: number) { pixiT.y = v; },
    get visible() { return pixiT.visible; },
    set visible(v: boolean) { pixiT.visible = v; },
    get alpha() { return pixiT.alpha; },
    set alpha(v: number) { pixiT.alpha = v; },
    get width() { return pixiT.width; },
    get height() { return pixiT.height; },
    get scale() { return pixiT.scale; },
    _pixi: pixiT,
  };
  return proxy;
}