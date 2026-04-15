import type { Recursos, DadosPlaneta, OrbitaPlaneta, OrbitaNave, FonteVisao } from '../../types';

export const CURRENT_SCHEMA_VERSION = 1;

// Root

export interface MundoDTO {
  schemaVersion: number;
  nome: string;
  criadoEm: number;
  salvoEm: number;
  tempoJogadoMs: number;
  tamanho: number;
  tipoJogador: TipoJogadorDTO;
  sistemas: SistemaDTO[];
  sois: SolDTO[];
  planetas: PlanetaDTO[];
  naves: NaveDTO[];
  fontesVisao: FonteVisao[];
}

// Entities

export interface SistemaDTO {
  id: string;
  x: number;
  y: number;
  solId: string;
  planetaIds: string[];
}

export interface SolDTO {
  id: string;
  x: number;
  y: number;
  raio: number;
  cor: number;
  visivelAoJogador: boolean;
  descobertoAoJogador: boolean;
}

export interface PlanetaDTO {
  id: string;
  orbita: OrbitaPlaneta;
  dados: DadosPlaneta;
  visivelAoJogador: boolean;
  descobertoAoJogador: boolean;
  memoria: MemoriaPlanetaDTO | null;
}

export interface MemoriaPlanetaDTO {
  conhecida: boolean;
  snapshotX: number;
  snapshotY: number;
  idadeMs: number;
  dados: {
    dono: string;
    tipoPlaneta: string;
    tamanho: number;
    fabricas: number;
    infraestrutura: number;
    naves: number;
    producao: number;
  };
}

export interface NaveDTO {
  id: string;
  tipo: string;
  tier: number;
  dono: string;
  x: number;
  y: number;
  estado: 'orbitando' | 'viajando' | 'parado' | 'fazendo_survey' | 'aguardando_decisao' | 'pilotando';
  carga: Recursos;
  configuracaoCarga: Recursos;
  orbita: OrbitaNave | null;
  surveyTempoRestanteMs?: number;
  surveyTempoTotalMs?: number;
  thrustX?: number;
  thrustY?: number;
  origemId: string;
  alvo: AlvoDTO | null;
  rotaManual: AlvoPontoDTO[];
  rotaCargueira: RotaCargueiraDTO | null;
}

export type AlvoDTO =
  | { tipo: 'planeta'; id: string }
  | { tipo: 'sol'; id: string }
  | { tipo: 'ponto'; x: number; y: number };

export interface AlvoPontoDTO {
  x: number;
  y: number;
}

export interface RotaCargueiraDTO {
  origemId: string | null;
  destinoId: string | null;
  loop: boolean;
  fase: 'origem' | 'destino';
}

export interface TipoJogadorDTO {
  nome: string;
  desc: string;
  cor: number;
  bonus: {
    producao?: number;
    fabricasIniciais?: number;
    infraestruturaInicial?: number;
  };
}
