import type { Mundo, Planeta, Nave } from '../types';
import type { PersonalidadeIA, Dificuldade } from './personalidade-ia';
import { gerarPersonalidades, PRESETS_DIFICULDADE } from './personalidade-ia';
import { criarNave, enviarNaveParaAlvo } from './naves';
import { gerarAcoesCandidatas } from './ia-utilidade';
import { decairMemorias, registrarBaixa, resetMemoriasIa } from './ia-memoria';

/**
 * AI decision loop — substitutes ia-inimigo.ts.
 *
 * Each tick (interval per difficulty):
 *   1. For each active AI personality:
 *      - decay memories
 *      - generate candidate actions via ia-utilidade
 *      - execute top N actions that fit "budget" (1 production + 1 fleet
 *        + 1 economy + 1 research per tick max)
 *   2. Conquer neutros that have only one AI's ships orbiting
 *
 * The tick rate, AI count, and forca are derived from difficulty.
 *
 * Public API:
 *   - inicializarIas(mundo, dificuldade) — call once at world creation
 *   - atualizarIasV2(mundo, deltaMs) — call each frame
 *   - resetIasV2() — call when destroying a world
 *   - getPersonalidades() — debug/UI access
 */

const ACTIONS_BUDGET = {
  produzir_nave: 1,
  enviar_frota: 1,
  pesquisar: 1,
  subir_fabrica: 1,
  subir_infra: 1,
};

let _personalidades: PersonalidadeIA[] = [];
let _accum = 0;
let _tickMs = 4000;
let _ticksDecorridos = 0;

export function getPersonalidades(): readonly PersonalidadeIA[] {
  return _personalidades;
}

export function resetIasV2(): void {
  _personalidades = [];
  _accum = 0;
  _ticksDecorridos = 0;
  _tickMs = 4000;
  resetMemoriasIa();
}

/**
 * Initialize AI factions on the world based on the chosen difficulty.
 * Picks home planets far from the player AND each other, sets ownership,
 * gives them starter resources/factories/fleet.
 */
export function inicializarIas(mundo: Mundo, dificuldade: Dificuldade): PersonalidadeIA[] {
  resetIasV2();
  const cfg = PRESETS_DIFICULDADE[dificuldade];
  if (cfg.quantidadeIas === 0) return [];

  _tickMs = cfg.tickMs;
  _personalidades = gerarPersonalidades(cfg.quantidadeIas, cfg.forca);

  const jogadorHome = mundo.planetas.find((p) => p.dados.dono === 'jogador');
  if (!jogadorHome) return _personalidades;

  // Sort neutros by distance from jogador, pick farthest available
  const neutros = mundo.planetas
    .filter((p) => p.dados.dono === 'neutro')
    .map((p) => ({ p, dJogador: dist(p, jogadorHome) }))
    .sort((a, b) => b.dJogador - a.dJogador);

  const homesEscolhidos: Planeta[] = [];
  for (const personalidade of _personalidades) {
    // Pick the candidate that maximizes min distance to all chosen homes + jogador
    let melhor: Planeta | null = null;
    let melhorScore = -Infinity;
    for (const cand of neutros) {
      if (homesEscolhidos.includes(cand.p)) continue;
      const minDist = Math.min(
        cand.dJogador,
        ...homesEscolhidos.map((h) => dist(cand.p, h)),
      );
      if (minDist > melhorScore) {
        melhorScore = minDist;
        melhor = cand.p;
      }
    }
    if (!melhor) break;

    // Take ownership + starter loadout
    melhor.dados.dono = personalidade.id;
    melhor.dados.fabricas = cfg.fabricasIniciais;
    melhor.dados.infraestrutura = 1;
    melhor.dados.naves = 0;
    homesEscolhidos.push(melhor);

    // Starter fleet
    for (let i = 0; i < cfg.frotaInicial; i++) {
      const tipo = i === 0 ? personalidade.naveFavorita : 'fragata';
      const nave = criarNave(mundo, melhor, tipo, 1);
      nave.dono = personalidade.id;
    }
  }

  return _personalidades;
}

export function atualizarIasV2(mundo: Mundo, deltaMs: number): void {
  if (_personalidades.length === 0) return;

  _accum += deltaMs;
  if (_accum < _tickMs) return;
  _accum = 0;
  _ticksDecorridos++;

  for (const ia of _personalidades) {
    decairMemorias(ia.id);

    // Patience gate — early game, AI doesn't act aggressively
    const aindaPaciente = _ticksDecorridos < ia.paciencia;

    const acoes = gerarAcoesCandidatas(ia, mundo);
    const orcamento = { ...ACTIONS_BUDGET };

    for (const { acao, score: _score } of acoes) {
      // Skip aggressive actions while patient
      if (aindaPaciente && acao.tipo === 'enviar_frota' && (acao as any).alvo.dados.dono === 'jogador') continue;

      if (orcamento[acao.tipo] <= 0) continue;
      const ok = executarAcao(mundo, ia, acao);
      if (ok) orcamento[acao.tipo]--;
    }
  }

  // Conquest mechanic: AI ships orbiting a neutro flip ownership
  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono !== 'neutro') continue;
    const orbitantes = mundo.naves.filter(
      (n) => n.estado === 'orbitando' && n.alvo === planeta && _personalidades.some((p) => p.id === n.dono),
    );
    if (orbitantes.length === 0) continue;
    const counts: Record<string, number> = {};
    for (const n of orbitantes) counts[n.dono] = (counts[n.dono] ?? 0) + 1;
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (winner && counts[winner] > 0) {
      planeta.dados.dono = winner;
      planeta.dados.fabricas = 1;
      planeta.dados.infraestrutura = 0;
    }
  }
}

