import { getMixer, getCategoriaNode } from './mixer';

/**
 * Procedural ambient music for Orbital Wydra.
 *
 * Generates a slow, evolving space drone using only Web Audio synthesis
 * (no external assets). The texture is built from:
 *
 *  - 1 sub-bass sine drone (root note)
 *  - 2 mid-range sawtooth oscillators detuned for chorus, low-pass filtered
 *  - 1 high "shimmer" triangle with slow tremolo
 *  - 3 LFOs that modulate detune, filter cutoff, and shimmer volume so
 *    nothing repeats exactly
 *
 * Routes through the 'musica' GainNode in the mixer, so master volume
 * and the user's music slider in Settings both affect it.
 *
 * Public API:
 *   - iniciarMusicaAmbiente()  — start (idempotent; lazy-creates oscillators)
 *   - pararMusicaAmbiente()    — stop and tear down
 *   - musicaAtiva()            — boolean state
 *
 * Browser autoplay policy: must be called after a user gesture. We hook
 * into the first interaction in main.ts.
 */

interface VoiceGroup {
  ctx: AudioContext;
  out: GainNode;          // local mix bus (connects to mixer.musica)
  nodes: AudioNode[];     // all oscillators + LFOs for cleanup
  startTime: number;
}

let _voices: VoiceGroup | null = null;

// Pentatonic minor scale rooted at A2 (110Hz). Sounds spacious + slightly sad.
const ROOT_HZ = 110;
const SCALE_RATIOS = [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5]; // A C D E G

function semitones(base: number, n: number): number {
  return base * Math.pow(2, n / 12);
}

export function musicaAtiva(): boolean {
  return _voices !== null;
}

export function iniciarMusicaAmbiente(): void {
  if (_voices) return;
  const mixer = getMixer();
  if (!mixer) return;
  const target = getCategoriaNode('musica');
  if (!target) return;

  const ctx = mixer.ctx;
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(target);
  // Fade in over 4s so it doesn't pop
  out.gain.linearRampToValueAtTime(1.0, now + 4);

  const nodes: AudioNode[] = [];

  // ─── Voice 1: Sub-bass sine drone (root) ───────────────────────────────
  {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = ROOT_HZ / 2; // A1 ≈ 55Hz
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    osc.connect(gain).connect(out);
    osc.start(now);
    nodes.push(osc, gain);
  }

  // ─── Voice 2 & 3: Mid sawtooth chorus ──────────────────────────────────
  // Two saws detuned by ±7 cents form a slow phasing chorus.
  // Routed through a low-pass filter that opens/closes via LFO.
  {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 4;
    filter.connect(out);

    // LFO modulating cutoff — period ~22s
    const lfoCutoff = ctx.createOscillator();
    lfoCutoff.type = 'sine';
    lfoCutoff.frequency.value = 1 / 22;
    const lfoCutoffGain = ctx.createGain();
    lfoCutoffGain.gain.value = 380; // sweep ±380Hz around the base freq
    lfoCutoff.connect(lfoCutoffGain).connect(filter.frequency);
    lfoCutoff.start(now);
    nodes.push(lfoCutoff, lfoCutoffGain);

    // Two detuned saws at the root + a fifth
    const freqs = [ROOT_HZ * SCALE_RATIOS[0], ROOT_HZ * SCALE_RATIOS[3]];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const detune = ctx.createGain(); // misuse Gain as static offset isn't possible; modulate via LFO
      const g = ctx.createGain();
      g.gain.value = 0.06;
      osc.connect(g).connect(filter);
      // Slow detune drift LFO
      const lfoDetune = ctx.createOscillator();
      lfoDetune.type = 'sine';
      lfoDetune.frequency.value = 1 / (13 + Math.random() * 7);
      const lfoDetuneGain = ctx.createGain();
      lfoDetuneGain.gain.value = 6 + Math.random() * 4; // ±6-10 cents
      lfoDetune.connect(lfoDetuneGain).connect(osc.detune);
      lfoDetune.start(now);
      osc.start(now);
      nodes.push(osc, g, lfoDetune, lfoDetuneGain, detune);
    }
    nodes.push(filter);
  }

  // ─── Voice 4: High shimmer triangle ────────────────────────────────────
  // Gentle high note with tremolo — adds a sense of "wonder".
  {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    // Octave + a third above root
    osc.frequency.value = semitones(ROOT_HZ * 4, 4);
    const gain = ctx.createGain();
    gain.gain.value = 0.0; // tremolo brings it in/out
    osc.connect(gain).connect(out);

    // Tremolo LFO — period ~9s
    const tremolo = ctx.createOscillator();
    tremolo.type = 'sine';
    tremolo.frequency.value = 1 / 9;
    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 0.025; // peak gain when LFO at +1
    // Need a constant offset of equal magnitude so the gain swings 0 → 0.05
    const tremoloOffset = ctx.createConstantSource();
    tremoloOffset.offset.value = 0.025;
    tremoloOffset.connect(gain.gain);
    tremolo.connect(tremoloGain).connect(gain.gain);
    tremolo.start(now);
    tremoloOffset.start(now);
    osc.start(now);
    nodes.push(osc, gain, tremolo, tremoloGain, tremoloOffset);
  }

  _voices = { ctx, out, nodes, startTime: now };
}

export function pararMusicaAmbiente(): void {
  const v = _voices;
  if (!v) return;
  _voices = null;

  const ctx = v.ctx;
  const now = ctx.currentTime;
  // Fade out over 1.5s, then stop everything
  v.out.gain.cancelScheduledValues(now);
  v.out.gain.setValueAtTime(v.out.gain.value, now);
  v.out.gain.linearRampToValueAtTime(0, now + 1.5);

  setTimeout(() => {
    for (const node of v.nodes) {
      try {
        if ('stop' in node && typeof (node as any).stop === 'function') {
          (node as any).stop();
        }
        node.disconnect();
      } catch {
        // node may already be torn down
      }
    }
    try { v.out.disconnect(); } catch { /* noop */ }
  }, 1700);
}
