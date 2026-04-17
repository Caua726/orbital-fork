import { Graphics } from 'pixi.js';
import type { Mundo, Nave } from '../types';
import { saoHostis } from './constantes';
import { getStatsCombate, podeAtacar } from './combate';
import { somExplosao } from '../audio/som';

/**
 * Combat resolution: each frame, every armed ship looks for enemy ships
 * within its weapon range and fires at the closest one. Damage is
 * dealt over time (dano per second). Beam visuals last ~150ms.
 *
 * Beams are drawn into a single Graphics in the rotasContainer, redrawn
 * every frame.
 *
 * Ships destroyed in combat are removed from the world (with explosion sfx).
 */

interface BeamVisual {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: number;
  age: number;
}

const BEAM_LIFETIME_MS = 150;
const _beams: BeamVisual[] = [];
let _beamGfx: Graphics | null = null;

function ensureBeamGfx(mundo: Mundo): Graphics {
  if (_beamGfx && _beamGfx.parent === mundo.rotasContainer) return _beamGfx;
  const g = new Graphics();
  g.eventMode = 'none';
  mundo.rotasContainer.addChild(g);
  _beamGfx = g;
  return g;
}

/** Reset beam state (call when destroying a world). */
export function resetCombateVisuals(): void {
  _beams.length = 0;
  if (_beamGfx) {
    try { _beamGfx.destroy(); } catch { /* noop */ }
  }
  _beamGfx = null;
}

/** Initialize HP for ships that don't have it yet (newly built). */
function ensureHp(nave: Nave): void {
  if (nave.hp !== undefined) return;
  nave.hp = getStatsCombate(nave).hp;
}

export function atualizarCombate(mundo: Mundo, deltaMs: number): void {
  // Initialize HP on any ship missing it
  for (const n of mundo.naves) ensureHp(n);

  const now = performance.now();

  // Build a quick spatial cache: hostile pairs only need to check each other.
  // For the small fleet sizes here (a few hundred ships max), O(n²) is fine.
  for (const atacante of mundo.naves) {
    if (!podeAtacar(atacante.tipo)) continue;
    if (atacante.estado === 'parado' && atacante.tipo !== 'torreta') continue;

    const stats = getStatsCombate(atacante);
    const cooldown = stats.cooldownMs;
    const lastShot = atacante._ultimoTiroMs ?? 0;
    if (now - lastShot < cooldown) continue;

    // Find nearest hostile in range
    let melhor: Nave | null = null;
    let melhorDist2 = stats.alcance * stats.alcance;
    for (const alvo of mundo.naves) {
      if (alvo === atacante) continue;
      if (!saoHostis(atacante.dono, alvo.dono)) continue;
      const dx = alvo.x - atacante.x;
      const dy = alvo.y - atacante.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < melhorDist2) {
        melhorDist2 = d2;
        melhor = alvo;
      }
    }
    if (!melhor) continue;

    // Apply damage — full hit per cooldown cycle
    const danoPorTiro = stats.dano * (cooldown / 1000);
    melhor.hp = (melhor.hp ?? getStatsCombate(melhor).hp) - danoPorTiro;
    atacante._ultimoTiroMs = now;

    // Spawn beam visual
    _beams.push({
      fromX: atacante.x,
      fromY: atacante.y,
      toX: melhor.x,
      toY: melhor.y,
      color: stats.corBeam,
      age: 0,
    });
  }

  // Age beams + redraw
  const gfx = ensureBeamGfx(mundo);
  gfx.clear();
  for (let i = _beams.length - 1; i >= 0; i--) {
    const b = _beams[i];
    b.age += deltaMs;
    if (b.age >= BEAM_LIFETIME_MS) {
      _beams.splice(i, 1);
      continue;
    }
    const t = 1 - b.age / BEAM_LIFETIME_MS;
    const alpha = t * 0.95;
    const width = 2.2 * t + 0.4;
    gfx.moveTo(b.fromX, b.fromY)
      .lineTo(b.toX, b.toY)
      .stroke({ color: b.color, width, alpha });
    // Small glow at the impact point
    gfx.circle(b.toX, b.toY, 4 * t + 2).fill({ color: b.color, alpha: alpha * 0.5 });
  }

  // Remove ships with hp <= 0 (deferred — caller handles removal via removerNave)
  // We mark them for removal here by emitting events; main loop removes after.
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const n = mundo.naves[i];
    if ((n.hp ?? 1) <= 0) {
      // Inline removal — destroy gfx, splice from array
      somExplosao();
      _removerNaveDoMundo(mundo, n);
    }
  }
}

function _removerNaveDoMundo(mundo: Mundo, nave: Nave): void {
  // Mirror of removerNave from naves.ts but inlined to avoid circular import
  const idx = mundo.naves.indexOf(nave);
  if (idx >= 0) mundo.naves.splice(idx, 1);
  if (nave.rotaGfx) {
    try {
      mundo.rotasContainer.removeChild(nave.rotaGfx);
      nave.rotaGfx.destroy();
    } catch { /* noop */ }
  }
  if (nave.gfx) {
    try {
      mundo.navesContainer.removeChild(nave.gfx);
      nave.gfx.destroy({ children: true });
    } catch { /* noop */ }
  }
}
