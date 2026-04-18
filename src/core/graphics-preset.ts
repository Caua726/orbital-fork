import type { OrbitalConfig } from './config';
import { getConfig, setConfig } from './config';

type Nivel = OrbitalConfig['graphics']['qualidadeEfeitos'];

type FlagsDerivadas = Pick<
  OrbitalConfig['graphics'],
  'fogThrottle' | 'maxFantasmas' | 'densidadeStarfield' | 'shaderLive' | 'mostrarOrbitas'
  | 'renderScale' | 'starfieldLayers' | 'planetMaxOctaves'
>;

// Render scale is the single biggest perf knob (pixel count scales
// quadratically with the multiplier). Tying it to the preset means
// a user flipping 'minimo' on a weak machine actually feels the
// difference instead of getting fogThrottle-only savings.
const PRESETS: Record<Nivel, FlagsDerivadas> = {
  alto: {
    fogThrottle: 1,
    maxFantasmas: -1,
    densidadeStarfield: 1.0,
    shaderLive: true,
    mostrarOrbitas: true,
    renderScale: 1.0,
    starfieldLayers: 3,
    planetMaxOctaves: 6,
  },
  medio: {
    fogThrottle: 2,
    maxFantasmas: 30,
    densidadeStarfield: 0.7,
    shaderLive: true,
    mostrarOrbitas: true,
    renderScale: 0.85,
    starfieldLayers: 3,
    planetMaxOctaves: 5,
  },
  baixo: {
    fogThrottle: 3,
    maxFantasmas: 15,
    densidadeStarfield: 0.4,
    // Keep the procedural shader live even on low preset — baking
    // freezes the planet to a static snapshot which reads as broken;
    // only the truly-minimum preset trades live shading for perf.
    shaderLive: true,
    mostrarOrbitas: true,
    renderScale: 0.65,
    starfieldLayers: 2,
    planetMaxOctaves: 3,
  },
  // Minimum preset doubles as the software-renderer safety net.
  // renderScale bumped from 0.2 → 0.3 after playtests on SwiftShader
  // showed that 0.2 was technically playable (~30 FPS) but visually
  // unreadable (1920×1080 × 0.2 = 384×216 — smaller than a thumbnail).
  // 0.3 = 576×324, which is still pixel-art territory but the sun,
  // planets, and UI text stay legible. Expect ~20 FPS on software,
  // which is tight but usable.
  minimo: {
    fogThrottle: 15,
    maxFantasmas: 0,
    densidadeStarfield: 0.1,
    shaderLive: false,
    mostrarOrbitas: false,
    renderScale: 0.3,
    starfieldLayers: 1,
    planetMaxOctaves: 2,
  },
};

export function aplicarPreset(nivel: Nivel): void {
  const preset = PRESETS[nivel];
  const cfg = getConfig();
  const previo = cfg.graphics.qualidadeEfeitos;
  setConfig({
    graphics: {
      ...cfg.graphics,
      ...preset,
      qualidadeEfeitos: nivel,
    },
  });
  // Log the preset transition so profiling traces can explain a sudden
  // shift in render cost (e.g. user flipped to minimo mid-session).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logarEvento } = require('../world/profiling-logger') as typeof import('../world/profiling-logger');
    logarEvento('preset_changed', { from: previo, to: nivel, ...preset });
  } catch { /* optional */ }
}

export function presetBateComFlagsDerivadas(cfg: OrbitalConfig): boolean {
  const esperado = PRESETS[cfg.graphics.qualidadeEfeitos];
  for (const k of Object.keys(esperado) as Array<keyof FlagsDerivadas>) {
    if (cfg.graphics[k] !== esperado[k]) return false;
  }
  return true;
}
