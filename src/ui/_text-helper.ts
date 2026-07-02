import { Text as PixiText } from 'pixi.js';
import { Text as WeydraText, FONT_SMALL, FONT_MEDIUM, FONT_LARGE } from '@weydra/renderer';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';

/**
 * M8 text helper. `criarText(content, fontSize, color)` returns a
 * proxy that mimics the Pixi `Text` API surface (text/x/y/visible/
 * alpha/style/anchor getters+setters) but routes writes to either
 * the Pixi Graphics path OR the weydra Text primitive, depending
 * on `cfg.weydra.text`.
 *
 * On the weydra path: writes to .style and .anchor are no-ops (the
 * weydra text's color is immutable post-create; the origin is fixed
 * at top-left). The getters still return stub objects so call sites
 * don't need optional-chaining.
 *
 * `_pixi` exposes the underlying Pixi Text for `addChild` / `removeChild`
 * integration with the Pixi container tree. On the weydra path the
 * text renders in its own pass and doesn't need a Pixi parent.
 */
export interface TextLike {
  text: string;
  x: number;
  y: number;
  visible: boolean;
  alpha: number;
  width: number;
  height: number;
  scale?: number;
  color?: number;
  style: PixiText['style'];
  anchor: PixiText['anchor'];
  _weydra?: WeydraText;
  _pixi?: PixiText;
}

function fontIdxFor(fontSize: number): number {
  if (fontSize <= 13) return FONT_SMALL;
  if (fontSize <= 18) return FONT_MEDIUM;
  return FONT_LARGE;
}

function emptyStyle(): PixiText['style'] {
  // Stubs for the weydra path so .style.fill = X typechecks. Writes to
  // these fields are silently dropped on the weydra path (color is
  // immutable post-create).
  return { fill: 0xffffff, fontSize: 12, fontFamily: 'monospace' } as PixiText['style'];
}

function emptyAnchor(): PixiText['anchor'] {
  return { x: 0, y: 0 } as PixiText['anchor'];
}

export function criarText(
  content: string,
  fontSize: number,
  color: number,
  worldSpace: boolean = false,
): TextLike {
  if (getConfig().weydra.text) {
    const r = getWeydraRenderer();
    if (r) {
      const fontIdx = fontIdxFor(fontSize);
      // Baked px size of each atlas (Silkscreen 12/16, VT323 24). The
      // requested fontSize is matched by scaling the glyphs — 11px on the
      // 12px atlas renders at 11/12 scale. Composes with the caller-driven
      // scale (e.g. the fog labels' counter-zoom). Without this, 9px and
      // 11px labels both rendered at a flat 12px (size hierarchy lost).
      const ATLAS_PX = [12, 16, 24];
      const sizeFactor = fontSize / (ATLAS_PX[fontIdx] ?? 12);
      let _rgb = color & 0xffffff;
      let _alpha = 1;
      let _userScale = 1;
      const t = r.createText(fontIdx, Math.max(64, content.length + 16), worldSpace);
      // RGBA8 — R/G/B from the rgb value, the REAL alpha in the low byte
      // (the shader multiplies by it; packing a hard 0xff made every label
      // fully opaque, e.g. the fog ghost's 0.47 dimming was dropped).
      const repack = (): void => {
        const r8 = (_rgb >> 16) & 0xff;
        const g8 = (_rgb >> 8) & 0xff;
        const b8 = _rgb & 0xff;
        const a8 = Math.max(0, Math.min(255, Math.round(_alpha * 255)));
        t.color = ((r8 << 24) | (g8 << 16) | (b8 << 8) | a8) >>> 0;
      };
      t.text = content;
      repack();
      t.scale = sizeFactor;
      let _x = 0;
      let _y = 0;
      const proxy: TextLike = {
        get text() { return t.text; },
        set text(v: string) { t.text = v; },
        get x() { return _x; },
        set x(v: number) { _x = v; t.x = v; },
        get y() { return _y; },
        set y(v: number) { _y = v; t.y = v; },
        get visible() { return t.visible; },
        set visible(v: boolean) { t.visible = v; },
        get alpha() { return _alpha; },
        set alpha(v: number) {
          if (v === _alpha) return;
          _alpha = v;
          repack();
        },
        get width() { return r.getTextWidth(t); },
        get height() { return 0; },
        // Caller-facing scale is the USER scale; the atlas-size compensation
        // factor is folded in transparently.
        set scale(v: number) { _userScale = v; t.scale = sizeFactor * v; },
        get scale() { return _userScale; },
        // Pixi-style RGB (matches the Pixi proxy's `style.fill = v`); the
        // current alpha is preserved. The old setter passed the RGB straight
        // through as packed RGBA — the blue byte landed in the alpha slot.
        set color(v: number) { _rgb = v & 0xffffff; repack(); },
        get color() { return _rgb; },
        get style() { return emptyStyle(); },
        set style(_v: PixiText['style']) { /* weydra px_size is baked at atlas create */ },
        get anchor() { return emptyAnchor(); },
        set anchor(_v: PixiText['anchor']) { /* weydra origin is top-left */ },
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
    get scale() { return pixiT.scale.x; },
    set scale(v: number) { pixiT.scale.set(v); },
    set color(v: number) { pixiT.style.fill = v; },
    get color() { return pixiT.style.fill as number; },
    get style() { return pixiT.style; },
    set style(v: PixiText['style']) { pixiT.style = v; },
    get anchor() { return pixiT.anchor; },
    set anchor(v: PixiText['anchor']) { pixiT.anchor = v; },
    _pixi: pixiT,
  };
  return proxy;
}
