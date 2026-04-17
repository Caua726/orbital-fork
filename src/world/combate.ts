import type { Nave } from '../types';

/**
 * Combat stats per ship type. Values are intentionally simple — combat
 * happens between ships in the same area, ticking damage based on dano
 * and reciprocating until one side is destroyed.
 *
 * - hp:      max hit points
 * - dano:    damage per second when actively firing
 * - alcance: world units; ship engages enemies within this radius
 * - cooldownMs: time between shots (visual cadence; dano is per-second)
 */
export interface StatsCombate {
  hp: number;
  dano: number;
  alcance: number;
  cooldownMs: number;
  /** Cor do beam disparado por essa nave. */
  corBeam: number;
}

export const STATS_COMBATE: Record<string, StatsCombate> = {
  // Civilian / utility ships have low hp and zero damage.
  colonizadora: { hp: 30,  dano: 0,    alcance: 0,    cooldownMs: 0,    corBeam: 0xffffff },
  cargueira:    { hp: 25,  dano: 0,    alcance: 0,    cooldownMs: 0,    corBeam: 0xffffff },
  // Scout has a tiny self-defense weapon.
  batedora:     { hp: 20,  dano: 4,    alcance: 280,  cooldownMs: 800,  corBeam: 0x9be7ff },
  // Turret is stationary defense — high hp, decent damage, long range.
  torreta:      { hp: 80,  dano: 12,   alcance: 520,  cooldownMs: 600,  corBeam: 0xffaa66 },
  // Combat ship — the offensive option.
  fragata:      { hp: 60,  dano: 18,   alcance: 420,  cooldownMs: 500,  corBeam: 0xff6b6b },
};

/** Tier multiplier — t1=1.0, t2=1.4, t3=1.8, etc. Applies to hp and dano. */
export function tierMultiplier(tier: number): number {
  return 1 + (tier - 1) * 0.4;
}

export function getStatsCombate(nave: Pick<Nave, 'tipo' | 'tier'>): StatsCombate {
  const base = STATS_COMBATE[nave.tipo];
  if (!base) return STATS_COMBATE.batedora;
  const mult = tierMultiplier(nave.tier);
  return {
    hp: base.hp * mult,
    dano: base.dano * mult,
    alcance: base.alcance,
    cooldownMs: base.cooldownMs,
    corBeam: base.corBeam,
  };
}

/** True if this ship type can attack at all (dano > 0). */
export function podeAtacar(tipo: string): boolean {
  return (STATS_COMBATE[tipo]?.dano ?? 0) > 0;
}
