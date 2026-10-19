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
export function desenharStarfieldCpu(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  camX: number, camY: number, vw: number, vh: number,
  tempo: number, densidade: number,
): void {
  const sx = W / vw;
  const sy = H / vh;
  const dens = Math.max(0, Math.min(2, densidade));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter'; // layers add, like `col + starLayer(...)`
  for (const c of CAMADAS) {
    // pp = worldPos - cam·(1 - parallax); the screen shows pp in
    // [cam·parallax - vw/2, cam·parallax + vw/2].
    const ox = camX * c.parallax;
    const oy = camY * c.parallax;
    const x0 = Math.floor((ox - vw / 2) / c.cell);
    const x1 = Math.floor((ox + vw / 2) / c.cell);
    const y0 = Math.floor((oy - vh / 2) / c.cell);
    const y1 = Math.floor((oy + vh / 2) / c.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const wx = ((cx % 32768) + 32768) % 32768;
        const wy = ((cy % 32768) + 32768) % 32768;
        if (hash1(wx, wy, c.salt) > c.density * dens) continue;
        hash2(wx, wy, c.salt + 23, _h);
        const speed = 0.003 + hash1(wx, wy, c.salt + 43) * 0.005;
        const dx = (_h[0] - 0.5) * tempo * speed;
        const dy = (_h[1] - 0.5) * tempo * speed;
        hash2(wx, wy, c.salt + 13, _h);
        const fx = _h[0] + dx, fy = _h[1] + dy;
        // Star world pixel in pp space (the shader uses the wrapped cell
        // index for the origin too).
        const starX = Math.floor(wx * c.cell + (fx - Math.floor(fx)) * c.cell);
        const starY = Math.floor(wy * c.cell + (fy - Math.floor(fy)) * c.cell);
        // Pixels whose centre maps into [star, star + 1) of pp space.
        const ax = (starX - ox) * sx + W / 2;
        const ay = (starY - oy) * sy + H / 2;
        const px0 = Math.ceil(ax - 0.5), px1 = Math.ceil(ax + sx - 0.5);
        const py0 = Math.ceil(ay - 0.5), py1 = Math.ceil(ay + sy - 0.5);
        if (px1 <= px0 || py1 <= py0 || px1 < 0 || py1 < 0 || px0 > W || py0 > H) continue;
        const v = Math.round(255 * c.brilho * (0.35 + 0.65 * hash1(wx, wy, c.salt + 97)));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
      }
    }
  }
  ctx.restore();
}
