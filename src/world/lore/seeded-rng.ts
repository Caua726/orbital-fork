/**
 * Deterministic RNG utilities used across lore generators.
 *
 * The goal is reproducibility: given the same (entityId, galaxySeed),
 * every generator produces the exact same story. No Math.random() in
 * lore code — every pick flows from a seeded stream.
 */

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/**
 * Mix two 32-bit seeds into one. Symmetric-ish; enough for lore
 * branching (we don't need crypto-grade here).
 */
export function mixSeed(a: number, b: number): number {
  let x = (a ^ (b + 0x9e3779b9 + ((a << 6) >>> 0) + (a >>> 2))) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function rngFromSeed(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(entityId: string, galaxySeed: number): () => number {
  return rngFromSeed(mixSeed(hashStr(entityId), galaxySeed));
}

export function pickRng<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Pick N distinct items from arr (or fewer if arr is smaller). */
export function pickManyRng<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  const want = Math.min(n, pool.length);
  for (let i = 0; i < want; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

export function intRng(min: number, max: number, rng: () => number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

export function chance(p: number, rng: () => number): boolean {
  return rng() < p;
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
