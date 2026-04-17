import type { Mundo, Planeta, Nave } from '../types';
import type { PersonalidadeIA } from './personalidade-ia';
import { saoHostis } from './constantes';
import { getStatsCombate, podeAtacar } from './combate';
import { getRancor, tempoDesdeUltimoAtaque, registrarPlanetaVisto, jaViuPlaneta } from './ia-memoria';
import { RAIO_VISAO_BASE, RAIO_VISAO_NAVE, RAIO_VISAO_BATEDORA } from './constantes';

/**
 * Utility-based action scoring for AI decisions.
 *
 * Each tick, the AI generates a list of candidate actions (build ship,
 * send fleet, research tech, expand factory). Each candidate gets a
 * utility score combining:
 *
 *   utility = base_value × personality_weight × situational_modifier
 *
 * The AI executes top-N actions that fit its budget. Personalities
 * differ → different utility shapes → different play styles.
 */

export type AcaoCandidata =
  | { tipo: 'produzir_nave'; planeta: Planeta; tipoNave: string; }
  | { tipo: 'enviar_frota'; origem: Planeta; alvo: Planeta; navesIds: string[]; }
  | { tipo: 'recall_defesa'; planeta_ameacado: Planeta; navesIds: string[]; }
  | { tipo: 'pesquisar'; planeta: Planeta; categoria: string; tier: number; }
  | { tipo: 'subir_fabrica'; planeta: Planeta; }
  | { tipo: 'subir_infra'; planeta: Planeta; };

export interface AcaoComScore {
  acao: AcaoCandidata;
  score: number;
}

function planetasDoDono(mundo: Mundo, dono: string): Planeta[] {
  return mundo.planetas.filter((p) => p.dados.dono === dono);
}

