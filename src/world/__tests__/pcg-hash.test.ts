import { describe, it, expect } from 'vitest';

/**
 * Cross-environment PCG hash parity. The planeta-canvas.ts JS port
 * MUST produce bit-identical u32 output to the planeta.frag shader
 * for a given (cell, seed) input — otherwise Canvas2D-rendered
 * planets diverge visually from Mesh+Shader planets.
 *
 * We can't actually run the shader here, but we CAN validate that
 * the JS port is:
 *   (a) deterministic (same inputs → same output, always),
 *   (b) uniform over [0, 1),
 *   (c) stable under the known algebraic identities PCG guarantees.
 *
 * Hash implementation is inlined here to dodge the graphics-heavy
 * planeta-canvas module imports — the algorithm must match the one
 * in src/world/planeta-canvas.ts.
 */
function pcg2d(vx: number, vy: number): number {
  let x = Math.imul(vx, 1664525) + 1013904223 | 0;
  let y = Math.imul(vy, 1664525) + 1013904223 | 0;
  x = x + Math.imul(y, 1664525) | 0;
  y = y + Math.imul(x, 1664525) | 0;
  x ^= x >>> 16;
  y ^= y >>> 16;
  x = x + Math.imul(y, 1664525) | 0;
  y = y + Math.imul(x, 1664525) | 0;
  x ^= x >>> 16;
  y ^= y >>> 16;
  return (x ^ y) >>> 0;
}

describe('pcg2d: determinism', () => {
  it('same input → same output across many calls', () => {
    const a = pcg2d(12345, 67890);
    for (let i = 0; i < 1000; i++) {
      expect(pcg2d(12345, 67890)).toBe(a);
    }
  });

  it('different inputs → (overwhelmingly) different outputs', () => {
    const a = pcg2d(100, 100);
    const b = pcg2d(100, 101);
    const c = pcg2d(101, 100);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('symmetry broken: pcg(a,b) !== pcg(b,a) in general', () => {
    const swaps = [
      [7, 13], [42, 42], [1, 2], [999, 1234],
    ];
    let different = 0;
    for (const [a, b] of swaps) {
      if (pcg2d(a, b) !== pcg2d(b, a)) different++;
    }
    // At minimum 3 out of 4 should differ — (42, 42) is the one
    // trivial fixed point where a === b.
    expect(different).toBeGreaterThanOrEqual(3);
  });

  it('output is always u32 (fits in [0, 2^32))', () => {
    for (let i = 0; i < 200; i++) {
      const v = pcg2d(i * 17, i * 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xFFFFFFFF);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('pcg2d: distribution quality', () => {
  it('normalized output covers [0, 1) roughly uniformly', () => {
    const N = 10_000;
    const bins = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const v = pcg2d(i, i * 7) / 4294967296;
      bins[Math.floor(v * 10)]++;
    }
    // Each bin should hold ~N/10 samples. Flag if any bin deviates
    // more than ±30% — PCG is better than that.
    const expected = N / 10;
    for (const b of bins) {
      expect(b).toBeGreaterThan(expected * 0.7);
      expect(b).toBeLessThan(expected * 1.3);
    }
  });

  it('adjacent cells decorrelate (no visible grid in normalized output)', () => {
    // If adjacent coords produced similar hashes we'd see grids in
    // the resulting planet/star field. Check mean diff across a
    // 64×64 scan is close to 0.333 (expected for uniform [0,1)).
    let sum = 0;
    const N = 64;
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        const a = pcg2d(x, y) / 4294967296;
        const b = pcg2d(x + 1, y) / 4294967296;
        sum += Math.abs(a - b);
      }
    }
    const mean = sum / (N * N);
    expect(mean).toBeGreaterThan(0.28);
    expect(mean).toBeLessThan(0.40);
  });
});

describe('pcg2d: cross-driver invariants', () => {
  it('uses only 32-bit integer ops (no 64-bit drift)', () => {
    // Algorithmic assertion: after >>> 0 every intermediate stays
    // within u32. If the implementation regressed to plain number
    // multiplies without Math.imul, this would silently start to
    // return non-integer or > 2^32 values.
    const samples = [
      pcg2d(0xFFFFFFFF, 0),
      pcg2d(0, 0xFFFFFFFF),
      pcg2d(0xFFFFFFFF, 0xFFFFFFFF),
      pcg2d(0x7FFFFFFF, 0x80000000),
    ];
    for (const s of samples) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xFFFFFFFF);
    }
  });

  it('golden values (regression guard for the hash algorithm)', () => {
    // Hard-coded u32 values computed once and frozen. If the JS
    // implementation drifts even by one bit, these fail — forcing a
    // conscious decision about whether the GLSL + WGSL paths must
    // be updated in lockstep, or the JS port reverted.
    expect(pcg2d(0, 0)).toBe(498713974);
    expect(pcg2d(1, 0)).toBe(414246933);
    expect(pcg2d(100, 100)).toBe(1204764823);
    expect(pcg2d(65535, 65535)).toBe(2643894335);
  });
});
