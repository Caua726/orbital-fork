import { describe, it, expect } from 'vitest';
import {
  profiling, profileAcumular, profileContar, profileFlush, profileMark,
  getProfilingHistory, getProfilingHistoryLen,
} from '../profiling';

/**
 * profiling.ts is module-state-heavy and drives the HUD + logger +
 * benchmark. Tests pin the observable behaviours without locking
 * to the exact averaging window math, which is brittle against
 * timer precision drift in Node/vitest.
 */

// Drain the averaging window so any subsequent counts start from
// a fresh published bucket.
function drenar(n = 60): void {
  for (let i = 0; i < n; i++) profileFlush();
}

describe('profiling: time accumulators', () => {
  it('profileAcumular feeds a non-zero average after enough frames', () => {
    drenar();
    // 60 frames with ~1ms of 'combate' work each. 60 is ≥ 2 windows,
    // guaranteeing at least one published value.
    for (let i = 0; i < 60; i++) {
      profileAcumular('combate', performance.now() - 1);
      profileFlush();
    }
    expect(profiling.combate).toBeGreaterThan(0);
  });

  it('profileMark matches performance.now() within timer precision', () => {
    const a = profileMark();
    const b = performance.now();
    expect(Math.abs(b - a)).toBeLessThan(5);
  });
});

describe('profiling: counters', () => {
  it('profileContar produces a non-zero counter after flushes', () => {
    drenar();
    for (let i = 0; i < 60; i++) {
      profileContar('drawCalls', 7);
      profileFlush();
    }
    expect(profiling.drawCalls).toBeGreaterThan(0);
  });

  it('profileContar default n=1 — 60 frames of single increments land on bucket', () => {
    drenar();
    for (let i = 0; i < 60; i++) {
      profileContar('textureUploads');
      profileFlush();
    }
    expect(profiling.textureUploads).toBeGreaterThan(0);
  });

  it('counter ZEROES after idle window', () => {
    drenar();
    for (let i = 0; i < 60; i++) {
      profileContar('triangles', 123);
      profileFlush();
    }
    expect(profiling.triangles).toBeGreaterThan(0);
    // Now idle — no profileContar calls. After 2 full windows the
    // averaged bucket should return to 0.
    drenar();
    expect(profiling.triangles).toBe(0);
  });
});

describe('profiling: ring buffer history', () => {
  it('history ring length matches getProfilingHistoryLen()', () => {
    const hist = getProfilingHistory();
    const len = getProfilingHistoryLen();
    expect(hist.drawCalls.length).toBe(len);
  });

  it('per-frame samples land in the ring regardless of window flush', () => {
    drenar();
    profileContar('drawCalls', 13);
    profileFlush();
    const hist = getProfilingHistory();
    let found = false;
    for (let i = 0; i < hist.drawCalls.length; i++) {
      if (hist.drawCalls[i] === 13) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});

describe('profiling: logica aggregate', () => {
  it('logica is the sum of gameplay sub-bucket samples each frame', () => {
    // Write a small value to each of the 5 sub-buckets once, flush,
    // and check that the logica sample in history equals the sum.
    drenar();
    const start = performance.now() - 2;
    profileAcumular('planetasLogic', start);
    profileAcumular('naves', start);
    profileAcumular('ia', start);
    profileAcumular('combate', start);
    profileAcumular('stats', start);
    profileFlush();

    const hist = getProfilingHistory();
    // Find the most recent non-zero logica sample (last written slot).
    let logicaSample = 0;
    let subSum = 0;
    for (let i = 0; i < hist.logica.length; i++) {
      if (hist.logica[i] > 0) {
        logicaSample = hist.logica[i];
        subSum = hist.planetasLogic[i] + hist.naves[i] + hist.ia[i] +
                 hist.combate[i] + hist.stats[i];
        break;
      }
    }
    expect(logicaSample).toBeGreaterThan(0);
    expect(Math.abs(logicaSample - subSum)).toBeLessThan(0.001);
  });
});
