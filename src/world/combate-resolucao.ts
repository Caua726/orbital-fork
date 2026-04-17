import { Graphics } from 'pixi.js';
import type { Mundo, Nave } from '../types';
import { saoHostis } from './constantes';
import { getStatsCombate, podeAtacar } from './combate';
import { somExplosao } from '../audio/som';

// ─── Hit-flash tracking ──────────────────────────────────────────────
// When a ship takes damage, briefly tint its sprite white then fade back.
// Stored on the ship as _hitFlashRemainingMs (number).
const FLASH_DURATION_MS = 120;
function aplicarFlashDeImpacto(nave: Nave, deltaMs: number): void {
  const restante = (nave as any)._hitFlashRemainingMs as number | undefined;
  if (restante === undefined) return;
  const novo = Math.max(0, restante - deltaMs);
  (nave as any)._hitFlashRemainingMs = novo;
  if (nave._sprite) {
    if (novo > 0) {
      const t = novo / FLASH_DURATION_MS;
      // Lerp normal tint → white based on remaining flash time
      // White = 0xffffff. Saturate sprite tint by mixing.
      const intensity = t;
      // Build a light tint that brightens the sprite without changing hue
      const r = 255;
      const g = 255 - Math.floor((1 - intensity) * 80);
      const b = 255 - Math.floor((1 - intensity) * 80);
      nave._sprite.tint = (r << 16) | (g << 8) | b;
    } else {
      // Restore default tint
      const SHIP_TINT_RESET: Record<string, number> = {
        fragata: 0xff7070,
      };
      nave._sprite.tint = SHIP_TINT_RESET[nave.tipo] ?? 0xffffff;
    }
  }
}

function disparouFlash(nave: Nave): void {
  (nave as any)._hitFlashRemainingMs = FLASH_DURATION_MS;
}

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

interface ImpactParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  age: number;
}

const BEAM_LIFETIME_MS = 150;
const PARTICLE_LIFETIME_MS = 320;
const _beams: BeamVisual[] = [];
const _particles: ImpactParticle[] = [];
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
  _particles.length = 0;
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

// ─── Spatial hash for combat target search ───────────────────────────
// Cells of 600x600 world units. Each ship lives in one cell; target
// search only iterates ships in the cell + 8 neighbors. Reduces
// O(n²) target search to O(n × k) where k is neighborhood density (~5).
//
// Built once per atualizarCombate call from the current ship array.
//
// Cell size is chosen to be larger than any ship's alcance (max ~520 for
// torreta) so a ship's effective targets are always within at most one
// neighbor cell. If alcance ever exceeds CELL_SIZE we'd need to widen
// the search to 2 cells in each direction.

const CELL_SIZE = 600;

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
}

function buildSpatialHash(naves: Nave[]): Map<string, Nave[]> {
  const grid = new Map<string, Nave[]>();
  for (const n of naves) {
    const key = cellKey(n.x, n.y);
    let cell = grid.get(key);
    if (!cell) {
      cell = [];
      grid.set(key, cell);
    }
    cell.push(n);
  }
  return grid;
}

function* iterNeighbors(grid: Map<string, Nave[]>, x: number, y: number): Generator<Nave> {
  const cx = Math.floor(x / CELL_SIZE);
  const cy = Math.floor(y / CELL_SIZE);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = grid.get(`${cx + dx},${cy + dy}`);
      if (!cell) continue;
      for (const n of cell) yield n;
    }
  }
}

// ─── Throttle combat to 30Hz ─────────────────────────────────────────
// Combat resolution runs every other frame. Beams/particles still age
// at 60fps because they accumulate the deltaMs of skipped frames. The
// damage tick is deterministic via cooldownMs per attacker, so 30Hz
// resolution doesn't change the combat math.
let _combatAccumMs = 0;
const COMBAT_TICK_MS = 33; // ~30Hz

export function atualizarCombate(mundo: Mundo, deltaMs: number): void {
  // Always tick the visual decay (beams + particles) at 60Hz so trails
  // look smooth regardless of combat throttling.
  _combatAccumMs += deltaMs;
  const runResolution = _combatAccumMs >= COMBAT_TICK_MS;
  if (runResolution) _combatAccumMs = 0;

  if (runResolution) {
    // Initialize HP on any ship missing it
    for (const n of mundo.naves) ensureHp(n);

    const now = performance.now();
    const spatialGrid = buildSpatialHash(mundo.naves);

    for (const atacante of mundo.naves) {
      if (!podeAtacar(atacante.tipo)) continue;
      if (atacante.estado === 'parado' && atacante.tipo !== 'torreta') continue;

      const stats = getStatsCombate(atacante);
      const cooldown = stats.cooldownMs;
      const lastShot = atacante._ultimoTiroMs ?? 0;
      if (now - lastShot < cooldown) continue;

      // Find nearest hostile via spatial grid (cell + 8 neighbors)
      let melhor: Nave | null = null;
      let melhorDist2 = stats.alcance * stats.alcance;
      for (const alvo of iterNeighbors(spatialGrid, atacante.x, atacante.y)) {
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
    // Trigger hit-flash on the target (briefly tints sprite white)
    disparouFlash(melhor);

    // Lead target — predict where the alvo will be when beam arrives.
    // Beam is "instant" but if the target is moving fast (viajando),
    // predict ~80ms ahead to feel right.
    const lastX = (melhor as any)._lastX as number | undefined;
    const lastY = (melhor as any)._lastY as number | undefined;
    let predictedX = melhor.x;
    let predictedY = melhor.y;
    if (lastX !== undefined && lastY !== undefined && melhor.estado === 'viajando') {
      const vx = melhor.x - lastX;
      const vy = melhor.y - lastY;
      // Adjust prediction proportional to ship speed
      predictedX = melhor.x + vx * 4;
      predictedY = melhor.y + vy * 4;
    }
    (melhor as any)._lastX = melhor.x;
    (melhor as any)._lastY = melhor.y;

    // Spawn beam visual aimed at predicted position
    _beams.push({
      fromX: atacante.x,
      fromY: atacante.y,
      toX: predictedX,
      toY: predictedY,
      color: stats.corBeam,
      age: 0,
    });

    // Spawn 4-6 impact particles spreading from the hit point
    const numParticles = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numParticles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.04 + Math.random() * 0.06;
      _particles.push({
        x: melhor.x,
        y: melhor.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: stats.corBeam,
        age: 0,
      });
    }

    // Tiny recoil on the attacker — push it back along firing direction
    const dxFire = atacante.x - melhor.x;
    const dyFire = atacante.y - melhor.y;
    const dFire = Math.hypot(dxFire, dyFire) || 1;
    const recoil = 0.4;
    atacante.x += (dxFire / dFire) * recoil;
    atacante.y += (dyFire / dFire) * recoil;
  }
  } // end of if (runResolution)

  // Tick hit-flashes for every ship (cheap — only does work for ships with active flash)
  for (const n of mundo.naves) {
    aplicarFlashDeImpacto(n, deltaMs);
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

  // Age + render impact particles (drift outward, fade)
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.age += deltaMs;
    if (p.age >= PARTICLE_LIFETIME_MS) {
      _particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * deltaMs;
    p.y += p.vy * deltaMs;
    const t = 1 - p.age / PARTICLE_LIFETIME_MS;
    gfx.circle(p.x, p.y, 1.4 * t + 0.4).fill({ color: p.color, alpha: t * 0.85 });
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
