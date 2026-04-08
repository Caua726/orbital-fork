import type { Container, Graphics, AnimatedSprite, Application, Texture } from 'pixi.js';
import type { TexturasPlaneta } from './world/planeta';

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

export interface Planeta extends AnimatedSprite {
  dados: DadosPlaneta;
  _tipoAlvo: 'planeta';
  _orbita: OrbitaPlaneta;
  _linhaOrbita: Graphics;
  _anel: Graphics;
  _construcoes: Graphics;
  _visivelAoJogador: boolean;
  _descobertoAoJogador: boolean;
}

// === Sol ===
export interface Sol extends AnimatedSprite {
  _raio: number;
  _cor: number;
  _tipoAlvo: 'sol';
  _visivelAoJogador: boolean;
  _descobertoAoJogador: boolean;
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
  carga: Recursos;
  configuracaoCarga: Recursos;
  rotaCargueira: {
    origem: Planeta | null;
    destino: Planeta | null;
    loop: boolean;
    fase: 'origem' | 'destino';
  } | null;
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
  planetaSheet: TexturasPlaneta;
  tipoJogador: TipoJogador;
  ultimoTickMs: number;
  visaoContainer: Container;
  orbitasContainer: Container;
  memoriaPlanetasContainer: Container;
  fontesVisao: FonteVisao[];
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
export type { Container, Graphics, AnimatedSprite, Application, Texture };
