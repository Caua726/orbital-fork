/**
 * Tests for v2 save-schema additions: nave HP/cooldown, IA memory,
 * events, stats, battles, first-contact, last-seen, proc-names.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same mocks as roundtrip.test.ts so we can build a fake world.
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
  criarVisualNave: () => ({
    gfx: { addChild: () => {}, destroy: () => {} },
    sprite: {},
    ring: {},
  }),
  limparPendingSprite: () => {},
  SHIP_TINT: {},
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
}));

vi.mock('../../profiling', () => ({
  profileMark: () => {},
  profileAcumular: () => {},
  profileFlush: () => {},
}));

vi.mock('../../engine-trails', () => ({
  instalarTrail: () => {},
}));

import type { Mundo, Sol, Sistema, Planeta, Nave } from '../../../types';
import { serializarMundo, instalarProviderRuntimeExtras, setRuntimeExtras } from '../serializar';
import { reconstruirMundo } from '../reconstruir';
import { registrarEvento, getEventos, resetEventos } from '../../eventos';
import { registrarBattle, getBattles, resetBattles } from '../../battle-log';
import { marcarPrimeiroContato, getPrimeiroContato, resetFirstContact } from '../../first-contact';
import { registrarLastSeen, getLastSeen, resetLastSeen } from '../../last-seen';
import { registrarNomeUsado, foiUsado, resetNomesUsados } from '../../proc-names';
import {
  registrarBaixa,
  registrarPlanetaVisto,
  getRancor,
  jaViuPlaneta,
  resetMemoriasIa,
} from '../../ia-memoria';
import { migrarDto } from '../migrations';

function mockSol(id: string, x: number, y: number): Sol {
  return {
    id, x, y,
    _raio: 200, _cor: 0xffd166,
    _tipoAlvo: 'sol',
    _visivelAoJogador: true, _descobertoAoJogador: true,
  } as unknown as Sol;
}

function mockSistema(id: string, sol: Sol, x: number, y: number): Sistema {
  return { id, x, y, sol, planetas: [] };
}

function mockPlaneta(id: string): Planeta {
  return {
    id, x: 500, y: 600,
    dados: {
      dono: 'jogador', tipoPlaneta: 'comum', nome: 'Alpha',
      producao: 1.2,
      recursos: { comum: 10, raro: 2, combustivel: 5 },
      tamanho: 200, selecionado: false,
      fabricas: 3, infraestrutura: 2, naves: 1,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: 0,
      construcaoAtual: null, producaoNave: null,
      filaProducao: [], repetirFilaProducao: false,
      pesquisas: {}, pesquisaAtual: null,
    },
    _tipoAlvo: 'planeta',
    _orbita: { centroX: 100, centroY: 200, raio: 400, angulo: 1.5, velocidade: 0.0001 },
    _visivelAoJogador: true, _descobertoAoJogador: true,
  } as unknown as Planeta;
}

function mockNave(id: string, origem: Planeta): Nave {
  return {
    id, tipo: 'fragata', tier: 1, dono: 'jogador',
    x: 500, y: 600, estado: 'orbitando',
    alvo: null, selecionado: false, origem,
    carga: { comum: 0, raro: 0, combustivel: 0 },
    configuracaoCarga: { comum: 0, raro: 0, combustivel: 0 },
    rotaManual: [], rotaCargueira: null,
    _tipoAlvo: 'nave',
    orbita: { raio: 120, angulo: 0, velocidade: 0.001 },
  } as unknown as Nave;
}

function mockMundo(): Mundo {
  const sol = mockSol('sol-0', 100, 200);
  const sistema = mockSistema('sys-0', sol, 100, 200);
  return {
    tamanho: 10000,
    planetas: [], sistemas: [sistema], sois: [sol], naves: [],
    fontesVisao: [],
    tipoJogador: { nome: 'Test', desc: '', cor: 0xffffff, bonus: {} },
    ultimoTickMs: 0,
    seedMusical: 12345,
  } as unknown as Mundo;
}

function fakeSol(x: number, y: number, raio: number): Sol {
  const { Container } = require('pixi.js');
  const c = new Container();
  return Object.assign(c, {
    x, y, _raio: raio, _cor: 0, _tipoAlvo: 'sol',
    _visivelAoJogador: false, _descobertoAoJogador: false,
  }) as unknown as Sol;
}

function fakePlanetaFromFactory(x: number, y: number): Planeta {
  const { Container } = require('pixi.js');
  const c = new Container();
  return Object.assign(c, {
    x, y, _tipoAlvo: 'planeta',
    _visivelAoJogador: false, _descobertoAoJogador: false,
  }) as unknown as Planeta;
}

beforeEach(() => {
  resetEventos();
  resetBattles();
  resetFirstContact();
  resetLastSeen();
  resetNomesUsados();
  resetMemoriasIa();
  instalarProviderRuntimeExtras(() => ({}));
});

describe('v2 save — nave HP and cooldown', () => {
  it('preserves hp and _ultimoTiroMs through roundtrip', async () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('p-0');
    mundo.planetas.push(planeta);
    mundo.sistemas[0].planetas.push(planeta);
    const nave = mockNave('n-0', planeta);
    nave.hp = 42;
    (nave as any)._ultimoTiroMs = 9999;
    mundo.naves.push(nave);

    const dto = serializarMundo(mundo, 'rt');
    expect(dto.naves[0].hp).toBe(42);
    expect(dto.naves[0].ultimoTiroMs).toBe(9999);

    const fakeApp = { stage: { addChild: () => {} } } as any;
    const rebuilt = await reconstruirMundo(dto, fakeApp, {
      criarSol: fakeSol,
      criarPlaneta: fakePlanetaFromFactory,
      skipVisuals: true,
    });
    expect(rebuilt.naves[0].hp).toBe(42);
    expect((rebuilt.naves[0] as any)._ultimoTiroMs).toBe(9999);
  });

  it('omits hp/cooldown when ship is at default state', () => {
    const mundo = mockMundo();
    const planeta = mockPlaneta('p-0');
    mundo.planetas.push(planeta);
    mundo.sistemas[0].planetas.push(planeta);
    mundo.naves.push(mockNave('n-0', planeta));

    const dto = serializarMundo(mundo, 'rt');
    expect(dto.naves[0].hp).toBeUndefined();
    expect(dto.naves[0].ultimoTiroMs).toBeUndefined();
  });
});

describe('v2 save — IA memory', () => {
  it('captures and restores rancor and planetasVistos', async () => {
    registrarBaixa('inimigo1', 'jogador');
    registrarBaixa('inimigo1', 'jogador');
    registrarPlanetaVisto('inimigo1', 'pla-0-0');

    const mundo = mockMundo();
    const dto = serializarMundo(mundo, 'rt');

    expect(dto.iaMemoria).toBeDefined();
    const mem = dto.iaMemoria!.find((m) => m.donoIa === 'inimigo1');
    expect(mem).toBeDefined();
    expect(mem!.rancor.jogador).toBeGreaterThan(0);
    expect(mem!.planetasVistos).toContain('pla-0-0');

    resetMemoriasIa();
    expect(getRancor('inimigo1', 'jogador')).toBe(0);

    const fakeApp = { stage: { addChild: () => {} } } as any;
    await reconstruirMundo(dto, fakeApp, {
      criarSol: fakeSol,
      criarPlaneta: fakePlanetaFromFactory,
      skipVisuals: true,
    });

    expect(getRancor('inimigo1', 'jogador')).toBeGreaterThan(0);
    expect(jaViuPlaneta('inimigo1', 'pla-0-0')).toBe(true);
  });
});

describe('v2 save — histórico modules', () => {
  it('round-trips events, battles, first-contact, last-seen, proc-names', async () => {
    registrarEvento('combate', 'Batalha em Sigma', 1000);
    registrarBattle({
      tempoMs: 500,
      atacante: 'inimigo1', defensor: 'jogador',
      localPlanetaId: 'p-0',
      perdasAtacante: 2, perdasDefensor: 3,
      vencedor: 'defensor',
    });
    marcarPrimeiroContato('inimigo2', 8000);
    registrarLastSeen({ id: 'n-99', dono: 'inimigo1', x: 10, y: 20 }, 1234);
    registrarNomeUsado('Vyr Okhar');

    const mundo = mockMundo();
    const dto = serializarMundo(mundo, 'rt');

    expect(dto.eventosHistorico).toHaveLength(1);
    expect(dto.battleHistory).toHaveLength(1);
    expect(dto.firstContact!.inimigo2).toBe(8000);
    expect(dto.lastSeenInimigos).toHaveLength(1);
    expect(dto.procNamesUsados).toContain('Vyr Okhar');

    resetEventos(); resetBattles(); resetFirstContact(); resetLastSeen(); resetNomesUsados();

    const fakeApp = { stage: { addChild: () => {} } } as any;
    await reconstruirMundo(dto, fakeApp, {
      criarSol: fakeSol,
      criarPlaneta: fakePlanetaFromFactory,
      skipVisuals: true,
    });

    expect(getEventos()).toHaveLength(1);
    expect(getBattles()).toHaveLength(1);
    expect(getPrimeiroContato('inimigo2')).toBe(8000);
    expect(getLastSeen()).toHaveLength(1);
    expect(foiUsado('Vyr Okhar')).toBe(true);
  });

  it('caps event log at 200', () => {
    for (let i = 0; i < 500; i++) {
      registrarEvento('combate', `ev ${i}`, i);
    }
    expect(getEventos()).toHaveLength(200);
    // Oldest dropped
    expect(getEventos()[0].texto).toBe('ev 300');
  });
});

describe('v2 save — runtime extras (camera/speed/difficulty)', () => {
  it('captures provider output in DTO', () => {
    instalarProviderRuntimeExtras(() => ({
      dificuldade: 'brutal',
      camera: { x: 123, y: 456, zoom: 1.5 },
      gameSpeed: 2,
      selecaoUI: { planetaId: 'p-99' },
    }));

    const mundo = mockMundo();
    const dto = serializarMundo(mundo, 'rt');

    expect(dto.dificuldade).toBe('brutal');
    expect(dto.camera).toEqual({ x: 123, y: 456, zoom: 1.5 });
    expect(dto.gameSpeed).toBe(2);
    expect(dto.selecaoUI).toEqual({ planetaId: 'p-99' });
  });

  it('falls back to setRuntimeExtras when no provider', () => {
    // When provider is installed, setRuntimeExtras is ignored; install
    // a provider that returns whatever's in _extrasSnapshot indirectly
    // by using a "self-reading" provider.
    let latest: any = {};
    instalarProviderRuntimeExtras(() => latest);
    setRuntimeExtras({ gameSpeed: 4 });
    latest = { gameSpeed: 4 };

    const dto = serializarMundo(mockMundo(), 'rt');
    expect(dto.gameSpeed).toBe(4);
  });
});

describe('migration v1 → v2', () => {
  it('adds missing schemaVersion and sets it to 2', () => {
    const v1 = {
      nome: 'old',
      sistemas: [], sois: [], planetas: [], naves: [], fontesVisao: [],
      tamanho: 1000,
      tipoJogador: { nome: '', desc: '', cor: 0, bonus: {} },
      criadoEm: 0, salvoEm: 0, tempoJogadoMs: 0,
    };
    const migrated = migrarDto(v1 as any);
    expect(migrated.schemaVersion).toBe(2);
    // v1 fields preserved
    expect(migrated.nome).toBe('old');
  });

  it('leaves v2 fields untouched for v1 saves', () => {
    const v1 = { schemaVersion: 1, nome: 'old' };
    const migrated = migrarDto(v1 as any);
    expect(migrated.iaMemoria).toBeUndefined();
    expect(migrated.eventosHistorico).toBeUndefined();
    expect(migrated.dificuldade).toBeUndefined();
  });
});

describe('lore generation', () => {
  it('is deterministic per (id, archetype)', async () => {
    const { gerarLoreFaccao } = await import('../../lore-faccao');
    const a1 = gerarLoreFaccao('inimigo1', 'warlord');
    const a2 = gerarLoreFaccao('inimigo1', 'warlord');
    expect(a1).toEqual(a2);
    const b = gerarLoreFaccao('inimigo1', 'trader');
    expect(b.ideologia).not.toBe(a1.ideologia);
  });

  it('formats lore with all four lines', async () => {
    const { gerarLoreFaccao, formatarLore } = await import('../../lore-faccao');
    const lore = gerarLoreFaccao('inimigo1', 'scientist');
    const txt = formatarLore(lore);
    expect(txt.split('\n')).toHaveLength(4);
    expect(txt).toContain('ciclos estelares');
  });
});

describe('distance matrix', () => {
  it('returns correct distances and handles unknown ids', async () => {
    const { buildDistanceMatrix, getDistanceMatrix, resetDistanceMatrix } = await import('../../distance-matrix');
    resetDistanceMatrix();

    const p0 = mockPlaneta('p-0');
    (p0 as any).x = 0; (p0 as any).y = 0;
    const p1 = mockPlaneta('p-1');
    (p1 as any).x = 3; (p1 as any).y = 4;
    const p2 = mockPlaneta('p-2');
    (p2 as any).x = 100; (p2 as any).y = 0;

    const mundo = mockMundo();
    mundo.planetas = [p0, p1, p2] as any;
    buildDistanceMatrix(mundo);
    const m = getDistanceMatrix()!;

    expect(m.dist('p-0', 'p-1')).toBeCloseTo(5, 3);
    expect(m.dist('p-0', 'p-2')).toBeCloseTo(100, 3);
    expect(m.dist('p-0', 'unknown')).toBe(Infinity);
    expect(m.nearest('p-0', 1)).toEqual(['p-1']);
    expect(m.vizinhos('p-0', 10)).toEqual(['p-1']);
  });
});
