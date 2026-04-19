/**
 * Procedural empire sigils.
 *
 * Composition pipeline per seed:
 *   1. Pick a base stroke width (used consistently across all layers).
 *   2. Pick a frame (outer enclosure) — drives the dominant symmetry.
 *   3. Pick a motif (central symbol), biased toward matching symmetry.
 *   4. Optional inner thin ring between motif and frame (25%).
 *   5. Optional satellites (dots/arcs) on that inner ring (35%).
 *   6. Optional rim ornament (ticks/pips/corner brackets) (40%).
 *   7. Optional center accent (tiny dot or ring at 24,24) (30%).
 *
 * Stroke width is constant within a single sigil for visual coherence;
 * some motifs also use fill for weight contrast. All strokes white.
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

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickWeighted<T>(rng: () => number, entries: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// ─── SVG helpers ────────────────────────────────────────────────────

function baseSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#ffffff');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  return svg;
}

function strokedPath(d: string, strokeWidth: number): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke-width', strokeWidth.toFixed(2));
  return p;
}

function filledPath(d: string): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', '#ffffff');
  p.setAttribute('stroke', 'none');
  return p;
}

function strokedCircle(cx: number, cy: number, r: number, strokeWidth: number): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', cx.toFixed(2));
  c.setAttribute('cy', cy.toFixed(2));
  c.setAttribute('r', r.toFixed(2));
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke-width', strokeWidth.toFixed(2));
  return c;
}

function filledCircle(cx: number, cy: number, r: number): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', cx.toFixed(2));
  c.setAttribute('cy', cy.toFixed(2));
  c.setAttribute('r', r.toFixed(2));
  c.setAttribute('fill', '#ffffff');
  c.setAttribute('stroke', 'none');
  return c;
}

// ─── Polygon builder ────────────────────────────────────────────────

function regularPoly(cx: number, cy: number, r: number, sides: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function starPoly(cx: number, cy: number, r: number, rInner: number, points: number, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : rInner;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

// ─── Frames ─────────────────────────────────────────────────────────

type Frame =
  | 'nenhum'
  | 'circulo'
  | 'duplo-circulo'
  | 'hex-pontudo'
  | 'hex-chato'
  | 'escudo'
  | 'diamante'
  | 'octogono'
  | 'quadrado-rot';

/** Symmetry order a motif should harmonize with when drawn inside the
 *  given frame. 0 means "free" / any motif is fine. */
const FRAME_SIMETRIA: Record<Frame, number> = {
  'nenhum': 0,
  'circulo': 0,
  'duplo-circulo': 0,
  'hex-pontudo': 6,
  'hex-chato': 6,
  'escudo': 0,
  'diamante': 4,
  'octogono': 8,
  'quadrado-rot': 4,
};

/** Radial room the motif has inside the frame before colliding. */
const FRAME_INNER: Record<Frame, number> = {
  'nenhum': 19,
  'circulo': 15,
  'duplo-circulo': 13,
  'hex-pontudo': 15,
  'hex-chato': 14,
  'escudo': 13.5,
  'diamante': 13,
  'octogono': 15,
  'quadrado-rot': 13,
};

const FRAMES: readonly Frame[] = [
  'nenhum', 'circulo', 'duplo-circulo',
  'hex-pontudo', 'hex-chato',
  'escudo', 'diamante', 'octogono', 'quadrado-rot',
];

function addFrame(svg: SVGSVGElement, kind: Frame, strokeWidth: number): void {
  switch (kind) {
    case 'nenhum':
      return;
    case 'circulo':
      svg.appendChild(strokedCircle(24, 24, 20, strokeWidth));
      return;
    case 'duplo-circulo':
      svg.appendChild(strokedCircle(24, 24, 20, strokeWidth));
      svg.appendChild(strokedCircle(24, 24, 16.5, strokeWidth * 0.65));
      return;
    case 'hex-pontudo':
      svg.appendChild(strokedPath(regularPoly(24, 24, 20, 6, -Math.PI / 2), strokeWidth));
      return;
    case 'hex-chato':
      svg.appendChild(strokedPath(regularPoly(24, 24, 20, 6, 0), strokeWidth));
      return;
    case 'escudo':
      svg.appendChild(strokedPath(
        'M24 4 L42 10 L42 24 C42 33 34 42 24 44 C14 42 6 33 6 24 L6 10 Z',
        strokeWidth,
      ));
      return;
    case 'diamante':
      svg.appendChild(strokedPath('M24 4 L44 24 L24 44 L4 24 Z', strokeWidth));
      return;
    case 'octogono':
      svg.appendChild(strokedPath(regularPoly(24, 24, 20, 8, Math.PI / 8), strokeWidth));
      return;
    case 'quadrado-rot':
      svg.appendChild(strokedPath(regularPoly(24, 24, 19, 4, Math.PI / 4), strokeWidth));
      return;
  }
}

