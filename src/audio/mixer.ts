import { getConfig, onConfigChange } from '../core/config';

export type AudioCategoria = 'sfx' | 'ui' | 'aviso';

interface MixerState {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  ui: GainNode;
  aviso: GainNode;
}

let _state: MixerState | null = null;
let _disponivel = true;
let _observerAttached = false;

export function getMixer(): MixerState | null {
  if (_state) return _state;
  if (!_disponivel) return null;
  try {
    const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!AC) {
      _disponivel = false;
      return null;
    }
    const ctx: AudioContext = new AC();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const sfx = ctx.createGain();    sfx.connect(master);
    const ui = ctx.createGain();     ui.connect(master);
    const aviso = ctx.createGain();  aviso.connect(master);
    _state = { ctx, master, sfx, ui, aviso };
    aplicarConfigAtual();
    if (!_observerAttached) {
      _observerAttached = true;
      onConfigChange(() => aplicarConfigAtual());
    }
    return _state;
  } catch (err) {
    console.warn('[audio] mixer indisponível:', err);
    _disponivel = false;
    return null;
  }
}

export function getCategoriaNode(cat: AudioCategoria): GainNode | null {
  const m = getMixer();
  return m ? m[cat] : null;
}

export function aplicarConfigAtual(): void {
  const m = _state;
  if (!m) return;
  const a = getConfig().audio;
  m.master.gain.value = a.master.muted ? 0 : a.master.volume;
  m.sfx.gain.value = a.sfx.muted ? 0 : a.sfx.volume;
  m.ui.gain.value = a.ui.muted ? 0 : a.ui.volume;
  m.aviso.gain.value = a.aviso.muted ? 0 : a.aviso.volume;
}

export function resetMixerForTest(): void {
  _state = null;
  _disponivel = true;
  _observerAttached = false;
}
