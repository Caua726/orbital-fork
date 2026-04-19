let _injected = false;

export function injectAnimations(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* ── Global tap/hover feedback for every UI button ──────────────── */
    button,
    .sidebar-btn,
    .menu-btn,
    .pm-btn,
    .nwm-btn,
    .confirm-btn,
    .settings-select-display,
    .settings-select-option,
    .zoom-controls button,
    .sidebar-hamburger {
      transition:
        transform 120ms cubic-bezier(0.2, 0, 0, 1),
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 160ms ease,
        opacity 120ms ease;
    }
    button:active:not(:disabled),
    .sidebar-btn:active,
    .menu-btn:active,
    .pm-btn:active,
    .nwm-btn:active,
    .confirm-btn:active,
    .zoom-controls button:active,
    .sidebar-hamburger:active {
      transform: scale(0.94);
    }

    /* ── Pulse for commit / toggle actions (added via JS) ───────────── */
    @keyframes orbital-flash-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(120, 200, 255, 0.55); }
      100% { box-shadow: 0 0 0 14px rgba(120, 200, 255, 0); }
    }
    .orbital-pulse {
      animation: orbital-flash-pulse 420ms ease-out;
    }

    /* ── Modal entrance animations (fade + scale-up) ────────────────── */
    @keyframes orbital-modal-in {
      from { opacity: 0; transform: scale(0.94); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes orbital-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .settings-overlay,
    .pause-menu,
    .new-world-modal,
    .save-modal-backdrop,
    .lore-modal-backdrop,
    .confirm-backdrop,
    .main-menu {
      animation: orbital-fade-in 160ms ease;
    }
    .settings-overlay > *,
    .pm-card,
    .nwm-card,
    .confirm-dialog,
    .lore-modal,
    .colony-modal.visible {
      animation: orbital-modal-in 220ms cubic-bezier(0.2, 0, 0, 1);
    }

    /* ── Side-docked panels slide in from the right on desktop ─────── */
    @keyframes orbital-slide-in-right {
      from { opacity: 0; transform: translateX(22px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    /* Only applies when NOT in bottom-sheet mode (bottom-sheet has its
       own slide-up keyframe in bottom-sheet.css).
       Note: :not(.a.b) matches elements missing EITHER class — we want
       elements missing BOTH, which requires chained :not() (De Morgan). */
    body:not(.size-sm):not(.portrait) .bottom-sheet-capable,
    body:not(.size-sm):not(.portrait) .planeta-drawer {
      animation: orbital-slide-in-right 220ms cubic-bezier(0.2, 0, 0, 1);
    }

    /* ── Sidebar drawer entrance on mobile already handled by
         transform transition in sidebar.ts — no extra rule needed. ──── */

    /* ── Zoom-control press feedback: subtle scale on tap ──────────── */
    .zoom-controls button:active {
      transform: scale(0.88);
      background: rgba(30,60,100,0.9);
    }

    /* ── HUD resource-bar value flash when it updates (optional hook) */
    @keyframes orbital-value-bump {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.14); }
      100% { transform: scale(1); }
    }
    .orbital-value-bump {
      animation: orbital-value-bump 320ms ease;
      display: inline-block;
    }

    /* ── Toggle-active flash for production/toggle buttons ─────────── */
    @keyframes orbital-toggle-flash {
      0%   { background: rgba(120, 200, 255, 0.45); }
      100% { background: transparent; }
    }
    .orbital-toggle-flash {
      animation: orbital-toggle-flash 380ms ease-out;
    }

    /* ── Respect reduced-motion preference ─────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Attach a one-off pulse animation to an element. Re-triggerable: strips
 * the class, forces a reflow, and re-adds so consecutive calls visibly flash.
 */
export function pulseElement(el: HTMLElement, className = 'orbital-pulse'): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}