// ─── Motifs ─────────────────────────────────────────────────────────

type MotifKind =
  // radial, "symmetric N"
  | 'estrela-4' | 'estrela-5' | 'estrela-6' | 'estrela-8'
  | 'estrela-4-cheia' | 'estrela-6-cheia'
  | 'triangulo' | 'triangulo-cheio'
  | 'hexagrama'
  | 'cruz-larga' | 'cruz-pomada'
  | 'anel' | 'anel-duplo' | 'alvo'
  | 'orbe'
  | 'olho'
  | 'atomo'
  | 'engrenagem'
  | 'sol-raiado'
  | 'crescente'
  | 'seta-para-cima'
  | 'asa'
  | 'chevron-triplo'
  | 'disco';

/** Natural symmetry order of each motif (0 = free / no strong order). */
const MOTIF_SIM: Record<MotifKind, number> = {
  'estrela-4': 4, 'estrela-5': 5, 'estrela-6': 6, 'estrela-8': 8,
  'estrela-4-cheia': 4, 'estrela-6-cheia': 6,
  'triangulo': 3, 'triangulo-cheio': 3,
  'hexagrama': 6,
  'cruz-larga': 4, 'cruz-pomada': 4,
  'anel': 0, 'anel-duplo': 0, 'alvo': 0,
  'orbe': 0,
  'olho': 0,
  'atomo': 3,
  'engrenagem': 8,
  'sol-raiado': 8,
  'crescente': 0,
  'seta-para-cima': 0,
  'asa': 0,
  'chevron-triplo': 0,
  'disco': 0,
};

const MOTIFS: readonly MotifKind[] = Object.keys(MOTIF_SIM) as MotifKind[];

