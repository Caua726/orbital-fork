import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source-level shader parity. WebGL2 (GLSL) and WebGPU (WGSL) paths
 * MUST use the same algorithm + same tuning constants, otherwise a
 * user with WebGPU sees one visual and a user with WebGL2 sees
 * another. This test doesn't run the shaders — it reads their
 * source and checks that the critical constants match.
 *
 * Why lexical: we can't execute either shader here, and anything
 * fancier (parsing GLSL/WGSL) is overkill. A set of regex probes
 * on well-known constants catches drift fast.
 */

const DIR = resolve(__dirname, '..', '..', 'shaders');

function carregar(name: string): string {
  return readFileSync(resolve(DIR, name), 'utf-8');
}

describe('shader source parity: starfield', () => {
  const frag = carregar('starfield.frag');
  const wgsl = carregar('starfield.wgsl');

  it('both use PCG2D with the same multiplier constants', () => {
    expect(frag).toContain('1664525u');
    expect(frag).toContain('1013904223u');
    expect(wgsl).toContain('1664525u');
    expect(wgsl).toContain('1013904223u');
  });

  it('both declare the three starLayer calls with matching cell sizes', () => {
    const fragSizes = [...frag.matchAll(/starLayer\(worldPos,\s*([0-9.]+)/g)].map((m) => m[1]);
    const wgslSizes = [...wgsl.matchAll(/starLayer\(worldPos,\s*(?:cam,\s*)?([0-9.]+)/g)].map((m) => m[1]);
    expect(fragSizes.length).toBeGreaterThanOrEqual(3);
    expect(fragSizes).toEqual(wgslSizes);
  });

  it('GLSL path starts with #version 300 es', () => {
    // Must be the very first non-blank line — spec requirement.
    const firstLine = frag.split('\n').find((l) => l.trim() !== '');
    expect(firstLine).toBe('#version 300 es');
  });

  it('both set precision/types to WebGL2-compatible', () => {
    expect(frag).toMatch(/precision\s+highp\s+float/);
    expect(frag).toMatch(/precision\s+highp\s+int/);
  });

  it('no fract(sin(dot(...))) hash in starfield (would reintroduce the ANGLE bug)', () => {
    expect(frag).not.toMatch(/fract\s*\(\s*sin\s*\(\s*dot/);
    expect(wgsl).not.toMatch(/fract\s*\(\s*sin\s*\(\s*dot/);
  });
});

describe('shader source parity: planeta', () => {
  const frag = carregar('planeta.frag');
  const wgsl = carregar('planeta.wgsl');

  it('both use PCG2D with the same multiplier constants', () => {
    expect(frag).toContain('1664525u');
    expect(frag).toContain('1013904223u');
    expect(wgsl).toContain('1664525u');
    expect(wgsl).toContain('1013904223u');
  });

  it('both derive Y-axis salt via one PCG step on the seed', () => {
    // The Y-axis salt is `seed * 1664525 + 1013904223` — plain u32
    // arithmetic with PCG constants that are already proven to
    // compile everywhere. Both paths must contain that exact
    // formula to keep GLSL and WGSL bit-identical.
    expect(frag).toMatch(/seed32\s*\*\s*1664525u\s*\+\s*1013904223u/);
    expect(wgsl).toMatch(/seed32\s*\*\s*1664525u\s*\+\s*1013904223u/);
  });

  it('GLSL planeta path starts with #version 300 es', () => {
    const firstLine = frag.split('\n').find((l) => l.trim() !== '');
    expect(firstLine).toBe('#version 300 es');
  });

  it('both declare precision highp for float AND int', () => {
    expect(frag).toMatch(/precision\s+highp\s+float/);
    expect(frag).toMatch(/precision\s+highp\s+int/);
  });

  it('rand() no longer uses fract(sin(dot(...))) — would revive cross-driver drift', () => {
    expect(frag).not.toMatch(/fract\s*\(\s*sin\s*\(\s*dot/);
    expect(wgsl).not.toMatch(/fract\s*\(\s*sin\s*\(\s*dot/);
  });
});

describe('shader source parity: JS port matches the shader hash', () => {
  it('planeta-canvas.ts uses the same PCG multipliers as the shader', () => {
    const canvas = readFileSync(
      resolve(__dirname, '..', 'planeta-canvas.ts'),
      'utf-8',
    );
    expect(canvas).toContain('1664525');
    expect(canvas).toContain('1013904223');
    // Must use Math.imul for 32-bit int math — without it JS defaults
    // to f64 multiply which doesn't match the u32 wrap semantics.
    expect(canvas).toContain('Math.imul');
  });
});
