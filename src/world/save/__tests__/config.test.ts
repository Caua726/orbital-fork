import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { getConfig, setConfig, resetConfigForTest, onConfigChange } from '../../../core/config';

describe('config', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('returns defaults when nothing stored', () => {
    const c = getConfig();
    expect(c.autosaveIntervalMs).toBe(60000);
    expect(c.saveMode).toBe('periodic');
  });

  it('persists partial updates', () => {
    setConfig({ autosaveIntervalMs: 30000 });
    expect(getConfig().autosaveIntervalMs).toBe(30000);
    expect(getConfig().saveMode).toBe('periodic');
  });

  it('survives reset+reload by reading from storage', () => {
    setConfig({ saveMode: 'experimental' });
    resetConfigForTest();
    expect(getConfig().saveMode).toBe('experimental');
  });
});

describe('config observer', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('notifies listeners on setConfig', () => {
    const calls: any[] = [];
    const unsub = onConfigChange((c) => calls.push(c.audio.master.volume));
    setConfig({ audio: { master: { volume: 0.5, muted: false } } });
    expect(calls).toEqual([0.5]);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    let calls = 0;
    const unsub = onConfigChange(() => calls++);
    setConfig({ gameplay: { edgeScroll: true, confirmarDestrutivo: true } });
    unsub();
    setConfig({ gameplay: { edgeScroll: false, confirmarDestrutivo: true } });
    expect(calls).toBe(1);
  });

  it('reentrant setConfig is rejected with console.error', () => {
    const errors: any[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => errors.push(args);
    const unsub = onConfigChange(() => {
      setConfig({ audio: { master: { volume: 0.1, muted: false } } });
    });
    setConfig({ audio: { master: { volume: 0.9, muted: false } } });
    expect(errors.length).toBeGreaterThan(0);
    expect(getConfig().audio.master.volume).toBe(0.9);
    unsub();
    console.error = origError;
  });

  it('listener that unsubscribes during notify does not crash', () => {
    let fired = 0;
    let unsub1: (() => void) | null = null;
    unsub1 = onConfigChange(() => { fired++; if (unsub1) unsub1(); });
    setConfig({ gameplay: { edgeScroll: true, confirmarDestrutivo: true } });
    setConfig({ gameplay: { edgeScroll: false, confirmarDestrutivo: true } });
    expect(fired).toBe(1);
  });
});
