let _tip: HTMLDivElement | null = null;
let _styleInjected = false;
let _touchDismissWired = false;
let _touchDismissTimer: number | null = null;
// Shared across attachTooltip bindings so pointermove only repositions
// when the cursor is still inside the element that owns the tooltip.
let _currentTargetEl: HTMLElement | null = null;
let _globalLeaveGuardWired = false;

/**
 * Document-level safety net: if a tick rebuilds the modal DOM while
 * the user is hovering a tooltipped span, `pointerleave` on that span
 * never fires (the node is gone). Without this guard the tooltip
 * stays stuck on screen until the next tooltipped element gets
 * hovered. We hide it whenever the cursor is no longer actually over
 * `_currentTargetEl` (either because the element was detached or
 * because the cursor moved away without triggering leave).
 */
function installGlobalLeaveGuard(): void {
  if (_globalLeaveGuardWired) return;
  _globalLeaveGuardWired = true;
  document.addEventListener('pointermove', (e: PointerEvent) => {
    if (!_tip || !_tip.classList.contains('show')) return;
    const target = _currentTargetEl;
    if (!target || !target.isConnected) {
      _tip.classList.remove('show');
      _currentTargetEl = null;
      return;
    }
    const rect = target.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) {
      _tip.classList.remove('show');
      _currentTargetEl = null;
    }
  }, { passive: true });
}

