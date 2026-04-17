/**
 * Periodic stats sampler — captures a snapshot of per-faction strength
 * every 60 seconds of game time. Cap ~100 samples (≈ 1h40 of play).
 *
 * Drives a future statistics dashboard. Persisted in save.
 */

import type { Mundo } from '../types';
import type { StatsAmostraDTO } from './save/dto';

const CAP_SAMPLES = 100;
const SAMPLE_INTERVAL_MS = 60_000;

let _samples: StatsAmostraDTO[] = [];
let _accumMs = 0;

export function acumularStats(mundo: Mundo, deltaMs: number, tempoJogadoMs: number): void {
  _accumMs += deltaMs;
  if (_accumMs < SAMPLE_INTERVAL_MS) return;
  _accumMs = 0;
  _samples.push(coletarAmostra(mundo, tempoJogadoMs));
  if (_samples.length > CAP_SAMPLES) {
    _samples.splice(0, _samples.length - CAP_SAMPLES);
  }
}

function coletarAmostra(mundo: Mundo, tempoMs: number): StatsAmostraDTO {
  let jPlanetas = 0;
  let jNaves = 0;
  let comum = 0;
  let raro = 0;
  const ias: Record<string, { planetas: number; naves: number }> = {};

  for (const p of mundo.planetas) {
    const d = p.dados.dono;
    if (d === 'jogador') {
      jPlanetas++;
      comum += p.dados.recursos.comum;
      raro += p.dados.recursos.raro;
    } else if (d.startsWith('inimigo')) {
      if (!ias[d]) ias[d] = { planetas: 0, naves: 0 };
      ias[d].planetas++;
    }
  }
  for (const n of mundo.naves) {
    if (n.dono === 'jogador') jNaves++;
    else if (n.dono.startsWith('inimigo')) {
      if (!ias[n.dono]) ias[n.dono] = { planetas: 0, naves: 0 };
      ias[n.dono].naves++;
    }
  }

  return {
    tempoMs,
    jogador: { planetas: jPlanetas, naves: jNaves, comum, raro },
    ias,
  };
}

export function getStats(): readonly StatsAmostraDTO[] {
  return _samples;
}

export function getStatsSerializaveis(): StatsAmostraDTO[] {
  return _samples.map((s) => ({
    tempoMs: s.tempoMs,
    jogador: { ...s.jogador },
    ias: Object.fromEntries(Object.entries(s.ias).map(([k, v]) => [k, { ...v }])),
  }));
}

export function restaurarStats(dtos: StatsAmostraDTO[]): void {
  _samples = dtos.slice(-CAP_SAMPLES).map((s) => ({
    tempoMs: s.tempoMs,
    jogador: { ...s.jogador },
    ias: Object.fromEntries(Object.entries(s.ias).map(([k, v]) => [k, { ...v }])),
  }));
  _accumMs = 0;
}

export function resetStats(): void {
  _samples = [];
  _accumMs = 0;
}
