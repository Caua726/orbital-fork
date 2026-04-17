/**
 * Deep procedural lore for a planet — not a summary, but a biography.
 *
 * Covers:
 *   - Geological/biological origin (biomas, geologia, atmosfera)
 *   - Pre-contact civilization, if any (who lived here before colonization)
 *   - Colonization chapter (who claimed it, when, why)
 *   - Cultural life (customs, religion, architecture)
 *   - Economic role (what the planet produces)
 *   - Present tensions (internal conflicts, dissent, secrets)
 *
 * Determinism: generated from (planetaId, galaxySeed, tipo, dono). Same
 * inputs → same biography. When a planet changes owner in gameplay,
 * only the "present chapter" shifts — the geological and pre-contact
 * layers stay identical.
 */

import type { Arquetipo } from '../personalidade-ia';
import { rngFor, pickRng, pickManyRng, intRng, chance, capitalize } from './seeded-rng';
import {
  biomasPorTipo,
  CIVS_ORIGINAIS,
  DESTINOS_CIVS,
  FENOMENOS_GEOLOGICOS,
  MOTIVOS_COLONIZACAO,
  COSTUMES_LOCAIS,
  RELIGIOES_PLANETA,
  ESPECIALIDADES_ECONOMICAS,
  TENSOES_INTERNAS,
  PROFISSOES_POR_ARQUETIPO,
} from './banks';

export interface PlanetaLore {
  /** Headline describing the planet's character in one line. */
  slogan: string;
  /** Geological / astronomical description. */
  geologia: string;
  /** 2-line biomas paragraph. */
  biomas: string;
  /** Pre-contact civilization. Null if planet was always uninhabited. */
  civOriginal: { descricao: string; destino: string; idadeEstimada: number } | null;
  /** When/how/why it was colonized. Null if still neutro/desabitado. */
  colonizacao: {
    ano: number;                // negative = before present; 0 = present era
    motivo: string;
    fundador: string;           // "primeiros colonos", nome do império, etc
  } | null;
  /** Cultural tradition practiced locally. */
  costumes: string;
  /** Religion / philosophy. */
  religiao: string;
  /** What the planet produces / is known for. */
  economia: string;
  /** Mostly-dormant tensions. */
  tensao: string;
  /** Dominant professions — ties to archetype when owned. */
  profissoesDominantes: string[];
  /** Short chronicler's note connecting all the above. */
  nota: string;
}

