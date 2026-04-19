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
  /** CSS selector for each draggable row within the list. */
  itemSelector: string;
  /** CSS selector for the grab handle inside each row. */
  handleSelector: string;
  /** Extract the logical fila index from an item element. */
  getIdx: (itemEl: HTMLElement) => number;
  /** Indices that cannot be moved or displaced (e.g. active item 0). */
  isLocked: (idx: number) => boolean;
  /** Called on drop with the final (fromIdx, toIdx) pair. */
  onReorder: (fromIdx: number, toIdx: number) => void;
}

/**
 * Binds pointer-based reordering to `listEl`. Adds a drop indicator
 * line that tracks the cursor. Respects `isLocked` so the active
 * item stays anchored at position 0.
 */
export function bindFilaDragDrop(listEl: HTMLElement, options: FilaDragOptions): void {
  injectFilaStyles();
  interface DragState {
    itemEl: HTMLElement;
    pointerId: number;
    fromIdx: number;
    startY: number;
    currentTargetIdx: number;
    rects: Array<{ el: HTMLElement; top: number; height: number; idx: number }>;
    indicator: HTMLDivElement;
    listRect: DOMRect;
  }
  let state: DragState | null = null;

  const handles = listEl.querySelectorAll<HTMLElement>(options.handleSelector);
  handles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (state) return; // already dragging
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const itemEl = handle.closest(options.itemSelector) as HTMLElement | null;
      if (!itemEl) return;
      const fromIdx = options.getIdx(itemEl);
      if (options.isLocked(fromIdx)) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);

      const items = Array.from(listEl.querySelectorAll<HTMLElement>(options.itemSelector));
      const rects = items.map((el) => {
        const r = el.getBoundingClientRect();
        return { el, top: r.top, height: r.height, idx: options.getIdx(el) };
      });
      const listRect = listEl.getBoundingClientRect();

      const indicator = document.createElement('div');
      indicator.className = 'fila-drop-indicator';
      // Position the list as a positioning parent if it wasn't already.
      if (getComputedStyle(listEl).position === 'static') {
        listEl.style.position = 'relative';
      }
      listEl.appendChild(indicator);

      itemEl.classList.add('fila-dragging');
      _draggingActive = true;

      state = {
        itemEl,
        pointerId: e.pointerId,
        fromIdx,
        startY: e.clientY,
        currentTargetIdx: fromIdx,
        rects,
        indicator,
        listRect,
      };

      // Bind move + up on the window so the drag keeps tracking even
      // if the cursor strays outside the list container.
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('keydown', onKeyDown);
    });
  });

  function computeTargetIdx(clientY: number): number {
    if (!state) return 0;
    let targetIdx = 0;
    for (const r of state.rects) {
      if (options.isLocked(r.idx)) continue;
      if (clientY > r.top + r.height / 2) {
        targetIdx = r.idx + 1;
      }
    }
    // Never drop above a locked item.
    let minIdx = 0;
    for (const r of state.rects) {
      if (options.isLocked(r.idx)) minIdx = r.idx + 1;
    }
    targetIdx = Math.max(minIdx, Math.min(targetIdx, state.rects.length));
    return targetIdx;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!state) return;
    const dy = e.clientY - state.startY;
    state.itemEl.style.transform = `translateY(${dy}px)`;

    const targetIdx = computeTargetIdx(e.clientY);
    state.currentTargetIdx = targetIdx;

    // Position the drop indicator line.
    let indicatorClientY: number;
    if (targetIdx >= state.rects.length) {
      const last = state.rects[state.rects.length - 1];
      indicatorClientY = last.top + last.height;
    } else {
      indicatorClientY = state.rects[targetIdx].top;
    }
    state.indicator.style.top = `${indicatorClientY - state.listRect.top - 2}px`;
    state.indicator.style.display = 'block';
  }

  function onPointerUp(): void {
    if (!state) return;
    const { fromIdx, currentTargetIdx, itemEl, indicator } = state;
    // splice semantics: removing from fromIdx shifts later entries
    // left by one, so targeting an idx > fromIdx needs -1.
    const adjustedToIdx = currentTargetIdx > fromIdx ? currentTargetIdx - 1 : currentTargetIdx;
    itemEl.style.transform = '';
    itemEl.classList.remove('fila-dragging');
    indicator.remove();

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);

    state = null;
    _draggingActive = false;

    if (adjustedToIdx !== fromIdx) {
      options.onReorder(fromIdx, adjustedToIdx);
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && state) {
      state.currentTargetIdx = state.fromIdx;
      onPointerUp();
    }
  }
}
