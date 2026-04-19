let _injected = false;

export function injectMobileStyles(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Touch targets: all buttons ≥44px in touch mode */
    body.touch button,
    body.touch .sidebar-btn,
    body.touch .settings-select-display {
      min-height: 44px;
    }

    /* Top HUD density: shrink paddings on small portrait */
    body.touch.size-sm.portrait .resource-bar,
    body.touch.size-sm.portrait .credits-bar,
    body.touch.size-sm.portrait .empire-badge {
      font-size: 11px !important;
      padding: 4px 6px !important;
    }
    body.touch.size-sm.portrait .credits-clock,
    body.touch.size-sm.portrait .credits-divider {
      display: none !important;
    }

    /* Minimap: shrink in sm */
    body.touch.size-sm .minimap {
      transform: scale(0.7);
      transform-origin: bottom left;
    }

    /* Modals fill the screen in sm */
    body.touch.size-sm .settings-overlay,
    body.touch.size-sm .main-menu,
    body.touch.size-sm .pause-menu,
    body.touch.size-sm .new-world-modal,
    body.touch.size-sm .save-modal-backdrop,
    body.touch.size-sm .lore-modal-backdrop,
    body.touch.size-sm .confirm-backdrop,
    body.touch.size-sm .colony-modal {
      width: 100vw !important;
      max-width: 100vw !important;
      height: 100vh !important;
      max-height: 100vh !important;
      border-radius: 0 !important;
      overflow-y: auto;
    }

    /* Inner cards within modals — keep padding but allow full-height scroll */
    body.touch.size-sm .lore-modal,
    body.touch.size-sm .confirm-dialog,
    body.touch.size-sm .pm-card,
    body.touch.size-sm .nwm-card {
      max-width: 100vw !important;
      max-height: 100vh !important;
      border-radius: 0 !important;
      overflow-y: auto;
    }
  `;
  document.head.appendChild(style);
}
