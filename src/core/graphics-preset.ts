import type { OrbitalConfig } from './config';
import { getConfig, setConfig } from './config';

type Nivel = OrbitalConfig['graphics']['qualidadeEfeitos'];

type FlagsDerivadas = Pick<
  OrbitalConfig['graphics'],
  'fogThrottle' | 'maxFantasmas' | 'densidadeStarfield' | 'shaderLive' | 'mostrarOrbitas'
>;

const PRESETS: Record<Nivel, FlagsDerivadas> = {
  alto: {
    fogThrottle: 1,
    maxFantasmas: -1,
    densidadeStarfield: 1.0,
    shaderLive: true,
    mostrarOrbitas: true,
  },
  medio: {
    fogThrottle: 2,
    maxFantasmas: 30,
    densidadeStarfield: 0.7,
    shaderLive: true,
    mostrarOrbitas: true,
  },
  baixo: {
    fogThrottle: 3,
    maxFantasmas: 15,
    densidadeStarfield: 0.4,
    shaderLive: false,
    mostrarOrbitas: true,
  },
  minimo: {
    fogThrottle: 5,
    maxFantasmas: 0,
    densidadeStarfield: 0.15,
    shaderLive: false,
    mostrarOrbitas: false,
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
