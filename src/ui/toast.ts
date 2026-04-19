let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function ensure(): HTMLDivElement {
  if (_container) return _container;
  if (!_styleInjected) {
    _styleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
      .toast-stack {
        position: fixed;
        bottom: calc(var(--hud-margin) * 1.5);
        right: var(--hud-margin);
        display: flex;
        flex-direction: column-reverse;
        gap: calc(var(--hud-unit) * 0.4);
        z-index: 700;
        pointer-events: none;
      }
      .toast {
        background: var(--hud-bg);
        border: 1px solid var(--hud-border);
        border-left: 3px solid #8ce0ff;
        border-radius: var(--hud-radius);
        backdrop-filter: blur(3px);
        color: var(--hud-text);
        padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 1.2);
        font-family: var(--hud-font);
        font-size: calc(var(--hud-unit) * 0.85);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        box-shadow: var(--hud-shadow), 0 calc(var(--hud-unit) * 0.3) calc(var(--hud-unit) * 0.8) rgba(0,0,0,0.5);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 200ms ease, transform 200ms ease;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
      .toast.err { border-left: 3px solid #ff6b6b; }
    `;
    document.head.appendChild(s);
  }
  const c = document.createElement('div');
  c.className = 'toast-stack';
  document.body.appendChild(c);
  _container = c;
  return c;
}

export function toast(msg: string, kind: 'info' | 'err' = 'info', durationMs = 3000): void {
  const stack = ensure();
  const t = document.createElement('div');
  t.className = `toast ${kind === 'err' ? 'err' : ''}`;
  t.textContent = msg;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, durationMs);
}
