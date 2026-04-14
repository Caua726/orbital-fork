// Single source of truth for HUD scaling.
// `--hud-unit` is a CSS variable that scales with viewport height, clamped
// between a minimum and maximum. All HUD components use calc() on this unit
// instead of doing their own resize math.
//
// Layout coordination (positioning components so they don't overlap) is
// still handled in JS because it depends on live element sizes.

type LayoutCallback = () => void;

let _badgeEl: HTMLElement | null = null;
let _sidebarEl: HTMLElement | null = null;
let _chatLogEl: HTMLElement | null = null;
let _resourceBarEl: HTMLElement | null = null;
let _creditsBarEl: HTMLElement | null = null;
let _minimapEl: HTMLElement | null = null;
let _planetPanelEl: HTMLElement | null = null;
let _listeners: LayoutCallback[] = [];
let _listening = false;

export function installRootVariables(): void {
  // Load pixelated fonts from Google Fonts
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=VT323&family=Press+Start+2P&display=swap';
  document.head.appendChild(fontLink);

  const style = document.createElement('style');
  style.textContent = `
    :root {
      /* Base unit that everything scales from. Uses min(vh, vw) so the HUD
         shrinks gracefully on both narrow and short viewports. */
      --hud-unit: clamp(12px, 1.8vmin, 22px);
      --hud-margin: clamp(10px, 1.6vmin, 22px);
      --hud-gap: clamp(8px, 1.2vmin, 16px);

      /* Derived tokens */
      --hud-radius: calc(var(--hud-unit) * 0.9);
      --hud-pad: calc(var(--hud-unit) * 0.8);
      --hud-icon: calc(var(--hud-unit) * 2);
      --hud-text-sm: calc(var(--hud-unit) * 0.55);
      --hud-text-md: calc(var(--hud-unit) * 0.8);
      --hud-text-lg: calc(var(--hud-unit) * 1.1);

      /* Colors / surface */
      --hud-bg: rgba(0, 0, 0, 0.88);
      --hud-border: rgba(255, 255, 255, 0.92);
      --hud-line: rgba(255, 255, 255, 0.18);
      --hud-text: #f5f5f5;
      --hud-text-dim: rgba(255, 255, 255, 0.5);
      --hud-text-faint: rgba(255, 255, 255, 0.35);

      --hud-shadow: 0 0 0 1px rgba(255,255,255,0.03), 0 0 24px rgba(255,255,255,0.04);

      /* Pixelated font stack — all HUD text is crisp pixel art style. */
      --hud-font: "Silkscreen", "VT323", "Press Start 2P", monospace;
      --hud-font-display: "Press Start 2P", "Silkscreen", monospace;
      --hud-font-body: "VT323", "Silkscreen", monospace;
    }

    /* Disable font smoothing for authentic pixel look */
    .hud-panel, .hud-panel * {
      -webkit-font-smoothing: none;
      -moz-osx-font-smoothing: none;
      font-smooth: never;
      text-rendering: optimizeSpeed;
    }

    .hud-panel {
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);
      position: fixed;
      z-index: 100;
    }
  `;
  document.head.appendChild(style);
}

export function registerBadge(el: HTMLElement): void {
  _badgeEl = el;
  startListening();
  scheduleRecalc();
}

export function registerSidebar(el: HTMLElement): void {
  _sidebarEl = el;
  startListening();
  scheduleRecalc();
}

export function registerChatLog(el: HTMLElement): void {
  _chatLogEl = el;
  startListening();
  scheduleRecalc();
}

export function registerResourceBar(el: HTMLElement): void {
  _resourceBarEl = el;
  startListening();
  scheduleRecalc();
}

export function unregisterResourceBar(): void {
  _resourceBarEl = null;
  scheduleRecalc();
}

export function registerCreditsBar(el: HTMLElement): void {
  _creditsBarEl = el;
  startListening();
  scheduleRecalc();
}

export function unregisterCreditsBar(): void {
  _creditsBarEl = null;
  scheduleRecalc();
}

export function registerMinimap(el: HTMLElement): void {
  _minimapEl = el;
  startListening();
  scheduleRecalc();
}

export function unregisterMinimap(): void {
  _minimapEl = null;
  scheduleRecalc();
}

