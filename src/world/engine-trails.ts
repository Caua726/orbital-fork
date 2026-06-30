import { Graphics } from 'pixi.js';
import type { Nave } from '../types';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { Z } from '../core/render-order';
import type { Sprite as WeydraSprite } from '@weydra/renderer';

/**
 * Engine trail particles for moving ships.
 *
 * Each ship in 'viajando' or 'pilotando' state spawns a particle at its
 * current position every ~30ms. Particles fade out over LIFETIME_MS.
 *
 * Two rendering paths:
 *
 * - **Pixi (default):** the trail is a `Graphics` child of the ship's gfx
 *   container. Positions are stored in WORLD coords and converted to local
 *   when drawing. Each frame re-clears and re-draws circles.
 *
 * - **weydra (`config.weydra.shipTrails`):** each ship owns a pool of
 *   pre-allocated weydra sprites, one per `MAX_PARTICLES` slot. Per-frame
 *   we push position + RGBA8 tint (alpha carries the fade) into shared
 *   memory; the render loop batches all trail particles across all ships
 *   into one draw call because they share the trail texture.
 *
 * The particle texture is a soft radial blob rasterised once at first use
 * (16×16 white with a quadratic alpha falloff) — matches the old Pixi
 * Graphics circle look closely enough to pass visual parity.
 */

const LIFETIME_MS = 600;
const SPAWN_INTERVAL_MS = 30;
const MAX_PARTICLES = 24;
const MIN_DIST_PER_SPAWN = 4; // world units — don't spawn if ship hasn't moved

const TRAIL_COLOR: Record<string, number> = {
  colonizadora: 0x9be7ff,
  cargueira:    0xffd97a,
  batedora:     0xb8ffaa,
  torreta:      0xff8a8a,
  fragata:      0xff6b6b,
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
  /** Tracks whether the last frame had zero particles; lets atualizar
   *  skip the Graphics.clear() call when nothing has changed. */
  wasEmptyLastFrame: boolean;
  /** Number of weydra trail sprites that were visible last frame. Lets the
   *  per-frame update touch only the slots that change (write 0..n, hide
   *  n..lastActiveCount) instead of looping all MAX_PARTICLES every frame
   *  for every ship — a stationary/empty trail then does zero work. */
  lastActiveCount: number;
}

const _state = new WeakMap<Nave, TrailState>();

function getOrInitState(nave: Nave): TrailState {
  let s = _state.get(nave);
  if (!s) {
    s = { particles: [], spawnAccum: 0, lastX: nave.x, lastY: nave.y, wasEmptyLastFrame: true, lastActiveCount: 0 };
    _state.set(nave, s);
  }
  return s;
}

// ─── Weydra particle texture (16×16 soft circle, RGBA8) ─────────────────

const TRAIL_TEX_SIZE = 16;
let _weydraTrailTex: bigint | null = null;

function makeTrailTexBytes(): Uint8Array {
  const n = TRAIL_TEX_SIZE;
  const bytes = new Uint8Array(n * n * 4);
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  const maxDist = cx;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      // Quadratic falloff — matches the old Pixi per-particle
      // `alpha = t*t*0.8` look with radial shape instead of flat circle.
      const t = Math.max(0, 1 - dist / maxDist);
      const a = Math.floor(t * t * 255);
      const i = (y * n + x) * 4;
      bytes[i] = 255;
      bytes[i + 1] = 255;
      bytes[i + 2] = 255;
      bytes[i + 3] = a;
    }
  }
  return bytes;
}

function getWeydraTrailTexture(): bigint | null {
  if (_weydraTrailTex != null) return _weydraTrailTex;
  const r = getWeydraRenderer();
  if (!r) return null;
  _weydraTrailTex = r.uploadTexture(makeTrailTexBytes(), TRAIL_TEX_SIZE, TRAIL_TEX_SIZE);
  return _weydraTrailTex;
}

