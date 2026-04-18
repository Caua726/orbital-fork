import type { Mundo, Planeta, AcaoNaveParsed, ItemFilaProducao } from '../types';
import { cheats } from '../ui/debug';
import { CICLO_RECURSO_MS, CUSTO_NAVE_COMUM } from './constantes';
import { aplicarProducaoCicloAoPlaneta, calcularCustoTier, calcularTempoConstrucaoMs, calcularTempoColonizadoraMs } from './recursos';
import { criarNave, parseAcaoNave } from './naves';
import { iniciarPesquisa } from './pesquisa';
import { notifConstrucaoCompleta, notifNaveProducida } from '../ui/notificacao';
import { somConstrucaoCompleta, somNaveProducida } from '../audio/som';

// desenharConstrucoesPlaneta was removed — the orange/blue bars it
// drew below each planet (one per factory / infra tier) were a world-
// layer debug overlay that read as visual noise, especially in
// Canvas2D mode where they rendered as solid sprite rectangles. The
// tier data is still shown in the planet panel; the world icons are
// gone for good.

/**
 * Resource production cycle — runs for ALL owned planets (including AI).
 * Without this, AI planets never accumulate resources and the AI fairness
 * fix would lock them out of building anything.
 */
export function atualizarRecursosPlaneta(planeta: Planeta, deltaMs: number): void {
  if (planeta.dados.dono === 'neutro') return;
  planeta.dados.acumuladorRecursosMs += deltaMs;
  while (planeta.dados.acumuladorRecursosMs >= CICLO_RECURSO_MS) {
    planeta.dados.acumuladorRecursosMs -= CICLO_RECURSO_MS;
    aplicarProducaoCicloAoPlaneta(planeta);
  }
}

export function atualizarFilasPlaneta(mundo: Mundo, planeta: Planeta, deltaMs: number): void {
  if (planeta.dados.dono !== 'jogador') return;

  const construcao = planeta.dados.construcaoAtual;
  if (construcao) {
    if (cheats.construcaoInstantanea) construcao.tempoRestanteMs = 0;
    else construcao.tempoRestanteMs = Math.max(0, construcao.tempoRestanteMs - deltaMs);
    if (construcao.tempoRestanteMs <= 0) {
      finalizarItemFila(planeta, `construcao:${construcao.tipo}`);
      if (construcao.tipo === 'fabrica') planeta.dados.fabricas = construcao.tierDestino;
      if (construcao.tipo === 'infraestrutura') planeta.dados.infraestrutura = construcao.tierDestino;
      planeta.dados.construcaoAtual = null;
      notifConstrucaoCompleta(construcao.tipo, construcao.tierDestino);
      somConstrucaoCompleta();
    }
  }

  const producao = planeta.dados.producaoNave;
  if (producao) {
    if (cheats.construcaoInstantanea) producao.tempoRestanteMs = 0;
    else producao.tempoRestanteMs = Math.max(0, producao.tempoRestanteMs - deltaMs);
    if (producao.tempoRestanteMs <= 0) {
      finalizarItemFila(planeta, `nave:${producao.tipoNave}:${producao.tier}`);
      planeta.dados.producaoNave = null;
      const tipoNave = producao.tipoNave || 'colonizadora';
      const tier = producao.tier || 1;
      if (tipoNave === 'colonizadora') planeta.dados.naves += 1;
      criarNave(mundo, planeta, tipoNave, tier);
      notifNaveProducida(tipoNave, tier);
      somNaveProducida();
    }
  }

  tentarIniciarProximaAcaoFila(mundo, planeta);
}

function totalItensProduzindo(planeta: Planeta): number {
  return planeta.dados.filaProducao.length;
}

function registrarFilaConclusao(planeta: Planeta, item: ItemFilaProducao): void {
  if (!planeta.dados.repetirFilaProducao) return;
  if (totalItensProduzindo(planeta) >= 5) return;
  planeta.dados.filaProducao.push({ acao: item.acao });
}

function finalizarItemFila(planeta: Planeta, idEsperado: string): void {
  const atual = planeta.dados.filaProducao[0];
  if (!atual) return;
  const idAtual = identificarItemFila(atual.acao);
  if (idAtual !== idEsperado) return;
  planeta.dados.filaProducao.shift();
  registrarFilaConclusao(planeta, atual);
}

