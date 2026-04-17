import { config } from '../ui/debug';

export const DONOS: Record<string, number> = {
  neutro: 0x888888,
  jogador: 0x44aaff,
};

export const CICLO_RECURSO_MS = 10 * 1000;
export const TIER_MAX = 5;
export const CUSTO_BASE_TIER = 20;
export const MULTIPLICADOR_TIER = 3;
export function RAIO_VISAO_BASE() { return config.raioVisaoBase; }
export function RAIO_VISAO_NAVE() { return config.raioVisaoNave; }
export function RAIO_VISAO_BATEDORA() { return config.raioVisaoBatedora; }
export function RAIO_VISAO_COLONIZADORA() { return config.raioVisaoColonizadora; }
export const DIST_MIN_SISTEMA = 2800;
export const TEMPO_BASE_CONSTRUCAO_MS = 60 * 1000;
export const TEMPO_BASE_COLONIZADORA_MS = 60 * 1000;
export const TEMPO_SURVEY_MS = 4 * 1000;
export const CUSTO_NAVE_COMUM = 20;
export const CUSTO_PESQUISA_RARO = 5;
export const TEMPO_PESQUISA_MS = 60 * 1000;
export const VELOCIDADE_NAVE = 0.045;
export const VELOCIDADE_ORBITA_NAVE = 0.00055;
export const CATEGORIAS_PESQUISA = ['torreta', 'cargueira', 'batedora', 'fragata'];

export function formatarId(prefixo: string): string {
  return `${prefixo}_${Math.random().toString(36).slice(2, 10)}`;
}
