import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Pin the JS-side contract of the M7 Graphics facade — the fluent
 * `.circle().fill()` / `.rect().stroke()` chain, the pending-state
 * resolver, the 0xRR_GG_BB_AA color packer, and the z-order setter.
 *
 * Mirrors the pattern from fog-layer.test.ts: mock the wasm-bindgen
 * module with a real WebAssembly.Memory and stubbed renderer methods,
 * then construct Graphics via the public Renderer.createGraphics
 * facade (not by reaching into private internals).
 */

const _wasmMemory = new WebAssembly.Memory({ initial: 1 });
const _wasmInstance = { memory: _wasmMemory };

// Spy storage — we don't run a real wasm module, so each wasm method
// is a vi.fn() that records its arguments. Tests assert on these.
const _calls: { method: string; args: unknown[] }[] = [];

function makeSpy(methodName: string) {
  return vi.fn((...args: unknown[]) => {
    _calls.push({ method: methodName, args });
    if (methodName === 'create_graphics') return 1n;
    return undefined;
  });
}

vi.mock('weydra-renderer-wasm', () => ({
  default: () => Promise.resolve(_wasmInstance),
}));

import { Renderer, Graphics, COLOR_NONE } from '../index';

beforeEach(() => {
  _calls.length = 0;
});

function makeRenderer(): Renderer {
  // Bypass the async `Renderer.create` factory — fabricate the renderer
  // with stubs for every wasm-bindgen call Graphics touches. This keeps
  // tests fast and free of GPU init.
  const r = Object.create(Renderer.prototype) as any;
  r.inner = {
    create_graphics_shader: vi.fn(),
    create_graphics: makeSpy('create_graphics'),
    destroy_graphics: makeSpy('destroy_graphics'),
    graphics_clear: makeSpy('graphics_clear'),
    graphics_circle: makeSpy('graphics_circle'),
    graphics_rect: makeSpy('graphics_rect'),
    graphics_round_rect: makeSpy('graphics_round_rect'),
    graphics_line: makeSpy('graphics_line'),
    graphics_arc: makeSpy('graphics_arc'),
    graphics_set_z_order: makeSpy('graphics_set_z_order'),
    graphics_set_translation: makeSpy('graphics_set_translation'),
    graphics_set_visible: makeSpy('graphics_set_visible'),
    graphics_set_alpha: makeSpy('graphics_set_alpha'),
    create_fog_shader: vi.fn(),
    fog_uniforms_ptr: () => 0,
    fog_uniforms_size: () => 0,
    fog_max_sources: () => 64,
    mem_version: () => 0,
  };
  r.graphicsClear = (h: bigint) => r.inner.graphics_clear(h);
  r.graphicsCircle = (h: bigint, x: number, y: number, rad: number, fill: number, stroke: number, sw: number) =>
    r.inner.graphics_circle(h, x, y, rad, fill, stroke, sw);
  r.graphicsRect = (h: bigint, x: number, y: number, w: number, rh: number, fill: number, stroke: number, sw: number) =>
    r.inner.graphics_rect(h, x, y, w, rh, fill, stroke, sw);
  r.graphicsRoundRect = (h: bigint, x: number, y: number, w: number, rh: number, radius: number, fill: number, stroke: number, sw: number) =>
    r.inner.graphics_round_rect(h, x, y, w, rh, radius, fill, stroke, sw);
  r.graphicsLine = (h: bigint, x1: number, y1: number, x2: number, y2: number, w: number, c: number) =>
    r.inner.graphics_line(h, x1, y1, x2, y2, w, c);
  r.graphicsArc = (h: bigint, cx: number, cy: number, rad: number, s: number, e: number, w: number, c: number) =>
    r.inner.graphics_arc(h, cx, cy, rad, s, e, w, c);
  r.destroyGraphics = (g: Graphics) => r.inner.destroy_graphics(g.handle);
  r.setGraphicsZOrder = (h: bigint, z: number) => r.inner.graphics_set_z_order(h, z);
  r.setGraphicsTranslation = (h: bigint, x: number, y: number) => r.inner.graphics_set_translation(h, x, y);
  r.setGraphicsVisible = (h: bigint, v: boolean) => r.inner.graphics_set_visible(h, v);
  r.setGraphicsAlpha = (h: bigint, a: number) => r.inner.graphics_set_alpha(h, a);
  return r as Renderer;
}

