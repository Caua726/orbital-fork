import { resolveKeyToAction } from './keymap';

type ActionCallback = () => void;
const _listeners = new Map<string, Set<ActionCallback>>();
const _upListeners = new Map<string, Set<ActionCallback>>();
let _installed = false;
let _habilitado = true;

export function setDispatcherHabilitado(val: boolean): void {
  _habilitado = val;
}

export function onAction(actionId: string, callback: ActionCallback): () => void {
  if (!_listeners.has(actionId)) _listeners.set(actionId, new Set());
  _listeners.get(actionId)!.add(callback);
  return () => { _listeners.get(actionId)?.delete(callback); };
}

export function onActionUp(actionId: string, callback: ActionCallback): () => void {
  if (!_upListeners.has(actionId)) _upListeners.set(actionId, new Set());
  _upListeners.get(actionId)!.add(callback);
  return () => { _upListeners.get(actionId)?.delete(callback); };
}

// F-keys left passthrough so the browser's reload / dev shortcuts still fire.
const PASSTHROUGH_KEYS = new Set(['F1', 'F3', 'F5']);

function dispatch(code: string, targetTag: string, listeners: Map<string, Set<ActionCallback>>): boolean {
  if (!_habilitado) return false;
  if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return false;
  const actionId = resolveKeyToAction(code);
  if (!actionId) return false;
  const cbs = listeners.get(actionId);
  if (!cbs || cbs.size === 0) return false;
  for (const cb of cbs) {
    try { cb(); } catch (err) { console.error(`[input] action ${actionId} error:`, err); }
  }
  return !PASSTHROUGH_KEYS.has(code);
}

export function instalarDispatcher(): void {
  if (_installed) return;
  _installed = true;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName ?? '';
    if ((e.target as HTMLElement)?.isContentEditable) return;
    const handled = dispatch(e.code, tag, _listeners);
    if (handled) e.preventDefault();
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName ?? '';
    dispatch(e.code, tag, _upListeners);
  });
}

export function _dispatchForTest(code: string, targetTag: string): boolean {
  return dispatch(code, targetTag, _listeners);
}

export function _dispatchUpForTest(code: string, targetTag: string): boolean {
  return dispatch(code, targetTag, _upListeners);
}
