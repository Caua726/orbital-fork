/**
 * AI memory: tracks recent threats and combat history per AI.
 *
 * Used by ia-utilidade to prioritize revenge attacks against whoever
 * recently destroyed their ships, and to avoid attacking AIs that have
 * proven too strong.
 *
 * Memory decays over time so old grudges fade.
 */

interface MemoriaInimigo {
  /** Score of how much we hate this dono. Decays toward 0. */
  rancor: Record<string, number>;
  /** Estimated military strength of each dono based on recent encounters. */
  forcaPercebida: Record<string, number>;
  /** Last time we attacked them (epoch ms). */
  ultimoAtaque: Record<string, number>;
  /** Set of planet IDs we've seen at least once (recon memory). */
  planetasVistos: Set<string>;
}

const _memorias = new Map<string, MemoriaInimigo>();

const RANCOR_DECAY_PER_TICK = 0.95;     // 5% decay per tick
const FORCA_DECAY_PER_TICK = 0.98;       // 2% decay
const RANCOR_POR_BAIXA = 1.5;            // each ship lost adds this
const RANCOR_POR_INVASAO = 4.0;          // someone at our planet adds this

function getMem(donoIa: string): MemoriaInimigo {
  let m = _memorias.get(donoIa);
  if (!m) {
    m = { rancor: {}, forcaPercebida: {}, ultimoAtaque: {}, planetasVistos: new Set() };
    _memorias.set(donoIa, m);
  }
  return m;
}

/** Mark a planet as seen — AI "remembers" it and can target it later. */
export function registrarPlanetaVisto(donoIa: string, planetaId: string): void {
  getMem(donoIa).planetasVistos.add(planetaId);
}

export function jaViuPlaneta(donoIa: string, planetaId: string): boolean {
  return getMem(donoIa).planetasVistos.has(planetaId);
}

/** Record that a ship of ours was destroyed by `causador`. */
export function registrarBaixa(donoIa: string, causador: string): void {
  if (donoIa === causador) return;
  const m = getMem(donoIa);
  m.rancor[causador] = (m.rancor[causador] ?? 0) + RANCOR_POR_BAIXA;
}

/** Record that an enemy is in our airspace at one of our planets. Called
 *  once per invader per AI tick with a small `quantidade` (default is the
 *  per-event amount) so a persistent invader settles at a modest rancor
 *  equilibrium under decay rather than spiking. */
export function registrarInvasao(donoIa: string, invasor: string, quantidade: number = RANCOR_POR_INVASAO): void {
  if (donoIa === invasor) return;
  const m = getMem(donoIa);
  m.rancor[invasor] = (m.rancor[invasor] ?? 0) + quantidade;
}

/** Update perceived strength of an enemy based on observed fleet size. */
export function observarForca(donoIa: string, alvo: string, frotaTamanho: number): void {
  const m = getMem(donoIa);
  // Weighted average: 70% memory, 30% new observation
  const atual = m.forcaPercebida[alvo] ?? frotaTamanho;
  m.forcaPercebida[alvo] = atual * 0.7 + frotaTamanho * 0.3;
}

/** Record that we attacked this dono now. */
export function marcarAtaque(donoIa: string, alvo: string): void {
  const m = getMem(donoIa);
  m.ultimoAtaque[alvo] = Date.now();
}

export function getRancor(donoIa: string, contra: string): number {
  return getMem(donoIa).rancor[contra] ?? 0;
}

export function getForcaPercebida(donoIa: string, contra: string): number {
  return getMem(donoIa).forcaPercebida[contra] ?? 0;
}

/**
 * Returns ms since last attack on this target, or Infinity if never.
 * Used to spread attacks out instead of constantly hammering one target.
 */
