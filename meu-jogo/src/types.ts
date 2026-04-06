import type { Container, Graphics, AnimatedSprite, Spritesheet, Application } from 'pixi.js';

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

// === Planeta ===
export interface DadosPlaneta {
  dono: string;
  tipoPlaneta: string;
  producao: number;
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
}

export interface OrbitaPlaneta {
  centroX: number;
  centroY: number;
  raio: number;
  angulo: number;
  velocidade: number;
}

export interface Planeta extends AnimatedSprite {
  dados: DadosPlaneta;
  _tipoAlvo: 'planeta';
  _orbita: OrbitaPlaneta;
  _anel: Graphics;
  _construcoes: Graphics;
  _visivelAoJogador: boolean;
}

// === Sol ===
export interface Sol extends Graphics {
  _raio: number;
  _cor: number;
  _tipoAlvo: 'sol';
  _visivelAoJogador: boolean;
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
  estado: 'orbitando' | 'viajando' | 'parado';
  alvo: Planeta | Sol | AlvoPonto | null;
  selecionado: boolean;
  origem: Planeta;
  gfx: Graphics;
  _tipoAlvo: 'nave';
  orbita: OrbitaNave | null;
  _selecaoAnterior?: boolean;
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
  x: number;
  y: number;
  sol: Sol;
  planetas: Planeta[];
}

// === Pesquisa ===
export interface Pesquisa {
  categoria: string;
  tier: number;
  tempoRestanteMs: number;
  tempoTotalMs: number;
}

export type PesquisasState = Record<string, boolean[]>;

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
  planetaSheet: Spritesheet;
  tipoJogador: TipoJogador;
  recursosJogador: Recursos;
  ultimoTickMs: number;
  visaoContainer: Container;
  memoriaPlanetasContainer: Container;
  fontesVisao: FonteVisao[];
  pesquisas: PesquisasState;
  pesquisaAtual: Pesquisa | null;
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
export interface ProfilingData {
  logica: number;
  fundo: number;
  fog: number;
  planetas: number;
  render: number;
  total: number;
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
export type { Container, Graphics, AnimatedSprite, Spritesheet, Application };