function identificarItemFila(acao: string): string {
  const parsed = parseAcaoNave(acao);
  if (parsed) return `nave:${parsed.tipo}:${parsed.tier}`;
  return `construcao:${acao}`;
}

function enfileirarProducaoNave(mundo: Mundo, planeta: Planeta, tipoNave: string, tier: number): boolean {
  if (planeta.dados.fabricas < 1 || planeta.dados.producaoNave) return false;
  if (tipoNave !== 'colonizadora') {
    if (planeta.dados.fabricas < tier) return false;
    const pesq = planeta.dados.pesquisas[tipoNave];
    if (!pesq || !pesq[tier - 1]) return false;
  }
  const tempo = calcularTempoColonizadoraMs(planeta);
  if (!tempo || planeta.dados.recursos.comum < CUSTO_NAVE_COMUM) return false;
  planeta.dados.recursos.comum -= CUSTO_NAVE_COMUM;
  planeta.dados.producaoNave = {
    tipoNave,
    tier,
    tempoRestanteMs: tempo,
    tempoTotalMs: tempo,
  };
  return true;
}

export function construirNoPlaneta(mundo: Mundo, planeta: Planeta, tipo: string): boolean {
  if (!planeta || planeta.dados.dono !== 'jogador') return false;
  if (tipo === 'fila_toggle_repeat') {
    planeta.dados.repetirFilaProducao = !planeta.dados.repetirFilaProducao;
    return true;
  }
  if (tipo === 'fila_limpar') {
    planeta.dados.filaProducao = (planeta.dados.construcaoAtual || planeta.dados.producaoNave)
      ? planeta.dados.filaProducao.slice(0, 1)
      : [];
    planeta.dados.repetirFilaProducao = false;
    return true;
  }
  // Research actions bypass the build queue — they go to pesquisaAtual,
  // which has its own update loop in atualizarPesquisaPlaneta.
  // Format: pesquisa_<categoria>_<tier>
  const pesqMatch = tipo.match(/^pesquisa_(cargueira|batedora|torreta|fragata)_([1-5])$/);
  if (pesqMatch) {
    return iniciarPesquisa(planeta, pesqMatch[1], Number(pesqMatch[2]));
  }
  if (totalItensProduzindo(planeta) >= 5) return false;
  planeta.dados.filaProducao.push({ acao: tipo });
  tentarIniciarProximaAcaoFila(mundo, planeta);
  return true;
}

function tentarIniciarProximaAcaoFila(mundo: Mundo, planeta: Planeta): void {
  if (planeta.dados.construcaoAtual || planeta.dados.producaoNave) return;
  const proximo = planeta.dados.filaProducao[0];
  if (!proximo) return;

  const parsedNave: AcaoNaveParsed | null = parseAcaoNave(proximo.acao);
  if (parsedNave) {
    enfileirarProducaoNave(mundo, planeta, parsedNave.tipo, parsedNave.tier);
    return;
  }

  if (proximo.acao === 'fabrica') {
    const custo = calcularCustoTier(planeta.dados.fabricas);
    const tempo = calcularTempoConstrucaoMs(planeta.dados.fabricas);
    if (!custo || !tempo || planeta.dados.recursos.comum < custo) return;
    planeta.dados.recursos.comum -= custo;
    planeta.dados.construcaoAtual = {
      tipo: 'fabrica',
      tierDestino: planeta.dados.fabricas + 1,
      tempoRestanteMs: tempo,
      tempoTotalMs: tempo,
    };
    return;
  }

  if (proximo.acao === 'infraestrutura') {
    const custo = calcularCustoTier(planeta.dados.infraestrutura);
    const tempo = calcularTempoConstrucaoMs(planeta.dados.infraestrutura);
    if (!custo || !tempo || planeta.dados.recursos.comum < custo) return;
    planeta.dados.recursos.comum -= custo;
    planeta.dados.construcaoAtual = {
      tipo: 'infraestrutura',
      tierDestino: planeta.dados.infraestrutura + 1,
      tempoRestanteMs: tempo,
      tempoTotalMs: tempo,
    };
  }
}
