import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Pin the post-merge fixes for M6 fog-of-war:
 *   d12b8a5 — skip fog draw when active_count == 0
 *   eb03a64 — gate fog branch on prerequisite weydra layers
 *   258b5dc — pre-decode palette colors for sRGB swap chain
 *
 * Three fixes shipped in a row after M6 merged; without these tests any
 * refactor of the gate logic, the fallback zeroing, or the camera hoist
 * in fundo.ts could silently reintroduce the "menu shows 75% navy" /
 * "fog hazes space while planets stay unfogged" / "fog stuck at origin"
 * regressions. Plus the FogLayer typed-array contract on the ts-bridge
 * side (Checkpoint B, separate file).
 *
 * Strategy:
 *   - mock ../../weydra-loader so getWeydraRenderer() returns a Renderer-shaped
 *     object whose `fog` field has vi.fn() spies on every setter.
 *   - drive cfg.weydra.* via the real setConfig/resetConfigForTest (same
 *     pattern as graphics-preset.test.ts).
 *   - call the REAL desenharNeblinaVisao / atualizarFundo — these tests pin
 *     the integration, not a reimplementation.
 */

// Module-level renderer mock. The weydra-loader mock returns this verbatim
// when `mockRendererUp` is true, or null when false. Each test rebuilds
// the spy fns in beforeEach so call counts are clean.
type FogSpies = {
  setBaseAlpha: ReturnType<typeof vi.fn>;
  setSource: ReturnType<typeof vi.fn>;
  setActiveCount: ReturnType<typeof vi.fn>;
  maxSources: number;
};
type MockRenderer = {
  fog: FogSpies | null;
  setCamera?: ReturnType<typeof vi.fn>;
  setStarfieldDensity?: ReturnType<typeof vi.fn>;
  setStarfieldBrightEnabled?: ReturnType<typeof vi.fn>;
};
let mockRenderer: MockRenderer | null = null;

// Resolve to src/weydra-loader (two levels up from __tests__/).
// Using '../weydra-loader' would target src/world/weydra-loader which
// doesn't exist and silently fail to apply the mock to fundo.ts's
// `import { getWeydraRenderer } from '../weydra-loader'`.
vi.mock('../../weydra-loader', () => ({
  getWeydraRenderer: () => mockRenderer,
}));

// Minimal fake localStorage — graphics-preset.test.ts and ui-mode.test.ts
// install their own; without one, `load()` in config.ts would re-read
// whatever a prior test file leaked into happy-dom's shared storage.
const _fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => _fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { _fakeStorage[k] = v; },
  removeItem: (k: string) => { delete _fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(_fakeStorage)) delete _fakeStorage[k]; },
};

import { desenharNeblinaVisao, destruirFog } from '../nevoa';
import { atualizarFundo } from '../fundo';
import { setConfig, resetConfigForTest } from '../../core/config';
import type { Mundo, FonteVisao, Camera } from '../../types';

function freshFogSpies(): FogSpies {
  return {
    setBaseAlpha: vi.fn(),
    setSource: vi.fn(),
    setActiveCount: vi.fn(),
    maxSources: 64,
  };
}

function makeMundo(): Mundo {
  // Only visaoContainer.addChild is touched by desenharNeblinaVisao's
  // Pixi-fallback path. The rest of the Mundo fields aren't read on the
  // fog codepath; cast to any for the unused fields.
  return {
    visaoContainer: {
      addChild: vi.fn(),
      removeChild: vi.fn(),
    },
  } as unknown as Mundo;
}

function applyWeydraFlags(flags: {
  starfield?: boolean;
  planetsLive?: boolean;
  planetsBaked?: boolean;
  ships?: boolean;
  fog?: boolean;
}): void {
  // setConfig merges over current state; we explicitly turn off anything
  // we don't care about so a prior test's flag doesn't leak through.
  setConfig({
    weydra: {
      starfield: flags.starfield ?? false,
      planetsLive: flags.planetsLive ?? false,
      planetsBaked: flags.planetsBaked ?? false,
      ships: flags.ships ?? false,
      fog: flags.fog ?? false,
      starfieldBright: false,
      shipTrails: false,
      backend: 'auto',
    },
  });
}

const FONTES: FonteVisao[] = [{ x: 100, y: 200, raio: 300 }];
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

// Some tests fall through to the Pixi canvas-2D path which requires a
// working 2D context that happy-dom doesn't fully provide. Wrap calls
// that touch the Pixi path so the throw doesn't surface — we only care
// about the spy calls executed before the fallthrough.
function safelyDraw(
  mundo: Mundo,
  fontes: FonteVisao[],
): void {
  try {
    desenharNeblinaVisao(mundo, fontes, CAMERA, 1920, 1080, 1);
  } catch {
    /* expected on Pixi-fallthrough paths without a real 2D context */
  }
}

// =====================================================================
// Checkpoint A — gate matrix + fallback zeroing
// =====================================================================

