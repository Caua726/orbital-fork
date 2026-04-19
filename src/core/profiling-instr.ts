/**
 * Profiling instrumentation — cobre o que está FORA do atualizarMundo
 * (94% do tempo do frame num caso real de profiling mobile). Mede o
 * trabalho do browser que o profiling.ts não vê: long tasks, paint,
 * layout shift, input delay, contagem de DOM nodes, listeners ativos,
 * animações CSS, panels visíveis, backdrop-filter, setTimeout pendentes.
 *
 * Módulo "cold" — instala hooks sob demanda via `instalarInstrumentacao()`.
 * Desligar não desfaz os hooks (browser não permite removê-los de forma
 * barata), mas para de coletar amostras.
 */

// ─── Long tasks ────────────────────────────────────────────────────
export interface LongTaskContext {
  openModal: string | null;
  drawerOpen: boolean;
  focusedTag: string;
  focusedClass: string;
  nodeCount: number;
  listeners: number;
  animations: number;
  visibleHudPanels: number;
  backdropFilterCount: number;
  timers: number;
  rafs: number;
  lastEventName: string;
  lastEventTimeMs: number;
}

export interface LongTaskSample {
  t: number;          // performance.now() do início
  duration: number;   // ms
  name: string;       // tipo do entry (geralmente 'self')
  containerType?: string;
  containerName?: string;
  /** Rich context — only captured for long tasks >=100ms to keep
   *  the cost bounded. */
  context?: LongTaskContext;
}

// Track last user event so long-task context can correlate "what did
// the user just do". Updated at capture phase via document listener.
let _lastEventName = '';
let _lastEventTimeMs = 0;
if (typeof document !== 'undefined') {
  const trackEvents = ['click', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'wheel'];
  for (const type of trackEvents) {
    document.addEventListener(type, (e) => {
      _lastEventName = e.type;
      _lastEventTimeMs = performance.now();
    }, { capture: true, passive: true });
  }
}

function captureLongTaskContext(): LongTaskContext {
  let openModal: string | null = null;
  for (const cls of [
    'planet-details-modal', 'empire-modal', 'colony-modal',
    'settings-overlay', 'lore-modal', 'save-modal',
    'renderer-info-modal', 'new-world-modal', 'pause-menu',
  ]) {
    const el = document.querySelector('.' + cls);
    if (el && el.classList.contains('visible')) { openModal = cls; break; }
  }
  const drawerOpen = !!document.querySelector('.planeta-drawer, .mpd-container.visible');
  const f = document.activeElement as HTMLElement | null;
  const snap = snapshotDom();
  return {
    openModal,
    drawerOpen,
    focusedTag: f?.tagName ?? '',
    focusedClass: typeof f?.className === 'string' ? f.className.slice(0, 80) : '',
    nodeCount: snap.nodeCount,
    listeners: _listenersActive,
    animations: snap.animationCount,
    visibleHudPanels: snap.visibleHudPanelCount,
    backdropFilterCount: snap.backdropFilterCount,
    timers: _timersActive,
    rafs: _rafsActive,
    lastEventName: _lastEventName,
    lastEventTimeMs: _lastEventTimeMs,
  };
}

const _longTasks: LongTaskSample[] = [];
const MAX_LONG_TASKS = 200;

// ─── Layout shift ──────────────────────────────────────────────────
export interface LayoutShiftSample {
  t: number;
  value: number;      // CLS contribution
  hadRecentInput: boolean;
}
const _layoutShifts: LayoutShiftSample[] = [];
const MAX_LAYOUT_SHIFTS = 200;

// ─── Paint entries (FP/FCP) ───────────────────────────────────────
export interface PaintSample {
  name: string;       // 'first-paint' | 'first-contentful-paint'
  t: number;
}
const _paints: PaintSample[] = [];

// ─── Input delay (event timing) ────────────────────────────────────
export interface EventSample {
  t: number;
  name: string;       // event name (click, pointerdown, etc.)
  duration: number;   // processingEnd - startTime
  processingDelay: number; // processingStart - startTime (input lag)
}
const _events: EventSample[] = [];
const MAX_EVENTS = 200;

// ─── Counters (wrapped APIs) ───────────────────────────────────────
let _listenersActive = 0;
let _timersActive = 0;
let _rafsActive = 0;

// ─── Instrumented originals ───────────────────────────────────────
let _installed = false;
let _enabled = false;

