import { describe, it, expect, vi } from 'vitest';
import type { Mundo, Sol, Sistema, Planeta, Nave } from '../../../types';

// Mock modules that touch Pixi internals at import/call time to avoid
// needing a real GPU renderer in the node test environment.

vi.mock('../../nevoa', () => {
  const { Container } = require('pixi.js');
  return {
    getMemoria: () => null,
    criarMemoriaVisualPlaneta: () => {},
    restaurarMemoriaPlaneta: () => {},
    criarCamadaMemoria: () => new Container(),
    registrarMemoriaPlaneta: () => {},
    atualizarVisibilidadeMemoria: () => {},
    atualizarEscalaLabelMemoria: () => {},
  };
});

vi.mock('../../planeta-procedural', () => ({
  criarEstrelaProcedural: () => {
    throw new Error('should not be called in tests');
  },
  criarPlanetaProceduralSprite: () => {
    throw new Error('should not be called in tests');
  },
  atualizarTempoPlanetas: () => {},
  atualizarLuzPlaneta: () => {},
}));

vi.mock('../../nomes', () => ({
  resetarNomesPlanetas: () => {},
}));

vi.mock('../../fundo', () => {
  const { Container } = require('pixi.js');
  return {
    criarFundo: () => new Container(),
    atualizarFundo: () => {},
  };
});

vi.mock('../../naves', () => ({
  atualizarNaves: () => {},
  atualizarSelecaoNave: () => {},
  carregarSpritesheetNaves: () => Promise.resolve(),
}));

vi.mock('../../sistema', () => ({
  criarSistemaSolar: () => {},
}));

vi.mock('../../pesquisa', () => ({
  atualizarPesquisaPlaneta: () => {},
}));

vi.mock('../../visao', () => ({
  atualizarCampoDeVisao: () => {},
}));

vi.mock('../../construcao', () => ({
  atualizarFilasPlaneta: () => {},
  desenharConstrucoesPlaneta: () => {},
}));

vi.mock('../../profiling', () => ({
  profileMark: () => {},
  profileAcumular: () => {},
  profileFlush: () => {},
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
    seedMusical: 12345, // deterministic for tests
    galaxySeed: 67890,  // deterministic for tests
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

    expect(dto.schemaVersion).toBe(2);
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

function mockNave(id: string, origem: Planeta): Nave {
  return {
    id,
    tipo: 'cargueira',
    tier: 1,
    dono: 'jogador',
    x: 500,
    y: 600,
    estado: 'orbitando',
    alvo: null,
    selecionado: false,
    origem,
    carga: { comum: 5, raro: 0, combustivel: 0 },
    configuracaoCarga: { comum: 10, raro: 0, combustivel: 0 },
    rotaManual: [],
    rotaCargueira: null,
    _tipoAlvo: 'nave',
    orbita: { raio: 120, angulo: 0.5, velocidade: 0.001 },
  } as unknown as Nave;
}

describe('serializarMundo — naves', () => {
  it('resolves origem as origemId', () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('pla-0-0');
    mundo.planetas.push(planeta);
    const nave = mockNave('nav-0', planeta);
    mundo.naves.push(nave);

    const dto = serializarMundo(mundo, 'teste');

    expect(dto.naves).toHaveLength(1);
    expect(dto.naves[0].origemId).toBe('pla-0-0');
    expect(dto.naves[0].alvo).toBeNull();
  });

  it('serializes alvo planeta as discriminated union', () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('pla-0-0');
    mundo.planetas.push(planeta);
    const nave = mockNave('nav-0', planeta);
    nave.alvo = planeta;
    mundo.naves.push(nave);

    const dto = serializarMundo(mundo, 'teste');

    expect(dto.naves[0].alvo).toEqual({ tipo: 'planeta', id: 'pla-0-0' });
  });

  it('serializes alvo ponto as ponto union', () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('pla-0-0');
    mundo.planetas.push(planeta);
    const nave = mockNave('nav-0', planeta);
    nave.alvo = { _tipoAlvo: 'ponto', x: 999, y: 888 };
    mundo.naves.push(nave);

    const dto = serializarMundo(mundo, 'teste');

    expect(dto.naves[0].alvo).toEqual({ tipo: 'ponto', x: 999, y: 888 });
  });

  it('serializes rotaCargueira with origem/destino ids', () => {
    const mundo = mockMundo();
    const origem = mockPlaneta('pla-0-0');
    const destino = mockPlaneta('pla-0-1');
    mundo.planetas.push(origem, destino);
    const nave = mockNave('nav-0', origem);
    nave.rotaCargueira = {
      origem,
      destino,
      loop: true,
      fase: 'destino',
    };
    mundo.naves.push(nave);

    const dto = serializarMundo(mundo, 'teste');

    expect(dto.naves[0].rotaCargueira).toEqual({
      origemId: 'pla-0-0',
      destinoId: 'pla-0-1',
      loop: true,
      fase: 'destino',
    });
  });
});

