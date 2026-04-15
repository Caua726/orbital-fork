import { describe, it, expect, vi } from 'vitest';
import type { Mundo, Sol, Sistema, Planeta } from '../../../types';

// Mock nevoa to avoid loading pixi.js (which requires DOM) in node test env.
vi.mock('../../nevoa', () => ({
  getMemoria: () => null,
}));

import { serializarMundo } from '../serializar';

function mockSol(id: string, x: number, y: number, raio = 200, cor = 0xffd166): Sol {
  return {
    id,
    x,
    y,
    _raio: raio,
    _cor: cor,
    _tipoAlvo: 'sol',
    _visivelAoJogador: true,
    _descobertoAoJogador: true,
  } as unknown as Sol;
}

function mockSistema(id: string, sol: Sol, x: number, y: number): Sistema {
  return { id, x, y, sol, planetas: [] };
}

function mockMundo(): Mundo {
  const sol = mockSol('sol-0', 100, 200);
  const sistema = mockSistema('sys-0', sol, 100, 200);
  return {
    tamanho: 10000,
    planetas: [],
    sistemas: [sistema],
    sois: [sol],
    naves: [],
    fontesVisao: [],
    tipoJogador: { nome: 'Test', desc: '', cor: 0xffffff, bonus: {} },
    ultimoTickMs: 0,
  } as unknown as Mundo;
}

function mockPlaneta(id: string): Planeta {
  return {
    id,
    x: 500,
    y: 600,
    dados: {
      dono: 'jogador',
      tipoPlaneta: 'comum',
      nome: 'Alpha',
      producao: 1.2,
      recursos: { comum: 10, raro: 2, combustivel: 5 },
      tamanho: 200,
      selecionado: false,
      fabricas: 3,
      infraestrutura: 2,
      naves: 1,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: 0,
      construcaoAtual: null,
      producaoNave: null,
      filaProducao: [],
      repetirFilaProducao: false,
      pesquisas: {},
      pesquisaAtual: null,
    },
    _tipoAlvo: 'planeta',
    _orbita: { centroX: 100, centroY: 200, raio: 400, angulo: 1.5, velocidade: 0.0001 },
    _visivelAoJogador: true,
    _descobertoAoJogador: true,
  } as unknown as Planeta;
}

describe('serializarMundo — header/sois/sistemas', () => {
  it('produces a MundoDTO with sois and sistemas', () => {
    const mundo = mockMundo();
    const dto = serializarMundo(mundo, 'meu-save');

    expect(dto.schemaVersion).toBe(1);
    expect(dto.nome).toBe('meu-save');
    expect(dto.sois).toHaveLength(1);
    expect(dto.sois[0]).toMatchObject({
      id: 'sol-0',
      x: 100,
      y: 200,
      raio: 200,
      cor: 0xffd166,
      visivelAoJogador: true,
      descobertoAoJogador: true,
    });
    expect(dto.sistemas).toHaveLength(1);
    expect(dto.sistemas[0]).toMatchObject({
      id: 'sys-0',
      solId: 'sol-0',
      planetaIds: [],
    });
  });
});

describe('serializarMundo — planetas', () => {
  it('includes planetas with dados cloned and orbita preserved', () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('pla-0-0');
    mundo.planetas.push(planeta);
    mundo.sistemas[0].planetas.push(planeta);

    const dto = serializarMundo(mundo, 'teste');

    expect(dto.planetas).toHaveLength(1);
    const p = dto.planetas[0];
    expect(p.id).toBe('pla-0-0');
    expect(p.orbita).toEqual(planeta._orbita);
    expect(p.dados.nome).toBe('Alpha');
    expect(p.dados.recursos).toEqual({ comum: 10, raro: 2, combustivel: 5 });
    expect(p.dados).not.toBe(planeta.dados);
    expect(p.dados.recursos).not.toBe(planeta.dados.recursos);
    expect(p.dados.pesquisas).not.toBe(planeta.dados.pesquisas);
    expect(p.dados.selecionado).toBe(false);
    expect(dto.sistemas[0].planetaIds).toEqual(['pla-0-0']);
  });

  it('serializes null memoria when fog has no snapshot', () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('pla-0-0');
    mundo.planetas.push(planeta);
    const dto = serializarMundo(mundo, 'teste');
    expect(dto.planetas[0].memoria).toBeNull();
  });
});
