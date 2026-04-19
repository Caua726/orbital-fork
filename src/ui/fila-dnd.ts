/**
 * Fila reorder — pointer-based, EVENT DELEGATION.
 *
 * Versões anteriores adicionavam listeners diretamente nos handles e
 * no listEl por bind. Rebuild a 2Hz (drawer) vazava ~15-20 listeners
 * por rebuild porque os elementos antigos ficavam detached na memória
 * com seus listeners presos — o profiling mostrou +579 listeners em
 * 20s de sessão (~29/seg de leak).
 *
 * Agora: UM SET de listeners globais no document, instalados uma
 * única vez no primeiro bind. Cada bindFilaDragDrop só REGISTRA as
 * opções num WeakMap indexado pelo listEl. Rebuild do cardFila cria
 * listEl novo → WeakMap auto-GC'a a entrada velha quando o listEl
 * vira detached. Zero vazamento.
 */

export interface FilaDragOptions {
  itemSelector: string;
  handleSelector: string;
  getIdx: (itemEl: HTMLElement) => number;
  isLocked: (idx: number) => boolean;
  onReorder: (fromIdx: number, toIdx: number) => void;
}

let _draggingActive = false;
let _stylesInjected = false;
let _pointerDownInsideFila = 0;
let _globalInstalled = false;

const _registrations = new WeakMap<HTMLElement, FilaDragOptions>();

const DRAG_THRESHOLD_PX = 4;

interface ActiveDrag {
  listEl: HTMLElement;
  options: FilaDragOptions;
  item: HTMLElement;
  sourceIdx: number;
  startX: number;
  startY: number;
  pointerId: number;
  committed: boolean;
  indicator: HTMLDivElement | null;
  targetInsertIdx: number;
}
let _active: ActiveDrag | null = null;

export function isFilaDragging(): boolean { return _draggingActive; }
export function isFilaInteracting(): boolean { return _pointerDownInsideFila > 0; }

// ─── Styles (inject once) ─────────────────────────────────────────

function injectFilaStyles(): void {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement('style');
  s.setAttribute('data-src', 'fila-dnd');
  s.textContent = `
    .fila-drag-handle {
      width: calc(var(--hud-unit) * 1.2);
      height: calc(var(--hud-unit) * 1.2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--hud-text-dim);
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      font-size: calc(var(--hud-unit) * 0.85);
      line-height: 1;
      letter-spacing: -1px;
      touch-action: none;
    }
    .fila-drag-handle:hover { color: var(--hud-text); }
    .fila-drag-handle:active { cursor: grabbing; }
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
    .fila-dragging-source {
      opacity: 0.45;
      box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1) rgba(0, 0, 0, 0.7);
    }
  `;
  document.head.appendChild(s);
}

// ─── Delegated handlers (installed ONCE globally) ────────────────

function installGlobalOnce(): void {
  if (_globalInstalled) return;
  _globalInstalled = true;

  // Walk up from event target to find a registered list.
  const findRegisteredList = (target: EventTarget | null): HTMLElement | null => {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (_registrations.has(el)) return el;
      el = el.parentElement;
    }
    return null;
  };

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const listEl = findRegisteredList(target);
    if (!listEl) return;

    // Any pointerdown inside the list bumps the "interacting" counter
    // so rebuild loops skip while the user is clicking/dragging.
    _pointerDownInsideFila++;
    const release = (): void => {
      _pointerDownInsideFila = Math.max(0, _pointerDownInsideFila - 1);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);

    const options = _registrations.get(listEl);
    if (!options) return;
    // Drag only starts when the press lands on a handle.
    const handle = target.closest(options.handleSelector) as HTMLElement | null;
    if (!handle) return;
    const item = handle.closest(options.itemSelector) as HTMLElement | null;
    if (!item || !listEl.contains(item)) return;
    const idx = options.getIdx(item);
    if (options.isLocked(idx)) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

    e.preventDefault();
    // Don't stopPropagation — other global handlers (tooltips, drawer
    // modal marcarInteracaoUi) need to see the pointerdown. We just
    // make sure our global up/move handlers fire first via capture.

    _active = {
      listEl, options, item, sourceIdx: idx,
      startX: e.clientX, startY: e.clientY,
      pointerId: e.pointerId,
      committed: false,
      indicator: null,
      targetInsertIdx: idx,
    };
  });

  window.addEventListener('pointermove', (e) => {
    if (!_active) return;
    if (e.pointerId !== _active.pointerId) return;
    const dx = e.clientX - _active.startX;
    const dy = e.clientY - _active.startY;
    if (!_active.committed) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      // Commit the drag: show indicator + source styling.
      _active.committed = true;
      _draggingActive = true;
      _active.item.classList.add('fila-dragging-source');
      const ind = document.createElement('div');
      ind.className = 'fila-drop-indicator';
      const listEl = _active.listEl;
      if (getComputedStyle(listEl).position === 'static') {
        listEl.style.position = 'relative';
      }
      listEl.appendChild(ind);
      _active.indicator = ind;
    }
    positionIndicator(e.clientY);
  }, true);

  const finishDrag = (cancel: boolean): void => {
    if (!_active) return;
    const a = _active;
    _active = null;
    _draggingActive = false;
    if (a.committed) {
      a.item.classList.remove('fila-dragging-source');
      if (a.indicator && a.indicator.parentElement) {
        a.indicator.parentElement.removeChild(a.indicator);
      }
      if (!cancel && a.targetInsertIdx !== a.sourceIdx) {
        a.options.onReorder(a.sourceIdx, a.targetInsertIdx);
      }
    }
  };

  window.addEventListener('pointerup', (e) => {
    if (!_active || e.pointerId !== _active.pointerId) return;
    finishDrag(false);
  }, true);
  window.addEventListener('pointercancel', (e) => {
    if (!_active || e.pointerId !== _active.pointerId) return;
    finishDrag(true);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _active) finishDrag(true);
  });
}

function positionIndicator(clientY: number): void {
  if (!_active || !_active.indicator) return;
  const { listEl, options, sourceIdx } = _active;
  const items = Array.from(listEl.querySelectorAll<HTMLElement>(options.itemSelector));
  if (items.length === 0) return;
  const listRect = listEl.getBoundingClientRect();
  const lastRect = items[items.length - 1].getBoundingClientRect();
  let rawTarget = 0;
  let indY = 0;
  if (clientY >= lastRect.bottom) {
    rawTarget = options.getIdx(items[items.length - 1]) + 1;
    indY = lastRect.bottom - listRect.top;
  } else {
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const i = options.getIdx(el);
      const below = clientY > r.top + r.height / 2;
      if (!below) { rawTarget = i; indY = r.top - listRect.top; break; }
      rawTarget = i + 1;
      indY = r.bottom - listRect.top;
    }
  }
  // Never allow inserting in front of locked items.
  for (const el of items) {
    const i = options.getIdx(el);
    if (options.isLocked(i)) rawTarget = Math.max(rawTarget, i + 1);
  }
  _active.targetInsertIdx = rawTarget > sourceIdx ? rawTarget - 1 : rawTarget;
  _active.indicator.style.top = `${indY - 1}px`;
  _active.indicator.style.display = 'block';
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Register a fila list for drag reorder. No listeners are attached to
 * listEl or its descendants — all interactions are handled via
 * delegation at the document level. WeakMap keys GC automatically when
 * the listEl is removed from the DOM and forgotten by its parent.
 */
export function bindFilaDragDrop(listEl: HTMLElement, options: FilaDragOptions): void {
  injectFilaStyles();
  installGlobalOnce();
  _registrations.set(listEl, options);
}
