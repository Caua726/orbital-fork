/**
 * CPU "shaders" for the weydra software backend — the same procedural
 * rasterizers the Pixi canvas backend uses (planeta-canvas.ts, starfield-cpu.ts),
 * adapted to the uniform snapshots the software renderer hands out.
 */
import type { SoftwareHooks } from '@weydra/renderer';
import { renderPlanetParaImageData } from './planeta-canvas';
import { desenharStarfieldCpu } from './starfield-cpu';
import type { PaletaPlaneta } from './planeta-procedural';

export function criarSoftwareHooks(): SoftwareHooks {
  return {
    rasterPlanet(dst, size, u) {
      const paleta: PaletaPlaneta = {
        planetType: u.uPlanetType,
        colors: u.colors,
        riverCutoff: u.uRiverCutoff,
        landCutoff: u.uLandCutoff,
        cloudCover: u.uCloudCover,
        stretch: u.uStretch,
        cloudCurve: u.uCloudCurve,
        lightBorder1: u.uLightBorder1,
        lightBorder2: u.uLightBorder2,
        octaves: u.uOctaves,
        size: u.uSize,
        timeSpeed: u.uTimeSpeed,
        ditherSize: u.uDitherSize,
        tiles: u.uTiles,
        cloudAlpha: u.uCloudAlpha,
      };
      renderPlanetParaImageData(dst, size, size, paleta, {
        uTime: u.uTime,
        uRotation: u.uRotation,
        uLightOriginX: u.uLightOrigin[0],
        uLightOriginY: u.uLightOrigin[1],
      }, size, u.uSeed);
    },
    drawStarfield(ctx, w, h, cam, density) {
      desenharStarfieldCpu(ctx, w, h, cam.x, cam.y, cam.vw, cam.vh, cam.time, density);
    },
  };
}