export interface PlanetaLoreContexto {
  planetaId: string;
  galaxySeed: number;
  tipo: string;                 // 'comum' | 'marte' | 'gasoso'
  dono: string;                 // 'jogador' | 'neutro' | 'inimigoN'
  nomePlaneta: string;
  /** Faction name if owned by an AI. */
  donoNome?: string;
  /** Faction archetype if owned by an AI — drives cultural tone. */
  donoArquetipo?: Arquetipo;
  /** Planet size, in game units — drives "grandioso" vs "modesto" wording. */
  tamanho: number;
  /** System name where the planet orbits. */
  sistemaNome?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function classificarPorte(tamanho: number): string {
  if (tamanho >= 280) return 'gigante';
  if (tamanho >= 220) return 'grande';
  if (tamanho >= 170) return 'médio';
  return 'modesto';
}

function textoPorTipo(tipo: string): { adjetivo: string; tipo_nome: string } {
  if (tipo === 'marte') return { adjetivo: 'árido', tipo_nome: 'mundo rochoso' };
  if (tipo === 'gasoso') return { adjetivo: 'tempestuoso', tipo_nome: 'gigante gasoso' };
  return { adjetivo: 'habitável', tipo_nome: 'planeta terrestre' };
}

// ─── Generator ───────────────────────────────────────────────────────

export function gerarPlanetaLore(ctx: PlanetaLoreContexto): PlanetaLore {
  const rng = rngFor(`planeta:${ctx.planetaId}`, ctx.galaxySeed);
  const porte = classificarPorte(ctx.tamanho);
  const { adjetivo, tipo_nome } = textoPorTipo(ctx.tipo);

  // ── Slogan
  const slogan = `${capitalize(adjetivo)} ${tipo_nome} de porte ${porte}${ctx.sistemaNome ? `, orbitando em ${ctx.sistemaNome}` : ''}.`;

  // ── Geologia
  const geologia = capitalize(pickRng(FENOMENOS_GEOLOGICOS, rng)) + '.';

  // ── Biomas
  const biomasPool = biomasPorTipo(ctx.tipo);
  const duasPaisagens = pickManyRng(biomasPool, 2, rng);
  const biomas = `${capitalize(duasPaisagens[0])}; ${duasPaisagens[1] ?? duasPaisagens[0]}.`;

  // ── Civilização original (30% de chance de já ter existido vida inteligente)
  let civOriginal: PlanetaLore['civOriginal'] = null;
  if (chance(0.3, rng)) {
    const descCiv = pickRng(CIVS_ORIGINAIS, rng);
    const destino = pickRng(DESTINOS_CIVS, rng);
    const idadeEstimada = intRng(3000, 12000, rng);
    civOriginal = { descricao: descCiv, destino, idadeEstimada };
  }

  // ── Colonização (só se tem dono)
  let colonizacao: PlanetaLore['colonizacao'] = null;
  if (ctx.dono !== 'neutro') {
    const motivo = pickRng(MOTIVOS_COLONIZACAO, rng);
    // ano negativo = há X ciclos atrás
    const ano = -intRng(50, 3200, rng);
    let fundador: string;
    if (ctx.dono === 'jogador') {
      fundador = 'os primeiros colonos do Império Jogador';
    } else if (ctx.donoNome) {
      fundador = ctx.donoNome;
    } else {
      fundador = 'uma facção hoje esquecida';
    }
    colonizacao = { ano, motivo, fundador };
  }

  // ── Costumes locais
  const costumes = capitalize(pickRng(COSTUMES_LOCAIS, rng)) + '.';

  // ── Religião
  const religiao = capitalize(pickRng(RELIGIOES_PLANETA, rng)) + '.';

  // ── Economia
  const economia = capitalize(pickRng(ESPECIALIDADES_ECONOMICAS, rng)) + '.';

  // ── Tensão interna (70% dos planetas habitados têm uma)
  let tensao = '';
  if (colonizacao && chance(0.7, rng)) {
    tensao = capitalize(pickRng(TENSOES_INTERNAS, rng)) + '.';
  } else if (!colonizacao) {
    // Neutro: tensão é ecológica/geológica
    tensao = 'O mundo permanece sem colonizadores — sinais automáticos continuam sendo emitidos, sem destinatário.';
  }

  // ── Profissões dominantes
  let profissoesDominantes: string[] = [];
  if (ctx.donoArquetipo) {
    profissoesDominantes = pickManyRng(
      PROFISSOES_POR_ARQUETIPO[ctx.donoArquetipo] ?? [],
      2,
      rng,
    );
  } else if (colonizacao) {
    profissoesDominantes = ['colonos independentes', 'técnicos rotativos'];
  }

  // ── Nota final (tie-the-knot line)
  const notaPartes: string[] = [];
  if (civOriginal) {
    notaPartes.push(
      `Os ${civOriginal.descricao} deixaram vestígios; hoje permanecem ${civOriginal.destino}.`,
    );
  }
  if (colonizacao) {
    const eraText = colonizacao.ano <= -1500 ? 'há milênios' : colonizacao.ano <= -500 ? 'há muitas gerações' : 'há poucas gerações';
    notaPartes.push(`Colonizado ${eraText} ${colonizacao.motivo}.`);
  } else {
    notaPartes.push('Permanece selvagem — sem bandeira, sem lei.');
  }
  const nota = notaPartes.join(' ');

  return {
    slogan,
    geologia,
    biomas,
    civOriginal,
    colonizacao,
    costumes,
    religiao,
    economia,
    tensao,
    profissoesDominantes,
    nota,
  };
}

// ─── Rendering helpers ───────────────────────────────────────────────

/**
 * Assembles a planet's lore into a chronicler-style paragraph for UI.
 * Breaks it into sections with labels so it reads like an archive entry.
 */
export function formatarPlanetaLore(lore: PlanetaLore, nomePlaneta: string): string {
  const linhas: string[] = [];
  linhas.push(`${nomePlaneta} — ${lore.slogan}`);
  linhas.push('');
  linhas.push(`Geologia: ${lore.geologia}`);
  linhas.push(`Paisagens: ${lore.biomas}`);

  if (lore.civOriginal) {
    const c = lore.civOriginal;
    linhas.push('');
    linhas.push(`Civilização original: ${capitalize(c.descricao)}.`);
    linhas.push(`Há cerca de ${c.idadeEstimada.toLocaleString('pt-BR')} ciclos, ${c.destino}.`);
  }

  if (lore.colonizacao) {
    const co = lore.colonizacao;
    const anoText = co.ano < 0 ? `há ${Math.abs(co.ano).toLocaleString('pt-BR')} ciclos` : 'em passado recente';
    linhas.push('');
    linhas.push(`Colonização: ${anoText}, por ${co.fundador}, ${co.motivo}.`);
  }

  linhas.push('');
  linhas.push(`Costumes: ${lore.costumes}`);
  linhas.push(`Religião: ${lore.religiao}`);
  linhas.push(`Economia: ${lore.economia}`);

  if (lore.profissoesDominantes.length > 0) {
    linhas.push(`Profissões dominantes: ${lore.profissoesDominantes.join(', ')}.`);
  }

  if (lore.tensao) {
    linhas.push('');
    linhas.push(`Tensões: ${lore.tensao}`);
  }

  linhas.push('');
  linhas.push(lore.nota);

  return linhas.join('\n');
}