function addMotif(svg: SVGSVGElement, kind: MotifKind, r: number, strokeWidth: number): void {
  const cx = 24, cy = 24;
  switch (kind) {
    case 'estrela-4':
      svg.appendChild(strokedPath(starPoly(cx, cy, r, r * 0.42, 4), strokeWidth));
      return;
    case 'estrela-5':
      svg.appendChild(strokedPath(starPoly(cx, cy, r, r * 0.42, 5), strokeWidth));
      return;
    case 'estrela-6':
      svg.appendChild(strokedPath(starPoly(cx, cy, r, r * 0.55, 6), strokeWidth));
      return;
    case 'estrela-8':
      svg.appendChild(strokedPath(starPoly(cx, cy, r, r * 0.48, 8), strokeWidth));
      return;
    case 'estrela-4-cheia':
      svg.appendChild(filledPath(starPoly(cx, cy, r, r * 0.38, 4)));
      return;
    case 'estrela-6-cheia':
      svg.appendChild(filledPath(starPoly(cx, cy, r, r * 0.5, 6)));
      return;
    case 'triangulo':
      svg.appendChild(strokedPath(regularPoly(cx, cy, r, 3, -Math.PI / 2), strokeWidth));
      return;
    case 'triangulo-cheio':
      svg.appendChild(filledPath(regularPoly(cx, cy, r, 3, -Math.PI / 2)));
      return;
    case 'hexagrama':
      svg.appendChild(strokedPath(regularPoly(cx, cy, r, 3, -Math.PI / 2), strokeWidth));
      svg.appendChild(strokedPath(regularPoly(cx, cy, r, 3, Math.PI / 2), strokeWidth));
      return;
    case 'cruz-larga':
      svg.appendChild(strokedPath(
        `M${cx} ${cy - r} L${cx} ${cy + r} M${cx - r} ${cy} L${cx + r} ${cy}`,
        strokeWidth * 1.3,
      ));
      return;
    case 'cruz-pomada': {
      const a = r * 0.92;
      svg.appendChild(strokedPath(
        `M${cx} ${cy - a} L${cx} ${cy + a} M${cx - a} ${cy} L${cx + a} ${cy}`,
        strokeWidth * 1.1,
      ));
      const b = r * 0.18;
      svg.appendChild(filledCircle(cx, cy - a, b));
      svg.appendChild(filledCircle(cx, cy + a, b));
      svg.appendChild(filledCircle(cx - a, cy, b));
      svg.appendChild(filledCircle(cx + a, cy, b));
      return;
    }
    case 'anel':
      svg.appendChild(strokedCircle(cx, cy, r * 0.85, strokeWidth));
      return;
    case 'anel-duplo':
      svg.appendChild(strokedCircle(cx, cy, r * 0.9, strokeWidth));
      svg.appendChild(strokedCircle(cx, cy, r * 0.5, strokeWidth * 0.85));
      return;
    case 'alvo':
      svg.appendChild(strokedCircle(cx, cy, r * 0.9, strokeWidth));
      svg.appendChild(strokedCircle(cx, cy, r * 0.55, strokeWidth * 0.8));
      svg.appendChild(filledCircle(cx, cy, r * 0.2));
      return;
    case 'orbe': {
      const rr = r * 0.85;
      svg.appendChild(strokedCircle(cx, cy, rr, strokeWidth));
      svg.appendChild(strokedPath(
        `M${cx - rr} ${cy} L${cx + rr} ${cy} M${cx} ${cy - rr} Q${cx + rr * 0.6} ${cy} ${cx} ${cy + rr} M${cx} ${cy - rr} Q${cx - rr * 0.6} ${cy} ${cx} ${cy + rr}`,
        strokeWidth * 0.8,
      ));
      return;
    }
    case 'olho': {
      const rr = r * 0.95;
      svg.appendChild(strokedPath(
        `M${cx - rr} ${cy} Q${cx} ${cy - rr * 0.6} ${cx + rr} ${cy} Q${cx} ${cy + rr * 0.6} ${cx - rr} ${cy} Z`,
        strokeWidth,
      ));
      svg.appendChild(filledCircle(cx, cy, r * 0.22));
      return;
    }
    case 'atomo': {
      svg.appendChild(filledCircle(cx, cy, r * 0.16));
      for (let i = 0; i < 3; i++) {
        const e = document.createElementNS(SVG_NS, 'ellipse');
        e.setAttribute('cx', cx.toFixed(2));
        e.setAttribute('cy', cy.toFixed(2));
        e.setAttribute('rx', (r * 0.9).toFixed(2));
        e.setAttribute('ry', (r * 0.4).toFixed(2));
        e.setAttribute('fill', 'none');
        e.setAttribute('stroke-width', (strokeWidth * 0.85).toFixed(2));
        e.setAttribute('transform', `rotate(${i * 60} ${cx} ${cy})`);
        svg.appendChild(e);
      }
      return;
    }
    case 'engrenagem': {
      const teeth = 8;
      const rInner = r * 0.7;
      const rOuter = r;
      const rHub = r * 0.28;
      const notchHalf = Math.PI / teeth * 0.45;
      const pts: string[] = [];
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2 - notchHalf;
        const a1 = (i / teeth) * Math.PI * 2 + notchHalf;
        const a2 = ((i + 1) / teeth) * Math.PI * 2 - notchHalf;
        pts.push(`${(cx + Math.cos(a0) * rOuter).toFixed(2)} ${(cy + Math.sin(a0) * rOuter).toFixed(2)}`);
        pts.push(`${(cx + Math.cos(a1) * rOuter).toFixed(2)} ${(cy + Math.sin(a1) * rOuter).toFixed(2)}`);
        pts.push(`${(cx + Math.cos(a2) * rInner).toFixed(2)} ${(cy + Math.sin(a2) * rInner).toFixed(2)}`);
      }
      svg.appendChild(strokedPath(`M${pts.join(' L')} Z`, strokeWidth));
      svg.appendChild(strokedCircle(cx, cy, rHub, strokeWidth * 0.9));
      return;
    }
    case 'sol-raiado': {
      const rays = 12;
      svg.appendChild(strokedCircle(cx, cy, r * 0.45, strokeWidth));
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const x1 = cx + Math.cos(a) * r * 0.6;
        const y1 = cy + Math.sin(a) * r * 0.6;
        const x2 = cx + Math.cos(a) * r * (i % 2 === 0 ? 1 : 0.85);
        const y2 = cy + Math.sin(a) * r * (i % 2 === 0 ? 1 : 0.85);
        svg.appendChild(strokedPath(`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`, strokeWidth * 0.9));
      }
      return;
    }
    case 'crescente': {
      const rr = r * 0.92;
      // Outer circle minus inner offset circle via path.
      svg.appendChild(filledPath(
        `M${cx - rr * 0.2} ${cy - rr}
         A${rr} ${rr} 0 1 0 ${cx - rr * 0.2} ${cy + rr}
         A${rr * 0.78} ${rr * 0.92} 0 1 1 ${cx - rr * 0.2} ${cy - rr} Z`,
      ));
      return;
    }
    case 'seta-para-cima': {
      const rr = r * 0.95;
      svg.appendChild(filledPath(
        `M${cx} ${cy - rr}
         L${cx + rr * 0.85} ${cy - rr * 0.1}
         L${cx + rr * 0.38} ${cy - rr * 0.1}
         L${cx + rr * 0.38} ${cy + rr * 0.9}
         L${cx - rr * 0.38} ${cy + rr * 0.9}
         L${cx - rr * 0.38} ${cy - rr * 0.1}
         L${cx - rr * 0.85} ${cy - rr * 0.1} Z`,
      ));
      return;
    }
    case 'asa': {
      const rr = r * 0.95;
      svg.appendChild(strokedPath(
        `M${cx} ${cy - rr * 0.55} Q${cx - rr * 1.05} ${cy - rr * 0.2} ${cx - rr * 0.95} ${cy + rr * 0.3}
         Q${cx - rr * 0.45} ${cy - rr * 0.05} ${cx} ${cy + rr * 0.15}
         Q${cx + rr * 0.45} ${cy - rr * 0.05} ${cx + rr * 0.95} ${cy + rr * 0.3}
         Q${cx + rr * 1.05} ${cy - rr * 0.2} ${cx} ${cy - rr * 0.55} Z`,
        strokeWidth,
      ));
      svg.appendChild(strokedPath(`M${cx} ${cy - rr * 0.55} L${cx} ${cy + rr}`, strokeWidth * 0.85));
      return;
    }
    case 'chevron-triplo': {
      const rr = r * 0.9;
      for (let i = 0; i < 3; i++) {
        const y = cy - rr * 0.65 + i * rr * 0.55;
        svg.appendChild(strokedPath(
          `M${cx - rr} ${y + rr * 0.35} L${cx} ${y - rr * 0.15} L${cx + rr} ${y + rr * 0.35}`,
          strokeWidth,
        ));
      }
      return;
    }
    case 'disco':
      svg.appendChild(filledCircle(cx, cy, r * 0.72));
      return;
  }
}