// Costs for AI — scaled DOWN slightly by forca so easy AIs are cheaper
// (won't outproduce the player) and brutal AIs pay close to player cost.
const CUSTO_NAVE_IA = 12;     // jogador paga 20 (CUSTO_NAVE_COMUM)
const CUSTO_PESQUISA_IA = 3;  // jogador paga 5 (CUSTO_PESQUISA_RARO)
const CUSTO_FABRICA_IA = 15;  // jogador paga 20 × 3^tier
const CUSTO_INFRA_IA = 12;
const TEMPO_PESQUISA_IA_MS = 30 * 1000; // jogador leva 60s

/** Defense reserve — keep at least N combat ships at home before sending attacks. */
function calcularReservaDefesa(ia: PersonalidadeIA): number {
  // Defenders keep more reserve, warlords keep almost none.
  return Math.max(1, Math.round(2 * ia.pesos.defesa));
}

function executarAcao(mundo: Mundo, ia: PersonalidadeIA, acao: any): boolean {
  switch (acao.tipo) {
    case 'produzir_nave': {
      const planeta: Planeta = acao.planeta;
      if (planeta.dados.dono !== ia.id) return false;
      if (planeta.dados.fabricas < 1) return false;
      // Pay resources (scaled by forca — weak AIs pay full price, strong AIs get a discount)
      const custo = Math.max(4, Math.round(CUSTO_NAVE_IA / Math.max(0.5, ia.forca)));
      if (planeta.dados.recursos.comum < custo) return false;
      planeta.dados.recursos.comum -= custo;
      const nave = criarNave(mundo, planeta, acao.tipoNave, 1);
      nave.dono = ia.id;
      return true;
    }
    case 'enviar_frota': {
      const navesIds: string[] = acao.navesIds;
      const todasMinhas = mundo.naves.filter((n) => n.dono === ia.id && n.estado === 'orbitando');
      const navesAReais = mundo.naves.filter((n) => navesIds.includes(n.id) && n.dono === ia.id);
      if (navesAReais.length === 0) return false;

      // Defense reserve: don't strip ALL ships from origin — leave at least N
      const planetaOrigem = navesAReais[0].alvo as Planeta | undefined;
      if (planetaOrigem && _personalidades.some((p) => p.id === ia.id)) {
        const reserva = calcularReservaDefesa(ia);
        const navesNoMesmoLocal = todasMinhas.filter((n) => n.alvo === planetaOrigem);
        const podeMandar = Math.max(0, navesNoMesmoLocal.length - reserva);
        const naAtual = Math.min(navesAReais.length, podeMandar);
        if (naAtual === 0) return false;
        for (let i = 0; i < naAtual; i++) {
          enviarNaveParaAlvo(mundo, navesAReais[i], acao.alvo);
        }
      } else {
        for (const nave of navesAReais) {
          enviarNaveParaAlvo(mundo, nave, acao.alvo);
        }
      }
      return true;
    }
    case 'pesquisar': {
      const planeta: Planeta = acao.planeta;
      if (planeta.dados.pesquisaAtual) return false;
      const arr = planeta.dados.pesquisas[acao.categoria];
      if (!arr) return false;
      // Pay raro + start a timed research (NOT instant anymore)
      const custo = Math.max(1, Math.round(CUSTO_PESQUISA_IA / Math.max(0.5, ia.forca)));
      if (planeta.dados.recursos.raro < custo) return false;
      planeta.dados.recursos.raro -= custo;
      const tempo = TEMPO_PESQUISA_IA_MS / Math.max(0.5, ia.forca);
      planeta.dados.pesquisaAtual = {
        categoria: acao.categoria,
        tier: acao.tier,
        tempoRestanteMs: tempo,
        tempoTotalMs: tempo,
      };
      return true;
    }
    case 'subir_fabrica': {
      const planeta: Planeta = acao.planeta;
      if (planeta.dados.fabricas >= 5) return false;
      const custo = Math.max(5, Math.round(CUSTO_FABRICA_IA / Math.max(0.5, ia.forca)));
      if (planeta.dados.recursos.comum < custo) return false;
      planeta.dados.recursos.comum -= custo;
      planeta.dados.fabricas++;
      return true;
    }
    case 'subir_infra': {
      const planeta: Planeta = acao.planeta;
      if (planeta.dados.infraestrutura >= 5) return false;
      const custo = Math.max(4, Math.round(CUSTO_INFRA_IA / Math.max(0.5, ia.forca)));
      if (planeta.dados.recursos.comum < custo) return false;
      planeta.dados.recursos.comum -= custo;
      planeta.dados.infraestrutura++;
      return true;
    }
  }
  return false;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Hook for combat system to register a kill — drives revenge AI. */
export function notificarBaixaParaIa(naveDestruida: Nave, atacante: string): void {
  if (_personalidades.some((p) => p.id === naveDestruida.dono)) {
    registrarBaixa(naveDestruida.dono, atacante);
  }
}
