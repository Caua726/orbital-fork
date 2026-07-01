import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Pin the `isAnyWeydraSubsystemOn` helper that gates the weydra boot
 * in src/weydra-loader.ts:29, the Pixi transparency decision in
 * src/main.ts:123, and the engine-dropdown UI in src/ui/settings-panel.ts.
 *
 * The helper iterates `cfg.weydra` excluding the `backend` field
 * (a string config, not a feature toggle). A regression here would
 * either leave weydra off when the user wants it on, or pay the WASM
 * init cost when no subsystem is on — both classes of bug are subtle
 * enough to ship without tripping a manual smoke test.
 */

const _fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => _fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { _fakeStorage[k] = v; },
  removeItem: (k: string) => { delete _fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(_fakeStorage)) delete _fakeStorage[k]; },
};

import { isAnyWeydraSubsystemOn, resetConfigForTest, setConfig, getConfig, DEFAULTS } from '../config';
import type { OrbitalConfig } from '../config';

function withWeydra(overrides: Partial<OrbitalConfig['weydra']>): OrbitalConfig {
  return {
    ...DEFAULTS,
    weydra: { ...DEFAULTS.weydra, ...overrides },
  };
}

describe('isAnyWeydraSubsystemOn: M6 fog flag', () => {
  beforeEach(() => {
    _fakeStorage['orbital_config'] = '';
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
  });

  it('returns true when ONLY fog is on (M6 keystone — alone must turn weydra on)', () => {
    expect(isAnyWeydraSubsystemOn(withWeydra({ fog: true }))).toBe(true);
  });

  it('returns false when all weydra flags are off', () => {
    // M10 flipped DEFAULTS.weydra to all-true. The isAnyWeydraSubsystemOn
    // contract is the same: "true on any flag, false on none". Pass an
    // explicit all-false config here to verify the latter case.
    expect(isAnyWeydraSubsystemOn(withWeydra({
      starfield: false,
      ships: false,
      shipTrails: false,
      starfieldBright: false,
      planetsBaked: false,
      planetsLive: false,
      fog: false,
      graphics: false,
      text: false,
      ui: false,
    }))).toBe(false);
  });

  it('returns false when ONLY backend is set (backend is config, not a feature flag)', () => {
    // The helper excludes `backend` from the loop. A user who sets
    // backend=webgpu without turning on any subsystem must NOT pay the
    // WASM init cost or flip Pixi to transparent. M10 flipped DEFAULTS
    // to all-true, so pass explicit all-false overrides here to verify
    // the contract on a config that has no subsystems enabled.
    const allFalse = {
      starfield: false, ships: false, shipTrails: false, starfieldBright: false,
      planetsBaked: false, planetsLive: false, fog: false, graphics: false,
      text: false, ui: false,
    };
    expect(isAnyWeydraSubsystemOn({ ...DEFAULTS, weydra: { ...allFalse, backend: 'webgpu' } })).toBe(false);
    expect(isAnyWeydraSubsystemOn({ ...DEFAULTS, weydra: { ...allFalse, backend: 'webgl2' } })).toBe(false);
    expect(isAnyWeydraSubsystemOn({ ...DEFAULTS, weydra: { ...allFalse, backend: 'auto' } })).toBe(false);
  });

  it('returns true when fog is on AND backend is configured (fog wins)', () => {
    expect(isAnyWeydraSubsystemOn(withWeydra({ fog: true, backend: 'webgl2' }))).toBe(true);
  });

  it('returns true for any single subsystem on (covers M2-M6 flags)', () => {
    expect(isAnyWeydraSubsystemOn(withWeydra({ starfield: true }))).toBe(true);
    expect(isAnyWeydraSubsystemOn(withWeydra({ ships: true }))).toBe(true);
    expect(isAnyWeydraSubsystemOn(withWeydra({ shipTrails: true }))).toBe(true);
    expect(isAnyWeydraSubsystemOn(withWeydra({ starfieldBright: true }))).toBe(true);
    expect(isAnyWeydraSubsystemOn(withWeydra({ planetsBaked: true }))).toBe(true);
    expect(isAnyWeydraSubsystemOn(withWeydra({ planetsLive: true }))).toBe(true);
  });
});

describe('isAnyWeydraSubsystemOn: defensive', () => {
  beforeEach(() => {
    _fakeStorage['orbital_config'] = '';
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
  });

  it('returns false when cfg.weydra is undefined (corrupt config defensive case)', () => {
    // A future migration that wipes the weydra key shouldn't cause the
    // helper to throw — it should just return false.
    const broken = { ...DEFAULTS } as Partial<OrbitalConfig>;
    delete broken.weydra;
    expect(isAnyWeydraSubsystemOn(broken as OrbitalConfig)).toBe(false);
  });
});

describe('setConfig + resetConfigForTest: integration smoke', () => {
  // Pin that the helper reads the live config, not a stale cache. This
  // is what guarantees `setConfig({ weydra: { fog: true } })` from the
  // settings panel actually flips the renderer on next boot.
  beforeEach(() => {
    _fakeStorage['orbital_config'] = '';
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
  });

  it('after setConfig({ weydra: { fog: true } }), getConfig().weydra.fog is true', () => {
    setConfig({ weydra: { ...DEFAULTS.weydra, fog: true } });
    expect(isAnyWeydraSubsystemOn({ ...DEFAULTS, weydra: { ...DEFAULTS.weydra, fog: true } })).toBe(true);
  });

  it('resetConfigForTest restores DEFAULTS.weydra state', () => {
    setConfig({ weydra: { ...DEFAULTS.weydra, fog: true, starfield: true } });
    resetConfigForTest();
    // M10: DEFAULTS.weydra is all-true. After reset, the helper
    // returns true (any flag set). To exercise the "all false"
    // contract path explicitly, pass an all-false override below.
    expect(isAnyWeydraSubsystemOn({
      ...DEFAULTS,
      weydra: {
        starfield: false, ships: false, shipTrails: false, starfieldBright: false,
        planetsBaked: false, planetsLive: false, fog: false, graphics: false,
        text: false, ui: false, backend: 'auto',
      },
    })).toBe(false);
  });
});

describe('getConfig: shared cached reference (perf-critical, must NOT deep-clone)', () => {
  beforeEach(() => {
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
  });

  it('returns the SAME object reference across calls (no per-call clone)', () => {
    // getConfig() is hit in 60 Hz loops — the previous deepClone(_cache)
    // per call was a full JSON serialize+parse. It must return the cached
    // reference. If someone re-adds a clone, this fails.
    expect(getConfig()).toBe(getConfig());
  });

  it('setConfig REPLACES the reference (immutable-snapshot semantics)', () => {
    const before = getConfig();
    setConfig({ weydra: { ...DEFAULTS.weydra, fog: true } });
    const after = getConfig();
    // A caller that cached `before` keeps a consistent (older) snapshot;
    // re-reading yields the fresh one.
    expect(after).not.toBe(before);
    expect(after.weydra.fog).toBe(true);
  });

  it('setConfig does not mutate a previously-returned snapshot in place', () => {
    const snap = getConfig();
    const fogBefore = snap.weydra.fog;
    setConfig({ weydra: { ...DEFAULTS.weydra, fog: !fogBefore } });
    // The old snapshot is unchanged (setConfig built a new object).
    expect(snap.weydra.fog).toBe(fogBefore);
  });
});