// ─── Ornaments ──────────────────────────────────────────────────────

type Ornament = 'nenhum' | 'ticks-4' | 'ticks-6' | 'ticks-8' | 'ticks-12' | 'pontos-6' | 'pontos-8' | 'cantos';
const ORNAMENTS: readonly Ornament[] = [
  'nenhum', 'ticks-4', 'ticks-6', 'ticks-8', 'ticks-12', 'pontos-6', 'pontos-8', 'cantos',
];

function addOrnament(svg: SVGSVGElement, kind: Ornament, strokeWidth: number): void {
  const cx = 24, cy = 24;
  switch (kind) {
    case 'nenhum':
      return;
    case 'ticks-4':
    case 'ticks-6':
    case 'ticks-8':
    case 'ticks-12': {
      const n = kind === 'ticks-4' ? 4 : kind === 'ticks-6' ? 6 : kind === 'ticks-8' ? 8 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x1 = cx + Math.cos(a) * 19.2;
        const y1 = cy + Math.sin(a) * 19.2;
        const x2 = cx + Math.cos(a) * 22;
        const y2 = cy + Math.sin(a) * 22;
        svg.appendChild(strokedPath(`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`, strokeWidth * 0.8));
      }
      return;
    }
    case 'pontos-6':
    case 'pontos-8': {
      const n = kind === 'pontos-6' ? 6 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / n;
        svg.appendChild(filledCircle(cx + Math.cos(a) * 21, cy + Math.sin(a) * 21, 0.9));
      }
      return;
    }
    case 'cantos': {
      const s = 5;
      const gap = 4;
      const corners: Array<[number, number, number, number]> = [
        [gap, gap, 1, 1],
        [48 - gap, gap, -1, 1],
        [gap, 48 - gap, 1, -1],
        [48 - gap, 48 - gap, -1, -1],
      ];
      for (const [x, y, dx, dy] of corners) {
        svg.appendChild(strokedPath(
          `M${x} ${y + dy * s} L${x} ${y} L${x + dx * s} ${y}`,
          strokeWidth * 0.8,
        ));
      }
      return;
    }
  }
}

