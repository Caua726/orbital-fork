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
  // Thresholds are for the REAL post-gl.finish frame cost. Scene
  // now renders 10× per sample with 48 max-octave planets + star —
  // live gameplay is ~30× lighter than this measurement, so a fast
  // GPU has enormous headroom on the recommended preset.
  if (avgMs < 30)     return { preset: 'alto',   scale: 1.0 };
  if (avgMs < 70)     return { preset: 'medio',  scale: 1.0 };
  if (avgMs < 130)    return { preset: 'medio',  scale: 0.85 };
  if (avgMs < 220)    return { preset: 'baixo',  scale: 0.75 };
  if (avgMs < 400)    return { preset: 'baixo',  scale: 0.5 };
  return               { preset: 'minimo', scale: 0.35 };
}

async function construirCenaTeste(screenW: number, screenH: number): Promise<Container> {
  const root = new PxContainer();

  const tiposArray = Object.values(TIPO_PLANETA);
  // 48-planet grid (8 cols × 6 rows) — denser than any gameplay
  // configuration. Each mesh forced to 6 FBM octaves so every pixel
  // runs the maximum-cost fragment path.
  const cols = 8;
  const rows = 6;
  const cellW = screenW * 0.98 / cols;
  const cellH = screenH * 0.98 / rows;
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
        // Slight overlap keeps GPU from skipping boundary pixels.
        cell * 1.05,
        tipo,
        1 + Math.random() * 9,
      );
      // Force the heaviest fbm octave count on every planet so even
      // gas / dry types run the terran-level surface cost. Safe to
      // touch — if the shader path is active, the uniform group
      // accepts the write; if we're in Canvas2D mode the paleta
      // would govern instead, but the stress scene is primarily a
      // GPU benchmark.
      const shader = (mesh as any)._planetShader;
      const uniforms = shader?.resources?.planetUniforms?.uniforms;
      if (uniforms) uniforms.uOctaves = 6;
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

  try {
    while (true) {
      // rAF paces the loop politely (gives the browser time for
      // input/compositor), but the actual frame-time measurement
      // wraps render+gl.finish, NOT the rAF gap — that way vsync
      // wait doesn't pollute the sample.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      const elapsed = now - start;

      // Heavy inner loop: advance uTime for every planet between
      // renders (so the visible result is motion, not a frozen
      // frame) and render the full scene many times. 50 renders per
      // sample takes a fast desktop GPU ~50-90 ms — enough that the
      // measurement is dominated by real GPU cost, not timer noise.
      // The screen only paints the LAST render of each sample (one
      // paint per rAF), which the user perceives as smooth
      // animation because each paint is uTime-advanced.
      const INNER_RENDERS = 50;
      const renderStart = performance.now();
      for (let i = 0; i < INNER_RENDERS; i++) {
        for (const child of scene.children) {
          const u = (child as any)?._planetShader?.resources?.planetUniforms?.uniforms;
          if (u) {
            u.uTime += 0.02;
            u.uRotation += 0.01;
          }
        }
        app.renderer.render({ container: scene });
      }
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
