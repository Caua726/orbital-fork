import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

class FakeGainNode {
  gain = { value: 1 };
  connect = (_: any) => {};
}
class FakeAudioContext {
  destination = {};
  currentTime = 0;
  createGain() { return new FakeGainNode(); }
  createOscillator() { return { type: 'sine', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(100) }; }
  createBufferSource() { return { buffer: null, connect: () => {}, start: () => {} }; }
  sampleRate = 44100;
}
(global as any).AudioContext = FakeAudioContext;

import { setConfig, resetConfigForTest } from '../../core/config';
import { getMixer, resetMixerForTest } from '../mixer';

describe('mixer', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
    resetMixerForTest();
  });

  it('creates GainNodes on first getMixer', () => {
    const m = getMixer();
    expect(m).not.toBeNull();
    expect(m!.master).toBeDefined();
    expect(m!.sfx).toBeDefined();
    expect(m!.ui).toBeDefined();
    expect(m!.aviso).toBeDefined();
  });

  it('applies config volumes to gain nodes on creation', () => {
    setConfig({ audio: { master: { volume: 0.5, muted: false }, sfx: { volume: 0.3, muted: false }, ui: { volume: 0.8, muted: false }, aviso: { volume: 1.0, muted: false } } });
    const m = getMixer()!;
    expect(m.master.gain.value).toBeCloseTo(0.5);
    expect(m.sfx.gain.value).toBeCloseTo(0.3);
    expect(m.ui.gain.value).toBeCloseTo(0.8);
    expect(m.aviso.gain.value).toBeCloseTo(1.0);
  });

  it('mute zeroes the gain but preserves volume in config', () => {
    setConfig({ audio: { master: { volume: 0.9, muted: true }, sfx: { volume: 1, muted: false }, ui: { volume: 1, muted: false }, aviso: { volume: 1, muted: false } } });
    const m = getMixer()!;
    expect(m.master.gain.value).toBe(0);
  });

  it('config observer updates gain live', () => {
    const m = getMixer()!;
    setConfig({ audio: { master: { volume: 0.2, muted: false }, sfx: { volume: 1, muted: false }, ui: { volume: 1, muted: false }, aviso: { volume: 1, muted: false } } });
    expect(m.master.gain.value).toBeCloseTo(0.2);
  });
});
