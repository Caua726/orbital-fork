import type { Mundo, Sol } from '../../types';
import type {
  MundoDTO,
  SolDTO,
  SistemaDTO,
  TipoJogadorDTO,
} from './dto';
import { CURRENT_SCHEMA_VERSION } from './dto';

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
    planetas: [], // Task 6
    naves: [],    // Task 7
    fontesVisao: mundo.fontesVisao.map((f) => ({ x: f.x, y: f.y, raio: f.raio })),
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
