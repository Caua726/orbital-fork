import type { ProfilingData } from '../types';

/**
 * Profiling ring — one-entry-per-frame sparkline support on top of
 * the averaged ProfilingData that the HUD already consumed.
 *
 * Flow per frame:
 *   1. profileMark() / profileAcumular() accumulate ms into _soma.
 *   2. profileFlush() divides by the window length, writes into the
 *      public `profiling` object, and also pushes the per-frame
 *      sample into `profilingHistory` for sparkline rendering.
 *
 * Two buffers because the HUD wants both:
 *   - Averaged readouts (stable number to read).
 *   - Per-frame samples (show variance + peaks in a mini chart).
 */

const CAMPOS: Array<keyof ProfilingData> = [
  'planetasLogic', 'naves', 'ia', 'combate', 'stats',
  'fundo', 'fog', 'planetas', 'render',
  'logica', 'total', 'frameWall',
];

function criarZero(): ProfilingData {
  return {
    planetasLogic: 0, naves: 0, ia: 0, combate: 0, stats: 0,
    fundo: 0, fog: 0, planetas: 0, render: 0,
    logica: 0, total: 0, frameWall: 0,
  };
}

export const profiling: ProfilingData = criarZero();

const _soma: ProfilingData = criarZero();
let _profilingFrames: number = 0;
const PROFILING_JANELA: number = 30;

// ─── Rolling per-frame history for sparklines ────────────────────
const HISTORY_LEN = 120;
export interface ProfilingHistory {
  [key: string]: Float32Array;
}
const _history: ProfilingHistory = {};
for (const k of CAMPOS) _history[k] = new Float32Array(HISTORY_LEN);
let _historyCursor = 0;

/** Read-only view into the per-frame sample ring. Each buffer has
 *  HISTORY_LEN samples; index 0 is oldest, HISTORY_LEN-1 is newest
 *  after being aligned via getHistoryAligned(). */
export function getProfilingHistory(): Readonly<ProfilingHistory> {
  return _history;
}

/** Returns the logical cursor position (0..HISTORY_LEN-1). The next
 *  per-frame write will land here. */
export function getProfilingHistoryCursor(): number {
  return _historyCursor;
}

export function getProfilingHistoryLen(): number {
  return HISTORY_LEN;
}

// ─── Accumulators ────────────────────────────────────────────────
// Each profileAcumular call records into _soma for the average AND
// into a per-frame "this frame so far" tally so we can snapshot the
// per-frame value into history on flush.
const _frameSample: ProfilingData = criarZero();

export function profileMark(): number {
  return performance.now();
}

export function profileAcumular(campo: keyof ProfilingData, inicio: number): void {
  const ms = performance.now() - inicio;
  _soma[campo] += ms;
  _frameSample[campo] += ms;
}

export function profileFlush(): void {
  // Derive the legacy logica aggregate so nobody needs to know the
  // list of sub-buckets.
  _frameSample.logica =
    _frameSample.planetasLogic + _frameSample.naves +
    _frameSample.ia + _frameSample.combate + _frameSample.stats;
  _soma.logica += _frameSample.logica;

  // Push this frame's samples into the ring.
  for (const k of CAMPOS) {
    _history[k][_historyCursor] = _frameSample[k];
    _frameSample[k] = 0;
  }
  _historyCursor = (_historyCursor + 1) % HISTORY_LEN;

  // Roll the averaged readout once per window.
  _profilingFrames++;
  if (_profilingFrames >= PROFILING_JANELA) {
    for (const k of CAMPOS) {
      profiling[k] = _soma[k] / PROFILING_JANELA;
      _soma[k] = 0;
    }
    _profilingFrames = 0;
  }
}
