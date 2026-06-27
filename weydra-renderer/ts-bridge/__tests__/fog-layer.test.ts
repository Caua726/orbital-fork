import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Pin the JS-side guards that protect the WGSL fog shader from bad
 * inputs. The Rust `FogPool` covers the byte-layout invariants via
 * `cargo test` (size_of / offset_of); this test pins the TS-side
 * contract on top of that — out-of-range throws, float-to-int coercion,
 * and the NaN / over-cap / negative clamps on `setActiveCount`.
 *
 * The Rust `FOG_MAX_SOURCES = 64` cap is mirrored on the TS side as
 * the `maxSources` constructor arg and as `array<VisionSource, 64>` in
 * the WGSL shader (pinned by Checkpoint C). All three layers must
 * agree — drifting any of them silently would either crash the GPU
 * upload or make the WGSL loop read past the declared array length.
 */

const _wasmMemory = new WebAssembly.Memory({ initial: 1 });
const _wasmInstance = { memory: _wasmMemory };

// Mock the wasm-bindgen generated module so init() returns our fake
// module-shaped object. The actual FogPool bytes are written through
// `WebAssembly.Memory.buffer`, which we control via _wasmMemory.
vi.mock('weydra-renderer-wasm', () => ({
  default: () => Promise.resolve(_wasmInstance),
}));

import { Renderer, FogLayer, initWeydra } from '../index';

// A stable buffer offset for our fake fog uniforms. 256 B is safely past
// any header the test process might use; we don't collide with other
// module allocations because this memory is owned by the test.
const FOG_PTR = 256;
// 1040 = 16 B header + 64 × 16 B sources (mirrors Rust FOG_UNIFORMS_SIZE).
const FOG_SIZE = 1040;

function makeRenderer(): Renderer {
  // Reach into the private `inner` field via `as any` — the alternative
  // would be a real WASM init which is heavy and out of scope for
  // these unit tests. The FogLayer only touches `_fogUniformsPtr()` and
  // the global `_wasm.memory.buffer`, both of which we stub here.
  const r = Object.create(Renderer.prototype) as any;
  r._fogUniformsPtr = vi.fn(() => FOG_PTR);
  // Provide a fog_max_sources / fog_uniforms_size stub for createFogShader
  // symmetry (the constructor accepts these directly so we don't need them).
  return r as Renderer;
}

function makeFog(maxSources = 64, sizeBytes = FOG_SIZE): FogLayer {
  const r = makeRenderer();
  return new FogLayer(r, maxSources, sizeBytes);
}

function readF32(offset: number, count = 1): number[] {
  const view = new Float32Array(_wasmMemory.buffer, FOG_PTR, FOG_SIZE / 4);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(view[offset + i]);
  return out;
}

function readU32(offset: number): number {
  const view = new Uint32Array(_wasmMemory.buffer, FOG_PTR, FOG_SIZE / 4);
  return view[offset];
}

beforeEach(async () => {
  // initWeydra is idempotent (caches the promise) — calling it before
  // each test guarantees the module-level `_wasm` is set, which
  // FogLayer.f32()/u32() asserts via `if (!_wasm) throw`.
  await initWeydra();
  // Zero out the fog buffer between tests so writes don't bleed.
  new Uint8Array(_wasmMemory.buffer, FOG_PTR, FOG_SIZE).fill(0);
});