export function tempoDesdeUltimoAtaque(donoIa: string, contra: string): number {
  const ult = getMem(donoIa).ultimoAtaque[contra];
  // `!== undefined` (not truthiness): a timestamp of 0 is a real "attacked
  // then" value, whereas `ult ? …` would misread it as "never attacked".
  return ult !== undefined ? Date.now() - ult : Infinity;
}

/** TTL for ultimoAtaque entries — attacks older than this stop biasing
 *  cooldown decisions. Matches 'rancor has faded' timescale. */
const ULTIMO_ATAQUE_TTL_MS = 5 * 60 * 1000;

/** Cap on planetasVistos per AI. Beyond this we prune the oldest
 *  entries so the Set doesn't grow forever during hour-long sessions. */
const PLANETAS_VISTOS_CAP = 200;

/** Decay all memories. Called once per AI tick. */
export function decairMemorias(donoIa: string): void {
  const m = getMem(donoIa);
  for (const k of Object.keys(m.rancor)) {
    m.rancor[k] *= RANCOR_DECAY_PER_TICK;
    if (m.rancor[k] < 0.05) delete m.rancor[k];
  }
  for (const k of Object.keys(m.forcaPercebida)) {
    m.forcaPercebida[k] *= FORCA_DECAY_PER_TICK;
    if (m.forcaPercebida[k] < 0.5) delete m.forcaPercebida[k];
  }
  // Prune ultimoAtaque entries older than the TTL — previously this
  // map grew forever, one entry per unique dono ever attacked.
  const agora = Date.now();
  for (const k of Object.keys(m.ultimoAtaque)) {
    if (agora - m.ultimoAtaque[k] > ULTIMO_ATAQUE_TTL_MS) {
      delete m.ultimoAtaque[k];
    }
  }
  // Cap planetasVistos — if somehow the AI saw more than the cap
  // (shouldn't happen in current gameplay but defensive), trim the
  // oldest via the Set's insertion order.
  if (m.planetasVistos.size > PLANETAS_VISTOS_CAP) {
    const keep = Array.from(m.planetasVistos).slice(-PLANETAS_VISTOS_CAP);
    m.planetasVistos.clear();
    for (const id of keep) m.planetasVistos.add(id);
  }
}

/** Wipe all AI memories — call when starting a new world. */
export function resetMemoriasIa(): void {
  _memorias.clear();
}

/**
 * Rough bytes held by all per-AI memory state. Each faction entry has
 * three Records + a Set of planet ids. Used by the RAM HUD readout.
 */
export function getAiMemoryBytes(): number {
  let total = 0;
  for (const m of _memorias.values()) {
    total += Object.keys(m.rancor).length * 64;
    total += Object.keys(m.forcaPercebida).length * 64;
    total += Object.keys(m.ultimoAtaque).length * 64;
    total += m.planetasVistos.size * 48;
    total += 256; // Map entry + inner object overhead
  }
  return total;
}

// ─── Save/load support ───────────────────────────────────────────────

import type { IaMemoriaDTO } from './save/dto';

/** Serialize all AI memories into plain DTOs (no Set instances). */
export function getMemoriasIaSerializadas(): IaMemoriaDTO[] {
  const out: IaMemoriaDTO[] = [];
  for (const [donoIa, m] of _memorias) {
    out.push({
      donoIa,
      rancor: { ...m.rancor },
      forcaPercebida: { ...m.forcaPercebida },
      ultimoAtaque: { ...m.ultimoAtaque },
      planetasVistos: Array.from(m.planetasVistos),
    });
  }
  return out;
}

/** Restore AI memories from DTOs — wipes current state first. */
export function restaurarMemoriasIa(dtos: IaMemoriaDTO[]): void {
  _memorias.clear();
  for (const dto of dtos) {
    _memorias.set(dto.donoIa, {
      rancor: { ...dto.rancor },
      forcaPercebida: { ...dto.forcaPercebida },
      ultimoAtaque: { ...dto.ultimoAtaque },
      planetasVistos: new Set(dto.planetasVistos),
    });
  }
}