describe('Graphics: fluent circle + fill/stroke', () => {
  it('circle().fill() calls graphics_circle with fill_rgba, stroke=0', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.circle(10, 20, 5).fill({ color: 0xff0000, alpha: 1 });

    const call = _calls.find(c => c.method === 'graphics_circle');
    expect(call).toBeDefined();
    // Args: (handle, x, y, r, fill_rgba, stroke_rgba, stroke_width)
    expect(call!.args[1]).toBe(10);
    expect(call!.args[2]).toBe(20);
    expect(call!.args[3]).toBe(5);
    // fill_rgba: 0xRR_GG_BB_AA — R=ff, G=00, B=00, A=ff (alpha 1 → 255)
    expect(call!.args[4]).toBe(0xff0000ff);
    expect(call!.args[5]).toBe(COLOR_NONE);
    expect(call!.args[6]).toBe(0);
  });

  it('circle().stroke() calls graphics_circle with fill=0, stroke_rgba + width', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.circle(0, 0, 10).stroke({ color: 0x00ff00, width: 3, alpha: 0.5 });

    const call = _calls.find(c => c.method === 'graphics_circle');
    expect(call).toBeDefined();
    expect(call!.args[4]).toBe(COLOR_NONE);  // no fill
    // stroke_rgba: 0x00_ff_00_7f (alpha 0.5 → 127)
    expect(call!.args[5]).toBe(0x00ff007f);
    expect(call!.args[6]).toBe(3);
  });

  it('rect().fill() routes to graphics_rect, not graphics_circle', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.rect(1, 2, 3, 4).fill({ color: 0xffffff });

    expect(_calls.some(c => c.method === 'graphics_rect')).toBe(true);
    expect(_calls.some(c => c.method === 'graphics_circle')).toBe(false);

    const call = _calls.find(c => c.method === 'graphics_rect')!;
    expect(call.args[1]).toBe(1);   // x
    expect(call.args[2]).toBe(2);   // y
    expect(call.args[3]).toBe(3);   // w
    expect(call.args[4]).toBe(4);   // h
  });

  it('roundRect().fill() routes to graphics_round_rect with radius', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.roundRect(1, 2, 10, 20, 4).fill({ color: 0xaabbcc });

    const call = _calls.find(c => c.method === 'graphics_round_rect')!;
    expect(call.args[5]).toBe(4); // radius
  });
});

describe('Graphics: color packing (0xRR_GG_BB_AA)', () => {
  it('packs 0xRRGGBB at full alpha', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.circle(0, 0, 1).fill({ color: 0xff8040, alpha: 1 });

    const call = _calls.find(c => c.method === 'graphics_circle')!;
    // R=ff, G=80, B=40, A=ff
    expect(call.args[4]).toBe(0xff8040ff >>> 0);
  });

  it('packs 0xRRGGBB at alpha 0.5 → AA byte = 127', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.circle(0, 0, 1).fill({ color: 0xff0000, alpha: 0.5 });

    const call = _calls.find(c => c.method === 'graphics_circle')!;
    expect(call.args[4]).toBe(0xff00007f);
  });

  it('clamps alpha 1.5 → 255 (does not overflow byte)', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.circle(0, 0, 1).fill({ color: 0xffffff, alpha: 1.5 });

    const call = _calls.find(c => c.method === 'graphics_circle')!;
    // A must be 255, not 382 (1.5 * 255).
    expect(call.args[4]).toBe(0xffffffff);
  });
});

describe('Graphics: pending state resolver', () => {
  it('shape without fill()/stroke() is silently dropped (with dev warn)', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    // Two shapes back-to-back, neither resolved.
    g.circle(0, 0, 5).circle(10, 10, 5).fill({ color: 0xffffff });

    // Only the LAST circle gets the fill — the first is dropped.
    const call = _calls.find(c => c.method === 'graphics_circle')!;
    expect(call.args[1]).toBe(10);   // x of second circle
    expect(call.args[2]).toBe(10);   // y of second circle
    expect(call.args[3]).toBe(5);    // r of second circle
  });

  it('clear() resets pending state and calls graphics_clear', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.circle(0, 0, 5).clear();  // pending circle should be dropped
    g.fill({ color: 0xff0000 }); // fill with no pending shape — no-op

    expect(_calls.some(c => c.method === 'graphics_clear')).toBe(true);
    expect(_calls.some(c => c.method === 'graphics_circle')).toBe(false);
  });
});

