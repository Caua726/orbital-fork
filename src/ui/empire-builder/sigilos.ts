/**
 * Fully procedural empire sigils.
 *
 * There are no named shapes, frames or motifs — every logo is a stack
 * of closed polar curves:
 *
 *    r(θ) = base + Σᵢ Aᵢ·cos(kᵢ·θ + φᵢ)
 *
 * Harmonic coefficients (frequencies kᵢ, amplitudes Aᵢ, phases φᵢ) and
 * the number of layers are all drawn from a seeded RNG. The result is
 * rendered as one or more SVG <path> elements with dense point
 * sampling so the silhouette stays smooth.
 *
 * Strokes are pure white — the logo is monochromatic.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// ─── Seeded RNG (Mulberry32) ────────────────────────────────────────

function makeRng(seed: number): () => number {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── SVG base ───────────────────────────────────────────────────────

function baseSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#ffffff');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  return svg;
}

// ─── Harmonic closed curve ──────────────────────────────────────────

interface Harmonic {
  k: number;      // angular frequency (integer → exact period closure)
  amp: number;    // amplitude relative to base radius
  phase: number;  // radians
}

function buildLayer(rng: () => number, options: {
  baseRadius: number;
  strokeWidth: number;
}): SVGPathElement {
  // 2–5 harmonics; keeping k integer guarantees r(0) = r(2π) → closed.
  const nHarmonics = 2 + Math.floor(rng() * 4);
  const harmonics: Harmonic[] = [];
  for (let i = 0; i < nHarmonics; i++) {
    // Low-k harmonics give broad lobes; high-k gives spiky rhythm.
    // Cap at 12 so the path doesn't alias against the 360-sample grid.
    const k = 2 + Math.floor(rng() * 10);
    // Dampen successive harmonics so the fundamental stays dominant
    // and we don't produce noisy self-intersecting curves.
    const amp = (0.15 + rng() * 0.35) / Math.pow(i + 1, 0.85);
    const phase = rng() * Math.PI * 2;
    harmonics.push({ k, amp, phase });
  }

  const SAMPLES = 360;
  const pts: string[] = [];
  for (let s = 0; s <= SAMPLES; s++) {
    const theta = (s / SAMPLES) * Math.PI * 2;
    let r = 1;
    for (const h of harmonics) r += h.amp * Math.cos(h.k * theta + h.phase);
    // Clamp to avoid pathological inversions when multiple negative
    // peaks stack up.
    r = Math.max(0.15, r);
    r *= options.baseRadius;
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  const d = 'M' + pts.join(' L') + ' Z';
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', options.strokeWidth.toFixed(2));
  return path;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Render a sigil from a seed. Every logo is one or more stacked
 * harmonic curves — no primitive catalog, just math with seeded
 * coefficients.
 */
export function gerarSigilo(seed: number): SVGSVGElement {
  const rng = makeRng(seed);
  const svg = baseSvg();

  // 1–3 concentric layers, shrinking inward. Each layer independent
  // harmonics → they visually pulse against each other.
  const nLayers = 1 + Math.floor(rng() * 3);
  // Outermost layer never touches the viewBox edge (100/2 = 50), leave
  // ~8u margin for the thickest strokes to stay on canvas.
  const outer = 42;

  for (let i = 0; i < nLayers; i++) {
    const t = nLayers === 1 ? 1 : 1 - i / (nLayers * 1.4);
    const baseRadius = outer * t;
    const strokeWidth = 1.4 + rng() * 1.4;
    svg.appendChild(buildLayer(rng, { baseRadius, strokeWidth }));
  }

  return svg;
}

/** Gallery helper: N incremented seeds starting at `base`. */
export function seedVariacoes(base: number, quantidade = 8): number[] {
  const out: number[] = [];
  for (let i = 0; i < quantidade; i++) out.push((base + i) | 0);
  return out;
}

export function novaSeed(): number {
  return (Math.floor(Math.random() * 0xFFFFFFFF)) | 0;
}
