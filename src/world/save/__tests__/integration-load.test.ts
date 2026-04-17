/**
 * Integration test: full save → migrate → reconstruct → reconcile flow.
 *
 * Verifies that the four stages compose correctly when a saved world
 * (simulated DTO blob) is fed back in. The seams between stages were
 * the source of the two critical bugs caught by code review — memory
 * wiping during reconciler handshake and tick state reset — so this
 * test exists mainly to trip that class of regression in the future.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  criarEstrelaProcedural: () => { throw new Error('unused'); },
  criarPlanetaProceduralSprite: () => { throw new Error('unused'); },
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
}));

vi.mock('../../sistema', () => ({ criarSistemaSolar: () => {} }));
vi.mock('../../pesquisa', () => ({ atualizarPesquisaPlaneta: () => {} }));
vi.mock('../../visao', () => ({ atualizarCampoDeVisao: () => {} }));
vi.mock('../../construcao', () => ({
  atualizarFilasPlaneta: () => {},
  desenharConstrucoesPlaneta: () => {},
}));
vi.mock('../../profiling', () => ({
  profileMark: () => {},
  profileAcumular: () => {},
  profileFlush: () => {},
}));
vi.mock('../../engine-trails', () => ({ instalarTrail: () => {} }));

import type { Sol, Planeta } from '../../../types';
import type { MundoDTO } from '../dto';
import { Container } from 'pixi.js';

import { migrarDtoComRelatorio } from '../migrations';
import { reconstruirMundo } from '../reconstruir';
import { reconciliarMundo } from '../reconciler';
import {
  setPersonalidadesParaMundoCarregado,
  getPersonalidades,
  resetIasV2,
  setIaTickState,
  getIaTickState,
} from '../../ia-decisao';
import {
  restaurarMemoriasIa,
  getMemoriasIaSerializadas,
  resetMemoriasIa,
} from '../../ia-memoria';

function fakeSol(x: number, y: number, raio: number): Sol {
  const c = new Container();
  return Object.assign(c, {
    x, y, _raio: raio, _cor: 0, _tipoAlvo: 'sol',
    _visivelAoJogador: false, _descobertoAoJogador: false,
  }) as unknown as Sol;
}

function fakePlanetaFromFactory(x: number, y: number): Planeta {
  const c = new Container();
  return Object.assign(c, {
    x, y, _tipoAlvo: 'planeta',
    _visivelAoJogador: false, _descobertoAoJogador: false,
  }) as unknown as Planeta;
}

function dtoCompletoV2(): MundoDTO {
  const sol = { id: 'sol-0', x: 100, y: 200, raio: 200, cor: 0xffd166, visivelAoJogador: true, descobertoAoJogador: true };
  const sistema = { id: 'sys-0', x: 100, y: 200, solId: 'sol-0', planetaIds: ['pla-0-0'] };
  const planeta = {
    id: 'pla-0-0',
    orbita: { centroX: 100, centroY: 200, raio: 400, angulo: 1.5, velocidade: 0.0001 },
    dados: {
      dono: 'jogador', tipoPlaneta: 'comum', nome: 'Alpha', producao: 1,
      recursos: { comum: 50, raro: 5, combustivel: 10 }, tamanho: 200, selecionado: false,
      fabricas: 2, infraestrutura: 1, naves: 0, acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 }, sistemaId: 0,
      construcaoAtual: null, producaoNave: null, filaProducao: [], repetirFilaProducao: false,
      pesquisas: { torreta: [], cargueira: [], batedora: [], fragata: [] }, pesquisaAtual: null,
    },
    visivelAoJogador: true, descobertoAoJogador: true, memoria: null,
  };
  return {
    schemaVersion: 2,
    nome: 'teste-integration',
    criadoEm: 1000, salvoEm: 2000, tempoJogadoMs: 12345,
    tamanho: 10000,
    tipoJogador: { nome: 'Test', desc: '', cor: 0xffffff, bonus: {} },
    sistemas: [sistema], sois: [sol], planetas: [planeta], naves: [],
    fontesVisao: [],
    seedMusical: 1111,
    galaxySeed: 2222,
    dificuldade: 'brutal',
    iaMemoria: [
      { donoIa: 'inimigo1', rancor: { jogador: 7 }, forcaPercebida: { jogador: 3 },
        ultimoAtaque: { jogador: 100 }, planetasVistos: ['pla-0-0'] },
    ],
    iaTickState: { accumMs: 777, ticksDecorridos: 42 },
    personalidadesIa: [{
      id: 'inimigo1', nome: 'Kiv Rak', cor: 0xff5555, arquetipo: 'warlord',
      pesos: { agressao: 1.4, expansao: 0.9, economia: 0.7, ciencia: 0.6, defesa: 0.5, vinganca: 1.2 },
      naveFavorita: 'fragata', frotaMinAtaque: 4, paciencia: 1, frotaMax: 30, forca: 2.0,
    }],
  };
}

beforeEach(() => {
  resetIasV2();
  resetMemoriasIa();
});

describe('integration: migrate → reconstruct → reconcile preserves save fidelity', () => {
  it('a v2 save round-trips without reconciler warnings', async () => {
    const dto = dtoCompletoV2();
    const { dto: migrated, versaoOriginal } = migrarDtoComRelatorio(dto);
    expect(versaoOriginal).toBe(2);

    const mundo = await reconstruirMundo(migrated, {} as any, {
      criarSol: fakeSol, criarPlaneta: fakePlanetaFromFactory, skipVisuals: true,
    });

    // Simulate main.ts handshake — install personalities (resets memory),
    // then re-apply memory + tick state from the DTO (the real load path
    // does this after restaurarOuReinicializarIas).
    const restored = dto.personalidadesIa!.map((d) => ({ ...d, pesos: { ...d.pesos } }));
    setPersonalidadesParaMundoCarregado(restored, 2500);
    if (dto.iaMemoria) restaurarMemoriasIa(dto.iaMemoria);
    if (dto.iaTickState) setIaTickState(dto.iaTickState);

    const diagnostics = reconciliarMundo(mundo, migrated, {
      versaoOriginal,
      transformsAplicados: [],
    });

    // No warnings on a well-formed v2 save.
    const problemas = diagnostics.filter((d) => d.severidade !== 'info');
    expect(problemas).toEqual([]);

    // AI memory preserved exactly through the pipeline.
    const mem = getMemoriasIaSerializadas();
    expect(mem).toHaveLength(1);
    expect(mem[0].rancor.jogador).toBe(7);
    expect(mem[0].forcaPercebida.jogador).toBe(3);
    expect(mem[0].planetasVistos).toEqual(['pla-0-0']);

    // Tick state preserved.
    expect(getIaTickState()).toEqual({ accumMs: 777, ticksDecorridos: 42 });

    // Personalities preserved.
    const ias = getPersonalidades();
    expect(ias).toHaveLength(1);
    expect(ias[0].nome).toBe('Kiv Rak');
    expect(ias[0].forca).toBe(2.0);
  });

  it('orphan dono in a v2 save is regenerated without wiping other AI memories', async () => {
    const dto = dtoCompletoV2();
    // Add an orphan: a planet owned by inimigo9 with no matching personality.
    dto.planetas.push({
      ...dto.planetas[0], id: 'pla-0-1', dados: { ...dto.planetas[0].dados, dono: 'inimigo9' },
    });
    dto.sistemas[0].planetaIds.push('pla-0-1');

    const { dto: migrated } = migrarDtoComRelatorio(dto);
    const mundo = await reconstruirMundo(migrated, {} as any, {
      criarSol: fakeSol, criarPlaneta: fakePlanetaFromFactory, skipVisuals: true,
    });

    const restored = dto.personalidadesIa!.map((d) => ({ ...d, pesos: { ...d.pesos } }));
    setPersonalidadesParaMundoCarregado(restored, 2500);
    if (dto.iaMemoria) restaurarMemoriasIa(dto.iaMemoria);
    if (dto.iaTickState) setIaTickState(dto.iaTickState);

    const diagnostics = reconciliarMundo(mundo, migrated, { versaoOriginal: 2 });

    // Orphan personality regenerated.
    const cats = new Set(diagnostics.map((d) => d.categoria));
    expect(cats.has('personalidade-orfa-do-dono')).toBe(true);
    const ias = getPersonalidades();
    expect(ias.some((i) => i.id === 'inimigo9')).toBe(true);

    // Brutal preset → regenerated AI has forca 2.0 (not the default 1.0).
    const inimigo9 = ias.find((i) => i.id === 'inimigo9');
    expect(inimigo9!.forca).toBe(2.0);

    // Existing AI (inimigo1) and its memory survive the orphan-regen step.
    expect(ias.some((i) => i.id === 'inimigo1')).toBe(true);
    const mem = getMemoriasIaSerializadas().find((m) => m.donoIa === 'inimigo1');
    expect(mem?.rancor.jogador).toBe(7);

    // Planet keeps its orphan dono (was regenerated, not reverted to neutro).
    const orphanPlanet = mundo.planetas.find((p) => p.id === 'pla-0-1');
    expect(orphanPlanet?.dados.dono).toBe('inimigo9');
  });

  it('v1 save is migrated and reconciled without data loss', async () => {
    const v2 = dtoCompletoV2();
    // Simulate a v1 save by stripping v2-only fields.
    const v1 = {
      ...v2,
      schemaVersion: 1,
      dificuldade: undefined,
      camera: undefined,
      gameSpeed: undefined,
      selecaoUI: undefined,
      iaTickState: undefined,
      iaMemoria: undefined,
      eventosHistorico: undefined,
      statsAmostragem: undefined,
      firstContact: undefined,
      battleHistory: undefined,
      lastSeenInimigos: undefined,
      procNamesUsados: undefined,
      galaxySeed: undefined,
    };

    const { dto: migrated, versaoOriginal, transforms } = migrarDtoComRelatorio(v1 as any);
    expect(versaoOriginal).toBe(1);
    expect(migrated.schemaVersion).toBe(2);
    expect(transforms.length).toBeGreaterThan(0);

    const mundo = await reconstruirMundo(migrated, {} as any, {
      criarSol: fakeSol, criarPlaneta: fakePlanetaFromFactory, skipVisuals: true,
    });

    const restored = v1.personalidadesIa!.map((d) => ({ ...d, pesos: { ...d.pesos } }));
    setPersonalidadesParaMundoCarregado(restored, 2500);

    const diagnostics = reconciliarMundo(mundo, migrated, { versaoOriginal });
    // Legacy-v1 note must fire.
    expect(diagnostics.some((d) => d.categoria === 'legacy-v1')).toBe(true);
    // Planet data survived.
    const p = mundo.planetas[0];
    expect(p.dados.fabricas).toBe(2);
    expect(p.dados.recursos.comum).toBe(50);
  });
});