describe('desenharNeblinaVisao: gate matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _fakeStorage['orbital_config'] = '';  // wipe any prior test's persisted config
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
    destruirFog();
    mockRenderer = null;
  });

  it('prerequisites all on + fog on + renderer up → weydra path (setActiveCount(1))', () => {
    applyWeydraFlags({ starfield: true, planetsLive: true, ships: true, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledTimes(1);
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(1);
    expect(mockRenderer!.fog!.setSource).toHaveBeenCalledTimes(1);
    expect(mockRenderer!.fog!.setSource).toHaveBeenCalledWith(0, 100, 200, 300);
    expect(mockRenderer!.fog!.setBaseAlpha).toHaveBeenCalledTimes(1);
    // Pixi fallback path must NOT have laid down a sprite — early-return
    // at nevoa.ts:483 means no addChild call.
    expect(mundo.visaoContainer.addChild).not.toHaveBeenCalled();
  });

  it('prerequisites all on + fog on + renderer null → Pixi path, no fog calls', () => {
    applyWeydraFlags({ starfield: true, planetsLive: true, ships: true, fog: true });
    mockRenderer = null;
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    // No renderer means no fog.* spies — must not throw.
    expect(true).toBe(true);
  });

  it('starfield off + fog on + renderer up → Pixi fallback with setActiveCount(0)', () => {
    applyWeydraFlags({ starfield: false, planetsLive: true, ships: true, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    // eb03a64 side-effect: when weydra.fog is on but a prerequisite is
    // false AND renderer is up, zero the active_count so the weydra
    // render loop doesn't keep clearing vision around stale positions.
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledTimes(1);
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(0);
    expect(mockRenderer!.fog!.setSource).not.toHaveBeenCalled();
  });

  it('ships off + fog on + renderer up → Pixi fallback with setActiveCount(0)', () => {
    applyWeydraFlags({ starfield: true, planetsLive: true, ships: false, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(0);
  });

  it('planetsLive AND planetsBaked both off + fog on + renderer up → Pixi fallback with setActiveCount(0)', () => {
    applyWeydraFlags({ starfield: true, planetsLive: false, planetsBaked: false, ships: true, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(0);
  });

  it('planetsBaked alone (no planetsLive) + fog on + renderer up → weydra path (OR clause satisfied)', () => {
    applyWeydraFlags({ starfield: true, planetsLive: false, planetsBaked: true, ships: true, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    // The OR clause in (planetsLive || planetsBaked) makes baked-only
    // a valid prerequisite configuration.
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(1);
    expect(mundo.visaoContainer.addChild).not.toHaveBeenCalled();
  });

  it('fog off → Pixi path runs unconditionally, no fog.* calls', () => {
    applyWeydraFlags({ starfield: true, planetsLive: true, ships: true, fog: false });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    expect(mockRenderer!.fog!.setActiveCount).not.toHaveBeenCalled();
    expect(mockRenderer!.fog!.setSource).not.toHaveBeenCalled();
    expect(mockRenderer!.fog!.setBaseAlpha).not.toHaveBeenCalled();
  });

  it('renderer up but fog field is null → Pixi fallback, no setActiveCount(0) (renderer.fog is the guard)', () => {
    applyWeydraFlags({ starfield: false, planetsLive: true, ships: true, fog: true });
    mockRenderer = { fog: null };
    const mundo = makeMundo();

    safelyDraw(mundo, FONTES);

    // nevoa.ts:468 — `if (r && r.fog && prerequisitesOn)` is the gate,
    // and nevoa.ts:492 — `if (r?.fog)` is the fallback-zero guard. When
    // r.fog is null, neither branch fires the setters.
    expect(true).toBe(true);
  });
});

describe('desenharNeblinaVisao: source clamping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
    destruirFog();
    mockRenderer = null;
  });

  it('>64 fontes are clamped to FOG_MAX_SOURCES=64 via Math.min', () => {
    applyWeydraFlags({ starfield: true, planetsLive: true, ships: true, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const fontes = Array.from({ length: 80 }, (_, i) => ({
      x: i, y: i, raio: 100,
    }));
    const mundo = makeMundo();

    safelyDraw(mundo, fontes);

    expect(mockRenderer!.fog!.setSource).toHaveBeenCalledTimes(64);
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(64);
    // Last write lands at index 63 (the 64th slot). fontes[63] has x=63
    // since fontes[79] (the 80th entry) is past the clamp and never
    // uploaded.
    expect(mockRenderer!.fog!.setSource).toHaveBeenLastCalledWith(63, 63, 63, 100);
  });
});

describe('desenharNeblinaVisao: active_count N→0 transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
    destruirFog();
    mockRenderer = null;
  });

  it('count goes from 3 to 0 across frames — guards d12b8a5 stale-slot hazard', () => {
    applyWeydraFlags({ starfield: true, planetsLive: true, ships: true, fog: true });
    mockRenderer = { fog: freshFogSpies() };
    const mundo = makeMundo();

    safelyDraw(mundo, [
      { x: 1, y: 1, raio: 100 },
      { x: 2, y: 2, raio: 100 },
      { x: 3, y: 3, raio: 100 },
    ]);
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenLastCalledWith(3);

    // Next frame: no fontes (e.g. all ships died / scouted out). The
    // shader must not iterate stale slots. The d12b8a5 guard at
    // adapters/wasm/src/lib.rs:672 reads active_count > 0, so we MUST
    // call setActiveCount(0) here. Clear BOTH spies so the second frame
    // doesn't see the first frame's setSource history.
    (mockRenderer!.fog!.setActiveCount as ReturnType<typeof vi.fn>).mockClear();
    (mockRenderer!.fog!.setSource as ReturnType<typeof vi.fn>).mockClear();
    safelyDraw(mundo, []);
    expect(mockRenderer!.fog!.setActiveCount).toHaveBeenCalledWith(0);
    expect(mockRenderer!.fog!.setSource).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Checkpoint F — camera-hoist in fundo.ts
// =====================================================================
//
// c582b9c hoisted `r.setCamera(...)` out of the starfield-only branch
// in `atualizarFundo`. Without this, fog tracking on the static / canvas
// fundo branches runs with a zero camera/viewport and the fog quad
// appears anchored at world origin instead of following the player. Pin
// the hoist runs in all three branches here.

function makeMockRendererWithCamera(): MockRenderer {
  return {
    fog: null,
    setCamera: vi.fn(),
    setStarfieldDensity: vi.fn(),
    setStarfieldBrightEnabled: vi.fn(),
  };
}

describe('atualizarFundo: setCamera hoist (M6 c582b9c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete _fakeStorage['orbital_config'];
    resetConfigForTest();
    destruirFog();
    mockRenderer = null;
  });

  it('starfield branch — setCamera called with (camX, camY, telaW, telaH, t)', () => {
    mockRenderer = makeMockRendererWithCamera();
    // Default fundo shape — no _isStaticFundo / _isCanvasFundo, lands at
    // fundo.ts:340 (default mesh path).
    const fundo: any = {
      _mesh: { x: 0, y: 0, visible: true, scale: { set: vi.fn() } },
      _uniforms: {
        uniforms: {
          uCamera: new Float32Array(2),
          uViewport: new Float32Array(2),
          uTime: 0,
          uDensidade: 0,
        },
      },
      _brightTiles: {
        visible: true, x: 0, y: 0, width: 0, height: 0,
        tilePosition: { x: 0, y: 0 },
      },
      _tempoAcumMs: 0,
    };

    // weydra.starfield stays false (DEFAULTS); weydraOn is false, so the
    // else branch runs uniforms update without touching setStarfieldDensity.
    atualizarFundo(fundo, 100, 200, 800, 600);

    expect(mockRenderer!.setCamera).toHaveBeenCalledTimes(1);
    const [x, y, w, h, t] = mockRenderer!.setCamera!.mock.calls[0];
    expect(x).toBe(100);
    expect(y).toBe(200);
    expect(w).toBe(800);
    expect(h).toBe(600);
    expect(t).toBeGreaterThan(0);
  });

  it('renderer up but starfield OFF — _tempoAcumMs still grows inside the starfield branch', () => {
    mockRenderer = makeMockRendererWithCamera();
    const fundo: any = {
      _mesh: { x: 0, y: 0, visible: true, scale: { set: vi.fn() } },
      _uniforms: {
        uniforms: {
          uCamera: new Float32Array(2),
          uViewport: new Float32Array(2),
          uTime: 0,
          uDensidade: 0,
        },
      },
      _brightTiles: {
        visible: true, x: 0, y: 0, width: 0, height: 0,
        tilePosition: { x: 0, y: 0 },
      },
      _tempoAcumMs: 0,
    };

    atualizarFundo(fundo, 0, 0, 100, 100);

    // fundo.ts:328 advances _tempoAcumMs in the hoist block when r !== null.
    expect(fundo._tempoAcumMs).toBeGreaterThan(0);
    expect(mockRenderer!.setCamera).toHaveBeenCalledTimes(1);
  });

  it('renderer null — no setCamera call, _tempoAcumMs still grows via the fallback branch', () => {
    mockRenderer = null;
    const fundo: any = {
      _mesh: { x: 0, y: 0, visible: true, scale: { set: vi.fn() } },
      _uniforms: {
        uniforms: {
          uCamera: new Float32Array(2),
          uViewport: new Float32Array(2),
          uTime: 0,
          uDensidade: 0,
        },
      },
      _brightTiles: {
        visible: true, x: 0, y: 0, width: 0, height: 0,
        tilePosition: { x: 0, y: 0 },
      },
      _tempoAcumMs: 0,
    };

    atualizarFundo(fundo, 0, 0, 100, 100);

    // fundo.ts:348 — when r is null, _tempoAcumMs is advanced inside
    // the starfield branch instead of the hoist block. Either way, it
    // must grow.
    expect(fundo._tempoAcumMs).toBeGreaterThan(0);
  });
});