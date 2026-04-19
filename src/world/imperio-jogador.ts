/**
 * Player empire — name, visual identity (logo/sigil), personality
 * weights, objective, and generated lore. Authored by the player in the
 * new-world wizard; carried on Mundo and persisted with the save.
 *
 * The personality is expressed as 6 sliders (the same genome the AI
 * uses). An "archetype" is inferred from the dominant weights only to
 * feed the existing lore generator — the player never picks one by name.
 */

import { gerarImperioLore, type ImperioLore } from './lore/imperio-lore';
import type { Arquetipo, PersonalidadeIA } from './personalidade-ia';
import type { SigiloManual } from '../ui/empire-builder/sigilos';

export type ObjetivoImperio =
  | 'conquista'      // eliminate all empires
  | 'economia'       // accumulate resources
  | 'ciencia'        // research everything
  | 'sobrevivencia'  // endure
  | 'exploracao'     // discover all systems
  | 'livre';         // no explicit goal

export interface PesosImperio {
  agressao: number;
  expansao: number;
  economia: number;
  ciencia: number;
  defesa: number;
  vinganca: number;
}

export interface ImperioJogador {
  nome: string;
  /** Procedural sigil seed — fed to gerarSigilo() in sigilos.ts. When
   *  `manual` is present it takes priority and the seed is ignored for
   *  rendering (but kept so toggling back to procedural restores the
   *  last browsed gallery base). */
  logo: { seed: number; manual?: SigiloManual };
  pesos: PesosImperio;
  objetivo: ObjetivoImperio;
  lore?: ImperioLore;
  /** Derived from pesos — same shape as the old TipoJogador.bonus. */
  bonus: {
    producao?: number;
    fabricasIniciais?: number;
    infraestruturaInicial?: number;
  };
}

/** Color auto-assigned to the player empire. Kept separate from pesos
 *  so auto-tinting logic can evolve without breaking save shape. */
export const COR_JOGADOR_DEFAULT = 0x44aaff;

export function novoSigiloSeed(): number {
  return (Math.floor(Math.random() * 0xFFFFFFFF)) | 0;
}

export const PESOS_DEFAULT: PesosImperio = {
  agressao: 1.0,
  expansao: 1.0,
  economia: 1.0,
  ciencia: 1.0,
  defesa: 1.0,
  vinganca: 1.0,
};

export const PESOS_MIN = 0;
export const PESOS_MAX = 1.5;

export function clampPeso(v: number): number {
  if (!Number.isFinite(v)) return 1.0;
  return Math.max(PESOS_MIN, Math.min(PESOS_MAX, v));
}

/**
 * High-level personality axes exposed in the UI. Each is 0..1 and
 * expands into the 6 underlying weights via pesosDeEixos().
 *
 *   postura: defensivo (0) ↔ agressivo (1)
 *   foco:    econômico (0) ↔ científico (1)
 *   ritmo:   contido (0) ↔ expansivo (1)
 *
 * The lore generator still reads the 6-weight genome; this is purely
 * an authoring simplification.
 */
export interface EixosPersonalidade {
  postura: number;
  foco: number;
  ritmo: number;
}

/** Convert high-level axes into the full 6-weight vector. */
export function pesosDeEixos(eixos: EixosPersonalidade): PesosImperio {
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  const p = clamp(eixos.postura);
  const f = clamp(eixos.foco);
  const r = clamp(eixos.ritmo);
  return {
    agressao: 0.3 + p * 1.2,                     // 0.3 .. 1.5
    defesa:   1.4 - p * 1.0,                     // 1.4 .. 0.4
    vinganca: 0.45 + p * 1.0,                    // 0.45 .. 1.45
    economia: 1.45 - f * 1.0,                    // 1.45 .. 0.45
    ciencia:  0.45 + f * 1.05,                   // 0.45 .. 1.5
    expansao: 0.3 + r * 1.2,                     // 0.3 .. 1.5
  };
}

/** Best-effort inverse of pesosDeEixos — used to seed the sliders from
 *  an existing pesos state (so editing a random initial empire doesn't
 *  snap all axes to 0.5). */
export function eixosDePesos(pesos: PesosImperio): EixosPersonalidade {
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  // Each axis recovered by inverting one of the linear forms.
  const postura = (pesos.agressao - 0.3) / 1.2;
  const foco = (pesos.ciencia - 0.45) / 1.05;
  const ritmo = (pesos.expansao - 0.3) / 1.2;
  return {
    postura: clamp(postura),
    foco: clamp(foco),
    ritmo: clamp(ritmo),
  };
}

