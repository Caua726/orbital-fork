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

  it('both use the same uSeed salt (0xA5A5A5A5)', () => {
    // Salt XOR masks a second u32 so X and Y axes get independent
    // streams. Drifting this value would desync Canvas2D/WebGL2/WebGPU.
    expect(frag).toContain('0xA5A5A5A5u');
    expect(wgsl).toContain('0xA5A5A5A5u');
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
    expect(canvas).toContain('0xA5A5A5A5');
    // Must use Math.imul for 32-bit int math — without it JS defaults
    // to f64 multiply which doesn't match the u32 wrap semantics.
    expect(canvas).toContain('Math.imul');
  });
});