/**
 * Instala os hooks. Idempotente. Chama uma vez no boot; `setEnabled`
 * controla se novas amostras são acumuladas.
 */
export function instalarInstrumentacao(): void {
  if (_installed) return;
  _installed = true;
  _enabled = true;

  // ─── PerformanceObservers ────────────────────────────────────────
  // Cada observer é tentado isolado — nem todos são suportados em
  // todos os browsers (longtask é mais raro no Safari, event é raro
  // no Firefox antigo, etc.).
  trySubscribe('longtask', (list) => {
    if (!_enabled) return;
    for (const entry of list.getEntries()) {
      const sample: LongTaskSample = {
        t: entry.startTime,
        duration: entry.duration,
        name: entry.name,
        containerType: (entry as unknown as { containerType?: string }).containerType,
        containerName: (entry as unknown as { containerName?: string }).containerName,
      };
      // Capture rich context for any long task >=100ms — the really
      // painful ones. Covers what the user was interacting with, which
      // UI panel was open, DOM/listener counts at the moment.
      if (entry.duration >= 100) {
        sample.context = captureLongTaskContext();
      }
      _longTasks.push(sample);
      if (_longTasks.length > MAX_LONG_TASKS) _longTasks.shift();
    }
  });

  trySubscribe('layout-shift', (list) => {
    if (!_enabled) return;
    for (const entry of list.getEntries() as unknown as Array<{
      startTime: number; value: number; hadRecentInput: boolean;
    }>) {
      _layoutShifts.push({
        t: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput,
      });
      if (_layoutShifts.length > MAX_LAYOUT_SHIFTS) _layoutShifts.shift();
    }
  });

  trySubscribe('paint', (list) => {
    for (const entry of list.getEntries()) {
      _paints.push({ name: entry.name, t: entry.startTime });
    }
  });

  trySubscribe('event', (list) => {
    if (!_enabled) return;
    for (const entry of list.getEntries() as unknown as Array<{
      name: string; startTime: number; duration: number; processingStart: number;
    }>) {
      // Only keep slow events (duration > 16ms).
      if (entry.duration < 16) continue;
      _events.push({
        t: entry.startTime,
        name: entry.name,
        duration: entry.duration,
        processingDelay: entry.processingStart - entry.startTime,
      });
      if (_events.length > MAX_EVENTS) _events.shift();
    }
  }, { durationThreshold: 16 } as unknown as PerformanceObserverInit);

  // ─── Wrap addEventListener / removeEventListener for live count ──
  // Each target type (Window, Document, Element, etc.) inherits from
  // EventTarget. Patch there once to count across all targets.
  const etProto = EventTarget.prototype;
  const origAdd = etProto.addEventListener;
  const origRemove = etProto.removeEventListener;
  etProto.addEventListener = function (...args: Parameters<typeof origAdd>) {
    _listenersActive++;
    return origAdd.apply(this, args);
  };
  etProto.removeEventListener = function (...args: Parameters<typeof origRemove>) {
    _listenersActive = Math.max(0, _listenersActive - 1);
    return origRemove.apply(this, args);
  };

  // ─── Wrap setTimeout / setInterval for live count ─────────────────
  // (TS complained about Node's NodeJS.Timeout return type; we cast
  // through `unknown` to stay compatible with both DOM and Node types.)
  const w = window as unknown as Record<string, unknown>;
  const origSetTimeout = w.setTimeout as (...a: unknown[]) => number;
  const origClearTimeout = w.clearTimeout as (id: number) => void;
  const origSetInterval = w.setInterval as (...a: unknown[]) => number;
  const origClearInterval = w.clearInterval as (id: number) => void;
  const activeTimers = new Set<number>();
  w.setTimeout = function wrappedSetTimeout(...args: unknown[]) {
    const handler = args[0];
    if (typeof handler === 'function') {
      const originalCb = handler as (...rest: unknown[]) => unknown;
      args[0] = (...rest: unknown[]) => {
        activeTimers.delete(id);
        _timersActive = activeTimers.size;
        return originalCb(...rest);
      };
    }
    const id = origSetTimeout.apply(window, args) as unknown as number;
    activeTimers.add(id);
    _timersActive = activeTimers.size;
    return id;
  };
  w.clearTimeout = function wrappedClearTimeout(id: number) {
    if (id != null) activeTimers.delete(id);
    _timersActive = activeTimers.size;
    return origClearTimeout.call(window, id);
  };
  w.setInterval = function wrappedSetInterval(...args: unknown[]) {
    const id = origSetInterval.apply(window, args) as unknown as number;
    activeTimers.add(id);
    _timersActive = activeTimers.size;
    return id;
  };
  w.clearInterval = function wrappedClearInterval(id: number) {
    if (id != null) activeTimers.delete(id);
    _timersActive = activeTimers.size;
    return origClearInterval.call(window, id);
  };

  // ─── Wrap requestAnimationFrame / cancelAnimationFrame ────────────
  const origRaf = window.requestAnimationFrame;
  const origCaf = window.cancelAnimationFrame;
  const activeRafs = new Set<number>();
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const wrapped: FrameRequestCallback = (ts) => {
      activeRafs.delete(id);
      _rafsActive = activeRafs.size;
      cb(ts);
    };
    const id = origRaf.call(window, wrapped);
    activeRafs.add(id);
    _rafsActive = activeRafs.size;
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    activeRafs.delete(id);
    _rafsActive = activeRafs.size;
    return origCaf.call(window, id);
  }) as typeof window.cancelAnimationFrame;
}