// ─── Satellites ─────────────────────────────────────────────────────

function addSatellites(svg: SVGSVGElement, count: number, radius: number): void {
  const cx = 24, cy = 24;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    svg.appendChild(filledCircle(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 1.1));
  }
}

// ─── Composition ────────────────────────────────────────────────────

/**
 * Prefer motifs whose natural symmetry matches the frame. Same-symmetry
 * pairings (hex frame + 6-star motif, diamond + 4-point cross, octagon
 * + 8-star) read as intentional design; clashing pairings still occur
 * occasionally so each seed isn't overly formulaic.
 */
function pickMotifFor(rng: () => number, frameSim: number): MotifKind {
  const weights: Array<readonly [MotifKind, number]> = MOTIFS.map((m) => {
    const s = MOTIF_SIM[m];
    let w = 1;
    if (frameSim === 0 || s === 0) w = 1;                // free pairing
    else if (s === frameSim) w = 5;                       // strong match
    else if (s === frameSim * 2 || s * 2 === frameSim) w = 3;  // harmonic
    else w = 0.35;                                        // clash — rare
    return [m, w] as const;
  });
  return pickWeighted(rng, weights);
}

// ─── Public API ─────────────────────────────────────────────────────

export function gerarSigilo(seed: number): SVGSVGElement {
  const rng = makeRng(seed);
  const svg = baseSvg();

  // One stroke width for the whole sigil — eliminates the "mixed weight"
  // look that made some old outputs feel unpolished.
  const strokeWidth = 1.8 + rng() * 0.6;   // 1.8..2.4

  const frame = pick(rng, FRAMES);
  addFrame(svg, frame, strokeWidth);

  const motif = pickMotifFor(rng, FRAME_SIMETRIA[frame]);
  const motifR = FRAME_INNER[frame] * (0.72 + rng() * 0.12);
  addMotif(svg, motif, motifR, strokeWidth);

  // Thin inner accent ring between motif and frame — only if there's
  // space AND a frame to be between with. 25%.
  const hasInnerRing = frame !== 'nenhum' && motifR < FRAME_INNER[frame] - 3 && rng() < 0.25;
  let innerRingR = 0;
  if (hasInnerRing) {
    innerRingR = (motifR + FRAME_INNER[frame]) / 2;
    svg.appendChild(strokedCircle(24, 24, innerRingR, strokeWidth * 0.55));
  }

  // Satellites on the inner ring (or midway if no ring) — 35%. Count
  // matches frame symmetry where possible.
  if (frame !== 'nenhum' && motifR < FRAME_INNER[frame] - 2 && rng() < 0.35) {
    const satR = innerRingR || (motifR + FRAME_INNER[frame]) / 2;
    const sym = FRAME_SIMETRIA[frame];
    const count = sym === 0 ? pick(rng, [4, 6, 8]) : sym;
    addSatellites(svg, count, satR);
  }

  // Rim ornament — 40%.
  if (rng() < 0.4) {
    addOrnament(svg, pick(rng, ORNAMENTS.filter((o) => o !== 'nenhum')), strokeWidth);
  }

  // Tiny center accent on top of motif (only on motifs that don't already
  // own the center) — 30%.
  const centerBusy: readonly MotifKind[] = [
    'atomo', 'olho', 'orbe', 'alvo', 'anel-duplo',
    'disco', 'crescente', 'estrela-4-cheia', 'estrela-6-cheia',
    'triangulo-cheio', 'sol-raiado',
  ];
  if (!centerBusy.includes(motif) && rng() < 0.3) {
    if (rng() < 0.5) svg.appendChild(filledCircle(24, 24, 1.2));
    else svg.appendChild(strokedCircle(24, 24, 2, strokeWidth * 0.8));
  }

  return svg;
}

export function seedVariacoes(base: number, quantidade = 8): number[] {
  const out: number[] = [];
  for (let i = 0; i < quantidade; i++) out.push((base + i) | 0);
  return out;
}

export function novaSeed(): number {
  return (Math.floor(Math.random() * 0xFFFFFFFF)) | 0;
}
