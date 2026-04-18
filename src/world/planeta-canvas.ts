import type { PaletaPlaneta } from './planeta-procedural';

/**
 * Canvas2D / JS port of planeta.frag.
 *
 * Runs the same math as the GLSL fragment shader but on the CPU, so
 * it works without any WebGL or WebGPU context. Output is an
 * ImageData buffer which Pixi wraps via Texture.from(canvas).
 *
 * Everything here is a direct translation of the shader: same hash
 * function, same octave count loop, same sphere projection, same
 * dithering, same cloud / river / flare logic. The visual output is
 * pixel-for-pixel identical to the WebGL path (modulo float
 * precision noise on the hash output, which is imperceptible).
 *
 * The trade-off is raw speed — GPU runs thousands of fragments in
 * parallel; JS runs them sequentially. To keep usable frame rates,
 * we render at a small fixed internal resolution (uPixels, default
 * 64) and let Pixi upscale with `scaleMode='nearest'` to preserve
 * the pixel-art look. At 64×64 per planet, a full repaint is
 * ~2-5ms in V8 on a desktop (terran with clouds is the heaviest).
 *
 * Exposed API mirrors the needs of planeta-procedural.ts:
 *
 *   renderPlanetParaImageData(data, W, H, paleta, state)
 *     Writes RGBA pixels for one planet into an existing Uint8ClampedArray.
 *     `state` carries the per-frame dynamic uniforms (time, rotation, light).
 */

export interface PlanetRenderState {
  uTime: number;         // seconds
  uRotation: number;     // radians
  uLightOriginX: number; // 0..1
  uLightOriginY: number; // 0..1
}

// ─── Shader helpers — direct GLSL ports ───────────────────────────

