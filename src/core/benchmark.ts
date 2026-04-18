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

const DURATION_MS = 20000;
const WARMUP_MS = 1500;

/**
 * Block until the GPU has actually finished executing the queued
 * commands. Without this the browser batches drawcalls and rAF
 * waits for vsync — every sample comes back pinned to ~16.67 ms
 * regardless of how heavy the scene is, which made the benchmark
 * useless on any machine with vsync on. gl.finish() forces a
 * pipeline stall in WebGL; queue.onSubmittedWorkDone() is the
 * WebGPU equivalent (it's a promise).
 */
async function syncGpu(renderer: any): Promise<void> {
  try {
    if (renderer?.gl?.finish) {
      renderer.gl.finish();
      return;
    }
    const device = renderer?.gpu?.device as GPUDevice | undefined;
    if (device?.queue?.onSubmittedWorkDone) {
      await device.queue.onSubmittedWorkDone();
    }
  } catch { /* noop — best-effort */ }
}

function classificar(avgMs: number): {
  preset: OrbitalConfig['graphics']['qualidadeEfeitos'];
  scale: number;
} {
  // Thresholds target gameplay-equivalent workload: the scene
  // approximates what a player actually sees (a handful of planets
  // at mixed sizes + a sun, one render per sample, natural octave
  // counts from the palette). avgMs is the real post-gl.finish
  // frame cost for that workload. The preset is picked so that at
  // 60 FPS (16.67 ms budget) the user has headroom on 'alto'.
  if (avgMs < 4)      return { preset: 'alto',   scale: 1.0 };
  if (avgMs < 9)      return { preset: 'medio',  scale: 1.0 };
  if (avgMs < 14)     return { preset: 'medio',  scale: 0.85 };
  if (avgMs < 22)     return { preset: 'baixo',  scale: 0.75 };
  if (avgMs < 40)     return { preset: 'baixo',  scale: 0.5 };
  return               { preset: 'minimo', scale: 0.35 };
}

async function construirCenaTeste(screenW: number, screenH: number): Promise<Container> {
  const root = new PxContainer();

  const tiposArray = Object.values(TIPO_PLANETA);
  // Gameplay-representative scene: what a typical player viewport
  // looks like — a handful of planets at mixed sizes, one sun.
  // Natural octave counts from each palette (terran=6, dry=4,
  // gas=5 etc) so the measurement reflects the real fragment cost.
  const placements: Array<{ x: number; y: number; size: number; tipoIdx: number }> = [
    // Center-ish medium planet (what 'the planet you're looking at' looks like)
    { x: 0.50, y: 0.55, size: 0.42, tipoIdx: 0 },
    // Two small planets further out (orbiting neighbours)
    { x: 0.22, y: 0.30, size: 0.18, tipoIdx: 1 },
    { x: 0.80, y: 0.75, size: 0.20, tipoIdx: 2 },
    // Distant gas / islands, small
    { x: 0.75, y: 0.22, size: 0.14, tipoIdx: 3 },
    { x: 0.18, y: 0.80, size: 0.15, tipoIdx: 0 },
  ];
  const minSide = Math.min(screenW, screenH);
  for (const p of placements) {
    const mesh = criarPlanetaProceduralSprite(
      screenW * p.x,
      screenH * p.y,
      minSide * p.size,
      tiposArray[p.tipoIdx % tiposArray.length],
      1 + Math.random() * 9,
    );
    root.addChild(mesh as unknown as Container);
  }

  // Sun at the edge of the scene, typical medium size.
  const sol = criarEstrelaProcedural(screenW * 0.12, screenH * 0.15, minSide * 0.08);
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

  try {
    while (true) {
      // rAF paces the loop politely (gives the browser time for
      // input/compositor), but the actual frame-time measurement
      // wraps render+gl.finish, NOT the rAF gap — that way vsync
      // wait doesn't pollute the sample.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      const elapsed = now - start;

      // One render per sample — matches what a normal gameplay frame
      // does, so the result directly maps to expected in-game FPS.
      // Animate the uniforms so each sample is a fresh frame and the
      // GPU can't cache.
      for (const child of scene.children) {
        const u = (child as any)?._planetShader?.resources?.planetUniforms?.uniforms;
        if (u) {
          u.uTime += 0.02;
          u.uRotation += 0.01;
        }
      }
      const renderStart = performance.now();
      app.renderer.render({ container: scene });
      await syncGpu(app.renderer);
      const renderEnd = performance.now();
      const workMs = renderEnd - renderStart;

      if (elapsed >= WARMUP_MS) samples.push(workMs);
      if (onProgress) onProgress(Math.min(1, elapsed / DURATION_MS), workMs);
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
