let _tip: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .ui-tooltip {
      position: fixed;
      max-width: 320px;
      background: rgba(0, 0, 0, 0.92);
      border: 1px solid var(--hud-border);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.75);
      line-height: 1.45;
      padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.8);
      pointer-events: none;
      z-index: 900;
      opacity: 0;
      white-space: pre-line;
      transition: opacity 140ms ease;
    }
    .ui-tooltip.show { opacity: 1; }
    .ui-help-icon {
      display: inline-block;
      width: calc(var(--hud-unit) * 1);
      height: calc(var(--hud-unit) * 1);
      line-height: calc(var(--hud-unit) * 1);
      text-align: center;
      border: 1px solid var(--hud-text-dim);
      border-radius: 50%;
      font-size: calc(var(--hud-unit) * 0.7);
      color: var(--hud-text-dim);
      cursor: help;
      margin-left: calc(var(--hud-unit) * 0.3);
      vertical-align: middle;
    }
    .ui-help-icon:hover {
      color: var(--hud-text);
      border-color: var(--hud-text);
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

export function comHelp(label: HTMLElement, text: string): void {
  injectStyles();
  const icon = document.createElement('span');
  icon.className = 'ui-help-icon';
  icon.textContent = '?';
  icon.setAttribute('aria-label', text);
  icon.addEventListener('mouseenter', () => {
    const tip = ensureTip();
    tip.textContent = text;
    tip.classList.add('show');
    const rect = icon.getBoundingClientRect();
    tip.style.left = `${rect.right + 8}px`;
    tip.style.top = `${rect.top}px`;
  });
  icon.addEventListener('mouseleave', () => {
    _tip?.classList.remove('show');
  });
  label.appendChild(icon);
}