// ─── Roundtrip tests ─────────────────────────────────────────────────────────

import { reconstruirMundo } from '../reconstruir';
import type { MundoDTO } from '../dto';

function fakeSol(x: number, y: number, raio: number): Sol {
  const { Container } = require('pixi.js');
  const c = new Container();
  return Object.assign(c, {
    x,
    y,
    _raio: raio,
    _cor: 0,
    _tipoAlvo: 'sol',
    _visivelAoJogador: false,
    _descobertoAoJogador: false,
  }) as unknown as Sol;
}

function fakePlanetaFromFactory(x: number, y: number, _tamanho: number, _tipo: string): Planeta {
  const { Container } = require('pixi.js');
  const c = new Container();
  return Object.assign(c, {
    x,
    y,
    _tipoAlvo: 'planeta',
    _visivelAoJogador: false,
    _descobertoAoJogador: false,
  }) as unknown as Planeta;
}

describe('reconstruirMundo — roundtrip', () => {
  it('serialize → reconstruct → serialize produces equivalent DTOs', async () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('pla-0-0');
    const planeta2 = mockPlaneta('pla-0-1');
    planeta2.id = 'pla-0-1';
    mundo.planetas.push(planeta, planeta2);
    mundo.sistemas[0].planetas.push(planeta, planeta2);

    const nave = mockNave('nav-0', planeta);
    nave.alvo = planeta2;
    mundo.naves.push(nave);

    const dto1 = serializarMundo(mundo, 'rt');
    const fakeApp = { stage: { addChild: () => {} } } as any;
    const rebuilt = await reconstruirMundo(dto1, fakeApp, {
      criarSol: fakeSol,
      criarPlaneta: fakePlanetaFromFactory,
      skipVisuals: true,
    });

    const dto2 = serializarMundo(rebuilt, 'rt');

    // Strip transient timestamps for comparison
    dto1.salvoEm = 0;
    dto2.salvoEm = 0;
    dto1.criadoEm = 0;
    dto2.criadoEm = 0;
    expect(dto2).toEqual(dto1);
  });

  it('throws on orphan reference', async () => {
    const dto: MundoDTO = {
      schemaVersion: 1,
      nome: 'corrupt',
      criadoEm: 0,
      salvoEm: 0,
      tempoJogadoMs: 0,
      tamanho: 1000,
      tipoJogador: { nome: '', desc: '', cor: 0, bonus: {} },
      sistemas: [{ id: 'sys-0', x: 0, y: 0, solId: 'sol-missing', planetaIds: [] }],
      sois: [],
      planetas: [],
      naves: [],
      fontesVisao: [],
    };
    const fakeApp = { stage: { addChild: () => {} } } as any;
    await expect(
      reconstruirMundo(dto, fakeApp, {
        criarSol: fakeSol,
        criarPlaneta: fakePlanetaFromFactory,
        skipVisuals: true,
      }),
    ).rejects.toThrow(/Save corrompido/);
  });
});
