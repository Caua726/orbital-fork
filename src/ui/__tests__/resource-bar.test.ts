/**
 * @vitest-environment happy-dom
 *
 * Resource bar HUD — asserts that values pushed via atualizarRecurso
 * actually end up in the DOM, not just that the function runs without
 * errors. Uses happy-dom so the document/element APIs work in tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// hud-layout registers the bar with the layout engine. In tests we
// mock it to a no-op because it reads hud-unit CSS variables that the
// stylesheet injector supplies.
vi.mock('../hud-layout', () => ({
  registerResourceBar: () => {},
  unregisterResourceBar: () => {},
}));

// obterProducaoNaturalCiclo is used by atualizarResourceBar. The real
// impl lives in world/mundo and imports Pixi transitively — mock it.
vi.mock('../../world/mundo', () => ({
  obterProducaoNaturalCiclo: () => ({ comum: 10, raro: 2, combustivel: 5 }),
}));

import type { Mundo, Planeta, Nave } from '../../types';
import {
  criarResourceBar,
  atualizarRecurso,
  atualizarResourceBar,
  destruirResourceBar,
} from '../resource-bar';

function mockPlaneta(dono: string, recursos = { comum: 100, raro: 50, combustivel: 30 }): Planeta {
  return {
    id: 'p-0',
    dados: {
      dono, producao: 1,
      recursos,
      tipoPlaneta: 'comum', nome: 'X', tamanho: 200, selecionado: false,
      fabricas: 0, infraestrutura: 0, naves: 0,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: 0,
      construcaoAtual: null, producaoNave: null,
      filaProducao: [], repetirFilaProducao: false,
      pesquisas: {}, pesquisaAtual: null,
    },
  } as unknown as Planeta;
}

function mockNave(dono: string): Nave {
  return { id: 'n-0', dono } as unknown as Nave;
}

function mundoCom(planetas: Planeta[], naves: Nave[] = []): Mundo {
  return { planetas, naves } as unknown as Mundo;
}

function resetDom(): void {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
}

beforeEach(() => {
  destruirResourceBar();
  resetDom();
});

describe('resource-bar DOM wiring', () => {
  it('criarResourceBar renders 5 slots with the expected ids', () => {
    criarResourceBar();
    const items = document.querySelectorAll<HTMLDivElement>('.resource-item');
    expect(items).toHaveLength(5);
    const ids = Array.from(items).map((i) => i.dataset.resourceId);
    expect(ids).toEqual(['comum', 'raro', 'combustivel', 'planetas', 'naves']);
  });

  it('atualizarRecurso writes value + rate into the DOM', () => {
    criarResourceBar();
    atualizarRecurso('comum', '1234', '+42/s');
    const item = document.querySelector<HTMLDivElement>('[data-resource-id="comum"]')!;
    expect(item.querySelector('.resource-value')?.textContent).toBe('1234');
    expect(item.querySelector('.resource-rate')?.textContent).toBe('+42/s');
  });

  it('atualizarRecurso for a non-existent id is a no-op (no crash)', () => {
    criarResourceBar();
    expect(() => atualizarRecurso('ghost-resource', '1')).not.toThrow();
  });

  it('atualizarResourceBar sums only player-owned planets and ships', () => {
    criarResourceBar();
    const planetas = [
      mockPlaneta('jogador', { comum: 100, raro: 50, combustivel: 30 }),
      mockPlaneta('jogador', { comum: 200, raro: 10, combustivel: 70 }),
      mockPlaneta('inimigo1', { comum: 9999, raro: 9999, combustivel: 9999 }),
      mockPlaneta('neutro', { comum: 9999, raro: 9999, combustivel: 9999 }),
    ];
    const naves = [mockNave('jogador'), mockNave('jogador'), mockNave('inimigo1')];
    atualizarResourceBar(mundoCom(planetas, naves));

    const getValue = (id: string) =>
      document.querySelector<HTMLDivElement>(`[data-resource-id="${id}"] .resource-value`)!
        .textContent;

    // Totals across player planets only (100+200, 50+10, 30+70)
    expect(getValue('comum')).toBe('300');
    expect(getValue('raro')).toBe('60');
    expect(getValue('combustivel')).toBe('100');
    // Count of player planets
    expect(getValue('planetas')).toBe('2');
    // Count of player ships
    expect(getValue('naves')).toBe('2');
  });

  it('formats large values with K suffix', () => {
    criarResourceBar();
    atualizarResourceBar(mundoCom([
      mockPlaneta('jogador', { comum: 15_000, raro: 2_500, combustivel: 50_000 }),
    ]));
    const getValue = (id: string) =>
      document.querySelector<HTMLDivElement>(`[data-resource-id="${id}"] .resource-value`)!
        .textContent;
    expect(getValue('comum')).toBe('15.0K');
    expect(getValue('raro')).toBe('2500');      // < 10000 not compacted
    expect(getValue('combustivel')).toBe('50.0K');
  });

  it('destruirResourceBar clears DOM + cache (a subsequent update is a no-op)', () => {
    criarResourceBar();
    atualizarRecurso('comum', '999');
    destruirResourceBar();
    expect(document.querySelectorAll('.resource-item')).toHaveLength(0);
    // After destroy, updates must not throw or revive the bar.
    expect(() => atualizarRecurso('comum', '1')).not.toThrow();
    expect(document.querySelectorAll('.resource-item')).toHaveLength(0);
  });
});