function navesDoDono(mundo: Mundo, dono: string): Nave[] {
  return mundo.naves.filter((n) => n.dono === dono);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Total combat power of a fleet (sum of dano × hp_ratio). */
function poderCombate(naves: Nave[]): number {
  let total = 0;
  for (const n of naves) {
    const stats = getStatsCombate(n);
    if (!podeAtacar(n.tipo)) continue;
    const hpRatio = (n.hp ?? stats.hp) / stats.hp;
    total += stats.dano * hpRatio;
  }
  return total;
}

// ─── Score functions ─────────────────────────────────────────────────────

function scoreProduzirNave(
  ia: PersonalidadeIA,
  planeta: Planeta,
  tipoNave: string,
  mundo: Mundo,
): number {
  let base = 10;

  // Personality bias toward favorite ship
  if (tipoNave === ia.naveFavorita) base *= 1.5;

  // Type-specific weights
  if (tipoNave === 'fragata') base *= ia.pesos.agressao * 1.2;
  if (tipoNave === 'torreta') base *= ia.pesos.defesa;
  if (tipoNave === 'batedora') base *= (ia.pesos.expansao * 0.7 + ia.pesos.agressao * 0.3);
  if (tipoNave === 'cargueira') base *= ia.pesos.economia * 0.6;

  // Threat at this planet → boost defensive choices
  const ameacaAqui = ameacaNoPlaneta(mundo, planeta, ia.id);
  if (tipoNave === 'torreta' && ameacaAqui > 0) {
    base *= 1 + ameacaAqui * 0.4;
  }
  if (tipoNave === 'fragata' && ameacaAqui > 0) {
    base *= 1 + ameacaAqui * 0.2; // fragata also helps defense
  }

  // Diminishing returns: lots of one type already? scale down
  const minhaFrotaTipo = mundo.naves.filter((n) => n.dono === ia.id && n.tipo === tipoNave).length;
  base *= 1 / (1 + minhaFrotaTipo * 0.1);

  // Difficulty multiplier
  base *= ia.forca;

  // Cooldown bonus: encourage some variety
  if (Math.random() < 0.1) base *= 0.7; // jitter

  return base;
}

/** Returns 0..3 representing how threatened this planet is. */
function ameacaNoPlaneta(mundo: Mundo, planeta: Planeta, donoIa: string): number {
  let ameaca = 0;
  for (const n of mundo.naves) {
    if (!saoHostis(n.dono, donoIa)) continue;
    const d = dist(n, planeta);
    if (d > 1500) continue;
    const proximidade = 1 - d / 1500; // 0..1
    const stats = getStatsCombate(n);
    ameaca += proximidade * (stats.dano / 10);
  }
  return Math.min(3, ameaca);
}

function scoreEnviarFrota(
  ia: PersonalidadeIA,
  origem: Planeta,
  alvo: Planeta,
  minhasNaves: Nave[],
  mundo: Mundo,
): number {
  const alvoDono = alvo.dados.dono;
  if (alvoDono === ia.id) return -Infinity; // can't attack own planet

  const meuPoder = poderCombate(minhasNaves);
  const defesaInimiga = poderCombate(
    mundo.naves.filter((n) => n.dono === alvoDono && saoHostis(n.dono, ia.id) && dist(n, alvo) < 600),
  );

  // Don't send tiny fleets unless attacking neutro
  if (alvoDono !== 'neutro' && minhasNaves.length < ia.frotaMinAtaque) return -Infinity;
  // Don't attack if outclassed (force ratio < 1.3)
  if (alvoDono !== 'neutro' && defesaInimiga > meuPoder * 0.8) return -Infinity;

  let base = 0;

  if (alvoDono === 'neutro') {
    // Expansion utility — value depends on planet type (gasoso planets are gold)
    base = 25 * ia.pesos.expansao;
    if (alvo.dados.tipoPlaneta === 'gasoso') base *= 1.4;
  } else {
    // Attack utility — based on enemy economy + revenge
    const valorEconomia = (alvo.dados.fabricas + alvo.dados.infraestrutura) * 5;
    const rancor = getRancor(ia.id, alvoDono);
    base = (valorEconomia + rancor * 8) * ia.pesos.agressao;

    // Revenge bonus
    if (rancor > 5) base *= 1 + ia.pesos.vinganca * 0.3;

    // Don't spam attacks on same target
    const t = tempoDesdeUltimoAtaque(ia.id, alvoDono);
    if (t < 8000) base *= 0.4;
  }

  // Distance penalty
  const d = dist(origem, alvo);
  base *= Math.max(0.2, 1 - d / 8000);

  // Force ratio bonus — winning by a lot scores higher
  if (defesaInimiga > 0) {
    const ratio = meuPoder / Math.max(1, defesaInimiga);
    base *= Math.min(2, ratio);
  } else {
    base *= 1.3; // undefended target — bonus
  }

  // Difficulty
  base *= ia.forca;

  return base;
}

function scorePesquisar(ia: PersonalidadeIA, _planeta: Planeta, categoria: string, tier: number): number {
  let base = 8 * tier; // higher tiers more valuable
  base *= ia.pesos.ciencia;

  // Category preference matches favorite ship
  if (categoria === ia.naveFavorita) base *= 1.4;

  // If currently engaged in combat, deprioritize research
  // (handled at executor level by checking resources first)

  base *= ia.forca;
  return base;
}

function scoreSubirFabrica(ia: PersonalidadeIA, planeta: Planeta): number {
  let base = 12;
  base *= ia.pesos.economia;
  // Higher tiers diminishing returns
  base *= 1 / (1 + planeta.dados.fabricas * 0.3);
  base *= ia.forca;
  return base;
}

function scoreSubirInfra(ia: PersonalidadeIA, planeta: Planeta): number {
  // Only useful on comum planets
  if (planeta.dados.tipoPlaneta !== 'comum') return 0;
  let base = 8;
  base *= ia.pesos.economia;
  base *= 1 / (1 + planeta.dados.infraestrutura * 0.3);
  base *= ia.forca;
  return base;
}

// ─── Action generation ───────────────────────────────────────────────────

// Recon cache: planets don't move, so seen-set converges quickly.
// Run recon at most once per RECON_CACHE_MS per AI.
const RECON_CACHE_MS = 12_000; // 3 ticks at default tickMs=4000
const _reconLastRun = new Map<string, number>();

/** Test/reset hook — called from resetIasV2 in ia-decisao.ts. */
export function resetReconCache(): void {
  _reconLastRun.clear();
}

/**
 * Update the AI's seen-planet set based on its current ships and planets.
 * Each planet ALWAYS sees its own location; ships extend visibility based
 * on type. Once a planet is seen, it's remembered (no fog re-coverage).
 */
function atualizarReconIa(ia: PersonalidadeIA, mundo: Mundo): void {
  const now = performance.now();
  const last = _reconLastRun.get(ia.id) ?? 0;
  if (now - last < RECON_CACHE_MS) return;
  _reconLastRun.set(ia.id, now);
  const meusPlanetas = planetasDoDono(mundo, ia.id);
  const minhasNaves = navesDoDono(mundo, ia.id);

  // Sources: my planet centers (with base vision) + my ship positions
  const fontes: Array<{ x: number; y: number; raio: number }> = [];
  for (const p of meusPlanetas) {
    fontes.push({ x: p.x, y: p.y, raio: RAIO_VISAO_BASE() + p.dados.tamanho * 0.2 });
  }
  for (const n of minhasNaves) {
    let raio: number;
    if (n.tipo === 'batedora') raio = RAIO_VISAO_BATEDORA();
    else raio = RAIO_VISAO_NAVE();
    fontes.push({ x: n.x, y: n.y, raio });
  }

  // For each planet in the world, check if any source can see it
  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === ia.id) {
      registrarPlanetaVisto(ia.id, planeta.id);
      continue;
    }
    for (const f of fontes) {
      const dx = f.x - planeta.x;
      const dy = f.y - planeta.y;
      if (dx * dx + dy * dy <= f.raio * f.raio) {
        registrarPlanetaVisto(ia.id, planeta.id);
        break;
      }
    }
  }
}

