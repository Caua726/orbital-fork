import type { Mundo, Planeta, AcaoNaveParsed, ItemFilaProducao } from '../types';
import { cheats } from '../ui/debug';
import { CICLO_RECURSO_MS, CUSTO_NAVE_COMUM } from './constantes';
import { aplicarProducaoCicloAoPlaneta, calcularCustoTier, calcularTempoConstrucaoMs, calcularTempoColonizadoraMs } from './recursos';
import { criarNave, parseAcaoNave } from './naves';
import { iniciarPesquisa } from './pesquisa';
import { notifConstrucaoCompleta, notifNaveProducida } from '../ui/notificacao';
import { toast } from '../ui/toast';
import { somConstrucaoCompleta, somNaveProducida } from '../audio/som';

const LABEL_NAVE_FILA: Record<string, string> = {
  colonizadora: 'Colonizadora',
  cargueira: 'Cargueira',
  batedora: 'Batedora',
  torreta: 'Torreta',
  fragata: 'Fragata',
};

function rotuloAcao(acao: string): string {
  const parsed = parseAcaoNave(acao);
  if (parsed) {
    const nome = LABEL_NAVE_FILA[parsed.tipo] ?? parsed.tipo;
    return parsed.tipo === 'colonizadora' ? nome : `${nome} T${parsed.tier}`;
  }
  if (acao === 'fabrica') return 'Fábrica';
  if (acao === 'infraestrutura') return 'Infraestrutura';
  return acao;
}

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
  if (totalItensProduzindo(planeta) >= 5) {
    toast('Fila cheia', 'err');
    return false;
  }
  planeta.dados.filaProducao.push({ acao: tipo });
  toast(`Adicionado à fila: ${rotuloAcao(tipo)}`);
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

/**
 * Returns a human-readable reason why the head of the queue cannot
 * start, or null if everything's fine (queue running, empty, or head
 * is ready to go). Used by the drawer + planet-details-modal to show
 * "fila travada porque X" instead of leaving the user guessing.
 *
 * Mirrors the gating logic of tentarIniciarProximaAcaoFila +
 * enfileirarProducaoNave so a 1:1 diagnostic is always accurate.
 */
export function diagnosticarFila(planeta: Planeta): string | null {
  const d = planeta.dados;
  if (d.filaProducao.length === 0) return null;
  if (d.construcaoAtual || d.producaoNave) return null; // item 0 rodando
  const proximo = d.filaProducao[0];
  if (!proximo) return null;

  const parsed = parseAcaoNave(proximo.acao);
  if (parsed) {
    if (d.fabricas < 1) return 'Fábrica necessária (construa uma primeiro).';
    if (parsed.tipo !== 'colonizadora') {
      if (d.fabricas < parsed.tier) {
        return `Fábrica T${parsed.tier} necessária (atual T${d.fabricas}).`;
      }
      const pesq = d.pesquisas[parsed.tipo];
      if (!pesq || !pesq[parsed.tier - 1]) {
        return `Pesquisa ${parsed.tipo} T${parsed.tier} não concluída.`;
      }
    }
    if (d.recursos.comum < CUSTO_NAVE_COMUM) {
      const falta = CUSTO_NAVE_COMUM - Math.floor(d.recursos.comum);
      return `Recursos insuficientes (faltam ${falta} comum).`;
    }
    return null;
  }

  if (proximo.acao === 'fabrica') {
    const custo = calcularCustoTier(d.fabricas);
    if (custo === null) return 'Tier máximo de fábrica atingido.';
    if (d.recursos.comum < custo) {
      const falta = custo - Math.floor(d.recursos.comum);
      return `Recursos insuficientes (faltam ${falta} comum).`;
    }
  }

  if (proximo.acao === 'infraestrutura') {
    const custo = calcularCustoTier(d.infraestrutura);
    if (custo === null) return 'Tier máximo de infraestrutura atingido.';
    if (d.recursos.comum < custo) {
      const falta = custo - Math.floor(d.recursos.comum);
      return `Recursos insuficientes (faltam ${falta} comum).`;
    }
  }

  return null;
}

/**
 * Reorders a queue entry. Returns true on success. Fails if indices
 * are out of range or if the caller tries to move the active (item 0)
 * entry — its resources are already spent, moving it would leak them.
 */
export function moverItemFila(planeta: Planeta, fromIdx: number, toIdx: number): boolean {
  const fila = planeta.dados.filaProducao;
  if (fromIdx < 0 || fromIdx >= fila.length) return false;
  if (toIdx < 0 || toIdx >= fila.length) return false;
  if (fromIdx === toIdx) return true;
  const headLocked = planeta.dados.construcaoAtual !== null || planeta.dados.producaoNave !== null;
  if (headLocked && (fromIdx === 0 || toIdx === 0)) return false;
  const [item] = fila.splice(fromIdx, 1);
  fila.splice(toIdx, 0, item);
  return true;
}

/**
 * Removes a queue entry. Can't remove item 0 when it's actively being
 * built — cost was already spent.
 */
export function removerItemFila(planeta: Planeta, idx: number): boolean {
  const fila = planeta.dados.filaProducao;
  if (idx < 0 || idx >= fila.length) return false;
  const headLocked = planeta.dados.construcaoAtual !== null || planeta.dados.producaoNave !== null;
  if (headLocked && idx === 0) return false;
  fila.splice(idx, 1);
  return true;
}
