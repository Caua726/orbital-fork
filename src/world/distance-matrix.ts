/**
 * Pre-computed planet-to-planet distance matrix.
 *
 * Planets are (effectively) stationary within a system's orbit radius,
 * so planet-to-planet straight-line distance is nearly constant after
 * world creation. AI scoring does this lookup hundreds of times per
 * tick — pre-computing it avoids the Math.hypot hot loop.
 *
 * Built once at world creation (or load). Not persisted — geographic
 * topology is derivable from the saved planet positions.
 */

import type { Mundo, Planeta } from '../types';

export interface DistanceMatrix {
  /** Distance between two planets by id. Returns Infinity if either id is unknown. */
  dist(idA: string, idB: string): number;
  /** K nearest neighbors of a planet. Empty if id unknown. */
  nearest(id: string, k: number): string[];
  /** All neighbors within a given radius. */
  vizinhos(id: string, raio: number): string[];
}

class MatrixImpl implements DistanceMatrix {
  private readonly idx: Map<string, number>;
  private readonly ids: string[];
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;

  constructor(planetas: readonly Planeta[]) {
    const n = planetas.length;
    this.idx = new Map();
    this.ids = new Array(n);
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = planetas[i];
      this.idx.set(p.id, i);
      this.ids[i] = p.id;
      this.xs[i] = p.x;
      this.ys[i] = p.y;
    }
  }

  dist(idA: string, idB: string): number {
    const a = this.idx.get(idA);
    const b = this.idx.get(idB);
    if (a === undefined || b === undefined) return Infinity;
    const dx = this.xs[a] - this.xs[b];
    const dy = this.ys[a] - this.ys[b];
    return Math.sqrt(dx * dx + dy * dy);
  }

  nearest(id: string, k: number): string[] {
    const a = this.idx.get(id);
    if (a === undefined) return [];
    const xa = this.xs[a];
    const ya = this.ys[a];
    const n = this.ids.length;
    const out: Array<{ id: string; d: number }> = [];
    for (let i = 0; i < n; i++) {
      if (i === a) continue;
      const dx = this.xs[i] - xa;
      const dy = this.ys[i] - ya;
      out.push({ id: this.ids[i], d: dx * dx + dy * dy });
    }
    out.sort((p, q) => p.d - q.d);
    return out.slice(0, k).map((e) => e.id);
  }

  vizinhos(id: string, raio: number): string[] {
    const a = this.idx.get(id);
    if (a === undefined) return [];
    const xa = this.xs[a];
    const ya = this.ys[a];
    const r2 = raio * raio;
    const n = this.ids.length;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i === a) continue;
      const dx = this.xs[i] - xa;
      const dy = this.ys[i] - ya;
      if (dx * dx + dy * dy <= r2) out.push(this.ids[i]);
    }
    return out;
  }
}

let _matrix: DistanceMatrix | null = null;

export function buildDistanceMatrix(mundo: Mundo): DistanceMatrix {
  _matrix = new MatrixImpl(mundo.planetas);
  return _matrix;
}

export function getDistanceMatrix(): DistanceMatrix | null {
  return _matrix;
}

export function resetDistanceMatrix(): void {
  _matrix = null;
}
