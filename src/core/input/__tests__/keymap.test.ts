import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { resetConfigForTest, setConfig } from '../../config';
import { getActiveKeymap, resolveKeyToAction, detectarConflito } from '../keymap';

describe('keymap', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('returns default keys when no custom bindings', () => {
    const map = getActiveKeymap();
    expect(map.zoom_in).toEqual(['Equal', 'NumpadAdd']);
    expect(map.toggle_debug_fast).toEqual(['F1']);
  });

  it('returns custom binding when set', () => {
    setConfig({ input: { bindings: { zoom_in: ['KeyZ'] } } });
    const map = getActiveKeymap();
    expect(map.zoom_in).toEqual(['KeyZ']);
    expect(map.zoom_out).toEqual(['Minus', 'NumpadSubtract']);
  });

  it('resolveKeyToAction finds the correct action', () => {
    expect(resolveKeyToAction('Equal')).toBe('zoom_in');
    expect(resolveKeyToAction('NumpadAdd')).toBe('zoom_in');
    expect(resolveKeyToAction('F1')).toBe('toggle_debug_fast');
    expect(resolveKeyToAction('KeyQ')).toBeNull();
  });

  it('resolveKeyToAction uses custom bindings', () => {
    setConfig({ input: { bindings: { zoom_in: ['KeyZ'] } } });
    expect(resolveKeyToAction('KeyZ')).toBe('zoom_in');
    expect(resolveKeyToAction('Equal')).toBeNull();
  });

  it('detectarConflito finds conflicts', () => {
    expect(detectarConflito('Equal')).toBe('zoom_in');
    expect(detectarConflito('Equal', 'zoom_in')).toBeNull();
    expect(detectarConflito('KeyQ')).toBeNull();
  });
});
