let _injected = false;

export function injectBottomSheetStyles(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Bottom-sheet behavior only for panels that aren't the planeta-drawer
       — the drawer is now a fullscreen modal on mobile (see mobile.css). */
    body.size-sm.portrait .bottom-sheet-capable:not(.planeta-drawer),
    body.portrait.size-md .bottom-sheet-capable:not(.planeta-drawer) {
      position: fixed !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      top: auto !important;
      margin: 0 !important;
      width: 100vw !important;
      max-width: 100vw !important;
      max-height: 85vh !important;
      border-radius: 16px 16px 0 0 !important;
      transform: translateY(100%) !important;
      transition: transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1) !important;
      overflow-y: auto;
    }
    body.size-sm.portrait .bottom-sheet-capable:not(.planeta-drawer).visible,
    body.portrait.size-md .bottom-sheet-capable:not(.planeta-drawer).visible {
      transform: translateY(0) !important;
    }
  `;
  document.head.appendChild(style);
}