function fract(x: number): number {
  return x - Math.floor(x);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smoothstepF(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Context bundle passed through every helper so we don't re-look-up
// the paleta fields per pixel (would kill the inner loop). Also lets
// us pre-compute a few values (cos/sin of rotation, size squared) once.
interface RenderCtx {
  paleta: PaletaPlaneta;
  state: PlanetRenderState;
  // derived
  mX: number;   // rand() modulo tiling X
  mY: number;   // rand() modulo tiling Y
  uSize: number;
  uSeed: number;
  uTime: number;
  uTimeSpeed: number;
  uPixels: number;
  uRotation: number;
  cosR: number;
  sinR: number;
  uLightX: number;
  uLightY: number;
  uLightBorder1: number;
  uLightBorder2: number;
  uDitherSize: number;
  uTiles: number;
  uOctaves: number;
  uPlanetType: number;
  uRiverCutoff: number;
  uLandCutoff: number;
  uCloudCover: number;
  uStretch: number;
  uCloudCurve: number;
  uCloudAlpha: number;
  uColors: [number, number, number, number][];
}

function buildCtx(paleta: PaletaPlaneta, state: PlanetRenderState, uPixels: number, uSeed: number): RenderCtx {
  const sizeFloor = Math.floor(paleta.size + 0.5);
  const mX = (paleta.planetType === 0 || paleta.planetType === 1) ? 2 * sizeFloor : sizeFloor;
  const mY = sizeFloor;
  return {
    paleta,
    state,
    mX, mY,
    uSize: paleta.size,
    uSeed,
    uTime: state.uTime,
    uTimeSpeed: paleta.timeSpeed,
    uPixels,
    uRotation: state.uRotation,
    cosR: Math.cos(state.uRotation),
    sinR: Math.sin(state.uRotation),
    uLightX: state.uLightOriginX,
    uLightY: state.uLightOriginY,
    uLightBorder1: paleta.lightBorder1,
    uLightBorder2: paleta.lightBorder2,
    uDitherSize: paleta.ditherSize,
    uTiles: paleta.tiles,
    uOctaves: paleta.octaves,
    uPlanetType: paleta.planetType,
    uRiverCutoff: paleta.riverCutoff,
    uLandCutoff: paleta.landCutoff,
    uCloudCover: paleta.cloudCover,
    uStretch: paleta.stretch,
    uCloudCurve: paleta.cloudCurve,
    uCloudAlpha: paleta.cloudAlpha,
    uColors: paleta.colors,
  };
}

// rand() from planeta.frag: modulo the coord by tiling, then
// fract(sin(dot(...)) * 15.5453 * uSeed). JS Math.sin is typically
// ~2× slower than multiply, so this is the hottest primitive here.
function rand(ctx: RenderCtx, cx: number, cy: number): number {
  // mod with positive wrap
  let x = cx % ctx.mX; if (x < 0) x += ctx.mX;
  let y = cy % ctx.mY; if (y < 0) y += ctx.mY;
  const d = x * 12.9898 + y * 78.233;
  return fract(Math.sin(d) * 15.5453 * ctx.uSeed);
}

function noise(ctx: RenderCtx, cx: number, cy: number): number {
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  const fx = cx - ix;
  const fy = cy - iy;
  const a = rand(ctx, ix, iy);
  const b = rand(ctx, ix + 1, iy);
  const c = rand(ctx, ix, iy + 1);
  const d = rand(ctx, ix + 1, iy + 1);
  const cubicX = fx * fx * (3 - 2 * fx);
  const cubicY = fy * fy * (3 - 2 * fy);
  return mix(a, b, cubicX) + (c - a) * cubicY * (1 - cubicX) + (d - b) * cubicX * cubicY;
}

function fbm(ctx: RenderCtx, cx: number, cy: number): number {
  let value = 0;
  let scale = 0.5;
  const oct = ctx.uOctaves > 6 ? 6 : ctx.uOctaves;
  for (let i = 0; i < oct; i++) {
    value += noise(ctx, cx, cy) * scale;
    cx *= 2;
    cy *= 2;
    scale *= 0.5;
  }
  return value;
}

function spherify(uvx: number, uvy: number, out: [number, number]): void {
  const cx = uvx * 2 - 1;
  const cy = uvy * 2 - 1;
  const dsq = cx * cx + cy * cy;
  if (dsq >= 1) {
    // GLSL sqrt(1 - dsq) would be NaN; clamp to 0 like GLSL's
    // implicit NaN-to-zero behaviour in this shader context.
    out[0] = 0.5 + cx * 0.5;
    out[1] = 0.5 + cy * 0.5;
    return;
  }
  const z = Math.sqrt(1 - dsq);
  out[0] = (cx / (z + 1)) * 0.5 + 0.5;
  out[1] = (cy / (z + 1)) * 0.5 + 0.5;
}

function rotate2d(ctx: RenderCtx, uvx: number, uvy: number, out: [number, number]): void {
  const cx = uvx - 0.5;
  const cy = uvy - 0.5;
  out[0] = cx * ctx.cosR - cy * ctx.sinR + 0.5;
  out[1] = cx * ctx.sinR + cy * ctx.cosR + 0.5;
}

function dither(ctx: RenderCtx, u1x: number, u2y: number): boolean {
  const step = 2 / ctx.uPixels;
  const s = (u1x + u2y) % step;
  const adj = s < 0 ? s + step : s;
  return adj <= 1 / ctx.uPixels;
}

function circleNoise(ctx: RenderCtx, uvx: number, uvy: number): number {
  const uv_y = Math.floor(uvy);
  uvx = uvx + uv_y * 0.31;
  const fx = fract(uvx);
  const fy = fract(uvy);
  const h = rand(ctx, Math.floor(uvx), uv_y);
  const dx = fx - 0.25 - h * 0.5;
  const dy = fy - 0.25 - h * 0.5;
  const m = Math.sqrt(dx * dx + dy * dy);
  const r = h * 0.25;
  return smoothstepF(0, r, m * 0.75);
}

// Scratch buffers for per-pixel vec2 math; reused across every call
// to avoid allocation per pixel.
const _sph: [number, number] = [0, 0];
const _rot: [number, number] = [0, 0];

// ─── Per-type planet functions (match planeta.frag) ───────────────

function terranPixel(ctx: RenderCtx, uvx: number, uvy: number, uvRawX: number, uvRawY: number, outRGBA: [number, number, number, number]): void {
  const dith = dither(ctx, uvx, uvRawY);
  const dxCenter = uvx - 0.5, dyCenter = uvy - 0.5;
  const a = (dxCenter * dxCenter + dyCenter * dyCenter) <= (0.49999 * 0.49999) ? 1 : 0;
  if (a === 0) {
    outRGBA[3] = 0;
    return;
  }
  spherify(uvx, uvy, _sph);
  const sphx = _sph[0], sphy = _sph[1];
  let d_light = Math.hypot(sphx - ctx.uLightX, sphy - ctx.uLightY);
  rotate2d(ctx, sphx, sphy, _rot);
  const rx = _rot[0], ry = _rot[1];

  const tOff = ctx.uTime * ctx.uTimeSpeed;
  const baseFbmX = rx * ctx.uSize + tOff;
  const baseFbmY = ry * ctx.uSize;
  const fbm1 = fbm(ctx, baseFbmX, baseFbmY);
  let fbm2 = fbm(ctx, baseFbmX - ctx.uLightX * fbm1, baseFbmY - ctx.uLightY * fbm1);
  let fbm3 = fbm(ctx, baseFbmX - ctx.uLightX * 1.5 * fbm1, baseFbmY - ctx.uLightY * 1.5 * fbm1);
  let fbm4 = fbm(ctx, baseFbmX - ctx.uLightX * 2 * fbm1, baseFbmY - ctx.uLightY * 2 * fbm1);

  let riverFbm = fbm(ctx, baseFbmX + fbm1 * 6, baseFbmY + fbm1 * 6);
  riverFbm = riverFbm >= ctx.uRiverCutoff ? 1 : 0;

  const ditherBorder = (1 / ctx.uPixels) * ctx.uDitherSize;
  if (d_light < ctx.uLightBorder1) fbm4 *= 0.9;
  if (d_light > ctx.uLightBorder1) { fbm2 *= 1.05; fbm3 *= 1.05; fbm4 *= 1.05; }
  if (d_light > ctx.uLightBorder2) {
    fbm2 *= 1.3; fbm3 *= 1.4; fbm4 *= 1.8;
    if (d_light < ctx.uLightBorder2 + ditherBorder && dith) fbm4 *= 0.5;
  }

  d_light = d_light * d_light * 0.4;
  let col = ctx.uColors[3];
  if (fbm4 + d_light < fbm1 * 1.5) col = ctx.uColors[2];
  if (fbm3 + d_light < fbm1 * 1.0) col = ctx.uColors[1];
  if (fbm2 + d_light < fbm1) col = ctx.uColors[0];
  if (riverFbm < fbm1 * 0.5) {
    col = ctx.uColors[5];
    if (fbm4 + d_light < fbm1 * 1.5) col = ctx.uColors[4];
  }

  // Cloud layer — gated on a > 0 (already) and cloudAlpha.
  if (ctx.uCloudAlpha > 0) {
    let cUVx = rx;
    let cUVy = ry + smoothstepF(0, 1.3, Math.abs(rx - 0.4));
    const cTime = ctx.uTime * ctx.uTimeSpeed * 0.5;
    let cNoiseSum = 0;
    for (let ci = 0; ci < 9; ci++) {
      cNoiseSum += circleNoise(
        ctx,
        cUVx * ctx.uSize * 0.3 + (ci + 1) + 10 + cTime,
        cUVy * ctx.uSize * 0.3 + (ci + 1) + 10,
      );
    }
    const cloudFbm = fbm(
      ctx,
      cUVx * ctx.uSize + cNoiseSum + cTime,
      cUVy * ctx.uSize + cNoiseSum,
    );
    if (cloudFbm >= ctx.uCloudCover) {
      // Cloud tiers match planeta.frag literal colors.
      const pxSnapX = Math.floor(uvRawX * ctx.uPixels) / ctx.uPixels;
      const pxSnapY = Math.floor(uvRawY * ctx.uPixels) / ctx.uPixels;
      spherify(pxSnapX, pxSnapY, _sph);
      const d_cloud_light = Math.hypot(_sph[0] - ctx.uLightX, _sph[1] - ctx.uLightY);
      let cr = 0.96, cg = 1.0, cb = 0.91;
      if (cloudFbm < ctx.uCloudCover + 0.03) { cr = 0.87; cg = 0.88; cb = 0.91; }
      if (d_cloud_light + cloudFbm * 0.2 > 0.52) { cr = 0.41; cg = 0.44; cb = 0.60; }
      if (d_cloud_light + cloudFbm * 0.2 > 0.62) { cr = 0.25; cg = 0.29; cb = 0.45; }
      outRGBA[0] = cr * 255;
      outRGBA[1] = cg * 255;
      outRGBA[2] = cb * 255;
      outRGBA[3] = 255;
      return;
    }
  }

  outRGBA[0] = col[0] * 255;
  outRGBA[1] = col[1] * 255;
  outRGBA[2] = col[2] * 255;
  outRGBA[3] = col[3] * 255;
}

function dryPixel(ctx: RenderCtx, uvx: number, uvy: number, _uvRawX: number, uvRawY: number, outRGBA: [number, number, number, number]): void {
  const dith = dither(ctx, uvx, uvRawY);
  let d_light = Math.hypot(uvx - ctx.uLightX, uvy - ctx.uLightY);
  const dxCenter = uvx - 0.5, dyCenter = uvy - 0.5;
  const a = (dxCenter * dxCenter + dyCenter * dyCenter) <= (0.49999 * 0.49999) ? 1 : 0;
  if (a === 0) { outRGBA[3] = 0; return; }
  // GLSL dryPlanet uses the ROTATED UV for fbm — no spherify. Previous
  // TS port did spherify first which shifted the noise coordinate space
  // and made dry planets look subtly wrong. Matching the shader now.
  rotate2d(ctx, uvx, uvy, _rot);
  const rx = _rot[0], ry = _rot[1];
  const fbm1 = fbm(ctx, rx, ry);
  d_light += fbm(
    ctx,
    rx * ctx.uSize + fbm1 + ctx.uTime * ctx.uTimeSpeed,
    ry * ctx.uSize + fbm1,
  ) * 0.3;

  const ditherBorder = (1 / ctx.uPixels) * ctx.uDitherSize;
  let col = ctx.uColors[0];
  if (d_light > ctx.uLightBorder1) {
    col = ctx.uColors[1];
    if (d_light < ctx.uLightBorder1 + ditherBorder && dith) col = ctx.uColors[0];
  }
  if (d_light > ctx.uLightBorder2) {
    col = ctx.uColors[2];
    if (d_light < ctx.uLightBorder2 + ditherBorder && dith) col = ctx.uColors[1];
  }
  outRGBA[0] = col[0] * 255;
  outRGBA[1] = col[1] * 255;
  outRGBA[2] = col[2] * 255;
  outRGBA[3] = col[3] * 255;
}

function islandsPixel(ctx: RenderCtx, uvx: number, uvy: number, _uvRawX: number, _uvRawY: number, outRGBA: [number, number, number, number]): void {
  const d_light_raw = Math.hypot(uvx - ctx.uLightX, uvy - ctx.uLightY);
  const dxCenter = uvx - 0.5, dyCenter = uvy - 0.5;
  const d_circle_sq = dxCenter * dxCenter + dyCenter * dyCenter;
  const a = d_circle_sq <= (0.49999 * 0.49999) ? 1 : 0;
  if (a === 0) { outRGBA[3] = 0; return; }

  rotate2d(ctx, uvx, uvy, _rot);
  spherify(_rot[0], _rot[1], _sph);
  const sx = _sph[0], sy = _sph[1];

  const baseX = sx * ctx.uSize + ctx.uTime * ctx.uTimeSpeed;
  const baseY = sy * ctx.uSize;
  const fbm1 = fbm(ctx, baseX, baseY);
  let fbm2 = fbm(ctx, baseX - ctx.uLightX * fbm1, baseY - ctx.uLightY * fbm1);
  let fbm3 = fbm(ctx, baseX - ctx.uLightX * 1.5 * fbm1, baseY - ctx.uLightY * 1.5 * fbm1);
  let fbm4 = fbm(ctx, baseX - ctx.uLightX * 2 * fbm1, baseY - ctx.uLightY * 2 * fbm1);

  if (d_light_raw < ctx.uLightBorder1) fbm4 *= 0.9;
  if (d_light_raw > ctx.uLightBorder1) { fbm2 *= 1.05; fbm3 *= 1.05; fbm4 *= 1.05; }
  if (d_light_raw > ctx.uLightBorder2) { fbm2 *= 1.3; fbm3 *= 1.4; fbm4 *= 1.8; }

  const d_light_adj = d_light_raw * d_light_raw * 0.1;
  let col = ctx.uColors[3];
  if (fbm4 + d_light_adj < fbm1) col = ctx.uColors[2];
  if (fbm3 + d_light_adj < fbm1) col = ctx.uColors[1];
  if (fbm2 + d_light_adj < fbm1) col = ctx.uColors[0];

  const landMask = fbm1 >= ctx.uLandCutoff ? 1 : 0;
  if (landMask === 0) { outRGBA[3] = 0; return; }
  outRGBA[0] = col[0] * 255;
  outRGBA[1] = col[1] * 255;
  outRGBA[2] = col[2] * 255;
  outRGBA[3] = col[3] * 255;
}

function cloudAlpha(ctx: RenderCtx, uvx: number, uvy: number): number {
  let cNoiseSum = 0;
  const tOff = ctx.uTime * ctx.uTimeSpeed;
  for (let i = 0; i < 9; i++) {
    cNoiseSum += circleNoise(
      ctx,
      uvx * ctx.uSize * 0.3 + (i + 1) + 10 + tOff,
      uvy * ctx.uSize * 0.3 + (i + 1) + 10,
    );
  }
  return fbm(
    ctx,
    uvx * ctx.uSize + cNoiseSum + tOff,
    uvy * ctx.uSize + cNoiseSum,
  );
}

function gasPixel(ctx: RenderCtx, uvx: number, uvy: number, _uvRawX: number, _uvRawY: number, outRGBA: [number, number, number, number]): void {
  const d_light = Math.hypot(uvx - ctx.uLightX, uvy - ctx.uLightY);
  const dxCenter = uvx - 0.5, dyCenter = uvy - 0.5;
  const a = (dxCenter * dxCenter + dyCenter * dyCenter) <= (0.49999 * 0.49999) ? 1 : 0;
  if (a === 0) { outRGBA[3] = 0; return; }

  rotate2d(ctx, uvx, uvy, _rot);
  spherify(_rot[0], _rot[1], _sph);
  const sx = _sph[0];
  const sy = _sph[1] + smoothstepF(0, ctx.uCloudCurve, Math.abs(_sph[0] - 0.4));

  const c = cloudAlpha(ctx, sx, sy * ctx.uStretch);
  let col = ctx.uColors[0];
  if (c < ctx.uCloudCover + 0.03) col = ctx.uColors[1];
  if (d_light + c * 0.2 > ctx.uLightBorder1) col = ctx.uColors[2];
  if (d_light + c * 0.2 > ctx.uLightBorder2) col = ctx.uColors[3];

  const cloudMask = c >= ctx.uCloudCover ? 1 : 0;
  const bgCol = ctx.uColors[3];
  const t = cloudMask;
  outRGBA[0] = mix(bgCol[0], col[0], t) * 255;
  outRGBA[1] = mix(bgCol[1], col[1], t) * 255;
  outRGBA[2] = mix(bgCol[2], col[2], t) * 255;
  // Multiply by `a` to honor disc boundary — GLSL returns vec4(col.rgb, a * col.a).
  outRGBA[3] = a * col[3] * 255;
}

// ─── Star shader helpers + function ───────────────────────────────

function hash2(ctx: RenderCtx, px: number, py: number, out: [number, number]): void {
  const r = 523 * Math.sin(px * 53.3158 + py * 43.6143) * ctx.uSeed;
  out[0] = fract(15.32354 * r);
  out[1] = fract(17.25865 * r);
}

function cells(ctx: RenderCtx, px: number, py: number, numCells: number): number {
  px *= numCells; py *= numCells;
  let d = 1e10;
  const modTarget = numCells / ctx.uTiles;
  for (let xo = -1; xo <= 1; xo++) {
    for (let yo = -1; yo <= 1; yo++) {
      let tx = Math.floor(px) + xo;
      let ty = Math.floor(py) + yo;
      // mod positive
      let mx = tx % modTarget; if (mx < 0) mx += modTarget;
      let my = ty % modTarget; if (my < 0) my += modTarget;
      hash2(ctx, mx, my, _sph);
      const dx = px - tx - _sph[0];
      const dy = py - ty - _sph[1];
      const dd = dx * dx + dy * dy;
      if (dd < d) d = dd;
    }
  }
  return Math.sqrt(d);
}

function starCircle(ctx: RenderCtx, uvx: number, uvy: number, amount: number, cSize: number): number {
  const invert = 1 / amount;
  let ux = uvx, uy = uvy;
  if (fract(uy / (invert * 2)) * (invert * 2) < invert) {
    ux += invert * 0.5;
  }
  const randCoX = Math.floor(ux * amount) / amount;
  const randCoY = Math.floor(uy * amount) / amount;
  const moddedX = fract(ux / invert) * amount;
  const moddedY = fract(uy / invert) * amount;
  const r = rand(ctx, randCoX, randCoY);
  const rc = clamp(r, invert, 1 - invert);
  const dx = moddedX - rc;
  const dy = moddedY - rc;
  const circ = Math.sqrt(dx * dx + dy * dy);
  return smoothstepF(circ, circ + 0.5, invert * cSize * rand(ctx, randCoX * 1.5, randCoY * 1.5));
}

function starPixel(ctx: RenderCtx, uvx: number, uvy: number, uvRawX: number, uvRawY: number, outRGBA: [number, number, number, number]): void {
  const dxCenter = uvx - 0.5;
  const dyCenter = uvy - 0.5;
  const quadDist = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);
  if (quadDist > 0.52) { outRGBA[3] = 0; return; }

  const mult = Math.floor(ctx.uSize + 0.5) * 2 / Math.max(ctx.uTimeSpeed, 0.001);
  const bodyTime = ctx.uTime * mult * 0.005;
  const blobTime = ctx.uTime * mult * 0.01;
  const flareTime = ctx.uTime * mult * 0.015;

  const dith = dither(ctx, uvRawX, uvy);

  // Body maps center 50% of quad to 0..1
  const bodyUVx = (uvx - 0.25) * 2;
  const bodyUVy = (uvy - 0.25) * 2;
  const bodyPixX = Math.floor(bodyUVx * ctx.uPixels) / ctx.uPixels;
  const bodyPixY = Math.floor(bodyUVy * ctx.uPixels) / ctx.uPixels;
  const bodyDsq = (bodyPixX - 0.5) * (bodyPixX - 0.5) + (bodyPixY - 0.5) * (bodyPixY - 0.5);
  const bodyA = bodyDsq <= (0.49999 * 0.49999) ? 1 : 0;

  let bodyR = 0, bodyG = 0, bodyB = 0;
  if (bodyA > 0) {
    rotate2d(ctx, bodyPixX, bodyPixY, _rot);
    spherify(_rot[0], _rot[1], _sph);
    const cn1 = cells(ctx, _sph[0] - bodyTime * ctx.uTimeSpeed * 2, _sph[1], 10);
    const cn2 = cells(ctx, _sph[0] - bodyTime * ctx.uTimeSpeed, _sph[1], 20);
    let n = clamp(cn1 * cn2 * 2, 0, 1);
    if (dith) n *= 1.3;
    let idx = Math.floor(n * 3);
    if (idx < 0) idx = 0; if (idx > 3) idx = 3;
    const bc = ctx.uColors[idx];
    bodyR = bc[0]; bodyG = bc[1]; bodyB = bc[2];
  }

  // Blobs + flares
  const fullPixX = Math.floor(uvx * ctx.uPixels) / ctx.uPixels;
  const fullPixY = Math.floor(uvy * ctx.uPixels) / ctx.uPixels;
  rotate2d(ctx, fullPixX, fullPixY, _rot);
  const fullD = Math.sqrt((fullPixX - 0.5) * (fullPixX - 0.5) + (fullPixY - 0.5) * (fullPixY - 0.5));
  const fullAngle = Math.atan2(_rot[0] - 0.5, _rot[1] - 0.5);

  let blobC = 0;
  for (let i = 0; i < 15; i++) {
    const r = rand(ctx, i, 0);
    blobC += starCircle(
      ctx,
      fullD * ctx.uSize - blobTime * ctx.uTimeSpeed - (1 / Math.max(fullD, 0.001)) * 0.1 + r,
      fullAngle * ctx.uSize - blobTime * ctx.uTimeSpeed - (1 / Math.max(fullD, 0.001)) * 0.1 + r,
      2, 1,
    );
  }
  blobC *= 0.37 - fullD;
  const blobA = (blobC - fullD) >= 0.07 ? 1 : 0;

  const fAngle = fullAngle * 0.4;
  const fn = fbm(ctx, fullD * ctx.uSize - flareTime * ctx.uTimeSpeed, fAngle * ctx.uSize - flareTime * ctx.uTimeSpeed);
  let fc = starCircle(ctx, fullD - flareTime * ctx.uTimeSpeed + fn, fAngle - flareTime * ctx.uTimeSpeed + fn, 2, 1);
  fc *= 1.5;
  const fn2 = fbm(ctx, fullD * ctx.uSize - flareTime + 100, fAngle * ctx.uSize - flareTime + 100);
  fc -= fn2 * 0.1;

  let flareAlpha = 0;
  if (1 - fullD > fc) {
    if (fc > 0.3 - 0.07 + fullD && dith) flareAlpha = 1;
    if (fc > 0.3 + fullD) flareAlpha = 1;
  }
  if (fn2 * 0.25 > fullD) flareAlpha = 0;

  // Composite back-to-front: flares, blobs, body.
  let r = 0, g = 0, b = 0, a = 0;
  if (flareAlpha > 0 && bodyA < 1) {
    const fIdx = Math.floor(fn2 + fc);
    const fc0 = ctx.uColors[fIdx > 0 ? 1 : 0];
    r = fc0[0]; g = fc0[1]; b = fc0[2]; a = flareAlpha;
  }
  if (blobA > 0) {
    if (bodyA > 0) {
      bodyR = mix(bodyR, ctx.uColors[0][0], 0.6);
      bodyG = mix(bodyG, ctx.uColors[0][1], 0.6);
      bodyB = mix(bodyB, ctx.uColors[0][2], 0.6);
    } else {
      const c0 = ctx.uColors[0];
      r = c0[0]; g = c0[1]; b = c0[2]; a = blobA;
    }
  }
  if (bodyA > 0) { r = bodyR; g = bodyG; b = bodyB; a = 1; }

  // Write straight (non-premultiplied). The outer pixel loop applies
  // premultiplied-alpha once at the end (matching planeta.frag's
  // final line). Previously this function also premultiplied, so
  // partial-alpha flare/blob pixels had their RGB squared in alpha-
  // space and came out too dim.
  outRGBA[0] = r * 255;
  outRGBA[1] = g * 255;
  outRGBA[2] = b * 255;
  outRGBA[3] = a * 255;
}

// ─── Public render entry point ────────────────────────────────────

const _pixelOut: [number, number, number, number] = [0, 0, 0, 0];

export function renderPlanetParaImageData(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  paleta: PaletaPlaneta,
  state: PlanetRenderState,
  uPixels: number,
  uSeed: number,
): void {
  const ctx = buildCtx(paleta, state, uPixels, uSeed);
  const uvStepX = 1 / W;
  const uvStepY = 1 / H;
  let idx = 0;
  for (let py = 0; py < H; py++) {
    const uvy = (py + 0.5) * uvStepY;
    const uvRawY = uvy;
    const uvPixY = Math.floor(uvy * uPixels) / uPixels;
    for (let px = 0; px < W; px++) {
      const uvx = (px + 0.5) * uvStepX;
      const uvRawX = uvx;
      const uvPixX = Math.floor(uvx * uPixels) / uPixels;
      switch (paleta.planetType) {
        case 0: terranPixel(ctx, uvPixX, uvPixY, uvRawX, uvRawY, _pixelOut); break;
        case 1: dryPixel(ctx, uvPixX, uvPixY, uvRawX, uvRawY, _pixelOut); break;
        case 2: islandsPixel(ctx, uvPixX, uvPixY, uvRawX, uvRawY, _pixelOut); break;
        case 3: gasPixel(ctx, uvPixX, uvPixY, uvRawX, uvRawY, _pixelOut); break;
        default: starPixel(ctx, uvPixX, uvPixY, uvRawX, uvRawY, _pixelOut); break;
      }
      // Premultiplied alpha (matches planeta.frag final line)
      const a = _pixelOut[3] / 255;
      data[idx] = _pixelOut[0] * a;
      data[idx + 1] = _pixelOut[1] * a;
      data[idx + 2] = _pixelOut[2] * a;
      data[idx + 3] = _pixelOut[3];
      idx += 4;
    }
  }
}
