import type { OrbitalConfig } from './config';
import { getConfig, setConfig } from './config';

type Nivel = OrbitalConfig['graphics']['qualidadeEfeitos'];

type FlagsDerivadas = Pick<
  OrbitalConfig['graphics'],
  'fogThrottle' | 'maxFantasmas' | 'densidadeStarfield' | 'shaderLive' | 'mostrarOrbitas' | 'renderScale'
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
  },
  medio: {
    fogThrottle: 2,
    maxFantasmas: 30,
    densidadeStarfield: 0.7,
    shaderLive: true,
    mostrarOrbitas: true,
    renderScale: 0.85,
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
  },
  minimo: {
    fogThrottle: 5,
    maxFantasmas: 0,
    densidadeStarfield: 0.15,
    shaderLive: false,
    mostrarOrbitas: false,
    renderScale: 0.4,
  },
};

export function aplicarPreset(nivel: Nivel): void {
  const preset = PRESETS[nivel];
  const cfg = getConfig();
  setConfig({
    graphics: {
      ...cfg.graphics,
      ...preset,
      qualidadeEfeitos: nivel,
    },
  });
}

export function presetBateComFlagsDerivadas(cfg: OrbitalConfig): boolean {
  const esperado = PRESETS[cfg.graphics.qualidadeEfeitos];
  for (const k of Object.keys(esperado) as Array<keyof FlagsDerivadas>) {
    if (cfg.graphics[k] !== esperado[k]) return false;
  }
  return true;
}
