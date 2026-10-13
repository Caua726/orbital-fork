import type { Mundo, Planeta } from '../types';
import type { MatchObjective, MatchStateDTO } from './save/dto';
import { obterProducaoNaturalCiclo } from './recursos';

const SURVIVAL_TARGET_MS = 30 * 60 * 1000;

export interface MatchProgress {
  current: number;
  target: number;
  secondaryCurrent?: number;
  secondaryTarget?: number;
}

export function criarMatchState(objective: MatchObjective = 'livre'): MatchStateDTO {
  return {
    objective,
    status: 'playing',
    simulationTimeMs: 0,
    survivalElapsedMs: 0,
  };
}

function totalRecursosJogador(mundo: Mundo): number {
  let total = 0;
  for (const p of mundo.planetas) {
    if (p.dados.dono !== 'jogador') continue;
    total += p.dados.recursos.comum + p.dados.recursos.raro + p.dados.recursos.combustivel;
  }
  for (const n of mundo.naves) {
    if (n.dono !== 'jogador') continue;
    total += n.carga.comum + n.carga.raro + n.carga.combustivel;
  }
  return total;
}

function producaoPlaneta(p: Planeta): number {
  const r = obterProducaoNaturalCiclo(p);
  return (r.comum + r.raro + r.combustivel) * (p.dados.producao || 1);
}

function participacaoProducao(mundo: Mundo): number {
  let jogador = 0;
  let total = 0;
  for (const p of mundo.planetas) {
    if (p.dados.dono === 'neutro') continue;
    const value = producaoPlaneta(p);
    total += value;
    if (p.dados.dono === 'jogador') jogador += value;
  }
  return total > 0 ? jogador / total : 0;
}

function tecnologiasConcluidas(mundo: Mundo): number {
  const union = new Set<string>();
  for (const p of mundo.planetas) {
    if (p.dados.dono !== 'jogador') continue;
    for (const [categoria, tiers] of Object.entries(p.dados.pesquisas)) {
      tiers.forEach((done, i) => { if (done) union.add(`${categoria}:${i + 1}`); });
    }
  }
  return union.size;
}

function astrosDescobertos(mundo: Mundo): { current: number; target: number } {
  const target = mundo.sois.length + mundo.planetas.length;
  const current = mundo.sois.filter((s) => s._descobertoAoJogador).length
    + mundo.planetas.filter((p) => p._descobertoAoJogador).length;
  return { current, target };
}

function hostisRestantes(mundo: Mundo): number {
  return mundo.planetas.filter((p) => p.dados.dono.startsWith('inimigo')).length
    + mundo.naves.filter((n) => n.dono.startsWith('inimigo')).length;
}

export function getMatchProgress(mundo: Mundo): MatchProgress {
  switch (mundo.match.objective) {
    case 'conquista': {
      return { current: hostisRestantes(mundo) === 0 ? 1 : 0, target: 1 };
    }
    case 'economia':
      return {
        current: totalRecursosJogador(mundo),
        target: Math.max(2500, mundo.planetas.length * 50),
        secondaryCurrent: participacaoProducao(mundo),
        secondaryTarget: 0.4,
      };
    case 'ciencia': return { current: tecnologiasConcluidas(mundo), target: 20 };
    case 'sobrevivencia': return { current: mundo.match.survivalElapsedMs, target: SURVIVAL_TARGET_MS };
    case 'exploracao': return astrosDescobertos(mundo);
    case 'livre': return { current: 0, target: Infinity };
  }
}

function venceu(mundo: Mundo): boolean {
  const progress = getMatchProgress(mundo);
  if (mundo.match.objective === 'livre') return false;
  if (mundo.match.objective === 'economia') {
    return progress.current >= progress.target
      && (progress.secondaryCurrent ?? 0) >= (progress.secondaryTarget ?? 1);
  }
  if (mundo.match.objective === 'conquista') return hostisRestantes(mundo) === 0;
  return progress.current >= progress.target;
}

function perdeu(mundo: Mundo): boolean {
  if (mundo.planetas.some((p) => p.dados.dono === 'jogador')) return false;
  const temColonizadora = mundo.naves.some((n) => n.dono === 'jogador' && n.tipo === 'colonizadora');
  const temAlvoNeutro = mundo.planetas.some((p) => p.dados.dono === 'neutro');
  return !(temColonizadora && temAlvoNeutro);
}

/** Advance engine-neutral clocks and return a newly reached terminal state. */
export function atualizarMatchState(
  mundo: Mundo,
  simulationDeltaMs: number,
  activeWallDeltaMs: number,
): 'victory' | 'defeat' | null {
  const match = mundo.match;
  match.simulationTimeMs += Math.max(0, simulationDeltaMs);
  if (simulationDeltaMs > 0) match.survivalElapsedMs += Math.max(0, activeWallDeltaMs);
  if (match.status !== 'playing') return null;
  if (perdeu(mundo)) {
    match.status = 'defeat';
    match.achievedAtMs = match.simulationTimeMs;
    return 'defeat';
  }
  if (venceu(mundo)) {
    match.status = 'victory';
    match.achievedAtMs = match.simulationTimeMs;
    return 'victory';
  }
  return null;
}

export function continuarComoSandbox(mundo: Mundo): void {
  mundo.match.status = 'sandbox';
  mundo.match.continuedAfterVictory = true;
}
