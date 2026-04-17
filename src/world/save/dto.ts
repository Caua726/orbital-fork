import type { Recursos, DadosPlaneta, OrbitaPlaneta, OrbitaNave, FonteVisao } from '../../types';
import type { Dificuldade } from '../personalidade-ia';

export const CURRENT_SCHEMA_VERSION = 2;

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
  /** Procedural music seed — same seed = same musical theme. */
  seedMusical?: number;
  /** Saved AI personality genomes — restored verbatim on load so name/color/archetype persist. */
  personalidadesIa?: PersonalidadeIaDTO[];

  // ─── v2 additions ───────────────────────────────────────────────────

  /** Difficulty preset the world was created under. Determines AI tick rate/forca after load. */
  dificuldade?: Dificuldade;
  /** Last camera position and zoom. */
  camera?: { x: number; y: number; zoom: number };
  /** Game speed (0 = paused, 1/2/4 = regular). */
  gameSpeed?: number;
  /** Selected entity for UI restoration. */
  selecaoUI?: { planetaId?: string; naveId?: string };
  /** AI decision tick accumulator — preserves cadence across load. */
  iaTickState?: { accumMs: number; ticksDecorridos: number };
  /** Per-AI memory: rancor, observed strength, last attack, seen planets. */
  iaMemoria?: IaMemoriaDTO[];
  /** Circular log of recent world events (combats, conquests, etc). Cap ~200. */
  eventosHistorico?: EventoHistoricoDTO[];
  /** Periodic stat samples (fleet, planets, resources). Cap ~100 samples. */
  statsAmostragem?: StatsAmostraDTO[];
  /** tempoJogadoMs at which the player first observed each enemy. */
  firstContact?: Record<string, number>;
  /** Recent battle summaries. Cap ~50. */
  battleHistory?: BattleDTO[];
  /** Last-known enemy ship positions with decay timestamp. */
  lastSeenInimigos?: LastSeenDTO[];
  /** Procedural names already used this world (anti-collision). */
  procNamesUsados?: string[];
  /** Deterministic seed for all lore generation — same seed → same history. */
  galaxySeed?: number;
}

/**
 * Snapshot of an AI personality. Mirrors PersonalidadeIA in shape but
 * stays a plain JSON DTO (no class instances) so it serializes cleanly.
 * On load, restored as-is — no regeneration needed.
 */
export interface PersonalidadeIaDTO {
  id: string;
  nome: string;
  cor: number;
  arquetipo: 'warlord' | 'trader' | 'scientist' | 'defender' | 'explorer';
  pesos: {
    agressao: number;
    expansao: number;
    economia: number;
    ciencia: number;
    defesa: number;
    vinganca: number;
  };
  naveFavorita: 'fragata' | 'torreta' | 'batedora' | 'cargueira';
  frotaMinAtaque: number;
  paciencia: number;
  frotaMax: number;
  forca: number;
  /** Optional faction backstory — shown in tooltips. */
  lore?: LoreFaccaoDTO;
}

export interface LoreFaccaoDTO {
  anoFundacao: number;
  homeworldDescricao: string;
  ideologia: string;
  eventoMarcante: string;
  citacao: string;
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
  /** Combat HP — omitted = ship is at STATS_COMBATE max for its type. */
  hp?: number;
  /** Last performance.now() at which the ship fired (cooldown gate). */
  ultimoTiroMs?: number;
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

// ─── v2 sub-DTOs ─────────────────────────────────────────────────────

export interface IaMemoriaDTO {
  /** AI id this memory belongs to. */
  donoIa: string;
  /** Per-enemy rancor scores. */
  rancor: Record<string, number>;
  /** Per-enemy perceived military strength. */
  forcaPercebida: Record<string, number>;
  /** Last attack Date.now() timestamps per enemy. */
  ultimoAtaque: Record<string, number>;
  /** Set of planet ids this AI has ever seen. */
  planetasVistos: string[];
}

export type EventoTipo =
  | 'combate'
  | 'conquista'
  | 'nave_destruida'
  | 'pesquisa_completa'
  | 'ia_despertou'
  | 'primeiro_contato';

export interface EventoHistoricoDTO {
  tempoMs: number;
  tipo: EventoTipo;
  /** Display string (localized at save time). */
  texto: string;
  /** Optional structured payload. */
  payload?: Record<string, string | number>;
}

export interface StatsAmostraDTO {
  tempoMs: number;
  /** Player snapshot. */
  jogador: { planetas: number; naves: number; comum: number; raro: number };
  /** Per-AI stats. Missing entries = AI is extinct or not yet born. */
  ias: Record<string, { planetas: number; naves: number }>;
}

export interface BattleDTO {
  tempoMs: number;
  atacante: string;
  defensor: string;
  localPlanetaId: string | null;
  perdasAtacante: number;
  perdasDefensor: number;
  vencedor: 'atacante' | 'defensor' | 'empate';
}

export interface LastSeenDTO {
  naveId: string;
  dono: string;
  x: number;
  y: number;
  tempoMs: number;
}
