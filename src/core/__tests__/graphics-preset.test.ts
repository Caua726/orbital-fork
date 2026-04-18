import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { setConfig, getConfig, resetConfigForTest } from '../config';
import { aplicarPreset, presetBateComFlagsDerivadas } from '../graphics-preset';

describe('aplicarPreset', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('alto preset sets all derived flags to their alto values', () => {
    aplicarPreset('alto');
    const g = getConfig().graphics;
    expect(g.qualidadeEfeitos).toBe('alto');
    expect(g.fogThrottle).toBe(1);
    expect(g.maxFantasmas).toBe(-1);
    expect(g.densidadeStarfield).toBe(1.0);
    expect(g.shaderLive).toBe(true);
    expect(g.mostrarOrbitas).toBe(true);
  });

  it('minimo preset sets all derived flags to their minimo values', () => {
    aplicarPreset('minimo');
    const g = getConfig().graphics;
    expect(g.qualidadeEfeitos).toBe('minimo');
    expect(g.fogThrottle).toBe(15);
    expect(g.maxFantasmas).toBe(0);
    expect(g.densidadeStarfield).toBe(0.1);
    expect(g.shaderLive).toBe(false);
    expect(g.mostrarOrbitas).toBe(false);
  });

  it('does NOT touch independent flags (scanlines, fpsCap)', () => {
    setConfig({ graphics: { ...getConfig().graphics, scanlines: false, fpsCap: 30 } });
    aplicarPreset('alto');
    const g = getConfig().graphics;
    expect(g.scanlines).toBe(false);
    expect(g.fpsCap).toBe(30);
  });
});

describe('presetBateComFlagsDerivadas', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('returns true right after applying a preset', () => {
    aplicarPreset('baixo');
    expect(presetBateComFlagsDerivadas(getConfig())).toBe(true);
  });

  it('returns false after a manual override of any derived flag', () => {
    aplicarPreset('alto');
    setConfig({ graphics: { ...getConfig().graphics, mostrarOrbitas: false } });
    expect(presetBateComFlagsDerivadas(getConfig())).toBe(false);
  });

  it('ignores non-derived flag changes', () => {
    aplicarPreset('alto');
    setConfig({ graphics: { ...getConfig().graphics, scanlines: false } });
    expect(presetBateComFlagsDerivadas(getConfig())).toBe(true);
  });
});