export function registerPlanetPanel(el: HTMLElement): void {
  _planetPanelEl = el;
  startListening();
  scheduleRecalc();
}

export function unregisterPlanetPanel(): void {
  _planetPanelEl = null;
  scheduleRecalc();
}


function scheduleRecalc(): void {
  // Measurements are unreliable until layout flushes, so defer to next frame.
  requestAnimationFrame(() => {
    recalc();
    // Run a second pass in case the first triggered layout changes
    // (e.g. moving the sidebar affects its offsetTop measurement).
    requestAnimationFrame(recalc);
  });
}

export function unregisterBadge(): void {
  _badgeEl = null;
  recalc();
}

export function unregisterSidebar(): void {
  _sidebarEl = null;
}

export function unregisterChatLog(): void {
  _chatLogEl = null;
  recalc();
}

export function onLayoutChange(cb: LayoutCallback): void {
  _listeners.push(cb);
}

function startListening(): void {
  if (_listening) return;
  _listening = true;
  window.addEventListener('resize', recalc);
  // Wait for fonts/layout to settle on first run
  requestAnimationFrame(recalc);
}

// Measure a CSS variable by applying it to a throwaway element.
// parseFloat() on the raw var value fails because it contains `clamp()`.
function resolveCssPx(cssValue: string): number {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.width = cssValue;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px;
}

export function recalc(): void {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const gap = resolveCssPx('var(--hud-gap)') || 12;
  const margin = resolveCssPx('var(--hud-margin)') || 18;

  // Center the resource bar horizontally in the space between the badge
  // (or left margin) and the credits bar (or right margin). Clamp to both
  // bounds so it never overlaps either side.
  if (_resourceBarEl) {
    const badgeRect = _badgeEl?.getBoundingClientRect();
    const creditsRect = _creditsBarEl?.getBoundingClientRect();

    const leftBound = badgeRect ? badgeRect.right + gap : margin;
    const rightBound = creditsRect ? creditsRect.left - gap : vw - margin;
    const available = rightBound - leftBound;

    // Allow bar to shrink to fit available width
    _resourceBarEl.style.maxWidth = `${Math.max(0, available)}px`;

    const barWidth = _resourceBarEl.getBoundingClientRect().width;
    const centerX = leftBound + available / 2;
    let leftOffset = centerX - barWidth / 2;
    // Clamp to both sides
    leftOffset = Math.max(leftBound, Math.min(leftOffset, rightBound - barWidth));

    _resourceBarEl.style.left = `${leftOffset}px`;
    _resourceBarEl.style.transform = 'none';
    _resourceBarEl.style.top = `${margin}px`;
  }

  if (_sidebarEl) {
    const badgeRect = _badgeEl?.getBoundingClientRect();
    const chatRect = _chatLogEl?.getBoundingClientRect();

    const topBound = badgeRect ? badgeRect.bottom + gap : margin;
    const bottomBound = chatRect ? chatRect.top - gap : vh - margin;

    const available = bottomBound - topBound;

    // Sidebar fills the available vertical gap exactly. Items inside
    // distribute themselves via justify-content: space-around.
    _sidebarEl.style.top = `${topBound}px`;
    _sidebarEl.style.height = `${Math.max(0, available)}px`;
    _sidebarEl.style.transform = 'none';

    // Scale icons from the sidebar's actual height so they fill the
    // panel proportionally, clamped to reasonable limits.
    const itemCount = _sidebarEl.querySelectorAll('.sidebar-btn').length || 7;
    const perItem = available / itemCount;
    const iconSize = Math.max(14, Math.min(26, perItem * 0.35));
    _sidebarEl.style.setProperty('--sb-icon', `${iconSize}px`);
  }

  if (_minimapEl) {
    _minimapEl.style.right = `${margin}px`;
    _minimapEl.style.bottom = `${margin}px`;
  }

  if (_planetPanelEl) {
    // Vertical centering and slide-in are handled by CSS (top: 50% +
    // translate(_, -50%)). Only constrain max height so the panel never
    // overflows the viewport between margins.
    const maxHeight = Math.max(0, vh - margin * 2);
    _planetPanelEl.style.maxHeight = `${maxHeight}px`;
  }

  for (const cb of _listeners) cb();
}
