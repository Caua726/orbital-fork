import { describe, it, expect } from 'vitest';
import { hash01 } from '../ia-utilidade';

/**
 * Pin the deterministic AI score-jitter hash. It replaced Math.random(),
 * which broke save/replay determinism and made candidate ordering unstable
 * frame-to-frame. The contract: same input → same output (no global state),
 * output in [0,1), distinct inputs spread across the range so ~10% of
 * candidates land below the 0.1 jitter threshold.
 */
describe('ia-utilidade: hash01 (deterministic score jitter)', () => {
  it('is deterministic — same input always yields the same value', () => {
    const a = hash01('ia1pla-0-0fragata');
    const b = hash01('ia1pla-0-0fragata');
    expect(a).toBe(b);
  });

  it('output is always in [0, 1)', () => {
    for (const s of ['', 'a', 'ia1', 'ia2pla-3-4torreta', '💥unicode', 'x'.repeat(500)]) {
      const v = hash01(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('distinct inputs generally produce distinct values (no trivial collisions)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(hash01(`ia${i % 4}pla-${i}-0fragata`));
    // Allow a few hash collisions but demand real spread.
    expect(seen.size).toBeGreaterThan(190);
  });

  it('roughly 10% of a candidate population falls below the 0.1 jitter cut', () => {
    let below = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (hash01(`ia${i % 6}pla-${i}-${i % 3}batedora`) < 0.1) below++;
    }
    const frac = below / N;
    // Uniform-ish: expect near 10%, tolerate hash imperfection.
    expect(frac).toBeGreaterThan(0.05);
    expect(frac).toBeLessThan(0.15);
  });
});
