import { getMixer, getCategoriaNode, type AudioCategoria } from './mixer';

function tocar(
  categoria: AudioCategoria,
  freq: number,
  dur: number,
  tipo: OscillatorType = 'sine',
  volume: number = 0.3,
  decay: boolean = true,
): void {
  const m = getMixer();
  if (!m) return;
  const catNode = getCategoriaNode(categoria);
  if (!catNode) return;
  const osc = m.ctx.createOscillator();
  const gain = m.ctx.createGain();
  osc.type = tipo;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  if (decay) gain.gain.exponentialRampToValueAtTime(0.001, m.ctx.currentTime + dur);
  osc.connect(gain);
  gain.connect(catNode);
  osc.start(m.ctx.currentTime);
  osc.stop(m.ctx.currentTime + dur);
  // Tear down the graph once the oscillator finishes. Without this the
  // GainNode stayed connected to the category bus forever, one per call;
  // on long sessions that's thousands of dangling nodes per minute.
  osc.onended = () => {
    try { gain.disconnect(); } catch { /* already torn down */ }
  };
}

// Reuse decoded noise buffers across calls — each `somExplosao` during
// combat previously allocated a fresh Float32Array + AudioBuffer, and
// with several explosions per second that produced noticeable GC and
// decoder-thread pressure. Keyed by `${sampleRate}-${dur}` since the
// sample data is stateless and only read during playback.
const _ruidoBufferCache = new Map<string, AudioBuffer>();

function tocarRuido(categoria: AudioCategoria, dur: number, volume = 0.2): void {
  const m = getMixer();
  if (!m) return;
  const catNode = getCategoriaNode(categoria);
  if (!catNode) return;
  const cacheKey = `${m.ctx.sampleRate}-${dur}`;
  let buffer = _ruidoBufferCache.get(cacheKey);
  if (!buffer) {
    const bufferSize = m.ctx.sampleRate * dur;
    buffer = m.ctx.createBuffer(1, bufferSize, m.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    _ruidoBufferCache.set(cacheKey, buffer);
  }
  const src = m.ctx.createBufferSource();
  src.buffer = buffer;
  const gain = m.ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(catNode);
  src.start();
  // Same cleanup story as tocar(): disconnect the gain when the buffer
  // source naturally ends so we don't pile up orphan nodes on the bus.
  src.onended = () => {
    try { gain.disconnect(); } catch { /* already torn down */ }
  };
}

export function somClique(): void {
  tocar('ui', 800, 0.08, 'square', 0.15);
  setTimeout(() => tocar('ui', 1200, 0.06, 'square', 0.1), 30);
}

export function somEnvio(): void {
  tocar('sfx', 300, 0.3, 'sawtooth', 0.15);
  setTimeout(() => tocar('sfx', 500, 0.2, 'sawtooth', 0.1), 50);
  setTimeout(() => tocar('sfx', 700, 0.15, 'sawtooth', 0.08), 100);
}

export function somExplosao(): void {
  tocarRuido('sfx', 0.4, 0.3);
  tocar('sfx', 100, 0.3, 'sine', 0.2);
  setTimeout(() => tocar('sfx', 60, 0.2, 'sine', 0.15), 50);
}

export function somConquista(): void {
  tocar('sfx', 400, 0.15, 'square', 0.15);
  setTimeout(() => tocar('sfx', 500, 0.15, 'square', 0.15), 100);
  setTimeout(() => tocar('sfx', 700, 0.2, 'square', 0.15), 200);
}

export function somVitoria(): void {
  const notas: number[] = [523, 659, 784, 1047];
  notas.forEach((n, i) => {
    setTimeout(() => tocar('aviso', n, 0.3, 'square', 0.15), i * 150);
  });
  setTimeout(() => tocar('aviso', 1047, 0.8, 'sine', 0.2, true), 600);
}

export function somDerrota(): void {
  const notas: number[] = [400, 350, 300, 200];
  notas.forEach((n, i) => {
    setTimeout(() => tocar('aviso', n, 0.4, 'sawtooth', 0.12), i * 200);
  });
}

export function somConstrucaoCompleta(): void {
  tocar('aviso', 600, 0.1, 'square', 0.12);
  setTimeout(() => tocar('aviso', 800, 0.1, 'square', 0.12), 80);
  setTimeout(() => tocar('aviso', 1000, 0.15, 'square', 0.1), 160);
}

export function somPesquisaCompleta(): void {
  tocar('aviso', 500, 0.2, 'sine', 0.15);
  setTimeout(() => tocar('aviso', 750, 0.2, 'sine', 0.15), 120);
  setTimeout(() => tocar('aviso', 1000, 0.3, 'sine', 0.12), 240);
  setTimeout(() => tocar('aviso', 750, 0.15, 'sine', 0.08), 400);
}

export function somNaveProducida(): void {
  tocar('sfx', 400, 0.1, 'triangle', 0.12);
  setTimeout(() => tocar('sfx', 600, 0.12, 'triangle', 0.1), 60);
}
