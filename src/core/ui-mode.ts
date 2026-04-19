import { getConfig, onConfigChange } from './config';

export type UiSize = 'sm' | 'md' | 'lg';
export type UiOrientation = 'portrait' | 'landscape';

export interface UiMode {
  touch: boolean;
  size: UiSize;
  orientation: UiOrientation;
}

export interface UiModeInputs {
  coarsePointer: boolean;
  innerWidth: number;
  portrait: boolean;
}

export function computeUiMode(inputs: UiModeInputs): UiMode {
  const mode = getConfig().ui?.touchMode ?? 'auto';
  let touch: boolean;
  if (mode === 'on') touch = true;
  else if (mode === 'off') touch = false;
  else touch = inputs.coarsePointer && inputs.innerWidth <= 1024;

  const size: UiSize =
    inputs.innerWidth < 600 ? 'sm'
    : inputs.innerWidth < 1024 ? 'md'
    : 'lg';

  const orientation: UiOrientation = inputs.portrait ? 'portrait' : 'landscape';
  return { touch, size, orientation };
}

let _current: UiMode = { touch: false, size: 'lg', orientation: 'landscape' };
let _installed = false;
let _coarseMql: MediaQueryList | null = null;
let _portraitMql: MediaQueryList | null = null;

function readInputs(): UiModeInputs {
  return {
    coarsePointer: _coarseMql?.matches ?? false,
    innerWidth: window.innerWidth,
    portrait: _portraitMql?.matches ?? (window.innerHeight > window.innerWidth),
  };
}

function applyBodyClasses(m: UiMode): void {
  const b = document.body.classList;
  b.toggle('touch', m.touch);
  b.toggle('portrait', m.orientation === 'portrait');
  b.toggle('landscape', m.orientation === 'landscape');
  b.toggle('size-sm', m.size === 'sm');
  b.toggle('size-md', m.size === 'md');
  b.toggle('size-lg', m.size === 'lg');
}

export function getUiMode(): UiMode {
  return _current;
}

export function isTouchMode(): boolean {
  return _current.touch;
}

function recompute(): void {
  const next = computeUiMode(readInputs());
  const changed =
    next.touch !== _current.touch ||
    next.size !== _current.size ||
    next.orientation !== _current.orientation;
  _current = next;
  applyBodyClasses(_current);
  if (changed) {
    window.dispatchEvent(new CustomEvent('orbital:ui-mode-changed', { detail: next }));
  }
}

export function instalarUiMode(): void {
  if (_installed) return;
  _installed = true;
  _coarseMql = window.matchMedia('(pointer: coarse)');
  _portraitMql = window.matchMedia('(orientation: portrait)');
  _coarseMql.addEventListener('change', recompute);
  _portraitMql.addEventListener('change', recompute);
  window.addEventListener('resize', recompute);
  window.addEventListener('orientationchange', recompute);
  onConfigChange(recompute);
  recompute();
}
