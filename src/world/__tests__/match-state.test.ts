import { describe, expect, it } from 'vitest';
import type { Mundo, Planeta } from '../../types';
import { atualizarMatchState, criarMatchState, getMatchProgress } from '../match-state';

function planet(dono: string, discovered = true): Planeta {
  return {
    dados: {
      dono, recursos: { comum: 0, raro: 0, combustivel: 0 },
      pesquisas: { torreta: [false, false, false, false, false], cargueira: [false, false, false, false, false], batedora: [false, false, false, false, false], fragata: [false, false, false, false, false] },
      producao: 1, infraestrutura: 0,
    },
    _descobertoAoJogador: discovered,
  } as unknown as Planeta;
}

function world(objective: Parameters<typeof criarMatchState>[0] = 'livre'): Mundo {
  return {
    planetas: [planet('jogador'), planet('inimigo1')],
    sois: [{ _descobertoAoJogador: true }],
    naves: [],
    match: criarMatchState(objective),
  } as unknown as Mundo;
}

describe('match-state', () => {
  it('conquest ignores neutral planets and waits for hostile assets', () => {
    const m = world('conquista');
    expect(atualizarMatchState(m, 16, 16)).toBeNull();
    m.planetas[1].dados.dono = 'neutro';
    expect(atualizarMatchState(m, 16, 16)).toBe('victory');
  });

  it('does not defeat a player with a colonizer and neutral target', () => {
    const m = world('livre');
    m.planetas[0].dados.dono = 'neutro';
    m.planetas[1].dados.dono = 'neutro';
    m.naves.push({ dono: 'jogador', tipo: 'colonizadora', carga: { comum: 0, raro: 0, combustivel: 0 } } as any);
    expect(atualizarMatchState(m, 16, 16)).toBeNull();
  });

  it('defeats when no planet or recovery colonizer remains', () => {
    const m = world('livre');
    m.planetas.forEach((p) => { p.dados.dono = 'neutro'; });
    expect(atualizarMatchState(m, 16, 16)).toBe('defeat');
  });

  it('survival uses active wall time and ignores game speed multiplier', () => {
    const m = world('sobrevivencia');
    for (let i = 0; i < 30; i++) atualizarMatchState(m, 4 * 60_000, 60_000);
    expect(m.match.survivalElapsedMs).toBe(30 * 60_000);
    expect(m.match.status).toBe('victory');
  });

  it('science combines completed research across player planets', () => {
    const m = world('ciencia');
    m.planetas[1].dados.dono = 'jogador';
    for (const tiers of Object.values(m.planetas[0].dados.pesquisas)) tiers.fill(true);
    expect(getMatchProgress(m).current).toBe(20);
    expect(atualizarMatchState(m, 1, 1)).toBe('victory');
  });
});
