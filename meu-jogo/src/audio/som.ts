// Sons gerados proceduralmente via Web Audio API
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tocar(frequencia: number, duracao: number, tipo: OscillatorType = 'sine', volume: number = 0.3, decay: boolean = true): void {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = tipo;
  osc.frequency.value = frequencia;
  gain.gain.value = volume;

  if (decay) {
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duracao);
  }

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duracao);
}

function tocarRuido(duracao: number, volume: number = 0.2): void {
  const c = getCtx();
  const bufferSize = c.sampleRate * duracao;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
  }

  const source = c.createBufferSource();
  source.buffer = buffer;
  const gain = c.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(c.destination);
  source.start();
}

export function somClique(): void {
  tocar(800, 0.08, 'square', 0.15);
  setTimeout(() => tocar(1200, 0.06, 'square', 0.1), 30);
}

export function somEnvio(): void {
  tocar(300, 0.3, 'sawtooth', 0.15);
  setTimeout(() => tocar(500, 0.2, 'sawtooth', 0.1), 50);
  setTimeout(() => tocar(700, 0.15, 'sawtooth', 0.08), 100);
}

export function somExplosao(): void {
  tocarRuido(0.4, 0.3);
  tocar(100, 0.3, 'sine', 0.2);
  setTimeout(() => tocar(60, 0.2, 'sine', 0.15), 50);
}

export function somConquista(): void {
  tocar(400, 0.15, 'square', 0.15);
  setTimeout(() => tocar(500, 0.15, 'square', 0.15), 100);
  setTimeout(() => tocar(700, 0.2, 'square', 0.15), 200);
}

export function somVitoria(): void {
  const notas: number[] = [523, 659, 784, 1047];
  notas.forEach((n, i) => {
    setTimeout(() => tocar(n, 0.3, 'square', 0.15), i * 150);
  });
  setTimeout(() => tocar(1047, 0.8, 'sine', 0.2, true), 600);
}

export function somDerrota(): void {
  const notas: number[] = [400, 350, 300, 200];
  notas.forEach((n, i) => {
    setTimeout(() => tocar(n, 0.4, 'sawtooth', 0.12), i * 200);
  });
}
