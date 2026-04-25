export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface OrbitalConfig {
  autosaveIntervalMs: number;
  saveMode: 'periodic' | 'experimental';

  audio: {
    master: { volume: number; muted: boolean };
    sfx:    { volume: number; muted: boolean };
    ui:     { volume: number; muted: boolean };
    aviso:  { volume: number; muted: boolean };
    musica: { volume: number; muted: boolean };
  };

  graphics: {
    qualidadeEfeitos: 'alto' | 'medio' | 'baixo' | 'minimo';
    fullscreen: boolean;
    scanlines: boolean;
    mostrarFps: boolean;
    mostrarRam: boolean;
    vsync: boolean;
    fpsCap: number;
    renderScale: number;   // 0.1..4. Pixi resolution multiplier — independent
                           // of window DPR. <1 renders fewer pixels + browser
                           // upscales; >1 oversamples for crisper output.
    starfieldLayers: 1 | 2 | 3;  // How many parallax star layers run in the
                                  // fullscreen shader. Lower = less fragment
                                  // work per pixel.
    planetMaxOctaves: number;     // Global cap on planet fbm octaves (1-6).
                                  // Each octave roughly doubles shader ALU.
    renderer: 'webgl' | 'webgpu' | 'software';
    webglVersion: 'auto' | '1' | '2';
    gpuPreference: 'auto' | 'high-performance' | 'low-power';
    mostrarOrbitas: boolean;
    fogThrottle: number;
    maxFantasmas: number;
    densidadeStarfield: number;
    shaderLive: boolean;
  };

  gameplay: {
    confirmarDestrutivo: boolean;
    edgeScroll: boolean;
  };

  input: {
    bindings: Record<string, string[]>;
  };

  ui: {
    touchMode: 'auto' | 'on' | 'off';
  };

  /**
   * Feature flags para a migração incremental Pixi → weydra-renderer.
   * Cada sistema ganha sua flag conforme o milestone correspondente
   * (M2..M9) é mergeado. Todas default false — ativar por sistema só
   * após visual parity verificada.
   */
  weydra: {
    starfield: boolean;  // M2 — procedural fullscreen shader via weydra
    ships: boolean;      // M3 — sprite pool for all ships
    shipTrails: boolean; // M3 — engine trails via sprite pool
    starfieldBright: boolean; // M3 — bright-tile layer via weydra tiling
    planetsBaked: boolean; // M4 — baked planets via weydra sprite pool
    /** Backend hint for wgpu Instance — picks WebGPU or WebGL2 path. */
    backend: 'auto' | 'webgpu' | 'webgl2';
  };

  language: 'pt' | 'en';
}

export const DEFAULTS: OrbitalConfig = {
  autosaveIntervalMs: 60000,
  saveMode: 'periodic',

  audio: {
    master: { volume: 0.8, muted: false },
    sfx:    { volume: 1.0, muted: false },
    ui:     { volume: 0.7, muted: false },
    aviso:  { volume: 1.0, muted: false },
    musica: { volume: 0.45, muted: false },
  },

  graphics: {
    qualidadeEfeitos: 'alto',
    fullscreen: false,
    scanlines: true,
    mostrarFps: false,
    mostrarRam: false,
    vsync: true,
    fpsCap: 0,
    renderScale: 1.0,
    starfieldLayers: 3,
    planetMaxOctaves: 6,
    renderer: 'webgl',
    webglVersion: 'auto',
    gpuPreference: 'auto',
    mostrarOrbitas: true,
    fogThrottle: 3,
    maxFantasmas: -1,
    densidadeStarfield: 1.0,
    shaderLive: true,
  },

  gameplay: {
    confirmarDestrutivo: true,
    edgeScroll: false,
  },

  input: {
    bindings: {},
  },

  ui: {
    touchMode: 'auto',
  },

  weydra: {
    starfield: false,
    ships: false,
    shipTrails: false,
    starfieldBright: false,
    planetsBaked: false,
    backend: 'auto',
  },

  language: 'pt',
};

const STORAGE_KEY = 'orbital_config';

let _cache: OrbitalConfig | null = null;

type ConfigListener = (cfg: OrbitalConfig) => void;
const _listeners = new Set<ConfigListener>();
let _notifying = false;

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function mergeDeep<T>(base: T, over: any): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeDeep((base as any)?.[k] ?? {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function migrarChavesLegadas(cfg: OrbitalConfig): void {
  const legacyRenderer = localStorage.getItem('renderer');
  if (legacyRenderer === 'webgl' || legacyRenderer === 'webgpu') {
    cfg.graphics.renderer = legacyRenderer;
    localStorage.removeItem('renderer');
  }
  // Old 'baixo' preset persisted shaderLive: false, which freezes the
  // procedural planets into a static baked sprite ('mostrando um
  // background ao invés do shader em tempo quase real'). We moved
  // shaderLive to true for 'baixo' — force-realign any saved config
  // that still has the old combination.
  const q = cfg.graphics.qualidadeEfeitos;
  if (q !== 'minimo' && cfg.graphics.shaderLive === false) {
    cfg.graphics.shaderLive = true;
  }
  // Migrate the old fpsCap=-1 sentinel ("Sem vsync") to the new split
  // where vsync is its own boolean and fpsCap is just a number.
  if (cfg.graphics.fpsCap as number === -1) {
    cfg.graphics.vsync = false;
    cfg.graphics.fpsCap = 0;
  }
}

function load(): OrbitalConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    const merged = mergeDeep(DEFAULTS, parsed);
    migrarChavesLegadas(merged);
    return merged;
  } catch {
    return deepClone(DEFAULTS);
  }
}

export function getConfig(): OrbitalConfig {
  if (!_cache) _cache = load();
  return deepClone(_cache);
}

export function onConfigChange(fn: ConfigListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function setConfig(partial: DeepPartial<OrbitalConfig>): void {
  if (_notifying) {
    console.error('[config] reentrant setConfig — ignored. Listener bug:', partial);
    return;
  }
  _cache = mergeDeep(getConfig(), partial);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
  } catch (err) {
    console.warn('[config] persist failed:', err);
  }
  _notifying = true;
  try {
    const snapshot = Array.from(_listeners);
    for (const fn of snapshot) {
      try { fn(deepClone(_cache!)); } catch (err) { console.error('[config] listener error:', err); }
    }
  } finally {
    _notifying = false;
  }
}

export function setConfigDuranteBoot(partial: DeepPartial<OrbitalConfig>): void {
  _cache = mergeDeep(getConfig(), partial);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
  } catch (err) {
    console.warn('[config] boot persist failed:', err);
  }
}

export function resetConfigForTest(): void {
  _cache = null;
  _listeners.clear();
  _notifying = false;
}
