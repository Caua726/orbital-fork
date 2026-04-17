import type { Mundo, Planeta, Nave } from '../types';
import { criarNave, enviarNaveParaAlvo } from './naves';
import { ehInimigo } from './constantes';

/**
 * Hostile AI controller for inimigo1 + inimigo2 factions.
 *
 * Simple but effective behavior:
 *  - Every TICK_AI_MS, each AI faction takes a "turn":
 *    1. PRODUCE: each owned planet may build a fragata or batedora if
 *       it has resources (treats infinite resources internally — AI
 *       cheats slightly so it stays a real threat).
 *    2. EXPAND: if AI owns a planet adjacent to a neutro planet,
 *       send a colonizadora-equivalent (we just convert ownership
 *       directly when a fragata reaches a neutro — simpler than full
 *       colonization mechanics).
 *    3. ATTACK: if there are jogador planets within reach, send
 *       fragatas at them.
 *
 * Personalities:
 *  - inimigo1 (red): aggressive — prioritizes attack ships, expands
 *    toward jogador faster.
 *  - inimigo2 (purple): defensive — builds more torretas, expands
 *    slower but turtles harder.
 *
 * AI cheat note: AI doesn't pay realistic resource cost per ship.
 * It builds at a rate gated only by TICK_AI_MS to keep code simple.
 * This is a "fair cheat" — players never see AI's resource bar.
 */

const TICK_AI_MS = 4000;
const ALCANCE_ATAQUE = 7000;     // world units — how far AI looks for jogador targets
const ALCANCE_EXPANSAO = 6000;   // world units — distance to consider for expansion

let _accum = 0;
let _spawnedHomes = false;

interface PersonalityConfig {
  shipMix: Array<{ tipo: string; weight: number }>;
  expansionInterval: number; // every N ticks, try to expand
  attackChance: number;       // 0–1 per tick, chance to send attack fleet
  ticksElapsed: number;
}

const _state: Record<string, PersonalityConfig> = {
  inimigo1: {
    shipMix: [{ tipo: 'fragata', weight: 0.7 }, { tipo: 'batedora', weight: 0.3 }],
    expansionInterval: 2,
    attackChance: 0.45,
    ticksElapsed: 0,
  },
  inimigo2: {
    shipMix: [{ tipo: 'torreta', weight: 0.5 }, { tipo: 'fragata', weight: 0.3 }, { tipo: 'batedora', weight: 0.2 }],
    expansionInterval: 4,
    attackChance: 0.20,
    ticksElapsed: 0,
  },
};

function pickShipType(mix: PersonalityConfig['shipMix']): string {
  const total = mix.reduce((s, m) => s + m.weight, 0);
  let r = Math.random() * total;
  for (const m of mix) {
    r -= m.weight;
    if (r <= 0) return m.tipo;
  }
  return mix[0].tipo;
}