function trySubscribe(
  type: string,
  handler: (list: PerformanceObserverEntryList) => void,
  extra?: PerformanceObserverInit,
): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const obs = new PerformanceObserver(handler);
    obs.observe({ type, buffered: true, ...(extra ?? {}) });
  } catch {
    // unsupported entry type on this browser
  }
}

export function setInstrumentacaoEnabled(v: boolean): void {
  _enabled = v;
}

export function isInstrumentacaoEnabled(): boolean {
  return _enabled;
}

// ─── Snapshot APIs ─────────────────────────────────────────────────

/** Snapshot caro — varre o DOM. Chame com cadência baixa (1-2Hz). */
export interface DomSnapshot {
  nodeCount: number;
  styleCount: number;
  canvasCount: number;
  backdropFilterCount: number;
  visibleModalCount: number;
  visibleHudPanelCount: number;
  animationCount: number;
  detachedLikely: number; // heuristic: count of document.body parent chains that don't reach html
}

export function snapshotDom(): DomSnapshot {
  const all = document.querySelectorAll('*');
  let styleCount = 0, canvasCount = 0, backdropFilterCount = 0;
  let visibleModalCount = 0, visibleHudPanelCount = 0;
  all.forEach((el) => {
    const tag = el.tagName;
    if (tag === 'STYLE') styleCount++;
    else if (tag === 'CANVAS') canvasCount++;
    // Visible HUD-ish panels: hud-panel, modals, drawers, tooltips.
    const cls = (el as HTMLElement).className;
    if (typeof cls === 'string') {
      if (cls.includes('hud-panel')) visibleHudPanelCount++;
      if (cls.includes('modal') && cls.includes('visible')) visibleModalCount++;
    }
    // Computed-style check is expensive — do it only on elements
    // we suspect could have backdrop-filter (HUD-ish classes).
    if (typeof cls === 'string' && (cls.includes('hud-') || cls.includes('modal') || cls.includes('drawer') || cls.includes('tooltip') || cls.includes('toast'))) {
      const cs = getComputedStyle(el);
      const bf = (cs as unknown as { backdropFilter?: string }).backdropFilter
        ?? (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter
        ?? '';
      if (bf && bf !== 'none' && !bf.includes('blur(0')) backdropFilterCount++;
    }
  });
  // Anims via getAnimations (includes CSS + WAAPI).
  let animationCount = 0;
  try {
    animationCount = document.getAnimations?.().length ?? 0;
  } catch { /* ignore */ }
  return {
    nodeCount: all.length,
    styleCount,
    canvasCount,
    backdropFilterCount,
    visibleModalCount,
    visibleHudPanelCount,
    animationCount,
    detachedLikely: 0,
  };
}

/** Current live counter values. Cheap — just reads numbers. */
export function getCounters(): {
  listeners: number; timers: number; rafs: number;
  longTasks: number; layoutShifts: number; slowEvents: number;
} {
  return {
    listeners: _listenersActive,
    timers: _timersActive,
    rafs: _rafsActive,
    longTasks: _longTasks.length,
    layoutShifts: _layoutShifts.length,
    slowEvents: _events.length,
  };
}

// ─── Read-only views for the logger + debug HUD ───────────────────
export function getLongTasks(): ReadonlyArray<LongTaskSample> { return _longTasks; }
export function getLayoutShifts(): ReadonlyArray<LayoutShiftSample> { return _layoutShifts; }
export function getPaints(): ReadonlyArray<PaintSample> { return _paints; }
export function getSlowEvents(): ReadonlyArray<EventSample> { return _events; }

/** Clears all buffers (called when user starts a fresh logging session). */
export function resetInstrumentacao(): void {
  _longTasks.length = 0;
  _layoutShifts.length = 0;
  _events.length = 0;
  // Keep _paints — FCP/FP are one-shot per page load.
}

/** Compute cumulative layout shift since instrumentation started. */
export function getCLS(): number {
  let cls = 0;
  for (const s of _layoutShifts) {
    if (!s.hadRecentInput) cls += s.value;
  }
  return cls;
}

// ─── Network / battery / orientation / visibility ─────────────────

export interface NetInfo {
  type: string;
  effectiveType: string;
  downlinkMbps: number;
  rttMs: number;
  saveData: boolean;
}
export function getNetInfo(): NetInfo | null {
  const c = (navigator as unknown as { connection?: {
    type?: string; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean;
  } }).connection;
  if (!c) return null;
  return {
    type: c.type ?? '',
    effectiveType: c.effectiveType ?? '',
    downlinkMbps: c.downlink ?? 0,
    rttMs: c.rtt ?? 0,
    saveData: c.saveData ?? false,
  };
}

export interface BatteryInfo {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}
let _batteryCache: BatteryInfo | null = null;
export function getBatteryInfo(): BatteryInfo | null {
  return _batteryCache;
}

async function snapshotBattery(): Promise<void> {
  const getBattery = (navigator as unknown as { getBattery?: () => Promise<{
    level: number; charging: boolean; chargingTime: number; dischargingTime: number;
  }> }).getBattery;
  if (!getBattery) return;
  try {
    const b = await getBattery.call(navigator);
    _batteryCache = {
      level: b.level,
      charging: b.charging,
      chargingTime: b.chargingTime,
      dischargingTime: b.dischargingTime,
    };
  } catch { /* ignore */ }
}

export interface OrientationInfo {
  type: string;
  angle: number;
}
export function getOrientation(): OrientationInfo | null {
  const o = (screen as unknown as { orientation?: { type?: string; angle?: number } }).orientation;
  if (!o) return null;
  return { type: o.type ?? '', angle: o.angle ?? 0 };
}

export function getVisibilityState(): string {
  return document.visibilityState;
}

// ─── Navigation & resource timing (one-shot, page-load context) ───

export interface NavTiming {
  domContentLoadedMs: number;
  loadEventEndMs: number;
  domInteractiveMs: number;
  firstPaintMs: number;
  firstContentfulPaintMs: number;
  transferSizeKb: number;
  encodedBodySizeKb: number;
  ttfbMs: number;  // time-to-first-byte
}
export function getNavTiming(): NavTiming | null {
  try {
    const [nav] = performance.getEntriesByType('navigation') as unknown as Array<{
      domContentLoadedEventEnd: number; loadEventEnd: number; domInteractive: number;
      transferSize: number; encodedBodySize: number; responseStart: number; startTime: number;
    }>;
    if (!nav) return null;
    const fp = _paints.find((p) => p.name === 'first-paint')?.t ?? 0;
    const fcp = _paints.find((p) => p.name === 'first-contentful-paint')?.t ?? 0;
    return {
      domContentLoadedMs: nav.domContentLoadedEventEnd,
      loadEventEndMs: nav.loadEventEnd,
      domInteractiveMs: nav.domInteractive,
      firstPaintMs: fp,
      firstContentfulPaintMs: fcp,
      transferSizeKb: nav.transferSize / 1024,
      encodedBodySizeKb: nav.encodedBodySize / 1024,
      ttfbMs: nav.responseStart - nav.startTime,
    };
  } catch { return null; }
}

export interface ResourceAgg {
  count: number;
  totalTransferKb: number;
  biggestName: string;
  biggestKb: number;
  slowestName: string;
  slowestMs: number;
}
export function getResourceAgg(): ResourceAgg {
  const entries = performance.getEntriesByType('resource') as unknown as Array<{
    name: string; transferSize: number; duration: number;
  }>;
  let total = 0, biggestKb = 0, biggestName = '', slowestMs = 0, slowestName = '';
  for (const e of entries) {
    const kb = (e.transferSize ?? 0) / 1024;
    total += kb;
    if (kb > biggestKb) { biggestKb = kb; biggestName = e.name.split('/').pop() ?? e.name; }
    if ((e.duration ?? 0) > slowestMs) { slowestMs = e.duration; slowestName = e.name.split('/').pop() ?? e.name; }
  }
  return { count: entries.length, totalTransferKb: total, biggestName, biggestKb, slowestName, slowestMs };
}

// ─── Gameplay event counters (per-tick, reset on flush) ──────────

export interface GameplayCounters {
  navesCriadas: number;
  navesDestruidas: number;
  batalhasIniciadas: number;
  pesquisasConcluidas: number;
  construcoesConcluidas: number;
  uiRebuildsModal: number;
  uiRebuildsDrawer: number;
  uiRebuildsBuildPanel: number;
}
const _counters: GameplayCounters = {
  navesCriadas: 0, navesDestruidas: 0, batalhasIniciadas: 0,
  pesquisasConcluidas: 0, construcoesConcluidas: 0,
  uiRebuildsModal: 0, uiRebuildsDrawer: 0, uiRebuildsBuildPanel: 0,
};
export function bumpCounter(k: keyof GameplayCounters, n: number = 1): void {
  _counters[k] += n;
}
export function getAndResetCounters(): GameplayCounters {
  const snap = { ..._counters };
  for (const k in _counters) _counters[k as keyof GameplayCounters] = 0;
  return snap;
}

// ─── Slow-frame context snapshots ─────────────────────────────────

export interface SlowFrameContext {
  t: number;
  frameWallMs: number;
  openModal: string | null;       // e.g. 'planet-details-modal'
  drawerOpen: boolean;
  selectedPlanetId: string | null;
  focusedTag: string;
  focusedClass: string;
  scrollY: number;
  visibleHudPanels: number;
  activeAnimations: number;
  nodeCount: number;
  listeners: number;
  timers: number;
}
const _slowFrames: SlowFrameContext[] = [];
const MAX_SLOW_FRAMES = 50;

/**
 * Captures DOM + game state at the moment of a slow frame. Called from
 * profiling-logger when a frame's wall time exceeds the threshold.
 */
export function captureSlowFrameContext(t: number, frameWallMs: number, extra?: { drawerOpen?: boolean; selectedPlanetId?: string | null }): void {
  if (_slowFrames.length >= MAX_SLOW_FRAMES) _slowFrames.shift();
  // Detect visible modal via known class names.
  let openModal: string | null = null;
  for (const cls of [
    'planet-details-modal', 'empire-modal', 'colony-modal',
    'settings-overlay', 'lore-modal', 'save-modal',
    'renderer-info-modal', 'new-world-modal', 'pause-menu',
  ]) {
    const el = document.querySelector('.' + cls + '.visible, .' + cls);
    if (el && el.classList.contains('visible')) { openModal = cls; break; }
  }
  const f = document.activeElement as HTMLElement | null;
  const snap = snapshotDom();
  _slowFrames.push({
    t, frameWallMs,
    openModal,
    drawerOpen: !!extra?.drawerOpen,
    selectedPlanetId: extra?.selectedPlanetId ?? null,
    focusedTag: f?.tagName ?? '',
    focusedClass: typeof f?.className === 'string' ? f.className.slice(0, 80) : '',
    scrollY: window.scrollY,
    visibleHudPanels: snap.visibleHudPanelCount,
    activeAnimations: snap.animationCount,
    nodeCount: snap.nodeCount,
    listeners: _listenersActive,
    timers: _timersActive,
  });
}

export function getSlowFrames(): ReadonlyArray<SlowFrameContext> { return _slowFrames; }

/** Trigger battery snapshot (async) and orientation listener. */
export function refreshAsyncProbes(): void {
  void snapshotBattery();
}

// Kick off initial async probes.
if (typeof window !== 'undefined') {
  setTimeout(() => refreshAsyncProbes(), 0);
  // Refresh battery every 30s — cheap.
  setInterval(() => refreshAsyncProbes(), 30_000);
}
