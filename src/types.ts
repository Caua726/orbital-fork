import type { Container, Graphics, AnimatedSprite, Sprite, Filter, Application, Texture } from 'pixi.js';

// === Recursos ===
export interface Recursos {
  comum: number;
  raro: number;
  combustivel: number;
}

// === Construção ===
export interface Construcao {
  tipo: 'fabrica' | 'infraestrutura';
  tierDestino: number;
  tempoRestanteMs: number;
  tempoTotalMs: number;
}

export interface ProducaoNave {
  tipoNave: string;
  tier: number;
  tempoRestanteMs: number;
  tempoTotalMs: number;
}

export interface ItemFilaProducao {
  acao: string;
}

// === Pesquisa ===
export interface Pesquisa {
  categoria: string;
  tier: number;
  tempoRestanteMs: number;
  tempoTotalMs: number;
}

export type PesquisasState = Record<string, boolean[]>;

// === Planeta ===
export interface DadosPlaneta {
  dono: string;
  tipoPlaneta: string;
  nome: string;
  producao: number;
  recursos: Recursos;
  tamanho: number;
  selecionado: boolean;
  fabricas: number;
  infraestrutura: number;
  naves: number;
  acumuladorRecursosMs: number;
  fracProducao: Recursos;
  sistemaId: number;
  construcaoAtual: Construcao | null;
  producaoNave: ProducaoNave | null;
  filaProducao: ItemFilaProducao[];
  repetirFilaProducao: boolean;
  pesquisas: PesquisasState;
  pesquisaAtual: Pesquisa | null;
}

export interface OrbitaPlaneta {
  centroX: number;
  centroY: number;
  raio: number;
  angulo: number;
  velocidade: number;
}

export interface Planeta extends Container {
  id: string;
  dados: DadosPlaneta;
  _tipoAlvo: 'planeta';
  _orbita: OrbitaPlaneta;
  _linhaOrbita: Graphics;
  _anel: Graphics;
  _visivelAoJogador: boolean;
  _descobertoAoJogador: boolean;
}

// === Sol ===
export interface Sol extends Container {
  id: string;
  _raio: number;
  _cor: number;
  _tipoAlvo: 'sol';
  _visivelAoJogador: boolean;
  _descobertoAoJogador: boolean;
  _planetShader?: any;
}

// === Nave ===
export interface OrbitaNave {
  raio: number;
  angulo: number;
  velocidade: number;
}

export interface Nave {
  id: string;
  tipo: string;
  tier: number;
  dono: string;
  x: number;
  y: number;
  estado: 'orbitando' | 'viajando' | 'parado' | 'fazendo_survey' | 'aguardando_decisao' | 'pilotando';
  alvo: Planeta | Sol | AlvoPonto | null;
  surveyTempoRestanteMs?: number;
  surveyTempoTotalMs?: number;
  // Real-time piloting thrust vector, normalized to magnitude ≤ 1.
  // Non-null only while estado === 'pilotando'.
  thrustX?: number;
  thrustY?: number;
  selecionado: boolean;
  origem: Planeta;
  carga: Recursos;
  configuracaoCarga: Recursos;
  rotaManual: AlvoPonto[];
  rotaCargueira: {
    origem: Planeta | null;
    destino: Planeta | null;
    loop: boolean;
    fase: 'origem' | 'destino';
  } | null;
  gfx: Container;
  rotaGfx: Graphics;
  _tipoAlvo: 'nave';
  orbita: OrbitaNave | null;
  _selecaoAnterior?: boolean;
  _sprite?: Sprite;
  _ring?: Graphics;
  _trail?: Graphics;
  _trailParticles?: Array<{ x: number; y: number; age: number }>;
  _lastX?: number;
  _lastY?: number;
  /** Combat HP. Undefined → use STATS_COMBATE max for type. */
  hp?: number;
  /** Last frame this ship fired (cooldown gate). */
  _ultimoTiroMs?: number;
}

export interface AlvoPonto {
  _tipoAlvo: 'ponto';
  x: number;
  y: number;
}

// === Visão ===
export interface FonteVisao {
  x: number;
  y: number;
  raio: number;
}

// === Camera ===
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// === Sistema Solar ===
export interface Sistema {
  id: string;
  x: number;
  y: number;
  sol: Sol;
  planetas: Planeta[];
}

// === Mundo ===
export interface Mundo {
  container: Container;
  tamanho: number;
  planetas: Planeta[];
  sistemas: Sistema[];
  sois: Sol[];
  naves: Nave[];
  fundo: Container;
  frotas: unknown[];
  frotasContainer: Container;
  navesContainer: Container;
  rotasContainer: Container;
  tipoJogador: TipoJogador;
  ultimoTickMs: number;
  visaoContainer: Container;
  orbitasContainer: Container;
  memoriaPlanetasContainer: Container;
  fontesVisao: FonteVisao[];
  /** Deterministic seed for procedural music — same seed = same musical theme. */
  seedMusical: number;
  /** Deterministic seed for procedural lore — same seed → same stories. */
  galaxySeed: number;
}

// === Tipo de Jogador ===
export interface TipoJogador {
  nome: string;
  desc: string;
  cor: number;
  bonus: {
    producao?: number;
    fabricasIniciais?: number;
    infraestruturaInicial?: number;
  };
}

// === Profiling ===
// Each field is milliseconds per frame, averaged over a rolling window.
// Fine-grained buckets so the profiler HUD can show exactly where the
// frame budget went — "logica" used to be one bucket encompassing AI,
// combat, ship movement, and resource ticks, which was useless for
// diagnosis. Kept as a legacy alias (sum of gameplay buckets).
export interface ProfilingData {
  // Gameplay sub-buckets (summed they replace what "logica" used to be).
  planetasLogic: number;   // Resource/research/orbit/queue ticks across all planets.
  naves: number;           // Ship movement + state updates.
  ia: number;              // AI decision-making + memory decay.
  combate: number;         // Combat resolution + spatial hash + damage.
  stats: number;           // Periodic stats sampling + first-contact + primeiro-contato.

  // Rendering / per-frame visual buckets.
  fundo: number;           // Starfield RT render + sprite placement.
  fog: number;             // Fog-of-war canvas draw + GPU upload.
  planetas: number;        // Per-planet sprite/uniform updates (light, shader rotation).
  render: number;          // Remaining render path: selection, trails, combat visuals, HUD.

  // Aggregates — computed from the above each flush.
  logica: number;          // Legacy = planetasLogic + naves + ia + combate + stats.
  total: number;           // Gameplay tick only (measured around our work).
  // Wall-clock time between consecutive atualizarMundo calls. This is
  // the real frame duration as the game perceives it; "total - our
  // measured buckets" = Pixi render + browser idle (vsync wait).
  frameWall: number;
}

// === Ação Nave Parsed ===
export interface AcaoNaveParsed {
  tipo: string;
  tier: number;
}

// === Config Debug ===
export interface DebugConfig {
  raioVisaoBase: number;
  raioVisaoNave: number;
  raioVisaoBatedora: number;
  raioVisaoColonizadora: number;
  fogAlpha: number;
  fogThrottle: number;
}

// === Cheats ===
export interface CheatsState {
  construcaoInstantanea: boolean;
  recursosInfinitos: boolean;
  pesquisaInstantanea: boolean;
  visaoTotal: boolean;
  velocidadeNave: boolean;
}

// === Re-export pixi types for convenience ===
export type { Container, Graphics, AnimatedSprite, Application, Texture };
