import type { ProfilingData, Mundo } from '../types';
import { profiling } from './profiling';

/**
 * Rolling profiling capture — starts appending one sample per frame
 * into a persistent buffer when the user presses 'Record' in the
 * debug menu, stops when they press again. The buffer is then
 * serialized and offered as a JSON download so the player can send
 * it to devs for post-mortem analysis.
 *
 * The flight-recorder design (capture during play, export later) is
 * the only way to meaningfully debug 'felt slow but I couldn't
 * reproduce it' — live profiling is useless when the user is in
 * the settings menu inspecting the graph.
 */

export interface LoggedFrame {
  /** Monotonic ms since recording started. */
  t: number;
  /** Every key from ProfilingData sampled at this frame. */
  buckets: ProfilingData;
  /** Instantaneous FPS estimate from frameWall (0 when frameWall=0). */
  fps: number;
  /** JS heap used, sampled every HEAP_SAMPLE_EVERY frames (0 otherwise). */
  heapMb: number;
  /** True when the sample came from the menu ticker, false from in-game. */
  menu: boolean;
}

export interface LoggedEvent {
  t: number;
  type: string;
  data?: unknown;
}

/** Pre-computed aggregate stats over the whole captured session.
 *  Saved into the JSON so consumers don't have to re-parse 10k frames
 *  just to see "was this run healthy". */
export interface BucketStats {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface LogSession {
  // ── Timing & environment ───────────────────────────────────────
  startedAtIsoUtc: string;
  durationMs: number;
  userAgent: string;
  platform: string;
  language: string;
  viewport: { w: number; h: number; dpr: number };
  screen: { w: number; h: number; colorDepth: number };

  // ── Renderer & GPU details ─────────────────────────────────────
  rendererName: string;
  rendererBackend: string;       // 'webgl' | 'webgpu' | 'canvas'
  webglVersion: number | null;   // 1 or 2
  gpuVendor: string;
  gpuRenderer: string;
  gpuUnmaskedVendor: string;
  gpuUnmaskedRenderer: string;
  gpuMaxTextureSize: number | null;
  glExtensions: string[];
  webgpuFeatures: string[];
  webgpuLimits: Record<string, number> | null;
  softwareDetected: boolean;
  softwareDetectionKind: string;

