import { Container, Graphics as PixiGraphics } from 'pixi.js';
import type { Graphics as WeydraGraphics, Renderer as WeydraRenderer } from '@weydra/renderer';
import { getWeydraRenderer } from '../weydra-loader';
import { getConfig } from './config';

/**
 * GraphicsAdapter — bridges `Pixi.Graphics` and the weydra `Graphics`
 * facade so game code can write `.circle().stroke()` style chains
 * without branching on the M7 flag at every call site.
 *
 * M7 migration strategy: instead of touching every `.circle()` /
 * `.lineTo()` / `.stroke()` call (hundreds across `naves.ts`,
 * `combate-resolucao.ts`, `mundo.ts`), each `new Graphics()` site
 * is replaced with `createAdapter(weydraOpts)`. The adapter exposes
 * the same fluent subset the Pixi Graphics has and routes to either
 * a real `Pixi.Graphics` (when `weydra.graphics` is off) or a
 * `Weydra.Graphics` (when on).
 *
 * Properties used by the game that are Pixi-specific (`parent`,
 * `visible`, `transform`, `x`, `y`, `width`, `height`) are forwarded
 * to the underlying Pixi object when present, or no-op on the weydra
 * path. The weydra path doesn't need `parent` because graphics aren't
 * added to the Pixi container when `weydra.graphics` is on.
 *
 * @internal M7 — created by the migration in CP6+. Removed in M10
 * when Pixi is removed wholesale.
 */
export class GraphicsAdapter {
  /** @internal */
  readonly pixi: PixiGraphics | null;
  /** @internal */
  readonly weydra: WeydraGraphics | null;
  /** @internal */
  readonly renderer: WeydraRenderer | null;

  private constructor(
    pixi: PixiGraphics | null,
    weydra: WeydraGraphics | null,
    renderer: WeydraRenderer | null,
  ) {
    this.pixi = pixi;
    this.weydra = weydra;
    this.renderer = renderer;
  }

  static create(opts: { worldSpace: boolean; zOrder?: number } = { worldSpace: true }): GraphicsAdapter {
    const r = getWeydraRenderer();
    const useWeydra = getConfig().weydra.graphics && r !== null;
    if (useWeydra) {
      const g = r!.createGraphics(opts.worldSpace);
      if (opts.zOrder !== undefined) {
        g.zOrder = opts.zOrder;
      }
      return new GraphicsAdapter(null, g, r);
    }
    return new GraphicsAdapter(new PixiGraphics(), null, null);
  }

  // ─── Fluent drawing API — mirrors Pixi.Graphics subset ────────────────

  clear(): this {
    if (this.weydra) this.weydra.clear();
    else if (this.pixi) this.pixi.clear();
    return this;
  }

  circle(x: number, y: number, r: number): this {
    if (this.weydra) this.weydra.circle(x, y, r);
    else if (this.pixi) this.pixi.circle(x, y, r);
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    if (this.weydra) this.weydra.rect(x, y, w, h);
    else if (this.pixi) this.pixi.rect(x, y, w, h);
    return this;
  }

  roundRect(x: number, y: number, w: number, h: number, radius: number): this {
    if (this.weydra) this.weydra.roundRect(x, y, w, h, radius);
    else if (this.pixi) this.pixi.roundRect(x, y, w, h, radius);
    return this;
  }

  moveTo(x: number, y: number): this {
    if (this.weydra) this.weydra.moveTo(x, y);
    else if (this.pixi) this.pixi.moveTo(x, y);
    return this;
  }

  lineTo(x: number, y: number): this {
    if (this.weydra) this.weydra.lineTo(x, y);
    else if (this.pixi) this.pixi.lineTo(x, y);
    return this;
  }

  arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): this {
    if (this.weydra) this.weydra.arc(cx, cy, r, startAngle, endAngle);
    else if (this.pixi) this.pixi.arc(cx, cy, r, startAngle, endAngle);
    return this;
  }

  fill(opts: { color: number; alpha?: number }): this {
    if (this.weydra) this.weydra.fill(opts);
    else if (this.pixi) this.pixi.fill(opts);
    return this;
  }

  stroke(opts: { color: number; width: number; alpha?: number }): this {
    if (this.weydra) this.weydra.stroke(opts);
    else if (this.pixi) this.pixi.stroke(opts);
    return this;
  }

  // ─── Pixi-specific properties (no-op on weydra path) ──────────────────

  get visible(): boolean {
    return this.pixi ? this.pixi.visible : true;
  }
  set visible(v: boolean) {
    if (this.pixi) this.pixi.visible = v;
    // weydra Graphics: visibility is structural (no commands = no draw).
  }

  get alpha(): number {
    return this.pixi ? this.pixi.alpha : 1;
  }
  set alpha(v: number) {
    if (this.pixi) this.pixi.alpha = v;
    // weydra Graphics: per-instance alpha would need a uniform per
    // Graphics; not worth the complexity for the few use sites
    // (orbita fade) — fall through to the per-command color's alpha
    // baked into tessellation.
  }

  /** Pixi parent. weydra Graphics have no parent. */
  get parent(): unknown {
    return this.pixi ? this.pixi.parent : null;
  }

  /**
   * Pixi eventMode (`'none' | 'static' | 'dynamic'`). On the weydra path
   * this is a no-op — DOM events go through canvas listeners, not
   * Pixi containers (see M7 §Task 5).
   */
  set eventMode(mode: 'none' | 'static' | 'dynamic') {
    if (this.pixi) this.pixi.eventMode = mode;
  }

  /**
   * Attach this adapter to a Pixi container. Pixi path: forwards to
   * `parent.addChild(this.pixi)`. Weydra path: no-op (weydra Graphics
   * aren't part of the Pixi scene graph; they render directly to
   * the weydra canvas in their own `render()` pass).
   */
  attachTo(parent: Container): void {
    if (this.pixi) parent.addChild(this.pixi);
  }

  /**
   * Destroy this adapter. Pixi path: forwards to `this.pixi.destroy()`.
   * Weydra path: calls `Renderer.destroyGraphics` so the SlotMap
   * handle is freed (otherwise the weydra-side Graphics + GPU buffers
   * leak — see M7 review: GraphicsAdapter.destroy() leak).
   */
  destroy(): void {
    if (this.pixi) {
      this.pixi.destroy();
    } else if (this.weydra && this.renderer) {
      this.renderer.destroyGraphics(this.weydra);
    }
  }

  /**
   * On the Pixi path, this returns the Pixi Graphics so callers that
   * need Pixi-specific methods still work. On the weydra path, returns
   * `this` so the chain doesn't crash — callers that use the result
   * for Pixi-only operations are already disabled when the flag is on.
   */
  get raw(): PixiGraphics | GraphicsAdapter {
    return this.pixi ?? this;
  }
}