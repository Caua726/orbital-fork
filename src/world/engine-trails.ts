import { Graphics } from 'pixi.js';
import type { Nave } from '../types';

/**
 * Engine trail particles for moving ships.
 *
 * Each ship in 'viajando' or 'pilotando' state spawns a particle at its
 * current position every ~30ms. Particles fade out over LIFETIME_MS.
 * The trail is rendered relative to the ship's gfx container, so we
 * store positions in WORLD coordinates and convert to local on draw.
 *
 * Color is per-ship-type so the player can identify ships at a glance.
 */

const LIFETIME_MS = 600;
const SPAWN_INTERVAL_MS = 30;
const MAX_PARTICLES = 24;
const MIN_DIST_PER_SPAWN = 4; // world units — don't spawn if ship hasn't moved

const TRAIL_COLOR: Record<string, number> = {
  colonizadora: 0x9be7ff, // soft cyan
  cargueira:    0xffd97a, // amber
  batedora:     0xb8ffaa, // pale green
  torreta:      0xff8a8a, // soft red (defensive)
  fragata:      0xff6b6b, // hot red (combat)
};

const TRAIL_WIDTH: Record<string, number> = {
  colonizadora: 6,
  cargueira:    5,
  batedora:     3.5,
  torreta:      4,
  fragata:      4.5,
};

interface TrailState {
  particles: Array<{ x: number; y: number; age: number }>;
  spawnAccum: number;
  lastX: number;
  lastY: number;
}

const _state = new WeakMap<Nave, TrailState>();

function getOrInitState(nave: Nave): TrailState {
  let s = _state.get(nave);
  if (!s) {
    s = { particles: [], spawnAccum: 0, lastX: nave.x, lastY: nave.y };
    _state.set(nave, s);
  }
  return s;
}

/**
 * Called once when a ship is created. Adds the trail Graphics to the
 * ship's gfx container BEHIND the sprite.
 */
export function instalarTrail(nave: Nave): void {
  if (nave._trail) return;
  const trail = new Graphics();
  trail.eventMode = 'none';
  // Add at index 0 so it renders BEHIND the sprite
  nave.gfx.addChildAt(trail, 0);
  nave._trail = trail;
}

/**
 * Called every frame from atualizarNaves. Spawns new particles when
 * moving, ages existing ones, and redraws the trail.
 */
export function atualizarTrail(nave: Nave, deltaMs: number): void {
  const trail = nave._trail;
  if (!trail) return;
  const state = getOrInitState(nave);

  const isMoving = nave.estado === 'viajando' || nave.estado === 'pilotando';

  // Spawn new particles when moving
  if (isMoving) {
    state.spawnAccum += deltaMs;
    while (state.spawnAccum >= SPAWN_INTERVAL_MS) {
      state.spawnAccum -= SPAWN_INTERVAL_MS;
      const dx = nave.x - state.lastX;
      const dy = nave.y - state.lastY;
      if (dx * dx + dy * dy >= MIN_DIST_PER_SPAWN * MIN_DIST_PER_SPAWN) {
        state.particles.push({ x: nave.x, y: nave.y, age: 0 });
        state.lastX = nave.x;
        state.lastY = nave.y;
        if (state.particles.length > MAX_PARTICLES) state.particles.shift();
      }
    }
  } else {
    state.spawnAccum = 0;
    state.lastX = nave.x;
    state.lastY = nave.y;
  }

  // Age and prune
  for (let i = state.particles.length - 1; i >= 0; i--) {
    state.particles[i].age += deltaMs;
    if (state.particles[i].age >= LIFETIME_MS) {
      state.particles.splice(i, 1);
    }
  }

  // Redraw — only if there are particles to draw
  trail.clear();
  if (state.particles.length === 0) return;

  const color = TRAIL_COLOR[nave.tipo] ?? 0xcccccc;
  const baseWidth = TRAIL_WIDTH[nave.tipo] ?? 4;

  // gfx container is positioned at nave.x/y, so local coords = world - nave pos
  // Draw oldest → newest as a chain of fading circles for a soft glow trail.
  for (const p of state.particles) {
    const t = 1 - p.age / LIFETIME_MS; // 1 = fresh, 0 = dead
    const localX = p.x - nave.x;
    const localY = p.y - nave.y;
    const radius = baseWidth * t;
    const alpha = t * t * 0.8; // quadratic falloff for softer fade
    trail.circle(localX, localY, radius).fill({ color, alpha });
  }
}

/**
 * Cleanup — called when ship is destroyed.
 */
export function destruirTrail(nave: Nave): void {
  _state.delete(nave);
  // The Graphics itself is destroyed by gfx.destroy({children:true}) in removerNave.
  nave._trail = undefined;
}
