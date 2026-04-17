import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { resetConfigForTest } from '../../config';
import { onAction, onActionUp, _dispatchForTest, _dispatchUpForTest } from '../dispatcher';

describe('dispatcher', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('calls onAction callback for matching key', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('Equal', 'CANVAS');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('does not call callback for non-matching key', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('KeyQ', 'CANVAS');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('ignores events when target is INPUT', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('Equal', 'INPUT');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('ignores events when target is TEXTAREA', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('Equal', 'TEXTAREA');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('onActionUp fires on keyup', () => {
    const fn = vi.fn();
    const unsub = onActionUp('pan_up', fn);
    _dispatchUpForTest('KeyW', 'CANVAS');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('unsubscribe stops callbacks', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    unsub();
    _dispatchForTest('Equal', 'CANVAS');
    expect(fn).not.toHaveBeenCalled();
  });
});
