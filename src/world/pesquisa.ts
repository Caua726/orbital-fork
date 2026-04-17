import type { Planeta, PesquisasState, Pesquisa } from '../types';
import { CATEGORIAS_PESQUISA, TIER_MAX, CUSTO_PESQUISA_RARO, TEMPO_PESQUISA_MS } from './constantes';
import { cheats } from '../ui/debug';
import { notifPesquisaCompleta } from '../ui/notificacao';
import { somPesquisaCompleta } from '../audio/som';

export function criarEstadoPesquisas(): PesquisasState {
  return {
    torreta: [false, false, false, false, false],
    cargueira: [false, false, false, false, false],
    batedora: [false, false, false, false, false],
    fragata: [false, false, false, false, false],
  };
}

export function atualizarPesquisaPlaneta(planeta: Planeta, deltaMs: number): void {
  const p: Pesquisa | null = planeta.dados.pesquisaAtual;
  if (!p) return;
  if (cheats.pesquisaInstantanea) p.tempoRestanteMs = 0;
  else p.tempoRestanteMs = Math.max(0, p.tempoRestanteMs - deltaMs);
  if (p.tempoRestanteMs <= 0) {
    const arr: boolean[] | undefined = planeta.dados.pesquisas[p.categoria];
    if (arr) arr[p.tier - 1] = true;
    // Only notify player about THEIR research completing, not AI research
    if (planeta.dados.dono === 'jogador') {
      notifPesquisaCompleta(p.categoria, p.tier);
      somPesquisaCompleta();
    }
    planeta.dados.pesquisaAtual = null;
  }
}

export function pesquisaTierLiberada(planeta: Planeta | null, categoria: string, tier: number): boolean {
  if (!planeta) return false;
  return !!planeta.dados.pesquisas[categoria]?.[tier - 1];
}

export function pesquisaTierDisponivel(planeta: Planeta | null, categoria: string, tier: number): boolean {
  if (!planeta) return false;
  if (!CATEGORIAS_PESQUISA.includes(categoria)) return false;
  if (tier < 1 || tier > TIER_MAX) return false;
  const arr: boolean[] | undefined = planeta.dados.pesquisas[categoria];
  if (!arr || arr[tier - 1]) return false;
  if (planeta.dados.dono !== 'jogador') return false;
  if (planeta.dados.pesquisaAtual) return false;
  if (planeta.dados.fabricas < tier) return false;
  if (tier > 1 && !arr[tier - 2]) return false;
  return true;
}

export function iniciarPesquisa(planeta: Planeta | null, categoria: string, tier: number): boolean {
  if (!planeta) return false;
  if (!pesquisaTierDisponivel(planeta, categoria, tier)) return false;
  if (planeta.dados.recursos.raro < CUSTO_PESQUISA_RARO) return false;
  planeta.dados.recursos.raro -= CUSTO_PESQUISA_RARO;
  planeta.dados.pesquisaAtual = {
    categoria, tier,
    tempoRestanteMs: TEMPO_PESQUISA_MS,
    tempoTotalMs: TEMPO_PESQUISA_MS,
  };
  return true;
}

export function getPesquisaAtual(planeta: Planeta | null): Pesquisa | null {
  if (!planeta) return null;
  return planeta.dados.pesquisaAtual || null;
}