function ensureWeydraSpritePool(nave: Nave): WeydraSprite[] | null {
  const r = getWeydraRenderer();
  if (!r) return null;
  if (nave._weydraTrailSprites && nave._weydraTrailSprites.length === MAX_PARTICLES) {
    return nave._weydraTrailSprites as WeydraSprite[];
  }
  const tex = getWeydraTrailTexture();
  if (tex == null) return null;

  const pool: WeydraSprite[] = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const s = r.createSprite(tex, 1, 1); // size set per frame from TRAIL_WIDTH
    s.visible = false;
    s.zOrder = Z.SHIP_TRAILS;
    pool.push(s);
  }
  nave._weydraTrailSprites = pool;
  return pool;
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

  const useWeydra = getConfig().weydra.shipTrails;
  const colorRgb = TRAIL_COLOR[nave.tipo] ?? 0xcccccc;
  const baseWidth = TRAIL_WIDTH[nave.tipo] ?? 4;

  if (useWeydra) {
    // Weydra path: push per-particle state into shared memory. Hide any
    // remaining Pixi Graphics (flag can flip mid-session). Graphics.clear
    // once if we were previously drawing with it.
    if (!state.wasEmptyLastFrame) {
      trail.clear();
      state.wasEmptyLastFrame = true;
    }
    const n = state.particles.length;
    // Fast path: nothing to draw and nothing was drawn last frame — skip the
    // pool entirely (don't even allocate it). atualizarTrail runs for every
    // ship every frame, so this keeps stationary / empty-trail ships free.
    if (n === 0 && state.lastActiveCount === 0) return;

    const pool = ensureWeydraSpritePool(nave);
    if (!pool) return;
    // Write the active particles into pool[0..n-1].
    for (let i = 0; i < n; i++) {
      const s = pool[i];
      const p = state.particles[i];
      const t = 1 - p.age / LIFETIME_MS;
      const radius = baseWidth * t;
      const alpha = Math.max(0, Math.min(255, Math.floor(t * t * 0.8 * 255)));
      s.visible = true;
      s.x = p.x;
      s.y = p.y;
      // Texture is 16x16; display size is 2*radius so the sprite covers
      // the same pixel footprint as the old Pixi circle with radius r.
      s.scaleX = 2 * radius / TRAIL_TEX_SIZE;
      s.scaleY = 2 * radius / TRAIL_TEX_SIZE;
      // 0xRRGGBB shifted left 8, alpha byte ORed in (plan §"cor packed").
      s.tint = ((colorRgb << 8) | alpha) >>> 0;
    }
    // Hide only the slots that were active last frame but aren't now — the
    // pool is created with every slot hidden, so slots above lastActiveCount
    // are already hidden and don't need touching.
    for (let i = n; i < state.lastActiveCount; i++) {
      pool[i].visible = false;
    }
    state.lastActiveCount = n;
    return;
  }

  // Pixi path — untouched from pre-M3 behaviour.
  if (state.particles.length === 0) {
    if (state.wasEmptyLastFrame) return;
    trail.clear();
    state.wasEmptyLastFrame = true;
    return;
  }
  state.wasEmptyLastFrame = false;
  trail.clear();

  // gfx container is positioned at nave.x/y, so local coords = world - nave pos
  // Draw oldest → newest as a chain of fading circles for a soft glow trail.
  for (const p of state.particles) {
    const t = 1 - p.age / LIFETIME_MS;
    const localX = p.x - nave.x;
    const localY = p.y - nave.y;
    const radius = baseWidth * t;
    const alpha = t * t * 0.8;
    trail.circle(localX, localY, radius).fill({ color: colorRgb, alpha });
  }
}

/**
 * Cleanup — called when ship is destroyed.
 */
export function destruirTrail(nave: Nave): void {
  _state.delete(nave);
  // The Graphics itself is destroyed by gfx.destroy({children:true}) in removerNave.
  nave._trail = undefined;

  if (nave._weydraTrailSprites) {
    const r = getWeydraRenderer();
    if (r) {
      for (const s of nave._weydraTrailSprites) {
        r.destroySprite(s as WeydraSprite);
      }
    }
    nave._weydraTrailSprites = undefined;
  }
}
