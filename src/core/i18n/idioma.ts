import { getConfig, setConfig } from '../config';

let _overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'hud-fade-overlay';
  document.body.appendChild(el);
  _overlay = el;
  return el;
}

export function getIdioma(): 'pt' | 'en' {
  return getConfig().language ?? 'pt';
}

export function trocarIdioma(lang: 'pt' | 'en'): void {
  if (lang === getIdioma()) return;
  const overlay = ensureOverlay();
  overlay.classList.add('active');
  overlay.addEventListener('transitionend', function handler() {
    overlay.removeEventListener('transitionend', handler);
    setConfig({ language: lang });
    requestAnimationFrame(() => {
      overlay.classList.remove('active');
    });
  }, { once: true });
}
