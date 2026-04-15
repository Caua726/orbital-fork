import { describe, it, expect } from 'vitest';
import type { Mundo, Sol, Sistema } from '../../../types';
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