/** Named quick-start presets — same concept as archetypes internally
 *  but exposed to the player as "flavors" without the RPG vocabulary. */
export const EIXOS_PRESETS: Array<{ id: string; nome: string; desc: string; eixos: EixosPersonalidade }> = [
  { id: 'balanceado',   nome: 'Balanceado',   desc: 'Sem preferência forte em nenhum eixo.', eixos: { postura: 0.5, foco: 0.5, ritmo: 0.5 } },
  { id: 'conquistador', nome: 'Conquistador', desc: 'Ataca primeiro. Expande rápido.',      eixos: { postura: 0.9, foco: 0.25, ritmo: 0.75 } },
  { id: 'mercador',     nome: 'Mercador',     desc: 'Economia forte, crescimento calmo.',   eixos: { postura: 0.2, foco: 0.25, ritmo: 0.7 } },
  { id: 'erudito',      nome: 'Erudito',      desc: 'Ciência primeiro. Defesa sólida.',     eixos: { postura: 0.35, foco: 0.9, ritmo: 0.4 } },
  { id: 'fortaleza',    nome: 'Fortaleza',    desc: 'Defesa máxima. Pouca expansão.',       eixos: { postura: 0.2, foco: 0.45, ritmo: 0.25 } },
];

export function imperioJogadorDefault(): ImperioJogador {
  const imperio: ImperioJogador = {
    nome: 'Meu Império',
    logo: { seed: novoSigiloSeed() },
    pesos: { ...PESOS_DEFAULT },
    objetivo: 'livre',
    bonus: {},
  };
  imperio.bonus = derivarBonus(imperio.pesos);
  return imperio;
}

/**
 * Map dominant weights → archetype for the lore generator.
 *
 * The lore engine's templates (birth story, foundational achievement,
 * military doctrine, etc.) are keyed by archetype. We infer the closest
 * fit from the player's slider state so lore stays coherent with how
 * they actually built the empire.
 */
export function inferirArquetipo(pesos: PesosImperio): Arquetipo {
  const scores: Array<[Arquetipo, number]> = [
    ['warlord',   pesos.agressao + pesos.vinganca * 0.5],
    ['explorer',  pesos.expansao],
    ['trader',    pesos.economia + pesos.expansao * 0.3],
    ['scientist', pesos.ciencia],
    ['defender',  pesos.defesa + pesos.vinganca * 0.3],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

/**
 * Derive gameplay bonuses from the personality weights. Keeps the
 * same TipoJogador.bonus shape so the existing world-creation code
 * (mundo.ts) can apply it unchanged.
 */
export function derivarBonus(pesos: PesosImperio): ImperioJogador['bonus'] {
  const bonus: ImperioJogador['bonus'] = {};
  if (pesos.economia >= 1.2) bonus.producao = 1 + (pesos.economia - 1) * 0.5;
  if (pesos.expansao >= 1.2) bonus.fabricasIniciais = 1;
  if (pesos.defesa >= 1.2)   bonus.infraestruturaInicial = 1;
  return bonus;
}

function defaultNaveFavorita(arquetipo: Arquetipo): PersonalidadeIA['naveFavorita'] {
  switch (arquetipo) {
    case 'warlord':   return 'fragata';
    case 'trader':    return 'cargueira';
    case 'scientist': return 'fragata';
    case 'defender':  return 'torreta';
    case 'explorer':  return 'batedora';
  }
}

/**
 * Build a PersonalidadeIA-shaped object from the player's empire so
 * the existing lore generator (which expects that shape) can run. The
 * returned object is NOT registered as an AI — it's purely a carrier.
 */
export function sintetizarPersonalidade(imperio: ImperioJogador): PersonalidadeIA {
  const arquetipo = inferirArquetipo(imperio.pesos);
  return {
    id: 'jogador',
    nome: imperio.nome,
    cor: COR_JOGADOR_DEFAULT,
    arquetipo,
    pesos: { ...imperio.pesos },
    naveFavorita: defaultNaveFavorita(arquetipo),
    frotaMinAtaque: 5,
    paciencia: 3,
    frotaMax: 25,
    forca: 1,
  };
}

/**
 * Generate lore for the player's empire. `seed` makes regeneration
 * deterministic-per-click — the wizard passes a fresh seed on each
 * "Regerar" press.
 */
export function gerarLoreDoJogador(imperio: ImperioJogador, seed: number): ImperioLore {
  const personalidade = sintetizarPersonalidade(imperio);
  return gerarImperioLore({
    empireId: 'jogador',
    galaxySeed: seed,
    nomeImperio: imperio.nome,
    personalidade,
  });
}
