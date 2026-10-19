/**
 * CPU starfield — a per-star port of the procedural starfield shaders
 * (src/shaders/starfield.frag / starfield-weydra.wgsl), used by the CPU
 * backends (Pixi `canvas`, weydra `software`).
 *
 * The shader tests every fragment against its cell's star. Here we walk the
 * visible cells instead and fill each star's covered pixels directly — the
 * same hash (PCG), cells, parallax, drift and pixel snapping, at the cost of
 * a few hundred cells per frame instead of a per-pixel pass (the old
 * 320×180 per-pixel port lost every star smaller than its 4×4 px cells).
 */

function pcg2d(vx: number, vy: number): number {
  let x = (Math.imul(vx, 1664525) + 1013904223) | 0;
  let y = (Math.imul(vy, 1664525) + 1013904223) | 0;
  x = (x + Math.imul(y, 1664525)) | 0;
  y = (y + Math.imul(x, 1664525)) | 0;
  x ^= x >>> 16;
  y ^= y >>> 16;
  x = (x + Math.imul(y, 1664525)) | 0;
  y = (y + Math.imul(x, 1664525)) | 0;
  x ^= x >>> 16;
  y ^= y >>> 16;
  return (x ^ y) >>> 0;
}

function hash1(cx: number, cy: number, salt: number): number {
  return pcg2d(cx + salt + 32768, cy + salt + 32768) / 4294967296;
}

function hash2(cx: number, cy: number, salt: number, out: [number, number]): void {
  const h = pcg2d(cx + salt + 32768, cy + salt + 32768);
  out[0] = (h & 0xFFFF) / 65536;
  out[1] = (h >>> 16) / 65536;
}

const _h: [number, number] = [0, 0];

interface Camada { cell: number; parallax: number; density: number; brilho: number; salt: number }
// Same two layers (and order) as the shaders' fs_main.
const CAMADAS: Camada[] = [
  { cell: 24, parallax: 0.40, density: 0.75, brilho: 0.80, salt: 1 },
  { cell: 60, parallax: 0.25, density: 0.40, brilho: 0.95, salt: 2 },
];

/**
 * Draws the starfield onto `ctx` (expected black underneath) covering a
 * `W × H` px canvas that shows `vw × vh` world units centred on (camX, camY).
 */
const f32 = Math.fround;

/**
 * Screen pixels [from, to) along one axis whose fragment maps into star
 * pixel `star` of pp space — evaluated with the shader's own float32 math
 * (`worldPos = cam + (uv - 0.5) * viewport`, `pp = worldPos - cam·(1-p)`,
 * `floor(pp) == star`). At large world coordinates f32 rounding decides
 * which screen pixel lands on a star, and a float64 port drew whole layers
 * off by a pixel against the GPU.
 */
function faixaCoberta(
  star: number, cam: number, view: number, n: number, keep: number, centro: number, escala: number,
): [number, number] {
  const guess = Math.floor((star - centro) * escala + n / 2);
  let de = -1, ate = -1;
  for (let px = guess - 2; px <= guess + Math.ceil(escala) + 2; px++) {
    if (px < 0 || px >= n) continue;
    const uv = f32((px + 0.5) / n);
    const world = f32(cam + f32(f32(uv - 0.5) * view));
    const pp = f32(world - f32(cam * keep));
    if (Math.floor(pp) === star) {
      if (de < 0) de = px;
      ate = px + 1;
    }
  }
  return [de, ate];
}

/**
 * Draws the starfield onto `ctx` (expected black underneath) covering a
 * `W × H` px canvas that shows `vw × vh` world units centred on (camX, camY).
 */
export function desenharStarfieldCpu(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  camX: number, camY: number, vw: number, vh: number,
  tempo: number, densidade: number,
): void {
  const sx = W / vw;
  const sy = H / vh;
  const dens = Math.max(0, Math.min(2, densidade));
  const cx32 = f32(camX), cy32 = f32(camY), vw32 = f32(vw), vh32 = f32(vh), t32 = f32(tempo);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter'; // layers add, like `col + starLayer(...)`
  for (const c of CAMADAS) {
    const keep = f32(1 - c.parallax);
    // pp = worldPos - cam·(1 - parallax); the screen shows pp in
    // [cam·parallax - vw/2, cam·parallax + vw/2].
    const ox = camX * c.parallax;
    const oy = camY * c.parallax;
    const x0 = Math.floor((ox - vw / 2) / c.cell) - 1;
    const x1 = Math.floor((ox + vw / 2) / c.cell) + 1;
    const y0 = Math.floor((oy - vh / 2) / c.cell) - 1;
    const y1 = Math.floor((oy + vh / 2) / c.cell) + 1;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const wx = ((cx % 32768) + 32768) % 32768;
        const wy = ((cy % 32768) + 32768) % 32768;
        if (hash1(wx, wy, c.salt) > c.density * dens) continue;
        hash2(wx, wy, c.salt + 23, _h);
        const vx = f32(_h[0] - 0.5), vy = f32(_h[1] - 0.5);
        const speed = f32(0.003 + f32(hash1(wx, wy, c.salt + 43) * 0.005));
        hash2(wx, wy, c.salt + 13, _h);
        const fx = f32(_h[0] + f32(f32(vx * t32) * speed));
        const fy = f32(_h[1] + f32(f32(vy * t32) * speed));
        // Star world pixel in pp space (the shader uses the wrapped cell
        // index for the origin too), in f32 like the shader.
        const starX = Math.floor(f32(f32(wx * c.cell) + f32((fx - Math.floor(fx)) * c.cell)));
        const starY = Math.floor(f32(f32(wy * c.cell) + f32((fy - Math.floor(fy)) * c.cell)));
        const [px0, px1] = faixaCoberta(starX, cx32, vw32, W, keep, ox, sx);
        if (px0 < 0) continue;
        const [py0, py1] = faixaCoberta(starY, cy32, vh32, H, keep, oy, sy);
        if (py0 < 0) continue;
        const v = Math.round(255 * c.brilho * (0.35 + 0.65 * hash1(wx, wy, c.salt + 97)));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
      }
    }
  }
  ctx.restore();
}
