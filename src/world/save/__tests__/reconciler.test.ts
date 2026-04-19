/**
 * Tests for the save reconciler — verifies each healer correctly
 * diagnoses and repairs drift in a loaded save.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  criarEstrelaProcedural: () => { throw new Error('unused in tests'); },
  criarPlanetaProceduralSprite: () => { throw new Error('unused in tests'); },
  atualizarTempoPlanetas: () => {},
  atualizarLuzPlaneta: () => {},
}));

vi.mock('../../nomes', () => ({ resetarNomesPlanetas: () => {} }));

vi.mock('../../fundo', () => {
  const { Container } = require('pixi.js');
  return { criarFundo: () => new Container(), atualizarFundo: () => {} };
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

vi.mock('../../sistema', () => ({ criarSistemaSolar: () => {} }));
vi.mock('../../pesquisa', () => ({ atualizarPesquisaPlaneta: () => {} }));
vi.mock('../../visao', () => ({ atualizarCampoDeVisao: () => {} }));
vi.mock('../../construcao', () => ({
  atualizarFilasPlaneta: () => {},
}));
vi.mock('../../profiling', () => ({
  profileMark: () => {},
  profileAcumular: () => {},
  profileFlush: () => {},
}));

import type { Mundo, Sol, Sistema, Planeta, Nave } from '../../../types';
import type { MundoDTO } from '../dto';
import { reconciliarMundo, resumirDiagnosticos } from '../reconciler';
import {
  getPersonalidades,
  setPersonalidadesParaMundoCarregado,
  resetIasV2,
} from '../../ia-decisao';
import { gerarPersonalidade } from '../../personalidade-ia';

function mockSol(): Sol {
  return {
    id: 'sol-0', x: 0, y: 0, _raio: 100, _cor: 0,
    _tipoAlvo: 'sol', _visivelAoJogador: false, _descobertoAoJogador: false,
  } as unknown as Sol;
}

function mockSistema(sol: Sol): Sistema {
  return { id: 'sys-0', x: 0, y: 0, sol, planetas: [] };
}

function mockPlaneta(id: string, dono: string = 'jogador'): Planeta {
  return {
    id, x: 0, y: 0,
    dados: {
      dono, tipoPlaneta: 'comum', nome: 'X', producao: 1,
      recursos: { comum: 0, raro: 0, combustivel: 0 },
      tamanho: 100, selecionado: false,
      fabricas: 1, infraestrutura: 1, naves: 0,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: 0,
      construcaoAtual: null, producaoNave: null,
      filaProducao: [], repetirFilaProducao: false,
      pesquisas: {}, pesquisaAtual: null,
    },
    _tipoAlvo: 'planeta',
    _orbita: { centroX: 0, centroY: 0, raio: 100, angulo: 0, velocidade: 0 },
    _visivelAoJogador: false, _descobertoAoJogador: false,
  } as unknown as Planeta;
}

function mockNave(id: string, origem: Planeta, overrides: Partial<Nave> = {}): Nave {
  return {
    id, tipo: 'fragata', tier: 1, dono: 'jogador',
    x: 0, y: 0, estado: 'orbitando', alvo: null, selecionado: false,
    origem, carga: { comum: 0, raro: 0, combustivel: 0 },
    configuracaoCarga: { comum: 0, raro: 0, combustivel: 0 },
    rotaManual: [], rotaCargueira: null,
    _tipoAlvo: 'nave', orbita: null,
    ...overrides,
  } as unknown as Nave;
}

function mockMundo(planetas: Planeta[] = [], naves: Nave[] = []): Mundo {
  const sol = mockSol();
  const sis = mockSistema(sol);
  sis.planetas.push(...planetas);
  return {
    tamanho: 1000,
    planetas, sistemas: [sis], sois: [sol], naves,
    fontesVisao: [],
    tipoJogador: { nome: '', desc: '', cor: 0, bonus: {} },
    ultimoTickMs: 0,
    seedMusical: 1,
  } as unknown as Mundo;
}

function emptyDto(): MundoDTO {
  return {
    schemaVersion: 2, nome: 'x',
    criadoEm: 0, salvoEm: 0, tempoJogadoMs: 0,
    tamanho: 1000,
    tipoJogador: { nome: '', desc: '', cor: 0, bonus: {} },
    sistemas: [], sois: [], planetas: [], naves: [], fontesVisao: [],
  };
}

beforeEach(() => {
  resetIasV2();
});

describe('healer: lore-faltando', () => {
  it('generates lore for personalities missing it', () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    delete (ia as any).lore;
    setPersonalidadesParaMundoCarregado([ia], 4000);

    const diag = reconciliarMundo(mockMundo(), emptyDto());
    const loreFix = diag.find((d) => d.categoria === 'lore-faltando');
    expect(loreFix).toBeDefined();
    expect(getPersonalidades()[0].lore).toBeDefined();
  });

  it('leaves existing lore untouched', () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    const loreOriginal = ia.lore;
    setPersonalidadesParaMundoCarregado([ia], 4000);

    const diag = reconciliarMundo(mockMundo(), emptyDto());
    expect(diag.find((d) => d.categoria === 'lore-faltando')).toBeUndefined();
    expect(getPersonalidades()[0].lore).toBe(loreOriginal);
  });
});

describe('healer: personalidade-orfa-do-dono', () => {
  it('regenerates personality for unknown dono', () => {
    const p = mockPlaneta('p-0', 'inimigo3');
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    const fix = diag.find((d) => d.categoria === 'personalidade-orfa-do-dono');
    expect(fix).toBeDefined();
    expect(getPersonalidades().some((i) => i.id === 'inimigo3')).toBe(true);
  });

  it('does not regenerate for jogador/neutro', () => {
    const p1 = mockPlaneta('p-0', 'jogador');
    const p2 = mockPlaneta('p-1', 'neutro');
    const diag = reconciliarMundo(mockMundo([p1, p2]), emptyDto());
    expect(diag.find((d) => d.categoria === 'personalidade-orfa-do-dono')).toBeUndefined();
  });
});

describe('healer: nave-hp-invalido / tipo desconhecido', () => {
  it('clamps negative hp to max', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { hp: -10 });
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'nave-hp-invalido')).toBeDefined();
    expect(n.hp).toBeGreaterThan(0);
  });

  it('resets NaN hp', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { hp: NaN });
    reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(Number.isFinite(n.hp!)).toBe(true);
  });

  it('converts unknown ship type to fragata', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { tipo: 'destructor-legado' });
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'nave-tipo-desconhecido')).toBeDefined();
    expect(n.tipo).toBe('fragata');
  });

  it('clamps tier above TIER_MAX', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { tier: 99 });
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'nave-tier-invalido')).toBeDefined();
    expect(n.tier).toBeLessThanOrEqual(5);
  });
});

describe('healer: pesquisas-incompletas', () => {
  it('initializes missing research categories as empty arrays', () => {
    const p = mockPlaneta('p-0');
    // Start with only one category present
    p.dados.pesquisas = { torreta: [true] } as any;
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'pesquisas-incompletas')).toBeDefined();
    expect(p.dados.pesquisas.cargueira).toEqual([]);
    expect(p.dados.pesquisas.fragata).toEqual([]);
    // Existing data preserved
    expect(p.dados.pesquisas.torreta).toEqual([true]);
  });

  it('clamps fabricas/infra above TIER_MAX', () => {
    const p = mockPlaneta('p-0');
    p.dados.fabricas = 99;
    p.dados.infraestrutura = 10;
    reconciliarMundo(mockMundo([p]), emptyDto());
    expect(p.dados.fabricas).toBe(5);
    expect(p.dados.infraestrutura).toBe(5);
  });
});

describe('healer: planeta-sistema-orfao', () => {
  it('coerces out-of-range sistemaId to 0', () => {
    const p = mockPlaneta('p-0');
    p.dados.sistemaId = 999;
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'planeta-sistema-orfao')).toBeDefined();
    expect(p.dados.sistemaId).toBe(0);
  });

  it('leaves valid sistemaId alone', () => {
    const p = mockPlaneta('p-0');
    p.dados.sistemaId = 0;
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'planeta-sistema-orfao')).toBeUndefined();
  });
});

describe('healer: planeta-dono-orfao', () => {
  it('reverts unknown dono to neutro when regeneration is not possible', () => {
    // This is hit when dono looks unusual enough that the personality
    // healer didn't regenerate (doesn't start with "inimigo").
    const p = mockPlaneta('p-0', 'faccao-esquecida');
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'dono-orfao')).toBeDefined();
    expect(p.dados.dono).toBe('neutro');
  });
});

describe('reconciliarMundo — integration', () => {
  it('runs all healers in order without crashing', () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    delete (ia as any).lore;
    setPersonalidadesParaMundoCarregado([ia], 4000);

    const p = mockPlaneta('p-0', 'inimigo9');
    p.dados.sistemaId = 42;
    p.dados.fabricas = 99;
    // Partially-populated pesquisas triggers the pesquisas-incompletas
    // diagnostic (an empty dict is treated as "fresh start" and is silent).
    p.dados.pesquisas = { torreta: [true] } as any;
    const n = mockNave('n-0', p, { hp: -5, tipo: 'ghost', tier: 99 });

    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    // Several categories should have fired
    const cats = new Set(diag.map((d) => d.categoria));
    expect(cats.has('lore-faltando')).toBe(true);
    expect(cats.has('personalidade-orfa-do-dono')).toBe(true);
    expect(cats.has('nave-hp-invalido')).toBe(true);
    expect(cats.has('nave-tipo-desconhecido')).toBe(true);
    expect(cats.has('nave-tier-invalido')).toBe(true);
    expect(cats.has('pesquisas-incompletas')).toBe(true);
    expect(cats.has('planeta-sistema-orfao')).toBe(true);
  });

  it('returns empty array on clean save', () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    setPersonalidadesParaMundoCarregado([ia], 4000);
    const pJogador = mockPlaneta('p-0', 'jogador');
    pJogador.dados.pesquisas = { torreta: [], cargueira: [], batedora: [], fragata: [] };
    const pInimigo = mockPlaneta('p-1', 'inimigo1');
    pInimigo.dados.pesquisas = { torreta: [], cargueira: [], batedora: [], fragata: [] };
    const diag = reconciliarMundo(mockMundo([pJogador, pInimigo]), emptyDto());
    expect(diag).toHaveLength(0);
  });
});

describe('healer: mundo-header', () => {
  it('regenerates invalid tamanho', () => {
    const m = mockMundo();
    m.tamanho = NaN;
    const diag = reconciliarMundo(m, emptyDto());
    expect(diag.find((d) => d.categoria === 'mundo-tamanho-invalido')).toBeDefined();
    expect(m.tamanho).toBe(10000);
  });

  it('regenerates missing seedMusical', () => {
    const m = mockMundo();
    (m as any).seedMusical = undefined;
    const diag = reconciliarMundo(m, emptyDto());
    expect(diag.find((d) => d.categoria === 'seed-musical-faltando')).toBeDefined();
    expect(Number.isFinite(m.seedMusical)).toBe(true);
  });

  it('filters malformed fontesVisao', () => {
    const m = mockMundo();
    m.fontesVisao = [
      { x: 0, y: 0, raio: 100 },
      { x: NaN, y: 0, raio: 100 } as any,
      null as any,
      { x: 0, y: 0, raio: -5 },
    ];
    const diag = reconciliarMundo(m, emptyDto());
    expect(diag.find((d) => d.categoria === 'fontesVisao-inválidas')).toBeDefined();
    expect(m.fontesVisao).toHaveLength(1);
  });
});

describe('healer: dto-header', () => {
  it('coerces unknown dificuldade to normal', () => {
    const dto = emptyDto();
    dto.dificuldade = 'galático' as any;
    const diag = reconciliarMundo(mockMundo(), dto);
    expect(diag.find((d) => d.categoria === 'dificuldade-invalida')).toBeDefined();
    expect(dto.dificuldade).toBe('normal');
  });

  it('discards camera with NaN values', () => {
    const dto = emptyDto();
    dto.camera = { x: NaN, y: 0, zoom: 1 };
    reconciliarMundo(mockMundo(), dto);
    expect(dto.camera).toBeUndefined();
  });

  it('clamps camera zoom to min/max', () => {
    const dto = emptyDto();
    dto.camera = { x: 0, y: 0, zoom: 100 };
    reconciliarMundo(mockMundo(), dto);
    expect(dto.camera!.zoom).toBeLessThanOrEqual(2.0);
  });

  it('coerces unknown gameSpeed to 1', () => {
    const dto = emptyDto();
    dto.gameSpeed = 99 as any;
    const diag = reconciliarMundo(mockMundo(), dto);
    expect(diag.find((d) => d.categoria === 'gameSpeed-invalido')).toBeDefined();
    expect(dto.gameSpeed).toBe(1);
  });
});

describe('healer: personalidade-campos', () => {
  it('replaces invalid arquetipo with warlord', () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    (ia as any).arquetipo = 'rogueish';
    setPersonalidadesParaMundoCarregado([ia], 4000);
    const diag = reconciliarMundo(mockMundo(), emptyDto());
    expect(diag.find((d) => d.categoria === 'personalidade-arquetipo-invalido')).toBeDefined();
    expect(getPersonalidades()[0].arquetipo).toBe('warlord');
  });

  it('fills missing weight fields with defaults', () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    (ia as any).pesos = { agressao: NaN };
    setPersonalidadesParaMundoCarregado([ia], 4000);
    reconciliarMundo(mockMundo(), emptyDto());
    const pesos = getPersonalidades()[0].pesos;
    expect(Number.isFinite(pesos.agressao)).toBe(true);
    expect(pesos.expansao).toBe(1);
  });
});

describe('healer: nave-campos', () => {
  it('coerces unknown estado to orbitando', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { estado: 'teletransportando' as any });
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'nave-estado-invalido')).toBeDefined();
    expect(n.estado).toBe('orbitando');
  });

  it('teleports ship back to origem when x/y are NaN', () => {
    const p = mockPlaneta('p-0');
    (p as any).x = 500;
    (p as any).y = 600;
    const n = mockNave('n-0', p, { x: NaN, y: NaN });
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'nave-posicao-invalida')).toBeDefined();
    expect(n.x).toBe(500);
    expect(n.y).toBe(600);
  });

  it('resets negative carga to 0', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { carga: { comum: -50, raro: NaN, combustivel: 5 } } as any);
    reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(n.carga.comum).toBe(0);
    expect(n.carga.raro).toBe(0);
    expect(n.carga.combustivel).toBe(5);
  });

  it('clears thrust on non-piloting ship', () => {
    const p = mockPlaneta('p-0');
    const n = mockNave('n-0', p, { thrustX: 0.8, thrustY: -0.2 } as any);
    reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(n.thrustX).toBeUndefined();
    expect(n.thrustY).toBeUndefined();
  });
});

describe('healer: planeta-campos (extended)', () => {
  it('regenerates missing nome', () => {
    const p = mockPlaneta('p-0');
    (p as any).dados.nome = '';
    reconciliarMundo(mockMundo([p]), emptyDto());
    expect(p.dados.nome.length).toBeGreaterThan(0);
  });

  it('discards pesquisaAtual with invalid category', () => {
    const p = mockPlaneta('p-0');
    p.dados.pesquisaAtual = { categoria: 'ghost-tech', tier: 1, tempoRestanteMs: 0, tempoTotalMs: 60_000 } as any;
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'planeta-pesquisa-invalida')).toBeDefined();
    expect(p.dados.pesquisaAtual).toBeNull();
  });

  it('falls back to default orbita when any field is NaN', () => {
    const p = mockPlaneta('p-0');
    p._orbita = { centroX: NaN, centroY: 0, raio: 100, angulo: 0, velocidade: 0.001 };
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'planeta-orbita-invalida')).toBeDefined();
    expect(Number.isFinite(p._orbita.centroX)).toBe(true);
  });

  it('removes malformed filaProducao entries', () => {
    const p = mockPlaneta('p-0');
    (p.dados as any).filaProducao = [
      { acao: 'fragata_t1' },
      null,
      { foo: 'bar' }, // missing acao
    ];
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'planeta-fila-corrompida')).toBeDefined();
    expect(p.dados.filaProducao).toHaveLength(1);
  });
});

describe('healer: ia-memoria', () => {
  it('drops memory entries for non-existent AI', async () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    setPersonalidadesParaMundoCarregado([ia], 4000);
    const iaMem = await import('../../ia-memoria');
    iaMem.restaurarMemoriasIa([
      { donoIa: 'inimigo1', rancor: {}, forcaPercebida: {}, ultimoAtaque: {}, planetasVistos: [] },
      { donoIa: 'inimigo-fantasma', rancor: { jogador: 5 }, forcaPercebida: {}, ultimoAtaque: {}, planetasVistos: [] },
    ]);
    const diag = reconciliarMundo(mockMundo(), emptyDto());
    expect(diag.find((d) => d.categoria === 'ia-memoria-orfa')).toBeDefined();
    const survivors = iaMem.getMemoriasIaSerializadas();
    expect(survivors.map((m) => m.donoIa)).toEqual(['inimigo1']);
  });

  it('clamps absurd rancor values', async () => {
    const ia = gerarPersonalidade('inimigo1', 1.0);
    setPersonalidadesParaMundoCarregado([ia], 4000);
    const iaMem = await import('../../ia-memoria');
    iaMem.restaurarMemoriasIa([
      { donoIa: 'inimigo1', rancor: { jogador: 999999, bad: NaN }, forcaPercebida: {}, ultimoAtaque: {}, planetasVistos: [] },
    ]);
    reconciliarMundo(mockMundo(), emptyDto());
    const restored = iaMem.getMemoriasIaSerializadas()[0];
    expect(restored.rancor.jogador).toBeLessThanOrEqual(1000);
    expect(restored.rancor.bad).toBeUndefined();
  });
});

describe('healer: historico-caps', () => {
  it('truncates event log above 200', () => {
    const dto = emptyDto();
    dto.eventosHistorico = Array.from({ length: 500 }, (_, i) => ({
      tempoMs: i, tipo: 'combate', texto: `ev ${i}`,
    }));
    const diag = reconciliarMundo(mockMundo(), dto);
    expect(diag.find((d) => d.categoria === 'historico-eventos-cap')).toBeDefined();
    expect(dto.eventosHistorico).toHaveLength(200);
  });

  it('dedupes procNamesUsados', () => {
    const dto = emptyDto();
    dto.procNamesUsados = ['Vyr', 'Vyr', 'Okhar', 'Vyr'];
    const diag = reconciliarMundo(mockMundo(), dto);
    expect(diag.find((d) => d.categoria === 'procnames-dedupe')).toBeDefined();
    expect(new Set(dto.procNamesUsados).size).toBe(dto.procNamesUsados.length);
  });

  it('drops bad firstContact entries', () => {
    const dto = emptyDto();
    dto.firstContact = { inimigo1: 1000, inimigo2: NaN as any, inimigo3: -5 };
    reconciliarMundo(mockMundo(), dto);
    expect(dto.firstContact!.inimigo1).toBe(1000);
    expect(dto.firstContact!.inimigo2).toBeUndefined();
    expect(dto.firstContact!.inimigo3).toBeUndefined();
  });
});

describe('healer: legacy-version', () => {
  it('annotates v1 saves', () => {
    const diag = reconciliarMundo(mockMundo(), emptyDto(), { versaoOriginal: 1 });
    const v1 = diag.find((d) => d.categoria === 'legacy-v1');
    expect(v1).toBeDefined();
  });

  it('does not annotate v2 saves', () => {
    const diag = reconciliarMundo(mockMundo(), emptyDto(), { versaoOriginal: 2 });
    expect(diag.find((d) => d.categoria === 'legacy-v1')).toBeUndefined();
  });

  it('includes migration transforms as info diagnostics', () => {
    const diag = reconciliarMundo(mockMundo(), emptyDto(), {
      versaoOriginal: 1,
      transformsAplicados: ['v1→v2 bump', 'backfill xyz'],
    });
    const transforms = diag.filter((d) => d.categoria === 'migration');
    expect(transforms).toHaveLength(2);
  });
});

describe('healer: sol-campos', () => {
  it('resets invalid raio and color', () => {
    const m = mockMundo();
    const sol = m.sois[0];
    (sol as any)._raio = -10;
    (sol as any)._cor = NaN;
    const diag = reconciliarMundo(m, emptyDto());
    expect(diag.find((d) => d.categoria === 'sol-raio-invalido')).toBeDefined();
    expect(sol._raio).toBeGreaterThan(0);
    expect(Number.isFinite(sol._cor)).toBe(true);
  });

  it('teleports sol with NaN position to origin', () => {
    const m = mockMundo();
    const sol = m.sois[0];
    (sol as any).x = NaN;
    const diag = reconciliarMundo(m, emptyDto());
    expect(diag.find((d) => d.categoria === 'sol-posicao-invalida')).toBeDefined();
  });
});

describe('healer: sistemas-refs', () => {
  it('removes orphan planet refs from system', () => {
    const p = mockPlaneta('p-0', 'jogador');
    const fakeP = mockPlaneta('p-fantasma', 'jogador');
    const m = mockMundo([p]);
    // Manually add a stale ref not tracked by mundo.planetas
    m.sistemas[0].planetas.push(fakeP);
    const diag = reconciliarMundo(m, emptyDto());
    expect(diag.find((d) => d.categoria === 'sistema-ref-orfa')).toBeDefined();
    expect(m.sistemas[0].planetas).toHaveLength(1);
  });
});

describe('healer: mundo-vazio', () => {
  it('reports no-planets as erro', () => {
    const diag = reconciliarMundo(mockMundo([]), emptyDto());
    expect(diag.find((d) => d.categoria === 'mundo-sem-planetas')).toBeDefined();
  });

  it('warns when no player planet exists', () => {
    const p = mockPlaneta('p-0', 'inimigo1');
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'jogador-sem-planeta')).toBeDefined();
  });
});

describe('healer: selecaoUI', () => {
  it('drops stale planet selection', () => {
    const p = mockPlaneta('p-0', 'jogador');
    const dto = emptyDto();
    dto.selecaoUI = { planetaId: 'p-inexistente', naveId: undefined };
    const diag = reconciliarMundo(mockMundo([p]), dto);
    expect(diag.find((d) => d.categoria === 'selecao-planeta-orfa')).toBeDefined();
    expect(dto.selecaoUI.planetaId).toBeUndefined();
  });

  it('drops stale ship selection', () => {
    const p = mockPlaneta('p-0', 'jogador');
    const dto = emptyDto();
    dto.selecaoUI = { naveId: 'n-fantasma' };
    const diag = reconciliarMundo(mockMundo([p]), dto);
    expect(diag.find((d) => d.categoria === 'selecao-nave-orfa')).toBeDefined();
    expect(dto.selecaoUI.naveId).toBeUndefined();
  });
});

describe('healer: rotaCargueira', () => {
  it('coerces invalid fase', () => {
    const p = mockPlaneta('p-0', 'jogador');
    const n = mockNave('n-0', p);
    n.rotaCargueira = { origem: p, destino: p, loop: true, fase: 'perdida' as any };
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'rotaCargueira-fase')).toBeDefined();
    expect(n.rotaCargueira!.fase).toBe('origem');
  });

  it('nulls orphan origem/destino references', () => {
    const p = mockPlaneta('p-0', 'jogador');
    const fake = mockPlaneta('p-fantasma', 'jogador');
    const n = mockNave('n-0', p);
    n.rotaCargueira = { origem: fake, destino: fake, loop: true, fase: 'origem' };
    const diag = reconciliarMundo(mockMundo([p], [n]), emptyDto());
    expect(diag.find((d) => d.categoria === 'rotaCargueira-origem-orfa')).toBeDefined();
    expect(diag.find((d) => d.categoria === 'rotaCargueira-destino-orfa')).toBeDefined();
    expect(n.rotaCargueira!.origem).toBeNull();
    expect(n.rotaCargueira!.destino).toBeNull();
  });
});

describe('healer: memoria-planeta', () => {
  it('clears corrupted fog memory', () => {
    const p = mockPlaneta('p-0', 'jogador');
    const dto = emptyDto();
    dto.planetas = [{
      id: 'p-0', orbita: { centroX: 0, centroY: 0, raio: 1, angulo: 0, velocidade: 0 } as any,
      dados: p.dados, visivelAoJogador: false, descobertoAoJogador: true,
      memoria: {
        conhecida: true, snapshotX: NaN, snapshotY: 0, idadeMs: -5,
        dados: { dono: 'jogador', tipoPlaneta: 'comum', tamanho: 100, fabricas: 1, infraestrutura: 1, naves: 0, producao: 1 },
      },
    }];
    const diag = reconciliarMundo(mockMundo([p]), dto);
    expect(diag.find((d) => d.categoria === 'memoria-planeta-corrompida')).toBeDefined();
    expect(dto.planetas[0].memoria).toBeNull();
  });
});

describe('healer ordering contract', () => {
  it('orphan dono with inimigoN prefix gets personality regenerated BEFORE dono-orfao reverts to neutro', () => {
    // No personalities exist yet. Planet has dono 'inimigo9' (orphan).
    // healPersonalidadeOrfa must run first, regenerate inimigo9, so that
    // healPlanetaDonoOrfao sees it as valid and keeps the planet owned.
    resetIasV2();
    const p = mockPlaneta('p-0', 'inimigo9');
    const diag = reconciliarMundo(mockMundo([p]), emptyDto());
    expect(diag.find((d) => d.categoria === 'personalidade-orfa-do-dono')).toBeDefined();
    expect(diag.find((d) => d.categoria === 'dono-orfao')).toBeUndefined();
    expect(p.dados.dono).toBe('inimigo9');
  });

  it('uses dto.dificuldade (not runtime) when regenerating orphan personalities', () => {
    resetIasV2();
    const p = mockPlaneta('p-0', 'inimigo7');
    const dto = emptyDto();
    dto.dificuldade = 'brutal';
    reconciliarMundo(mockMundo([p]), dto);
    const ia = getPersonalidades().find((x) => x.id === 'inimigo7');
    expect(ia).toBeDefined();
    // brutal preset: forca exactly 2.0 (not jittered). Any other value
    // means the healer used the wrong preset.
    expect(ia!.forca).toBe(2.0);
  });

  it('does NOT wipe AI memories when orphan personality is added mid-reconcile', async () => {
    const iaMem = await import('../../ia-memoria');
    const existente = gerarPersonalidade('inimigo1', 1.0);
    setPersonalidadesParaMundoCarregado([existente], 4000);
    iaMem.restaurarMemoriasIa([
      { donoIa: 'inimigo1', rancor: { jogador: 9 }, forcaPercebida: {}, ultimoAtaque: {}, planetasVistos: [] },
    ]);
    // Orphan dono triggers healer — must NOT reset memórias
    const p = mockPlaneta('p-0', 'inimigo2');
    reconciliarMundo(mockMundo([p]), emptyDto());
    const restored = iaMem.getMemoriasIaSerializadas();
    const entry = restored.find((m) => m.donoIa === 'inimigo1');
    expect(entry?.rancor.jogador).toBe(9);
  });
});

describe('lore-edge: unknown archetype guard', () => {
  it('gerarPlanetaLore degrades gracefully with unknown donoArquetipo', async () => {
    const { gerarPlanetaLore } = await import('../../lore/planeta-lore');
    const lore = gerarPlanetaLore({
      planetaId: 'pla-0', galaxySeed: 1, tipo: 'comum',
      dono: 'inimigo1', nomePlaneta: 'X', tamanho: 200,
      donoNome: 'X',
      donoArquetipo: 'ghost-archetype' as any,
    });
    // Core fields populated
    expect(lore.slogan.length).toBeGreaterThan(10);
    expect(lore.geologia).toMatch(/[.!?]$/);
    expect(lore.biomas).toMatch(/[.!?]$/);
    expect(lore.costumes).toMatch(/[.!?]$/);
    expect(lore.religiao).toMatch(/[.!?]$/);
    expect(lore.economia).toMatch(/[.!?]$/);
    // Unknown archetype should mean empty profissoes — not a crash or undefined
    expect(lore.profissoesDominantes).toEqual([]);
    // No bleed-through of the raw archetype string
    for (const key of ['slogan', 'geologia', 'biomas', 'costumes', 'nota'] as const) {
      expect(lore[key]).not.toContain('undefined');
      expect(lore[key]).not.toContain('ghost-archetype');
    }
  });
});

describe('migration — pathological schemaVersion', () => {
  it('treats schemaVersion: 0 as v1 instead of throwing', async () => {
    const { migrarDtoComRelatorio } = await import('../migrations');
    const result = migrarDtoComRelatorio({
      schemaVersion: 0, nome: 'x',
      criadoEm: 0, salvoEm: 0, tempoJogadoMs: 0,
      tamanho: 1000, tipoJogador: { nome: '', desc: '', cor: 0, bonus: {} },
      sistemas: [], sois: [], planetas: [], naves: [], fontesVisao: [],
    });
    expect(result.versaoOriginal).toBe(1);
    expect(result.dto.schemaVersion).toBe(2);
  });

  it('handles negative schemaVersion gracefully', async () => {
    const { migrarDtoComRelatorio } = await import('../migrations');
    const result = migrarDtoComRelatorio({
      schemaVersion: -5, nome: 'x',
      criadoEm: 0, salvoEm: 0, tempoJogadoMs: 0,
      tamanho: 1000, tipoJogador: { nome: '', desc: '', cor: 0, bonus: {} },
      sistemas: [], sois: [], planetas: [], naves: [], fontesVisao: [],
    });
    expect(result.versaoOriginal).toBe(1);
  });
});

describe('lastSeenInimigos healer', () => {
  it('drops entries with NaN coordinates or negative tempoMs', () => {
    const dto = emptyDto();
    dto.lastSeenInimigos = [
      { naveId: 'n1', dono: 'inimigo1', x: 10, y: 20, tempoMs: 100 },
      { naveId: 'n2', dono: 'inimigo1', x: NaN, y: 20, tempoMs: 100 },
      { naveId: 'n3', dono: 'inimigo1', x: 10, y: 20, tempoMs: -5 },
    ];
    const diag = reconciliarMundo(mockMundo(), dto);
    expect(diag.find((d) => d.categoria === 'historico-lastseen-cap')).toBeDefined();
    expect(dto.lastSeenInimigos).toHaveLength(1);
    expect(dto.lastSeenInimigos![0].naveId).toBe('n1');
  });
});

describe('healer: personalidade-cor-duplicada', () => {
  it('regenerates a fresh color for the collision', () => {
    const a = gerarPersonalidade('inimigo1', 1.0);
    const b = gerarPersonalidade('inimigo2', 1.0);
    (b as any).cor = a.cor;
    setPersonalidadesParaMundoCarregado([a, b], 4000);
    const diag = reconciliarMundo(mockMundo(), emptyDto());
    expect(diag.find((d) => d.categoria === 'personalidade-cor-colidiu')).toBeDefined();
    const ias = getPersonalidades();
    expect(ias[0].cor).not.toBe(ias[1].cor);
  });
});

describe('idempotência', () => {
  it('segunda passada não gera diagnósticos novos', () => {
    // Start with a save full of drift
    const ia = gerarPersonalidade('inimigo1', 1.0);
    delete (ia as any).lore;
    setPersonalidadesParaMundoCarregado([ia], 4000);
    const p = mockPlaneta('p-0', 'jogador');
    p.dados.sistemaId = 99;
    p.dados.fabricas = 99;
    p.dados.pesquisas = { torreta: [true] } as any;
    const n = mockNave('n-0', p, { hp: -10, tipo: 'ghost', tier: 99 });
    const dto = emptyDto();
    dto.gameSpeed = 13 as any;
    dto.dificuldade = 'lendário' as any;
    dto.procNamesUsados = ['a', 'a', 'b'];

    const mundo = mockMundo([p], [n]);
    const diag1 = reconciliarMundo(mundo, dto);
    expect(diag1.length).toBeGreaterThan(0);

    // Second pass on the same (already healed) state
    const diag2 = reconciliarMundo(mundo, dto);
    // Info-level "migration" entries re-fire if opts.transformsAplicados is
    // re-passed, but with no opts it should be fully quiet.
    expect(diag2).toHaveLength(0);
  });
});

describe('resumirDiagnosticos', () => {
  it('returns null for empty list', () => {
    expect(resumirDiagnosticos([])).toBeNull();
  });

  it('groups by severity', () => {
    const msg = resumirDiagnosticos([
      { severidade: 'erro', categoria: 'x', detalhe: '' },
      { severidade: 'warn', categoria: 'y', detalhe: '' },
      { severidade: 'warn', categoria: 'z', detalhe: '' },
      { severidade: 'info', categoria: 'a', detalhe: '' },
    ]);
    expect(msg).toContain('1 erro');
    expect(msg).toContain('2 ajuste');
    expect(msg).toContain('1 auto-fix');
  });
});