describe('Graphics: arc + polyline', () => {
  it('arc().stroke() calls graphics_arc with start/end angles', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.arc(0, 0, 10, 0, Math.PI).stroke({ color: 0xffffff, width: 2 });

    const call = _calls.find(c => c.method === 'graphics_arc')!;
    expect(call.args[1]).toBe(0);  // cx
    expect(call.args[2]).toBe(0);  // cy
    expect(call.args[3]).toBe(10); // r
    expect(call.args[4]).toBe(0);  // start
    expect(call.args[5]).toBeCloseTo(Math.PI); // end
    expect(call.args[6]).toBe(2);  // width
  });

  it('moveTo + lineTo + stroke flushes one graphics_line PER SEGMENT', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.moveTo(0, 0).lineTo(10, 10).lineTo(20, 5).stroke({ color: 0xff0000, width: 1 });

    // Polyline flushes as N graphics_line calls, one per segment.
    // (0,0)→(10,10) and (10,10)→(20,5) = 2 segments.
    expect(_calls.filter(c => c.method === 'graphics_line').length).toBe(2);

    const calls = _calls.filter(c => c.method === 'graphics_line');
    expect(calls[0].args[1]).toBe(0);   // x1
    expect(calls[0].args[2]).toBe(0);   // y1
    expect(calls[0].args[3]).toBe(10);  // x2
    expect(calls[0].args[4]).toBe(10);  // y2
    expect(calls[1].args[1]).toBe(10);  // x1 (continues from previous)
    expect(calls[1].args[2]).toBe(10);  // y1
    expect(calls[1].args[3]).toBe(20);  // x2
    expect(calls[1].args[4]).toBe(5);   // y2
  });
});

describe('Graphics: z-order', () => {
  it('zOrder setter calls graphics_set_z_order', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    g.zOrder = 25;

    const call = _calls.find(c => c.method === 'graphics_set_z_order')!;
    expect(call.args[1]).toBe(25);
  });
});

describe('Graphics: lifecycle', () => {
  it('createGraphics returns a Graphics with the handle as bigint', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    expect(g).toBeInstanceOf(Graphics);
    expect(typeof g.handle).toBe('bigint');
    expect(g.handle).toBe(1n);
    expect(g.worldSpace).toBe(true);
  });

  it('destroyGraphics calls destroy_graphics with the handle', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);

    r.destroyGraphics(g);

    const call = _calls.find(c => c.method === 'destroy_graphics')!;
    expect(call.args[0]).toBe(g.handle);
  });
});

describe('Graphics: per-instance translation (mirrors Pixi container x/y)', () => {
  it('x setter calls graphics_set_translation(handle, x, y) with current y', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.x = 42;
    const call = _calls.find(c => c.method === 'graphics_set_translation')!;
    expect(call.args[0]).toBe(g.handle);
    expect(call.args[1]).toBe(42);
    expect(call.args[2]).toBe(0); // y still default
    expect(g.x).toBe(42);         // getter round-trips
  });

  it('y setter preserves the previously-set x', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.x = 10;
    g.y = 20;
    const last = [..._calls].reverse().find(c => c.method === 'graphics_set_translation')!;
    expect(last.args[1]).toBe(10);
    expect(last.args[2]).toBe(20);
    expect(g.y).toBe(20);
  });

  it('setPosition sets both components in ONE wasm call', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.setPosition(3, 4);
    const calls = _calls.filter(c => c.method === 'graphics_set_translation');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toBe(3);
    expect(calls[0].args[2]).toBe(4);
    expect(g.x).toBe(3);
    expect(g.y).toBe(4);
  });
});

describe('Graphics: visibility (O(1) draw-loop skip)', () => {
  it('visible = false calls graphics_set_visible(handle, false)', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.visible = false;
    const call = _calls.find(c => c.method === 'graphics_set_visible')!;
    expect(call.args[0]).toBe(g.handle);
    expect(call.args[1]).toBe(false);
    expect(g.visible).toBe(false);
  });

  it('defaults to visible=true and does not call wasm redundantly', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    expect(g.visible).toBe(true);
    // Setting the same value it already holds must NOT cross the wasm boundary.
    g.visible = true;
    expect(_calls.some(c => c.method === 'graphics_set_visible')).toBe(false);
  });

  it('coalesces repeated identical toggles into one wasm call', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.visible = false;
    g.visible = false; // no-op (already false)
    g.visible = false;
    const calls = _calls.filter(c => c.method === 'graphics_set_visible');
    expect(calls).toHaveLength(1);
  });
});

describe('Graphics: per-instance alpha (mirrors Pixi container .alpha)', () => {
  it('alpha setter calls graphics_set_alpha(handle, v)', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.alpha = 0.18;
    const call = _calls.find(c => c.method === 'graphics_set_alpha')!;
    expect(call.args[0]).toBe(g.handle);
    expect(call.args[1]).toBeCloseTo(0.18);
    expect(g.alpha).toBeCloseTo(0.18);
  });

  it('defaults to alpha=1 and does not cross the wasm boundary redundantly', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    expect(g.alpha).toBe(1);
    g.alpha = 1; // same as default — no wasm call
    expect(_calls.some(c => c.method === 'graphics_set_alpha')).toBe(false);
  });

  it('coalesces repeated identical alpha writes into one wasm call', () => {
    const r = makeRenderer();
    const g = r.createGraphics(true);
    g.alpha = 0.5;
    g.alpha = 0.5; // no-op
    g.alpha = 0.5;
    const calls = _calls.filter(c => c.method === 'graphics_set_alpha');
    expect(calls).toHaveLength(1);
  });
});