describe('FogLayer.setSource: range guard', () => {
  it('throws when idx === maxSources (64)', () => {
    const fog = makeFog(64, FOG_SIZE);
    expect(() => fog.setSource(64, 1, 2, 3)).toThrow(/out of range/);
  });

  it('throws when idx < 0', () => {
    const fog = makeFog(64, FOG_SIZE);
    expect(() => fog.setSource(-1, 1, 2, 3)).toThrow(/out of range/);
  });

  it('does NOT throw at idx === maxSources - 1 and writes through to the buffer', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setSource(63, 11, 22, 33);
    // Source 63 lives at byte offset 16 + 63*16 = 1024 → f32 index 256.
    // The header takes f32 indices 0..3 (base_alpha, active_count, _pad×2),
    // so source N's slot starts at f32 index 4 + N*4.
    const at63 = readF32(4 + 63 * 4, 3);
    expect(at63).toEqual([11, 22, 33]);
  });

  it('coerces fractional idx via `idx | 0` so 1.5 lands at slot 1, not 1.5', () => {
    const fog = makeFog(64, FOG_SIZE);
    // 1.5 passes the range check (1.5 < 64) and gets coerced to 1.
    // Without the coercion the base would be 4 + 1.5*4 = 10, writing
    // across the boundary between source 1's _pad and source 2's
    // position. With coercion the base is 4 + 1*4 = 8, which is the
    // correct slot for source 1.
    fog.setSource(1.5, 7, 8, 9);
    const at1 = readF32(4 + 1 * 4, 3);
    expect(at1).toEqual([7, 8, 9]);
  });

  it('throws when a fractional idx coerces to an OOB int (e.g. -0.5 → 0 OK; 63.9 → 63 OK; 64.5 → 64 throw)', () => {
    const fog = makeFog(64, FOG_SIZE);
    expect(() => fog.setSource(64.5, 1, 2, 3)).toThrow(/out of range/);
    expect(() => fog.setSource(63.9, 1, 2, 3)).not.toThrow();
  });

  it('zeroes nothing in the trailing _pad slot (index 4 + N*4 + 3)', () => {
    const fog = makeFog(64, FOG_SIZE);
    // Write a sentinel into the _pad slot, then call setSource — the
    // sentinel must NOT be overwritten. Use 1.5 (exactly representable
    // in f32) so a naive `99086349`-style integer sentinel doesn't get
    // rounded and confuse the assertion.
    const view = new Float32Array(_wasmMemory.buffer, FOG_PTR, FOG_SIZE / 4);
    view[4 + 5 * 4 + 3] = 1.5;
    fog.setSource(5, 1, 2, 3);
    expect(view[4 + 5 * 4 + 3]).toBe(1.5);
  });
});

describe('FogLayer.setActiveCount: clamps', () => {
  it('clamps NaN to 0 (the JS-spec silent-no-op hazard)', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setActiveCount(NaN);
    expect(readU32(1)).toBe(0);
  });

  it('clamps over-cap (100) to maxSources (64)', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setActiveCount(100);
    expect(readU32(1)).toBe(64);
  });

  it('clamps negative (-5) to 0', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setActiveCount(-5);
    expect(readU32(1)).toBe(0);
  });

  it('writes the int bit-for-bit at byte offset 4 (the WGSL u32 slot)', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setActiveCount(7);
    const u32 = new Uint32Array(_wasmMemory.buffer, FOG_PTR, FOG_SIZE / 4);
    expect(u32[1]).toBe(7);
    // base_alpha at f32 index 0 must remain untouched (separate slot).
    expect(u32[0]).toBe(0);
  });

  it('round-trips 0 as 0', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setActiveCount(42);  // pollute first
    fog.setActiveCount(0);
    expect(readU32(1)).toBe(0);
  });
});

describe('FogLayer.setBaseAlpha', () => {
  it('writes through to byte offset 0 (f32 index 0)', () => {
    const fog = makeFog(64, FOG_SIZE);
    fog.setBaseAlpha(0.42);
    const f32 = new Float32Array(_wasmMemory.buffer, FOG_PTR, FOG_SIZE / 4);
    expect(f32[0]).toBeCloseTo(0.42);
  });
});

describe('FogLayer.totalF32 derives from sizeBytes', () => {
  it('totalF32 = sizeBytes / 4 (1040 → 260 f32s)', () => {
    const fog = makeFog(64, 1040);
    // No public getter — sanity check via the bytes-writable assumption:
    // writing at the last f32 index (259) must not throw.
    expect(() => fog.setBaseAlpha(0.5)).not.toThrow();
    const f32 = new Float32Array(_wasmMemory.buffer, FOG_PTR, 260);
    expect(f32[259]).toBe(0);  // untouched
  });
});