let _injected = false;

/**
 * Layout-compact rules gate on `body.size-sm` (and size-md portrait)
 * regardless of touch, so a narrow desktop window also adapts. Only
 * gesture/affordance rules (large tap targets) stay gated on `.touch`.
 */
export function injectMobileStyles(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* ── HUD base unit: bump back up so derived text (calc * 0.55/0.8/1.1)
       stays legible across ALL panels. Components that ballooned
       (empire-badge) get explicit size overrides below — don't punish
       every other panel for one outlier. */
    body.size-sm,
    body.portrait.size-md {
      --hud-unit: clamp(18px, 2.4vmin, 22px) !important;
      --hud-margin: clamp(10px, 2vmin, 18px) !important;
    }

    /* Empire badge is the only top-HUD piece that balloons when
       --hud-unit grows — pin it to a fixed compact size. */
    body.size-sm .empire-badge {
      min-height: 46px !important;
      padding: 6px 10px !important;
      font-size: 13px !important;
      gap: 8px !important;
    }
    body.size-sm .empire-badge .empire-crest {
      width: 28px !important;
      height: 28px !important;
    }
    body.size-sm .empire-badge .empire-name {
      font-size: 13px !important;
    }
    body.size-sm .empire-badge .empire-level {
      font-size: 11px !important;
    }

    /* ── Global floor: nothing on mobile goes below 13px. Catches any
       rogue .calc(--hud-unit * 0.55) = 9.9px text we missed. */
    body.size-sm :where(span, div, label, p, button, h1, h2, h3, h4, h5, h6, li, td, th) {
      font-size: max(13px, 1em);
    }
    body.size-sm input,
    body.size-sm select,
    body.size-sm textarea {
      font-size: 16px;
    }

    /* ── Hide minimap + zoom controls on small/portrait screens — pinça/duplo-toque substituem. */
    body.size-sm .minimap,
    body.size-sm .zoom-controls,
    body.portrait.size-md .minimap,
    body.portrait.size-md .zoom-controls {
      display: none !important;
    }
    @media (max-width: 820px) and (orientation: portrait) {
      .minimap,
      .zoom-controls {
        display: none !important;
      }
    }

    /* ── Generous touch targets on small or touch screens. */
    body.size-sm button,
    body.size-sm .settings-select-display,
    body.touch .sidebar-btn,
    body.touch .zoom-controls button,
    body.touch .menu-btn,
    body.touch .pm-btn,
    body.touch .nwm-btn,
    body.touch .confirm-btn,
    body.touch .settings-select-display {
      min-height: 48px;
    }

    /* ── Top HUD: clearly readable on narrow portrait. */
    body.size-sm.portrait .resource-bar,
    body.size-sm.portrait .credits-bar,
    body.size-sm.portrait .empire-badge {
      font-size: 14px !important;
      padding: 6px 10px !important;
      line-height: 1.25 !important;
      max-width: calc(100vw - 24px) !important;
    }
    body.size-sm .resource-bar {
      min-height: 46px !important;
    }
    body.size-sm .resource-bar .resource-value {
      font-size: 15px !important;
    }
    body.size-sm .resource-bar .resource-text {
      font-size: 13px !important;
    }
    body.size-sm .resource-bar .resource-rate {
      font-size: 11px !important;
    }
    body.size-sm.portrait .credits-clock,
    body.size-sm.portrait .credits-divider {
      display: none !important;
    }

    /* Resource-bar icons visibly bigger so values aren't ambiguous. */
    body.size-sm.portrait .resource-bar .resource-icon,
    body.size-sm.portrait .resource-bar img {
      width: 22px !important;
      height: 22px !important;
    }

    /* Nudge top HUD below the hamburger strip (64px btn + 14px top margin + 8px gap). */
    body.size-sm .resource-bar,
    body.size-sm .empire-badge {
      top: 88px !important;
    }

    /* ── Modal cards: card feel, not fullscreen slab. */
    body.size-sm .settings-overlay,
    body.size-sm .main-menu,
    body.size-sm .pause-menu,
    body.size-sm .new-world-modal,
    body.size-sm .save-modal-backdrop,
    body.size-sm .lore-modal-backdrop,
    body.size-sm .confirm-backdrop {
      max-width: 100vw !important;
      max-height: 100vh !important;
      overflow-y: auto;
    }
    body.size-sm .lore-modal,
    body.size-sm .confirm-dialog,
    body.size-sm .pm-card,
    body.size-sm .nwm-card,
    body.size-sm .colony-modal {
      width: min(94vw, 440px) !important;
      max-height: 90vh !important;
      border-radius: 14px !important;
      overflow-y: auto;
      font-size: 15px !important;
    }
    body.size-sm .settings-overlay > * {
      width: min(96vw, 560px) !important;
      max-height: 94vh !important;
      font-size: 15px !important;
    }
    body.size-sm .settings-row {
      font-size: 15px !important;
      min-height: 52px !important;
    }
    body.size-sm .pm-title,
    body.size-sm .nwm-title,
    body.size-sm .confirm-title,
    body.size-sm .lore-modal-title {
      font-size: 20px !important;
    }
    body.size-sm .pm-btn,
    body.size-sm .nwm-btn,
    body.size-sm .confirm-btn,
    body.size-sm .menu-btn {
      min-height: 56px !important;
      font-size: 18px !important;
      padding: 14px 20px !important;
      letter-spacing: 0.04em !important;
    }
    body.size-sm .pm-card {
      padding: 24px 18px !important;
      gap: 12px !important;
      width: min(92vw, 360px) !important;
    }
    body.size-sm .pm-title {
      font-size: 22px !important;
      margin-bottom: 18px !important;
    }
    body.size-sm .pm-confirm-msg {
      font-size: 16px !important;
      line-height: 1.4 !important;
    }

    /* ── Build panel cards + tabs: finger-friendly. */
    body.size-sm .build-card {
      min-height: 72px !important;
      min-width: 72px !important;
    }
    body.size-sm .build-panel .build-tab {
      min-height: 44px !important;
      padding: 10px 14px !important;
      font-size: 14px !important;
    }

    /* ── Drawer close button (mobile modal). Grabber hidden — in
       fullscreen modal mode there's no drag-to-dismiss. */
    .planeta-drawer-grabber,
    .planeta-drawer-close {
      display: none;
    }
    body.size-sm .planeta-drawer-close,
    body.portrait.size-md .planeta-drawer-close {
      display: flex;
      position: absolute;
      top: 14px;
      right: 14px;
      width: 48px;
      height: 48px;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255,255,255,0.28);
      background: rgba(10,20,35,0.75);
      color: var(--hud-text, #e8f2ff);
      border-radius: 12px;
      font-size: 20px;
      cursor: pointer;
      touch-action: manipulation;
      z-index: 3;
    }

    /* ── FULLSCREEN MODAL for planet-drawer on mobile.
       Overrides all bottom-sheet rules. No slide-from-bottom,
       no 85vh cap — covers the entire viewport. */
    body.size-sm .planeta-drawer,
    body.portrait.size-md .planeta-drawer {
      position: fixed !important;
      inset: 0 !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      max-width: 100vw !important;
      height: 100dvh !important;
      max-height: 100dvh !important;
      margin: 0 !important;
      border-radius: 0 !important;
      border: none !important;
      transform: none !important;
      display: none !important;
      flex-direction: column !important;
      z-index: 950 !important;
      overflow-y: auto !important;
      animation: orbital-modal-fade-in 180ms ease !important;
      transition: opacity 180ms ease !important;
    }
    body.size-sm .planeta-drawer.visible,
    body.portrait.size-md .planeta-drawer.visible {
      display: flex !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    @keyframes orbital-modal-fade-in {
      from { opacity: 0; transform: scale(0.98); }
      to   { opacity: 1; transform: scale(1); }
    }
    body.size-sm .planeta-drawer-body,
    body.portrait.size-md .planeta-drawer-body {
      flex: 1 !important;
      overflow-y: auto !important;
      padding: 16px 20px 32px !important;
    }
    body.size-sm .planeta-drawer-head,
    body.portrait.size-md .planeta-drawer-head {
      padding: 18px 72px 14px 20px !important;
      gap: 14px !important;
    }

    /* ── Planeta drawer tabs (mobile only). ───────────────────────── */
    .planeta-drawer-tabs {
      display: none;
    }
    body.size-sm .planeta-drawer-tabs,
    body.portrait.size-md .planeta-drawer-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 8px 12px 4px;
      background: transparent;
    }
    .planeta-drawer-tab {
      appearance: none;
      border: 1px solid var(--hud-border, rgba(255,255,255,0.25));
      background: rgba(10,20,35,0.5);
      color: var(--hud-text-dim, rgba(255,255,255,0.55));
      font-family: "Silkscreen", "VT323", monospace;
      font-size: 14px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 10px 14px;
      border-radius: 8px;
      cursor: pointer;
      min-height: 44px;
    }
    .planeta-drawer-tab.active {
      background: rgba(40,80,130,0.75);
      color: #fff;
      border-color: rgba(255,255,255,0.7);
    }
    .planeta-drawer-build {
      padding: 0 8px 16px;
      flex: 1;
      overflow-y: auto;
    }
    .build-panel.embedded {
      position: static !important;
      width: 100% !important;
      max-width: 100% !important;
      max-height: none !important;
      left: auto !important;
      right: auto !important;
      bottom: auto !important;
      top: auto !important;
      transform: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      border: none !important;
      background: transparent !important;
      animation: none !important;
      /* atualizarBuildPanel toggles .visible each frame; when embedded
         the panel must always be visible regardless of its own class. */
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
    }
    /* Hide the standalone build-panel on mobile — lives inside drawer now */
    body.size-sm .build-panel:not(.embedded),
    body.portrait.size-md .build-panel:not(.embedded) {
      display: none !important;
    }

    /* ── Planet drawer text + pills. Fixed px, independent of --hud-unit. */
    body.size-sm .planeta-drawer {
      font-size: 16px !important;
      display: flex !important;
      flex-direction: column !important;
    }
    body.size-sm .planeta-drawer-name {
      font-size: 22px !important;
    }
    body.size-sm .planeta-drawer-tipo {
      font-size: 13px !important;
      letter-spacing: 0.06em !important;
    }
    body.size-sm .planeta-drawer-owner,
    body.size-sm .planeta-drawer-owner-name {
      font-size: 14px !important;
    }
    body.size-sm .planeta-card-title {
      font-size: 14px !important;
      letter-spacing: 0.06em !important;
    }
    body.size-sm .planeta-resource-value {
      font-size: 22px !important;
    }
    body.size-sm .planeta-resource-label {
      font-size: 12px !important;
      letter-spacing: 0.04em !important;
    }
    body.size-sm .planeta-stats-row,
    body.size-sm .planeta-stats-label,
    body.size-sm .planeta-stats-value {
      font-size: 15px !important;
    }
    body.size-sm .planeta-drawer button,
    body.size-sm .planeta-drawer .drawer-pill {
      min-height: 44px !important;
      font-size: 14px !important;
    }

    /* ── Build panel cards: readable labels, not just icons. */
    body.size-sm .build-card {
      font-size: 13px !important;
    }
    body.size-sm .build-card-name,
    body.size-sm .build-card-cost {
      font-size: 13px !important;
    }

    /* ── Ship panel action icons need bigger tap targets. */
    body.size-sm .ship-panel-action {
      min-width: 48px !important;
      min-height: 48px !important;
    }
  `;
  document.head.appendChild(style);
}