function isTouchDevice(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .ui-tooltip {
      position: fixed;
      max-width: min(320px, 88vw);
      background: rgba(8, 10, 14, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: calc(var(--hud-radius) * 0.6);
      box-shadow: 0 calc(var(--hud-unit) * 0.3) calc(var(--hud-unit) * 0.9) rgba(0, 0, 0, 0.6);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: max(13px, calc(var(--hud-unit) * 0.78));
      line-height: 1.45;
      letter-spacing: 0.02em;
      padding: calc(var(--hud-unit) * 0.55) calc(var(--hud-unit) * 0.8);
      pointer-events: none;
      z-index: 2000;
      opacity: 0;
      transform: translateY(3px);
      white-space: pre-line;
      backdrop-filter: blur(3px);
      transition: opacity 140ms ease, transform 160ms ease;
    }
    .ui-tooltip.show { opacity: 1; transform: translateY(0); }

    /* Affordance hints — make it OBVIOUS that a tooltip exists before
       the user hovers. Two variants depending on target shape:
       .has-tooltip      → inline text (dotted underline)
       .has-tooltip-box  → container rows/chips (dotted bottom border) */
    .has-tooltip {
      text-decoration: underline dotted rgba(255, 255, 255, 0.5);
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      cursor: help;
      transition: text-decoration-color 140ms ease;
    }
    .has-tooltip:hover,
    .has-tooltip:focus-visible {
      text-decoration-color: rgba(255, 255, 255, 0.9);
    }
    .has-tooltip-box {
      cursor: help;
      box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.28);
      transition: box-shadow 140ms ease;
    }
    .has-tooltip-box:hover,
    .has-tooltip-box:focus-visible {
      box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.75);
    }
    .ui-help-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: calc(var(--hud-unit) * 1);
      height: calc(var(--hud-unit) * 1);
      text-align: center;
      border: 1px solid var(--hud-text-dim);
      border-radius: 50%;
      font-size: calc(var(--hud-unit) * 0.7);
      color: var(--hud-text-dim);
      cursor: help;
      margin-left: calc(var(--hud-unit) * 0.3);
      vertical-align: middle;
      appearance: none;
      background: transparent;
      padding: 0;
    }
    body.touch .ui-help-icon {
      min-width: 24px;
      min-height: 24px;
    }
    .ui-help-icon:hover,
    .ui-help-icon:focus-visible {
      color: var(--hud-text);
      border-color: var(--hud-text);
      outline: none;
    }
  `;
  document.head.appendChild(s);
}

function ensureTip(): HTMLDivElement {
  if (_tip) return _tip;
  injectStyles();
  const t = document.createElement('div');
  t.className = 'ui-tooltip';
  document.body.appendChild(t);
  _tip = t;
  return t;
}

function clampToViewport(tip: HTMLDivElement, anchorRect: DOMRect): void {
  // Place to the right+top of the anchor, then shift left/up if it overflows.
  tip.style.left = `${anchorRect.right + 8}px`;
  tip.style.top = `${anchorRect.top}px`;
  requestAnimationFrame(() => {
    const tr = tip.getBoundingClientRect();
    if (tr.right > window.innerWidth - 4) {
      tip.style.left = `${Math.max(4, anchorRect.left - tr.width - 8)}px`;
    }
    if (tr.bottom > window.innerHeight - 4) {
      tip.style.top = `${Math.max(4, window.innerHeight - tr.height - 4)}px`;
    }
    if (tr.top < 4) tip.style.top = '4px';
  });
}

function showTip(text: string, anchor: HTMLElement, durationMs = 3000): void {
  const tip = ensureTip();
  tip.textContent = text;
  tip.classList.add('show');
  clampToViewport(tip, anchor.getBoundingClientRect());
  if (_touchDismissTimer) {
    clearTimeout(_touchDismissTimer);
    _touchDismissTimer = null;
  }
  _touchDismissTimer = window.setTimeout(hideTip, durationMs);
  wireTouchDismiss();
}

function hideTip(): void {
  _tip?.classList.remove('show');
}

function wireTouchDismiss(): void {
  if (_touchDismissWired) return;
  _touchDismissWired = true;
  document.addEventListener('pointerdown', (e) => {
    if (!_tip?.classList.contains('show')) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.classList.contains('ui-help-icon') || target.closest('.ui-help-icon'))) return;
    hideTip();
  }, { passive: true });
}

/**
 * Attach a hover tooltip to any element. On touch, tap-to-show / tap-away-to-hide
 * is used instead of hover since mouseenter doesn't fire reliably on touch.
 */
export function comTooltipHover(target: HTMLElement, getText: () => string): void {
  injectStyles();
  if (isTouchDevice()) {
    target.addEventListener('pointerup', (e) => {
      const text = getText();
      if (!text) return;
      e.stopPropagation();
      showTip(text, target);
    });
    return;
  }
  target.addEventListener('mouseenter', () => {
    const text = getText();
    if (!text) return;
    const tip = ensureTip();
    tip.textContent = text;
    tip.classList.add('show');
    clampToViewport(tip, target.getBoundingClientRect());
  });
  target.addEventListener('mouseleave', hideTip);
  target.addEventListener('mousemove', (e: MouseEvent) => {
    if (!_tip?.classList.contains('show')) return;
    _tip.style.left = `${e.clientX + 12}px`;
    _tip.style.top = `${e.clientY + 12}px`;
  });
}

/**
 * Preferred API — attach a hover/focus tooltip AND add a visual
 * affordance marker (dotted underline or bottom-border) so the user
 * knows the target is hoverable before they hover.
 *
 * Idempotent per element: calling again replaces the text without
 * rewiring listeners. Pass empty text to remove both tooltip and
 * affordance class.
 *
 *   variant 'text' → dotted underline (use on inline text cells)
 *   variant 'box'  → dotted bottom-border (use on rows/chips/buttons)
 */
// ─── Delegated tooltip (event delegation to avoid per-element leak) ─
//
// Todos os listeners ficam no document; cada chamada de attachTooltip
// só seta `data-tooltip-text` no elemento. O handler global pega
// pointerenter/leave/move via delegação e decide mostrar/esconder
// baseado no `.has-tooltip` / `.has-tooltip-box` + data attribute.
// Sem isso, cada attachTooltip vazava ~4 listeners quando o elemento
// era removido do DOM e nunca GCd em sessão longa.

let _delegatedInstalled = false;
let _delegShowTimer: number | null = null;
let _delegHideTimer: number | null = null;
let _delegCursorX = 0;
let _delegCursorY = 0;
let _delegHasCursor = false;

function installDelegatedListeners(): void {
  if (_delegatedInstalled) return;
  _delegatedInstalled = true;
  injectStyles();
  installGlobalLeaveGuard();
  const DELAY_SHOW = 180;

  const getTipTarget = (node: EventTarget | null): HTMLElement | null => {
    if (!node || !(node as HTMLElement).closest) return null;
    return (node as HTMLElement).closest('.has-tooltip, .has-tooltip-box') as HTMLElement | null;
  };

  const showFor = (target: HTMLElement): void => {
    const txt = target.dataset.tooltipText;
    if (!txt) return;
    if (_delegHideTimer !== null) { clearTimeout(_delegHideTimer); _delegHideTimer = null; }
    const tip = ensureTip();
    tip.textContent = txt;
    tip.classList.add('show');
    _currentTargetEl = target;
    requestAnimationFrame(() => {
      if (_delegHasCursor) positionAtCursor();
      else positionAtElement(target);
    });
  };

  const positionAtCursor = (): void => {
    if (!_tip) return;
    const tr = _tip.getBoundingClientRect();
    const OFFSET_X = 14, OFFSET_Y = 18;
    let left = _delegCursorX + OFFSET_X;
    let top = _delegCursorY + OFFSET_Y;
    if (left + tr.width > window.innerWidth - 8) left = _delegCursorX - tr.width - OFFSET_X;
    if (top + tr.height > window.innerHeight - 8) top = _delegCursorY - tr.height - OFFSET_Y;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    _tip.style.left = `${left}px`;
    _tip.style.top = `${top}px`;
  };
  const positionAtElement = (target: HTMLElement): void => {
    if (!_tip) return;
    const rect = target.getBoundingClientRect();
    const tr = _tip.getBoundingClientRect();
    const above = rect.top > tr.height + 16 || rect.top > window.innerHeight - rect.bottom;
    const top = above ? rect.top - tr.height - 8 : rect.bottom + 8;
    let left = rect.left + rect.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    _tip.style.left = `${left}px`;
    _tip.style.top = `${top}px`;
  };

  const hideSoon = (): void => {
    if (_delegShowTimer !== null) { clearTimeout(_delegShowTimer); _delegShowTimer = null; }
    if (_delegHideTimer !== null) clearTimeout(_delegHideTimer);
    _delegHideTimer = window.setTimeout(() => {
      _tip?.classList.remove('show');
      _currentTargetEl = null;
      _delegHideTimer = null;
    }, 60);
  };

  document.addEventListener('pointerover', (e) => {
    const target = getTipTarget(e.target);
    if (!target) return;
    _delegCursorX = e.clientX; _delegCursorY = e.clientY; _delegHasCursor = true;
    if (_delegShowTimer !== null) clearTimeout(_delegShowTimer);
    _delegShowTimer = window.setTimeout(() => {
      _delegShowTimer = null;
      showFor(target);
    }, DELAY_SHOW);
  });

  document.addEventListener('pointerout', (e) => {
    const target = getTipTarget(e.target);
    if (!target) return;
    // If relatedTarget is still inside the same tooltipped element, ignore.
    const rel = (e as PointerEvent).relatedTarget as Node | null;
    if (rel && target.contains(rel)) return;
    hideSoon();
  });

  document.addEventListener('pointermove', (e) => {
    _delegCursorX = e.clientX; _delegCursorY = e.clientY; _delegHasCursor = true;
    if (_tip?.classList.contains('show') && _currentTargetEl) {
      positionAtCursor();
    }
  }, { passive: true });

  document.addEventListener('focusin', (e) => {
    const target = getTipTarget(e.target);
    if (!target) return;
    _delegHasCursor = false;
    showFor(target);
  });
  document.addEventListener('focusout', (e) => {
    const target = getTipTarget(e.target);
    if (!target) return;
    hideSoon();
  });
}

/**
 * Attach a tooltip to an element. Zero listeners added per call —
 * listeners are delegated at document level (installed once). The
 * affordance class (.has-tooltip / .has-tooltip-box) + the
 * `data-tooltip-text` attribute are all that's needed.
 */
export function attachTooltip(
  el: HTMLElement,
  text: string | null | undefined,
  variant: 'text' | 'box' = 'text',
): void {
  installDelegatedListeners();
  if (!text) {
    delete el.dataset.tooltipText;
    el.classList.remove('has-tooltip', 'has-tooltip-box');
    return;
  }
  el.dataset.tooltipText = text;
  el.classList.remove('has-tooltip', 'has-tooltip-box');
  el.classList.add(variant === 'box' ? 'has-tooltip-box' : 'has-tooltip');
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
}

export function comHelp(label: HTMLElement, text: string): void {
  injectStyles();
  // Use <button> so it's keyboard-focusable and screen-reader operable.
  const icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'ui-help-icon';
  icon.textContent = '?';
  icon.setAttribute('aria-label', text);
  if (isTouchDevice()) {
    icon.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      showTip(text, icon);
    });
  } else {
    icon.addEventListener('mouseenter', () => {
      const tip = ensureTip();
      tip.textContent = text;
      tip.classList.add('show');
      clampToViewport(tip, icon.getBoundingClientRect());
    });
    icon.addEventListener('mouseleave', hideTip);
  }
  // Keyboard: space/enter toggles like a button.
  icon.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showTip(text, icon);
    } else if (e.key === 'Escape') {
      hideTip();
    }
  });
  label.appendChild(icon);
}