export function gerarAcoesCandidatas(ia: PersonalidadeIA, mundo: Mundo): AcaoComScore[] {
  const meusPlanetas = planetasDoDono(mundo, ia.id);
  if (meusPlanetas.length === 0) return [];
  const minhasNaves = navesDoDono(mundo, ia.id);

  // Update recon — what the AI has seen so far
  atualizarReconIa(ia, mundo);

  const acoes: AcaoComScore[] = [];

  // Production candidates: each planet × each ship type
  for (const planeta of meusPlanetas) {
    if (planeta.dados.fabricas < 1) continue;
    if (minhasNaves.length >= ia.frotaMax) continue;
    for (const tipoNave of ['fragata', 'torreta', 'batedora', 'cargueira']) {
      const score = scoreProduzirNave(ia, planeta, tipoNave, mundo);
      if (score > 0) acoes.push({ acao: { tipo: 'produzir_nave', planeta, tipoNave }, score });
    }

    // Research candidates
    for (const cat of ['fragata', 'torreta', 'batedora', 'cargueira']) {
      const arr = planeta.dados.pesquisas[cat];
      if (!arr) continue;
      const tierAtual = arr.filter(Boolean).length;
      const proxTier = tierAtual + 1;
      if (proxTier > 5) continue;
      if (planeta.dados.fabricas < proxTier) continue;
      if (planeta.dados.pesquisaAtual) continue;
      const score = scorePesquisar(ia, planeta, cat, proxTier);
      if (score > 0) acoes.push({ acao: { tipo: 'pesquisar', planeta, categoria: cat, tier: proxTier }, score });
    }

    // Economy candidates
    if (planeta.dados.fabricas < 5) {
      const score = scoreSubirFabrica(ia, planeta);
      if (score > 0) acoes.push({ acao: { tipo: 'subir_fabrica', planeta }, score });
    }
    if (planeta.dados.infraestrutura < 5 && planeta.dados.tipoPlaneta === 'comum') {
      const score = scoreSubirInfra(ia, planeta);
      if (score > 0) acoes.push({ acao: { tipo: 'subir_infra', planeta }, score });
    }
  }

  // Fleet dispatch candidates: COORDINATED across multiple planets.
  //
  // Instead of "each planet attacks alone with 5 ships", we evaluate
  // each visible target globally and pick the best one per origin
  // — but ALSO emit a "mass attack" candidate that pulls combat ships
  // from ALL my planets within range. This makes AI feel coordinated:
  // when a player planet is targeted, the AI sends 8-12 ships from
  // multiple bases instead of 3 from one.
  const todasMinhasOrbitando = mundo.naves.filter(
    (n) => n.dono === ia.id && n.estado === 'orbitando'
      && (n.tipo === 'fragata' || n.tipo === 'batedora'),
  );

  // For each visible target, compute the best mass-attack score
  for (const alvo of mundo.planetas) {
    if (alvo.dados.dono === ia.id) continue;
    if (!jaViuPlaneta(ia.id, alvo.id)) continue;

    // Find all my planets within reach of this target + their orbiting ships
    const planetasComFrota = meusPlanetas.filter(
      (p) => dist(p, alvo) <= 8000 && todasMinhasOrbitando.some((n) => n.alvo === p),
    );
    if (planetasComFrota.length === 0) continue;

    // Pool ships across all those planets (combat ships only)
    const frotaPool = todasMinhasOrbitando.filter(
      (n) => planetasComFrota.includes(n.alvo as Planeta),
    );
    if (frotaPool.length === 0) continue;

    // Best origin = closest planet (so we keep an "origem" reference for
    // distance calc + defense reserve check)
    const origem = planetasComFrota
      .map((p) => ({ p, d: dist(p, alvo) }))
      .sort((a, b) => a.d - b.d)[0].p;

    // Score the consolidated attack
    const score = scoreEnviarFrota(ia, origem, alvo, frotaPool, mundo);
    if (score > 0) {
      // Cap at 8 ships per attack to prevent total committment
      const maxNaves = Math.min(frotaPool.length, 8);
      // Sort by distance to target — closest go first
      const ordenadasPorDist = frotaPool
        .map((n) => ({ n, d: dist(n, alvo) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, maxNaves)
        .map((x) => x.n);
      acoes.push({
        acao: {
          tipo: 'enviar_frota',
          origem,
          alvo,
          navesIds: ordenadasPorDist.map((n) => n.id),
        },
        score,
      });
    }
  }

  // Defensive recall: if any of MY planets is under threat, recall ships
  // from elsewhere to defend. High utility — defending home matters more
  // than expansion or attack.
  for (const planetaAmeacado of meusPlanetas) {
    const ameaca = ameacaNoPlaneta(mundo, planetaAmeacado, ia.id);
    if (ameaca < 0.5) continue; // ignore low threats

    // Find my combat ships that are at OTHER planets (not already defending here)
    const candidatos = minhasNaves.filter(
      (n) => n.estado === 'orbitando'
        && n.alvo !== planetaAmeacado
        && (n.tipo === 'fragata' || n.tipo === 'torreta' || n.tipo === 'batedora'),
    );
    if (candidatos.length === 0) continue;

    // Pick closest 3
    const ordenados = candidatos
      .map((n) => ({ n, d: dist(n, planetaAmeacado) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((x) => x.n);
    if (ordenados.length === 0) continue;

    // Score: threat × defense weight × (1 / closest distance for urgency)
    const score = 50 * ameaca * ia.pesos.defesa * ia.forca;
    acoes.push({
      acao: {
        tipo: 'recall_defesa',
        planeta_ameacado: planetaAmeacado,
        navesIds: ordenados.map((n) => n.id),
      },
      score,
    });
  }

  // Sort by score desc
  acoes.sort((a, b) => b.score - a.score);
  return acoes;
}
