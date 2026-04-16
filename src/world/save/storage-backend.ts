import type { MundoDTO } from './dto';

export interface SaveMetadata {
  nome: string;
  criadoEm: number;
  salvoEm: number;
  tempoJogadoMs: number;
  tipoJogador: { nome: string; cor: number };
  planetasJogador: number;
}

export interface StorageBackend {
  listarMundos(): Promise<SaveMetadata[]> | SaveMetadata[];
  carregar(nome: string): Promise<MundoDTO | null> | MundoDTO | null;
  salvar(dto: MundoDTO): Promise<void> | void;
  apagar(nome: string): Promise<void> | void;
  existe(nome: string): Promise<boolean> | boolean;
}

export function extrairMetadata(dto: MundoDTO): SaveMetadata {
  const planetasJogador = dto.planetas.filter((p) => p.dados.dono === 'jogador').length;
  return {
    nome: dto.nome,
    criadoEm: dto.criadoEm,
    salvoEm: dto.salvoEm,
    tempoJogadoMs: dto.tempoJogadoMs,
    tipoJogador: { nome: dto.tipoJogador.nome, cor: dto.tipoJogador.cor },
    planetasJogador,
  };
}
