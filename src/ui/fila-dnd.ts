/**
 * Pointer-based drag & drop reorder for a flat list of items.
 *
 * Designed for the production queue (fila de produção) surfaced in
 * the planet drawer and the planet-details modal. Works on desktop
 * mouse and touch — unified via pointer events.
 *
 * Exposes a global "dragging" flag so parent rebuild loops can skip
 * re-rendering the list while the user is mid-drag; otherwise the
 * tick would blow away the drag state every frame.
 */

let _draggingActive = false;
let _stylesInjected = false;

function injectFilaStyles(): void {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement('style');
  s.setAttribute('data-src', 'fila-dnd');
  s.textContent = `
    .fila-drag-handle {
      width: calc(var(--hud-unit) * 1);
      height: calc(var(--hud-unit) * 1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--hud-text-dim);
      cursor: grab;
      user-select: none;
      font-size: calc(var(--hud-unit) * 0.8);
      line-height: 1;
      letter-spacing: -1px;
      touch-action: none;
    }
    .fila-drag-handle:hover { color: var(--hud-text); }
    .fila-drag-handle.locked {
      opacity: 0.25;
      cursor: not-allowed;
    }
    .fila-remove-btn {
      appearance: none;
      background: transparent;
      border: 1px solid transparent;
      color: var(--hud-text-dim);
      width: calc(var(--hud-unit) * 1.1);
      height: calc(var(--hud-unit) * 1.1);
      border-radius: 50%;
      cursor: pointer;
      font-size: calc(var(--hud-unit) * 0.8);
      line-height: 1;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms, color 120ms, border-color 120ms;
    }
    .fila-remove-btn:hover:not(:disabled) {
      color: #ff9f9f;
      border-color: rgba(255, 120, 120, 0.45);
      background: rgba(255, 120, 120, 0.08);
    }
    .fila-remove-btn:disabled {
      opacity: 0.2;
      cursor: not-allowed;
    }
    .fila-drop-indicator {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 1px;
      pointer-events: none;
      box-shadow: 0 0 calc(var(--hud-unit) * 0.4) rgba(255, 255, 255, 0.35);
      z-index: 20;
      display: none;
    }
  `;
  document.head.appendChild(s);
}

export function isFilaDragging(): boolean {
  return _draggingActive;
}

export interface FilaDragOptions {
  itemSelector: string;
  handleSelector: string;
  getIdx: (itemEl: HTMLElement) => number;
  isLocked: (idx: number) => boolean;
  onReorder: (fromIdx: number, toIdx: number) => void;
}

interface DragState {
  itemEl: HTMLElement;
  pointerId: number;
  fromIdx: number;
  startY: number;
  currentTargetIdx: number;
  rects: Array<{ top: number; height: number; idx: number }>;
  indicator: HTMLDivElement;
  listRect: DOMRect;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
  onKey: (e: KeyboardEvent) => void;
}

export function bindFilaDragDrop(listEl: HTMLElement, options: FilaDragOptions): void {
  injectFilaStyles();

  let state: DragState | null = null;

  function start(e: PointerEvent, handle: HTMLElement): void {
    if (state) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const itemEl = handle.closest(options.itemSelector) as HTMLElement | null;
    if (!itemEl) return;
    const fromIdx = options.getIdx(itemEl);
    if (options.isLocked(fromIdx)) return;
    // Stop so parent modal/drawer pointerdown handlers don't run any
    // side effects while we're starting a drag.
    e.stopPropagation();
    e.preventDefault();

    const items = Array.from(listEl.querySelectorAll<HTMLElement>(options.itemSelector));
    const rects = items.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, idx: options.getIdx(el) };
    });
    const listRect = listEl.getBoundingClientRect();

    const indicator = document.createElement('div');
    indicator.className = 'fila-drop-indicator';
    if (getComputedStyle(listEl).position === 'static') {
      listEl.style.position = 'relative';
    }
    listEl.appendChild(indicator);

    itemEl.style.position = 'relative';
    itemEl.style.zIndex = '10';
    itemEl.classList.add('fila-dragging');
    _draggingActive = true;

    // Set up listeners on document (not window) — some environments
    // deliver pointer events only via document. pointercancel triggers
    // cleanup so a stuck drag doesn't freeze the UI.
    const onMove = (ev: PointerEvent): void => {
      if (!state) return;
      if (ev.pointerId !== state.pointerId) return;
      const dy = ev.clientY - state.startY;
      state.itemEl.style.transform = `translateY(${dy}px)`;
      const targetIdx = computeTargetIdx(ev.clientY);
      state.currentTargetIdx = targetIdx;

      let indicatorClientY: number;
      if (targetIdx >= state.rects.length) {
        const last = state.rects[state.rects.length - 1];
        indicatorClientY = last.top + last.height;
      } else {
        indicatorClientY = state.rects[targetIdx].top;
      }
      state.indicator.style.top = `${indicatorClientY - state.listRect.top - 2}px`;
      state.indicator.style.display = 'block';
    };

    const onUp = (ev: PointerEvent): void => {
      if (!state) return;
      if (ev.pointerId !== state.pointerId) return;
      finish(false);
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (!state) return;
      if (ev.key === 'Escape') finish(true);
    };

    state = {
      itemEl,
      pointerId: e.pointerId,
      fromIdx,
      startY: e.clientY,
      currentTargetIdx: fromIdx,
      rects,
      indicator,
      listRect,
      onMove,
      onUp,
      onKey,
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKey);
  }

  function computeTargetIdx(clientY: number): number {
    if (!state) return 0;
    let targetIdx = 0;
    for (const r of state.rects) {
      if (options.isLocked(r.idx)) continue;
      if (clientY > r.top + r.height / 2) {
        targetIdx = r.idx + 1;
      }
    }
    let minIdx = 0;
    for (const r of state.rects) {
      if (options.isLocked(r.idx)) minIdx = r.idx + 1;
    }
    targetIdx = Math.max(minIdx, Math.min(targetIdx, state.rects.length));
    return targetIdx;
  }

  function finish(cancel: boolean): void {
    if (!state) return;
    const s = state;
    state = null;
    _draggingActive = false;
    s.itemEl.style.transform = '';
    s.itemEl.style.position = '';
    s.itemEl.style.zIndex = '';
    s.itemEl.classList.remove('fila-dragging');
    s.indicator.remove();
    document.removeEventListener('pointermove', s.onMove);
    document.removeEventListener('pointerup', s.onUp);
    document.removeEventListener('pointercancel', s.onUp);
    document.removeEventListener('keydown', s.onKey);
    if (cancel) return;
    // splice semantics: removing fromIdx first shifts later entries
    // down by 1, so a target > fromIdx needs -1.
    const adjustedToIdx = s.currentTargetIdx > s.fromIdx ? s.currentTargetIdx - 1 : s.currentTargetIdx;
    if (adjustedToIdx !== s.fromIdx) options.onReorder(s.fromIdx, adjustedToIdx);
  }

  const handles = listEl.querySelectorAll<HTMLElement>(options.handleSelector);
  handles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => start(e, handle));
  });
}
