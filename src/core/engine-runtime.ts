import { Application, Graphics } from 'pixi.js';
import type { GraphicsEngine, PixiBackend } from './config';
import { getConfig, setConfigDuranteBoot } from './config';
import { startWeydra, stopWeydra } from '../weydra-loader';

export interface EngineRuntime {
  engine: GraphicsEngine;
  app: Application;
  requestedBackend: string;
  effectiveBackend: string;
  canvas: HTMLCanvasElement;
}

let _runtime: EngineRuntime | null = null;

export function getEngineRuntime(): EngineRuntime | null {
  return _runtime;
}

function styleCanvas(canvas: HTMLCanvasElement, visible: boolean): void {
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '0';
  canvas.style.display = visible ? 'block' : 'none';
}

function createWeydraAppShim(canvas: HTMLCanvasElement): Application {
  const screen = { width: window.innerWidth, height: window.innerHeight };
  return {
    canvas,
    screen,
    renderer: {
      resize: (): void => {},
      render: (): void => {},
      resolution: 1,
    } as unknown as Application['renderer'],
    stage: {
      addChild: (): void => {},
      removeChild: (): void => {},
    } as unknown as Application['stage'],
    ticker: {
      add: (): void => {},
      deltaMS: 16,
      speed: 1,
      started: true,
      start: (): void => {},
      stop: (): void => {},
      maxFPS: 0,
      update: (): void => {},
    } as unknown as Application['ticker'],
  } as unknown as Application;
}

function pixiFallbackOrder(requested: PixiBackend): PixiBackend[] {
  const order: PixiBackend[] = [requested, 'webgl', 'webgpu', 'canvas'];
  return order.filter((v, i) => order.indexOf(v) === i);
}

async function initializePixi(): Promise<EngineRuntime> {
  const cfg = getConfig();
  const requested = cfg.rendering.pixi.backend;
  const errors: string[] = [];
  const weydraCanvas = document.getElementById('weydra-canvas') as HTMLCanvasElement | null;
  if (weydraCanvas) styleCanvas(weydraCanvas, false);

  for (const backend of pixiFallbackOrder(requested)) {
    const app = new Application();
    try {
      const init: Record<string, unknown> = {
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x000000,
        backgroundAlpha: 1,
        resolution: (window.devicePixelRatio || 1) * cfg.graphics.renderScale,
        autoDensity: true,
        antialias: false,
        preference: backend,
        powerPreference: cfg.rendering.pixi.gpuPreference === 'auto'
          ? 'high-performance'
          : cfg.rendering.pixi.gpuPreference,
      };
      if (backend === 'canvas') {
        init.resolution = 1;
        init.autoDensity = false;
      } else if (backend === 'webgl' && cfg.rendering.pixi.webglVersion !== 'auto') {
        init.preferWebGLVersion = Number(cfg.rendering.pixi.webglVersion);
      }
      await app.init(init as any);
      // Painting is driven by main.ts's frame loop (FPS cap + frame count in
      // core/frame-pacer.ts); Pixi's own ticker would render uncapped and
      // overwrite the sim delta the loop writes into it.
      app.ticker.stop();
      // Pixi silently falls back to WebGL when WebGPU isn't usable: report
      // the renderer it really built, not the one we asked for.
      const efetivo = (app.renderer as { name?: string }).name;
      const effective: PixiBackend = efetivo === 'webgpu' || efetivo === 'canvas' ? efetivo : 'webgl';
      if (effective !== backend) throw new Error(`Pixi criou ${efetivo} em vez de ${backend}`);
      // Exercise the buffer path once: some WebGPU implementations accept the
      // device and then reject the first geometry upload mid-frame, which
      // used to kill the page instead of falling back to the next backend.
      const teste = new Graphics().rect(0, 0, 4, 4).fill(0xffffff);
      try { app.renderer.render({ container: teste }); } finally { teste.destroy(); }
      app.canvas.id = 'pixi-canvas';
      styleCanvas(app.canvas, true);
      document.body.appendChild(app.canvas);
      if (backend !== requested) {
        setConfigDuranteBoot({
          rendering: {
            ...cfg.rendering,
            pixi: { ...cfg.rendering.pixi, backend },
          },
        });
      }
      return {
        engine: 'pixi', app, requestedBackend: requested,
        effectiveBackend: backend, canvas: app.canvas,
      };
    } catch (err) {
      errors.push(`${backend}: ${err instanceof Error ? err.message : String(err)}`);
      try { app.destroy(true); } catch { /* initialization never completed */ }
    }
  }
  throw new Error(`Pixi não inicializou em nenhum backend: ${errors.join(' | ')}`);
}

async function initializeWeydra(): Promise<EngineRuntime> {
  const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #weydra-canvas não encontrado.');
  const stalePixi = document.getElementById('pixi-canvas');
  stalePixi?.remove();
  styleCanvas(canvas, true);
  const result = await startWeydra();
  // The software backend may have swapped in a fresh canvas element (a canvas
  // already bound to WebGL/WebGPU can't take a 2D context) — use the live one.
  const live = (document.getElementById('weydra-canvas') as HTMLCanvasElement | null) ?? canvas;
  return {
    engine: 'weydra',
    app: createWeydraAppShim(live),
    requestedBackend: result.requestedBackend,
    effectiveBackend: result.effectiveBackend,
    canvas: live,
  };
}

export async function initializeEngineRuntime(engine = getConfig().rendering.engine): Promise<EngineRuntime> {
  if (_runtime) return _runtime;
  _runtime = engine === 'pixi' ? await initializePixi() : await initializeWeydra();
  return _runtime;
}

export function destroyEngineRuntime(): void {
  const runtime = _runtime;
  _runtime = null;
  if (!runtime) return;
  if (runtime.engine === 'weydra') {
    stopWeydra();
    styleCanvas(runtime.canvas, false);
    return;
  }
  try { runtime.app.destroy(true); } catch { /* best effort teardown */ }
  runtime.canvas.remove();
}

export function resizeEngineRuntime(): void {
  const runtime = _runtime;
  if (!runtime) return;
  if (runtime.engine === 'pixi') {
    runtime.app.renderer.resize(window.innerWidth, window.innerHeight);
  }
  runtime.app.screen.width = window.innerWidth;
  runtime.app.screen.height = window.innerHeight;
}
