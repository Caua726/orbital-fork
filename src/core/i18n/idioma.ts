import { getConfig, setConfig } from '../config';

let _overlay: HTMLDivElement | null = null;
let _inflight = false;

function ensureOverlay(): HTMLDivElement {
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'hud-fade-overlay';
  document.body.appendChild(el);
  // Force a layout so the element paints at opacity: 0 BEFORE we add .active,
  // otherwise the browser collapses both styles into one frame and the
  // 0→1 transition never runs (and transitionend never fires).
  void el.offsetWidth;
  _overlay = el;
  return el;
}

export function getIdioma(): 'pt' | 'en' {
  return getConfig().language ?? 'pt';
}

export function trocarIdioma(lang: 'pt' | 'en'): void {
  if (_inflight) return;
  if (lang === getIdioma()) return;
  _inflight = true;

  const overlay = ensureOverlay();
  let applied = false;
  const FADE_MS = 200;

  function applyAndFadeOut(): void {
    if (applied) return;
    applied = true;
    setConfig({ language: lang });
    requestAnimationFrame(() => {
      overlay.classList.remove('active');
      window.setTimeout(() => { _inflight = false; }, FADE_MS + 50);
    });
  }

  overlay.addEventListener('transitionend', applyAndFadeOut, { once: true });
  // Safety fallback: if transitionend doesn't fire (e.g. prefers-reduced-motion,
  // tab hidden, or the browser collapsed the transition), apply after the fade
  // window elapses anyway so we never get stuck on a black screen.
  window.setTimeout(applyAndFadeOut, FADE_MS + 80);

  requestAnimationFrame(() => {
    overlay.classList.add('active');
  });
}