  // ── Memory & perf timing ───────────────────────────────────────
  memory: {
    usedJsHeapSize: number;
    totalJsHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;

  // ── World snapshot at export time ──────────────────────────────
  world: {
    sistemas: number;
    planetas: number;
    planetasVisiveis: number;
    sois: number;
    naves: number;
    navesEmCombate: number;
    ias: number;
  } | null;

  // ── Config + build ─────────────────────────────────────────────
  config: unknown;
  graphicsPreset: string;
  buildMode: string;
  gitHash: string | null;

  // ── Stats + frames ─────────────────────────────────────────────
  stats: Partial<Record<keyof ProfilingData, BucketStats>>;
  frameTimeHistogram: Array<{ binMs: number; count: number }>;
  frames: LoggedFrame[];

  // ── Events (time-stamped game lifecycle markers) ──────────────
  events: LoggedEvent[];

  // ── FPS histogram for at-a-glance distribution view ───────────
  fpsHistogram: Array<{ bin: number; count: number }>;
  heapTimeline: Array<{ t: number; heapMb: number }>;
}

let _active = false;
let _startMs = 0;
let _frames: LoggedFrame[] = [];
let _events: LoggedEvent[] = [];
let _isMenu = false;
let _frameCounter = 0;
// Cap the buffer so a forgotten recording doesn't exhaust RAM. At
// 60 FPS this is ~5 minutes of samples; 120 Hz → ~2.5 min.
const MAX_FRAMES = 18_000;
// Heap sampling is cheap but let's not mutate the LoggedFrame struct
// 60 times a second when the value barely drifts. Sample every 15f
// (4× per second at 60Hz), interpolate visually if needed.
const HEAP_SAMPLE_EVERY = 15;

/**
 * Callers declare whether this sampler is being driven by the in-game
 * ticker or the menu ticker. Flips the `menu` flag on every captured
 * frame so the analyst can distinguish menu idle from gameplay load.
 */
export function setLoggerContexto(menu: boolean): void {
  _isMenu = menu;
}

/**
 * Log a timestamped lifecycle event (game started, world loaded,
 * settings changed, etc). Captured verbatim in the export so the
 * consumer can correlate FPS drops with what the user did.
 */
export function logarEvento(type: string, data?: unknown): void {
  if (!_active) return;
  _events.push({ t: performance.now() - _startMs, type, data });
}

export function iniciarLoggingProfiling(): void {
  if (_active) return;
  _active = true;
  _startMs = performance.now();
  _frames = [];
  _events = [];
  _frameCounter = 0;
  _events.push({ t: 0, type: 'logger_started', data: { menu: _isMenu } });
}

export function pararLoggingProfiling(): void {
  _active = false;
}

export function estaLoggingProfiling(): boolean {
  return _active;
}

/** How many frames have been captured so far. */
export function getFramesCapturadosCount(): number {
  return _frames.length;
}

/**
 * Called once per frame by the main ticker when recording is on.
 * Snapshots the current ProfilingData averages (cheap — they're
 * already computed by profileFlush).
 */
export function amostrarFrameProfiling(): void {
  if (!_active) return;
  if (_frames.length >= MAX_FRAMES) {
    _events.push({ t: performance.now() - _startMs, type: 'buffer_full_stopped' });
    _active = false;
    return;
  }
  _frameCounter++;
  const frameWall = profiling.frameWall || 0;
  const fps = frameWall > 0 ? 1000 / frameWall : 0;
  let heapMb = 0;
  if (_frameCounter % HEAP_SAMPLE_EVERY === 0) {
    const pm = (performance as any).memory;
    if (pm && typeof pm.usedJSHeapSize === 'number') {
      heapMb = pm.usedJSHeapSize / (1024 * 1024);
    }
  }
  _frames.push({
    t: performance.now() - _startMs,
    buckets: { ...profiling },
    fps,
    heapMb,
    menu: _isMenu,
  });
}

/** Quantile over a Float array (non-destructive). Returns 0 if empty. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(base + 1, sorted.length - 1)];
  return sorted[base] + rest * (next - sorted[base]);
}

function computarStats(
  frames: LoggedFrame[],
  keys: Array<keyof ProfilingData>,
): Partial<Record<keyof ProfilingData, BucketStats>> {
  const out: Partial<Record<keyof ProfilingData, BucketStats>> = {};
  if (frames.length === 0) return out;
  const col: number[] = new Array(frames.length);
  for (const k of keys) {
    for (let i = 0; i < frames.length; i++) col[i] = frames[i].buckets[k] ?? 0;
    col.sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < col.length; i++) sum += col[i];
    out[k] = {
      avg: sum / col.length,
      p50: quantile(col, 0.5),
      p95: quantile(col, 0.95),
      p99: quantile(col, 0.99),
      min: col[0],
      max: col[col.length - 1],
    };
  }
  return out;
}

/** Bin frame wall times into 2ms buckets so the consumer can see the
 *  shape of the distribution (bimodal stutters vs. clean runs). */
function histogramaFrameWall(frames: LoggedFrame[]): Array<{ binMs: number; count: number }> {
  if (frames.length === 0) return [];
  const BIN = 2; // ms per bucket
  const bins = new Map<number, number>();
  for (const f of frames) {
    const v = f.buckets.frameWall || 0;
    const key = Math.floor(v / BIN) * BIN;
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  return Array.from(bins.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([binMs, count]) => ({ binMs, count }));
}

/** FPS histogram in 5-FPS bins clamped [0, 240]. */
function histogramaFps(frames: LoggedFrame[]): Array<{ bin: number; count: number }> {
  if (frames.length === 0) return [];
  const BIN = 5;
  const bins = new Map<number, number>();
  for (const f of frames) {
    const v = Math.min(240, Math.max(0, f.fps || 0));
    const key = Math.floor(v / BIN) * BIN;
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  return Array.from(bins.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bin, count]) => ({ bin, count }));
}

/** Compact heap timeline: only frames where heapMb was actually sampled. */
function timelineHeap(frames: LoggedFrame[]): Array<{ t: number; heapMb: number }> {
  const out: Array<{ t: number; heapMb: number }> = [];
  for (const f of frames) if (f.heapMb > 0) out.push({ t: f.t, heapMb: f.heapMb });
  return out;
}

/**
 * Bundle the captured frames + comprehensive environment metadata
 * into a session object. Whatever a remote debugger might need to
 * reproduce or understand the session — we dump it here. JSON size
 * tends to be dominated by the frame array; env/aggregates stay
 * under a few KB.
 */
function montarSessao(
  app: { renderer?: any } | null,
  config: unknown,
  mundo: Mundo | null,
): LogSession {
  const r = app?.renderer;
  const rendererName = String(r?.name ?? r?.type ?? 'desconhecido');

  // ── GPU probing ───────────────────────────────────────────────
  let gpuVendor = 'desconhecido';
  let gpuRenderer = 'desconhecido';
  let gpuUnmaskedVendor = '';
  let gpuUnmaskedRenderer = '';
  let webglVersion: number | null = null;
  let gpuMaxTextureSize: number | null = null;
  const glExtensions: string[] = [];
  const webgpuFeatures: string[] = [];
  let webgpuLimits: Record<string, number> | null = null;
  let softwareDetected = false;
  let softwareDetectionKind = '';
  let rendererBackend = 'unknown';

  try {
    const gl = r?.gl as WebGLRenderingContext | WebGL2RenderingContext | undefined;
    if (gl) {
      rendererBackend = 'webgl';
      webglVersion = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 2 : 1;
      gpuMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      gpuVendor = String(gl.getParameter(gl.VENDOR) ?? '');
      gpuRenderer = String(gl.getParameter(gl.RENDERER) ?? '');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        gpuUnmaskedVendor = String(gl.getParameter((ext as any).UNMASKED_VENDOR_WEBGL) ?? '');
        gpuUnmaskedRenderer = String(gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) ?? '');
      }
      const exts = gl.getSupportedExtensions();
      if (exts) glExtensions.push(...exts);
    }
    const adapter = r?.gpu?.adapter as GPUAdapter | undefined;
    if (adapter) {
      rendererBackend = 'webgpu';
      if (adapter.info) {
        gpuVendor = adapter.info.vendor || gpuVendor;
        gpuRenderer = adapter.info.description || adapter.info.device || adapter.info.architecture || gpuRenderer;
      }
      try {
        for (const f of adapter.features as Set<string>) webgpuFeatures.push(f);
        const limits: Record<string, number> = {};
        const lobj = adapter.limits as any;
        for (const k in lobj) if (typeof lobj[k] === 'number') limits[k] = lobj[k];
        webgpuLimits = limits;
      } catch { /* best-effort */ }
    }
    if (rendererName.toLowerCase().includes('canvas')) rendererBackend = 'canvas';
  } catch { /* best-effort */ }

