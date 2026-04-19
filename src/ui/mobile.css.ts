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
    /* ── HUD base unit: aggressive bump so derived text is readable. */
    body.size-sm,
    body.portrait.size-md {
      --hud-unit: clamp(20px, 4vmin, 28px) !important;
      --hud-margin: clamp(12px, 2.4vmin, 22px) !important;
    }

    /* ── Hide minimap + zoom controls on small screens — pinça/duplo-toque substituem. */
    body.size-sm .minimap,
    body.size-sm .zoom-controls {
      display: none !important;
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
      font-size: 15px !important;
      padding: 8px 12px !important;
      line-height: 1.3 !important;
      max-width: calc(100vw - 24px) !important;
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

    /* Nudge top HUD below the hamburger strip. */
    body.size-sm .resource-bar,
    body.size-sm .empire-badge {
      top: 76px !important;
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
      min-height: 52px !important;
      font-size: 16px !important;
      padding: 12px 18px !important;
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

    /* ── Planet drawer text + pills. */
    body.size-sm .planeta-drawer {
      font-size: 15px !important;
    }
    body.size-sm .planeta-drawer button,
    body.size-sm .planeta-drawer .drawer-pill {
      min-height: 44px !important;
      font-size: 14px !important;
    }

    /* ── Ship panel action icons need bigger tap targets. */
    body.size-sm .ship-panel-action {
      min-width: 48px !important;
      min-height: 48px !important;
    }
  `;
  document.head.appendChild(style);
}