function planetasDoDono(mundo: Mundo, dono: string): Planeta[] {
  return mundo.planetas.filter((p) => p.dados.dono === dono);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestPlaneta(de: Planeta, candidatos: Planeta[]): Planeta | null {
  let melhor: Planeta | null = null;
  let melhorDist = Infinity;
  for (const c of candidatos) {
    if (c === de) continue;
    const d = dist(de, c);
    if (d < melhorDist) {
      melhorDist = d;
      melhor = c;
    }
  }
  return melhor;
}

/**
 * Spawn AI home planets at game start. Picks 2 planets far from each
 * other and far from the jogador's starting planet, sets ownership,
 * and gives them 1-2 starter ships.
 */
export function spawnInimigosNoMundo(mundo: Mundo): void {
  if (_spawnedHomes) return;
  _spawnedHomes = true;

  const jogadorHome = mundo.planetas.find((p) => p.dados.dono === 'jogador');
  if (!jogadorHome) return;

  // Pick the two planets farthest from jogador as enemy homes
  const candidatos = mundo.planetas
    .filter((p) => p.dados.dono === 'neutro')
    .map((p) => ({ p, d: dist(p, jogadorHome) }))
    .sort((a, b) => b.d - a.d);

  if (candidatos.length < 2) return;

  const home1 = candidatos[0].p;
  // Pick second far from both jogador AND home1
  const home2 = candidatos
    .slice(1)
    .map(({ p }) => ({ p, d: Math.min(dist(p, jogadorHome), dist(p, home1)) }))
    .sort((a, b) => b.d - a.d)[0]?.p;
  if (!home2) return;

  home1.dados.dono = 'inimigo1';
  home1.dados.fabricas = 2;
  home1.dados.infraestrutura = 1;
  home1.dados.naves = 0;
  home2.dados.dono = 'inimigo2';
  home2.dados.fabricas = 2;
  home2.dados.infraestrutura = 1;
  home2.dados.naves = 0;

  // Initial fleets
  for (let i = 0; i < 2; i++) criarNaveInimiga(mundo, home1, 'fragata');
  for (let i = 0; i < 2; i++) criarNaveInimiga(mundo, home2, 'torreta');
}

function criarNaveInimiga(mundo: Mundo, planeta: Planeta, tipo: string): Nave {
  const nave = criarNave(mundo, planeta, tipo, 1);
  nave.dono = planeta.dados.dono;
  return nave;
}

export function atualizarIaInimigos(mundo: Mundo, deltaMs: number): void {
  _accum += deltaMs;
  if (_accum < TICK_AI_MS) return;
  _accum = 0;

  for (const dono of ['inimigo1', 'inimigo2']) {
    const cfg = _state[dono];
    cfg.ticksElapsed++;
    const meusPlanetas = planetasDoDono(mundo, dono);
    if (meusPlanetas.length === 0) continue;

    // PRODUCE — each planet builds 1 ship per tick if it has factories
    for (const planeta of meusPlanetas) {
      if (planeta.dados.fabricas < 1) continue;
      // Don't oversaturate — cap fleet per planet
      const minhasNavesAqui = mundo.naves.filter(
        (n) => n.dono === dono && n.estado === 'orbitando' && n.alvo === planeta,
      ).length;
      if (minhasNavesAqui >= 5) continue;
      const tipo = pickShipType(cfg.shipMix);
      criarNaveInimiga(mundo, planeta, tipo);
    }

    // EXPAND — every Nth tick, send a fragata at nearest neutro planet
    if (cfg.ticksElapsed % cfg.expansionInterval === 0) {
      const neutros = mundo.planetas.filter(
        (p) => p.dados.dono === 'neutro' && meusPlanetas.some((mp) => dist(mp, p) < ALCANCE_EXPANSAO),
      );
      if (neutros.length > 0) {
        const planetaBase = meusPlanetas[Math.floor(Math.random() * meusPlanetas.length)];
        const alvo = nearestPlaneta(planetaBase, neutros);
        if (alvo) {
          // Send any orbiting ship of mine — prefer fragata for capture
          const minhaFrota = mundo.naves.filter(
            (n) => n.dono === dono && n.estado === 'orbitando' && n.alvo === planetaBase,
          );
          const expedicao = minhaFrota.find((n) => n.tipo === 'fragata') ?? minhaFrota[0];
          if (expedicao) enviarNaveParaAlvo(mundo, expedicao, alvo);
        }
      }
    }

    // ATTACK — chance per tick to send fragatas at jogador
    if (Math.random() < cfg.attackChance) {
      const alvosJogador = mundo.planetas.filter(
        (p) => p.dados.dono === 'jogador'
          && meusPlanetas.some((mp) => dist(mp, p) < ALCANCE_ATAQUE),
      );
      if (alvosJogador.length > 0) {
        const alvo = alvosJogador[Math.floor(Math.random() * alvosJogador.length)];
        // Send up to 3 fragatas at the target
        const meusAtacantes = mundo.naves.filter(
          (n) => n.dono === dono
            && n.estado === 'orbitando'
            && (n.tipo === 'fragata' || n.tipo === 'batedora'),
        );
        for (let i = 0; i < Math.min(3, meusAtacantes.length); i++) {
          enviarNaveParaAlvo(mundo, meusAtacantes[i], alvo);
        }
      }
    }
  }

  // Conquest mechanic: any ship from an enemy faction orbiting a neutro
  // planet flips ownership after a brief delay (3 ticks). Simpler than
  // full colonization for the AI.
  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono !== 'neutro') continue;
    const orbitantes = mundo.naves.filter(
      (n) => n.estado === 'orbitando' && n.alvo === planeta && ehInimigo(n.dono),
    );
    if (orbitantes.length === 0) continue;
    // Group by dono; whoever has most ships claims it
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

/** Reset AI state (call when starting a new world). */
export function resetIaInimigos(): void {
  _accum = 0;
  _spawnedHomes = false;
  _state.inimigo1.ticksElapsed = 0;
  _state.inimigo2.ticksElapsed = 0;
}
