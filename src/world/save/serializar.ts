import type { Mundo, Sol, Planeta } from '../../types';
import type {
  MundoDTO,
  SolDTO,
  SistemaDTO,
  TipoJogadorDTO,
  PlanetaDTO,
  MemoriaPlanetaDTO,
} from './dto';
import { CURRENT_SCHEMA_VERSION } from './dto';
import { getMemoria } from '../nevoa';

export function serializarMundo(
  mundo: Mundo,
  nome: string,
  opts: { criadoEm?: number; tempoJogadoMs?: number } = {},
): MundoDTO {
  const now = Date.now();

  const sois: SolDTO[] = mundo.sois
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((sol) => serializarSol(sol));

  const sistemas: SistemaDTO[] = mundo.sistemas
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((sis) => ({
      id: sis.id,
      x: sis.x,
      y: sis.y,
      solId: sis.sol.id,
      planetaIds: sis.planetas.map((p) => p.id),
    }));

  const agora = performance.now();
  const planetas: PlanetaDTO[] = mundo.planetas
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => serializarPlaneta(p, agora));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    nome,
    criadoEm: opts.criadoEm ?? now,
    salvoEm: now,
    tempoJogadoMs: opts.tempoJogadoMs ?? 0,
    tamanho: mundo.tamanho,
    tipoJogador: serializarTipoJogador(mundo.tipoJogador),
    sistemas,
    sois,
    planetas,
    naves: [],    // Task 7
    fontesVisao: mundo.fontesVisao.map((f) => ({ x: f.x, y: f.y, raio: f.raio })),
  };
}

function clonarDadosPlaneta(dados: Planeta['dados']): Planeta['dados'] {
  return {
    ...dados,
    recursos: { ...dados.recursos },
    fracProducao: { ...dados.fracProducao },
    pesquisas: Object.fromEntries(
      Object.entries(dados.pesquisas).map(([k, v]) => [k, [...v]]),
    ),
    filaProducao: dados.filaProducao.map((i) => ({ ...i })),
    construcaoAtual: dados.construcaoAtual ? { ...dados.construcaoAtual } : null,
    producaoNave: dados.producaoNave ? { ...dados.producaoNave } : null,
    pesquisaAtual: dados.pesquisaAtual ? { ...dados.pesquisaAtual } : null,
    selecionado: false, // transient UI state, never persisted
  };
}

function serializarPlaneta(planeta: Planeta, agora: number): PlanetaDTO {
  return {
    id: planeta.id,
    orbita: { ...planeta._orbita },
    dados: clonarDadosPlaneta(planeta.dados),
    visivelAoJogador: planeta._visivelAoJogador,
    descobertoAoJogador: planeta._descobertoAoJogador,
    memoria: serializarMemoria(planeta, agora),
  };
}

function serializarMemoria(planeta: Planeta, agora: number): MemoriaPlanetaDTO | null {
  const mem = getMemoria(planeta);
  if (!mem || !mem.dados) return null;
  return {
    conhecida: mem.conhecida,
    snapshotX: mem.dados.x,
    snapshotY: mem.dados.y,
    idadeMs: agora - mem.dados.timestamp,
    dados: { ...mem.dados.dados },
  };
}

function serializarSol(sol: Sol): SolDTO {
  return {
    id: sol.id,
    x: sol.x,
    y: sol.y,
    raio: sol._raio,
    cor: sol._cor,
    visivelAoJogador: sol._visivelAoJogador,
    descobertoAoJogador: sol._descobertoAoJogador,
  };
}

function serializarTipoJogador(tj: Mundo['tipoJogador']): TipoJogadorDTO {
  return {
    nome: tj.nome,
    desc: tj.desc,
    cor: tj.cor,
    bonus: { ...tj.bonus },
  };
}
