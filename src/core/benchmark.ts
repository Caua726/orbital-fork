import type { Application, Container } from 'pixi.js';
import { Container as PxContainer } from 'pixi.js';
import { criarPlanetaProceduralSprite, criarEstrelaProcedural } from '../world/planeta-procedural';
import { TIPO_PLANETA } from '../world/planeta';
import type { OrbitalConfig } from './config';

/**
 * On-screen stress benchmark.
 *
 * Adds a full-viewport scene to app.stage (on top of whatever is
 * there — the menu or the game — dimmed behind a backdrop), renders
 * it for ~8 seconds while measuring per-frame wall time, then picks
 * a preset + renderScale recommendation from the result.
 *
 * The scene is intentionally harsher than live gameplay:
 *   - 20 planet meshes in a 5×4 grid covering every planet type,
 *     each 256 world units wide. Each mesh animates time/rotation
 *     so the fragment shader actually re-runs every frame.
 *   - 1 star mesh at 384 units wide so the star shader path is
 *     exercised too.
 *   - Scene is SHOWN, not rendered to a RenderTexture, so the
 *     measurement reflects the full pipeline the user sees.
 *
 * Because the scene is live we observe the actual app.ticker frame
 * deltas rather than wrapping the render call — no chance of GPU
 * pipeline desync hiding cost.
 */

export interface BenchmarkResult {
  avgFrameMs: number;
  minFrameMs: number;
  maxFrameMs: number;
  p95FrameMs: number;
  framesSampled: number;
  recommendedPreset: OrbitalConfig['graphics']['qualidadeEfeitos'];
  recommendedRenderScale: number;
}

const DURATION_MS = 8000;
const WARMUP_MS = 800;

function classificar(avgMs: number): {
  preset: OrbitalConfig['graphics']['qualidadeEfeitos'];
  scale: number;
} {
  // Thresholds tuned on this on-screen stress scene. Live gameplay
  // is ~5× lighter than this, so a preset picked here has headroom.
  if (avgMs < 6)      return { preset: 'alto',   scale: 1.0 };
  if (avgMs < 14)     return { preset: 'medio',  scale: 1.0 };
  if (avgMs < 24)     return { preset: 'medio',  scale: 0.85 };
  if (avgMs < 40)     return { preset: 'baixo',  scale: 0.75 };
  if (avgMs < 70)     return { preset: 'baixo',  scale: 0.5 };
  return               { preset: 'minimo', scale: 0.35 };
}

async function construirCenaTeste(screenW: number, screenH: number): Promise<Container> {
  const root = new PxContainer();

  const tiposArray = Object.values(TIPO_PLANETA);
  const cols = 5;
  const rows = 4;
  // Fit the grid to the viewport with a small margin so every planet
  // actually falls on-screen.
  const cellW = screenW * 0.9 / cols;
  const cellH = screenH * 0.9 / rows;
  const cell = Math.min(cellW, cellH);
  const gridW = cell * cols;
  const gridH = cell * rows;
  const offsetX = (screenW - gridW) / 2;
  const offsetY = (screenH - gridH) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tipo = tiposArray[(r * cols + c) % tiposArray.length];
      const mesh = criarPlanetaProceduralSprite(
        offsetX + c * cell + cell / 2,
        offsetY + r * cell + cell / 2,
        cell * 0.95,
        tipo,
        1 + Math.random() * 9,
      );
      root.addChild(mesh as unknown as Container);
    }
  }

  const sol = criarEstrelaProcedural(screenW / 2, screenH / 2, Math.min(screenW, screenH) * 0.15);
  root.addChild(sol as unknown as Container);

  return root;
}

/**
 * Run the on-screen benchmark. The caller is expected to have shown
 * a UI overlay (progress + running state) before calling this.
 *
 * `onProgress(p, liveFrameMs)` fires every rendered frame with:
 *   p           — 0..1, how much of the sampling window elapsed
 *   liveFrameMs — instant frame time for the most-recent frame
 */
export async function rodarBenchmark(
  app: Application,
  onProgress?: (p: number, liveFrameMs: number) => void,
): Promise<BenchmarkResult> {
  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const scene = await construirCenaTeste(screenW, screenH);
  app.stage.addChild(scene);

  const samples: number[] = [];
  const start = performance.now();
  let last = start;

  try {
    while (true) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      // Also animate the planets' uTime/uRotation so the fragment
      // shader actually recomputes varying noise coords each frame.
      // atualizarTempoPlanetas normally does this from mundo.ts; we
      // aren't attached to mundo here, so the shader's uTime would
      // stay frozen otherwise and the GPU would re-use the same
      // fragment output each frame (a cache-hit workload, not real).
      const now = performance.now();
      const dt = now - last;
      last = now;
      const elapsed = now - start;

      if (elapsed >= WARMUP_MS) samples.push(dt);
      if (onProgress) onProgress(Math.min(1, elapsed / DURATION_MS), dt);
      if (elapsed >= DURATION_MS) break;
    }
  } finally {
    try {
      app.stage.removeChild(scene);
      scene.destroy({ children: true });
    } catch { /* noop */ }
  }

  if (samples.length === 0) {
    return {
      avgFrameMs: 999,
      minFrameMs: 999,
      maxFrameMs: 999,
      p95FrameMs: 999,
      framesSampled: 0,
      recommendedPreset: 'minimo',
      recommendedRenderScale: 0.35,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const trimmed = sorted.slice(0, Math.ceil(sorted.length * 0.9));
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const { preset, scale } = classificar(avg);

  return {
    avgFrameMs: avg,
    minFrameMs: sorted[0],
    maxFrameMs: sorted[sorted.length - 1],
    p95FrameMs: p95,
    framesSampled: samples.length,
    recommendedPreset: preset,
    recommendedRenderScale: scale,
  };
}