  // ── Software detection (uses same probe as boot-time auto-preset) ──
  try {
    // Dynamic import to dodge circular reference in build graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const det = require('../core/benchmark') as typeof import('../core/benchmark');
    if (app && (app as any).renderer) {
      const sw = det.detectarRendererSoftware(app as any);
      softwareDetected = sw.isSoftware;
      softwareDetectionKind = sw.kind || '';
    }
  } catch { /* optional */ }

  // ── Memory snapshot (Chrome only exposes performance.memory) ──
  let memory: LogSession['memory'] = null;
  const pm = (performance as any).memory;
  if (pm) {
    memory = {
      usedJsHeapSize: pm.usedJSHeapSize,
      totalJsHeapSize: pm.totalJSHeapSize,
      jsHeapSizeLimit: pm.jsHeapSizeLimit,
    };
  }

  // ── World snapshot ────────────────────────────────────────────
  let world: LogSession['world'] = null;
  if (mundo) {
    const navesEmCombate = mundo.naves.filter((n) => (n as any)._ultimoTiroMs !== undefined).length;
    const ias = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ia = require('./ia-decisao') as typeof import('./ia-decisao');
        return ia.getPersonalidades().length;
      } catch { return 0; }
    })();
    world = {
      sistemas: mundo.sistemas.length,
      planetas: mundo.planetas.length,
      planetasVisiveis: mundo.planetas.filter((p) => p._visivelAoJogador).length,
      sois: mundo.sois.length,
      naves: mundo.naves.length,
      navesEmCombate,
      ias,
    };
  }

  // ── Build metadata ────────────────────────────────────────────
  const buildMode = (import.meta as any).env?.MODE ?? 'unknown';
  const gitHash = (import.meta as any).env?.VITE_GIT_HASH ?? null;
  const graphicsPreset = String((config as any)?.graphics?.qualidadeEfeitos ?? 'unknown');

  // ── Aggregates over captured frames ───────────────────────────
  const framesSnapshot = [..._frames];
  const eventsSnapshot = [..._events];
  const statsKeys = Object.keys(framesSnapshot[0]?.buckets ?? {}) as Array<keyof ProfilingData>;
  const stats = computarStats(framesSnapshot, statsKeys);
  const frameTimeHistogram = histogramaFrameWall(framesSnapshot);
  const fpsHistogram = histogramaFps(framesSnapshot);
  const heapTimeline = timelineHeap(framesSnapshot);

  const durationMs = framesSnapshot.length > 0
    ? framesSnapshot[framesSnapshot.length - 1].t - framesSnapshot[0].t
    : 0;

  return {
    startedAtIsoUtc: new Date(Date.now() - (performance.now() - _startMs)).toISOString(),
    durationMs,
    userAgent: navigator.userAgent,
    platform: (navigator as any).platform || '',
    language: navigator.language || '',
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    screen: {
      w: window.screen.width,
      h: window.screen.height,
      colorDepth: window.screen.colorDepth,
    },
    rendererName,
    rendererBackend,
    webglVersion,
    gpuVendor,
    gpuRenderer,
    gpuUnmaskedVendor,
    gpuUnmaskedRenderer,
    gpuMaxTextureSize,
    glExtensions,
    webgpuFeatures,
    webgpuLimits,
    softwareDetected,
    softwareDetectionKind,
    memory,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemoryGb: (navigator as any).deviceMemory ?? null,
    world,
    config,
    graphicsPreset,
    buildMode,
    gitHash,
    stats,
    frameTimeHistogram,
    frames: framesSnapshot,
    events: eventsSnapshot,
    fpsHistogram,
    heapTimeline,
  };
}

/**
 * Pack the captured session into a JSON blob and trigger a browser
 * download. Does NOT stop recording — caller should do that first if
 * they want the final snapshot.
 */
export function baixarLogProfiling(
  app: { renderer?: any } | null,
  config: unknown,
  mundo: Mundo | null = null,
): void {
  const sessao = montarSessao(app, config, mundo);
  const json = JSON.stringify(sessao, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `orbital-profiling-${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick — the browser has already started the download.
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function limparLogProfiling(): void {
  _frames = [];
  _startMs = performance.now();
}
