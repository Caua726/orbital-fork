/**
 * Procedural empire sigils.
 *
 * Composition: frame (outer enclosure) + motif (central symbol) +
 * optional ornament (rim flourish) + optional satellites (small
 * repeated elements orbiting the motif) + optional inner accent.
 *
 * Every parameter — which frame, which motif, whether satellites appear,
 * how many satellites, stroke width — is drawn from a seeded RNG so the
 * same seed always yields the same SVG. All strokes are pure white.
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

function path(d: string, strokeWidth = 2): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke-width', String(strokeWidth));
  return p;
}

function circle(cx: number, cy: number, r: number, strokeWidth = 2): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke-width', String(strokeWidth));
  return c;
}

function dot(cx: number, cy: number, r: number): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  c.setAttribute('fill', '#ffffff');
  c.setAttribute('stroke', 'none');
  return c;
}

// ─── Frames (outer enclosure) ───────────────────────────────────────

type Frame =
  | 'nenhum'
  | 'circulo'
  | 'duplo-circulo'
  | 'hex'
  | 'hex-apontado'
  | 'escudo'
  | 'diamante'
  | 'octogono';

const FRAMES: readonly Frame[] = [
  'nenhum', 'circulo', 'duplo-circulo',
  'hex', 'hex-apontado', 'escudo', 'diamante', 'octogono',
];

/** How much radial room the frame leaves for the motif (percent of 22). */
const FRAME_INNER_RADIUS: Record<Frame, number> = {
  'nenhum': 18,
  'circulo': 14,
  'duplo-circulo': 12,
  'hex': 14,
  'hex-apontado': 14,
  'escudo': 13,
  'diamante': 13,
  'octogono': 14,
};

function addFrame(svg: SVGSVGElement, kind: Frame, strokeWidth: number): void {
  switch (kind) {
    case 'nenhum':
      return;
    case 'circulo':
      svg.appendChild(circle(24, 24, 20, strokeWidth));
      return;
    case 'duplo-circulo':
      svg.appendChild(circle(24, 24, 20, strokeWidth));
      svg.appendChild(circle(24, 24, 17, strokeWidth * 0.7));
      return;
    case 'hex':
    case 'hex-apontado': {
      const pts: string[] = [];
      const rot = kind === 'hex' ? Math.PI / 6 : 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rot;
        pts.push(`${(24 + Math.cos(a) * 20).toFixed(2)} ${(24 + Math.sin(a) * 20).toFixed(2)}`);
      }
      svg.appendChild(path(`M${pts.join(' L')} Z`, strokeWidth));
      return;
    }
    case 'escudo':
      svg.appendChild(path('M24 4 L42 10 L42 24 C42 33 34 42 24 44 C14 42 6 33 6 24 L6 10 Z', strokeWidth));
      return;
    case 'diamante':
      svg.appendChild(path('M24 4 L44 24 L24 44 L4 24 Z', strokeWidth));
      return;
    case 'octogono': {
      const pts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        pts.push(`${(24 + Math.cos(a) * 20).toFixed(2)} ${(24 + Math.sin(a) * 20).toFixed(2)}`);
      }
      svg.appendChild(path(`M${pts.join(' L')} Z`, strokeWidth));
      return;
    }
  }
}

// ─── Motifs (central symbol) ────────────────────────────────────────

type Motif =
  | 'estrela-4'
  | 'estrela-5'
  | 'estrela-6'
  | 'estrela-8'
  | 'cruz'
  | 'cruz-pomada'
  | 'triangulo'
  | 'triangulo-inv'
  | 'triangulos-opostos'
  | 'anel'
  | 'anel-duplo'
  | 'orbe'
  | 'olho'
  | 'atomo'
  | 'engrenagem'
  | 'asa'
  | 'raio'
  | 'seta'
  | 'pontos-triangulo'
  | 'barras-horiz'
  | 'barras-diag'
  | 'chevron'
  | 'circulo-preenchido'
  | 'crescente';

const MOTIFS: readonly Motif[] = [
  'estrela-4', 'estrela-5', 'estrela-6', 'estrela-8',
  'cruz', 'cruz-pomada',
  'triangulo', 'triangulo-inv', 'triangulos-opostos',
  'anel', 'anel-duplo', 'orbe', 'olho',
  'atomo', 'engrenagem', 'asa',
  'raio', 'seta', 'pontos-triangulo',
  'barras-horiz', 'barras-diag', 'chevron',
  'circulo-preenchido', 'crescente',
];

/** Build a motif scaled so its bounding radius is ≤ `r` around (24,24). */
function addMotif(svg: SVGSVGElement, kind: Motif, r: number, strokeWidth: number): void {
  // Helper to make star-shaped polygons at the current radius.
  const starPoly = (points: number, innerRatio: number, rotate = -Math.PI / 2): string => {
    const pts: string[] = [];
    const n = points * 2;
    for (let i = 0; i < n; i++) {
      const a = rotate + (i / n) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * innerRatio;
      pts.push(`${(24 + Math.cos(a) * rr).toFixed(2)} ${(24 + Math.sin(a) * rr).toFixed(2)}`);
    }
    return `M${pts.join(' L')} Z`;
  };

  switch (kind) {
    case 'estrela-4':
      svg.appendChild(path(starPoly(4, 0.42), strokeWidth));
      return;
    case 'estrela-5':
      svg.appendChild(path(starPoly(5, 0.42), strokeWidth));
      return;
    case 'estrela-6':
      svg.appendChild(path(starPoly(6, 0.55), strokeWidth));
      return;
    case 'estrela-8':
      svg.appendChild(path(starPoly(8, 0.48), strokeWidth));
      return;
    case 'cruz':
      svg.appendChild(path(
        `M24 ${24 - r} L24 ${24 + r} M${24 - r} 24 L${24 + r} 24`,
        strokeWidth * 1.2,
      ));
      return;
    case 'cruz-pomada': {
      const a = r * 0.9;
      svg.appendChild(path(
        `M24 ${24 - a} L24 ${24 + a} M${24 - a} 24 L${24 + a} 24`,
        strokeWidth * 1.1,
      ));
      const b = r * 0.18;
      svg.appendChild(circle(24, 24 - a, b, strokeWidth));
      svg.appendChild(circle(24, 24 + a, b, strokeWidth));
      svg.appendChild(circle(24 - a, 24, b, strokeWidth));
      svg.appendChild(circle(24 + a, 24, b, strokeWidth));
      return;
    }
    case 'triangulo':
      svg.appendChild(path(starPoly(3, 1, -Math.PI / 2), strokeWidth));
      return;
    case 'triangulo-inv':
      svg.appendChild(path(starPoly(3, 1, Math.PI / 2), strokeWidth));
      return;
    case 'triangulos-opostos':
      svg.appendChild(path(starPoly(3, 1, -Math.PI / 2), strokeWidth * 0.9));
      svg.appendChild(path(starPoly(3, 1, Math.PI / 2), strokeWidth * 0.9));
      return;
    case 'anel':
      svg.appendChild(circle(24, 24, r * 0.85, strokeWidth));
      return;
    case 'anel-duplo':
      svg.appendChild(circle(24, 24, r * 0.85, strokeWidth));
      svg.appendChild(circle(24, 24, r * 0.45, strokeWidth * 0.8));
      return;
    case 'orbe': {
      const rr = r * 0.85;
      svg.appendChild(circle(24, 24, rr, strokeWidth));
      svg.appendChild(path(
        `M${24 - rr} 24 L${24 + rr} 24 M24 ${24 - rr} Q${24 + rr * 0.6} 24 24 ${24 + rr} M24 ${24 - rr} Q${24 - rr * 0.6} 24 24 ${24 + rr}`,
        strokeWidth * 0.8,
      ));
      return;
    }
    case 'olho': {
      const rr = r * 0.95;
      svg.appendChild(path(
        `M${24 - rr} 24 Q24 ${24 - rr * 0.6} ${24 + rr} 24 Q24 ${24 + rr * 0.6} ${24 - rr} 24 Z`,
        strokeWidth,
      ));
      svg.appendChild(dot(24, 24, r * 0.22));
      return;
    }
    case 'atomo': {
      svg.appendChild(dot(24, 24, r * 0.16));
      for (let i = 0; i < 3; i++) {
        const e = document.createElementNS(SVG_NS, 'ellipse');
        e.setAttribute('cx', '24');
        e.setAttribute('cy', '24');
        e.setAttribute('rx', String(r * 0.9));
        e.setAttribute('ry', String(r * 0.42));
        e.setAttribute('fill', 'none');
        e.setAttribute('stroke-width', String(strokeWidth * 0.8));
        e.setAttribute('transform', `rotate(${i * 60} 24 24)`);
        svg.appendChild(e);
      }
      return;
    }
    case 'engrenagem': {
      const rr = r * 0.75;
      svg.appendChild(circle(24, 24, rr * 0.45, strokeWidth));
      svg.appendChild(circle(24, 24, rr, strokeWidth));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x1 = 24 + Math.cos(a) * rr;
        const y1 = 24 + Math.sin(a) * rr;
        const x2 = 24 + Math.cos(a) * r;
        const y2 = 24 + Math.sin(a) * r;
        svg.appendChild(path(`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`, strokeWidth));
      }
      return;
    }
    case 'asa': {
      const rr = r * 0.95;
      svg.appendChild(path(
        `M24 ${24 - rr * 0.6} Q${24 - rr} ${24 - rr * 0.2} ${24 - rr} ${24 + rr * 0.3}
         Q${24 - rr * 0.4} 24 24 ${24 + rr * 0.1}
         Q${24 + rr * 0.4} 24 ${24 + rr} ${24 + rr * 0.3}
         Q${24 + rr} ${24 - rr * 0.2} 24 ${24 - rr * 0.6} Z`,
        strokeWidth,
      ));
      svg.appendChild(path(`M24 ${24 - rr * 0.6} L24 ${24 + rr}`, strokeWidth * 0.8));
      return;
    }
    case 'raio':
      svg.appendChild(path(
        `M${24 + r * 0.2} ${24 - r} L${24 - r * 0.6} ${24 + r * 0.2}
         L${24 - r * 0.1} ${24 + r * 0.2} L${24 - r * 0.5} ${24 + r}
         L${24 + r * 0.5} ${24 - r * 0.2} L${24} ${24 - r * 0.2}
         L${24 + r * 0.4} ${24 - r} Z`,
        strokeWidth,
      ));
      return;
    case 'seta':
      svg.appendChild(path(
        `M24 ${24 - r} L${24 + r * 0.9} ${24} L${24 + r * 0.35} ${24}
         L${24 + r * 0.35} ${24 + r} L${24 - r * 0.35} ${24 + r}
         L${24 - r * 0.35} ${24} L${24 - r * 0.9} ${24} Z`,
        strokeWidth,
      ));
      return;
    case 'pontos-triangulo': {
      const rr = r * 0.85;
      const a1 = -Math.PI / 2;
      const a2 = a1 + (2 * Math.PI) / 3;
      const a3 = a1 + (4 * Math.PI) / 3;
      const p1 = [24 + Math.cos(a1) * rr, 24 + Math.sin(a1) * rr];
      const p2 = [24 + Math.cos(a2) * rr, 24 + Math.sin(a2) * rr];
      const p3 = [24 + Math.cos(a3) * rr, 24 + Math.sin(a3) * rr];
      svg.appendChild(path(`M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} L${p3[0]} ${p3[1]} Z`, strokeWidth * 0.7));
      svg.appendChild(dot(p1[0], p1[1], r * 0.18));
      svg.appendChild(dot(p2[0], p2[1], r * 0.18));
      svg.appendChild(dot(p3[0], p3[1], r * 0.18));
      return;
    }
    case 'barras-horiz':
      for (let i = 0; i < 3; i++) {
        const y = 24 + (i - 1) * r * 0.5;
        svg.appendChild(path(`M${24 - r * 0.9} ${y.toFixed(2)} L${24 + r * 0.9} ${y.toFixed(2)}`, strokeWidth * 1.2));
      }
      return;
    case 'barras-diag':
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * r * 0.45;
        svg.appendChild(path(`M${(24 - r * 0.9 + o).toFixed(2)} ${(24 + r * 0.9).toFixed(2)} L${(24 + r * 0.9 + o).toFixed(2)} ${(24 - r * 0.9).toFixed(2)}`, strokeWidth * 1.2));
      }
      return;
    case 'chevron': {
      const rr = r * 0.9;
      svg.appendChild(path(
        `M${24 - rr} ${24 + rr * 0.4} L24 ${24 - rr * 0.4} L${24 + rr} ${24 + rr * 0.4} M${24 - rr} ${24 + rr * 0.95} L24 ${24 + rr * 0.15} L${24 + rr} ${24 + rr * 0.95}`,
        strokeWidth,
      ));
      return;
    }
    case 'circulo-preenchido':
      svg.appendChild(dot(24, 24, r * 0.7));
      return;
    case 'crescente': {
      const rr = r * 0.9;
      // Crescent = big circle minus offset smaller circle, approximated
      // with a path. The offset pushes the "bite" to the right.
      svg.appendChild(path(
        `M${24 - rr * 0.3} ${24 - rr} A${rr} ${rr} 0 1 0 ${24 - rr * 0.3} ${24 + rr} A${rr * 0.75} ${rr * 0.9} 0 1 1 ${24 - rr * 0.3} ${24 - rr} Z`,
        strokeWidth,
      ));
      return;
    }
  }
}

// ─── Ornaments (rim flourish) ───────────────────────────────────────

type Ornament = 'nenhum' | 'ticks-4' | 'ticks-8' | 'ticks-12' | 'pontos-4' | 'pontos-8' | 'cantos';
const ORNAMENTS: readonly Ornament[] = [
  'nenhum', 'ticks-4', 'ticks-8', 'ticks-12',
  'pontos-4', 'pontos-8', 'cantos',
];

function addOrnament(svg: SVGSVGElement, kind: Ornament, strokeWidth: number): void {
  switch (kind) {
    case 'nenhum':
      return;
    case 'ticks-4':
    case 'ticks-8':
    case 'ticks-12': {
      const n = kind === 'ticks-4' ? 4 : kind === 'ticks-8' ? 8 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x1 = 24 + Math.cos(a) * 19;
        const y1 = 24 + Math.sin(a) * 19;
        const x2 = 24 + Math.cos(a) * 22;
        const y2 = 24 + Math.sin(a) * 22;
        svg.appendChild(path(`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`, strokeWidth * 0.8));
      }
      return;
    }
    case 'pontos-4':
    case 'pontos-8': {
      const n = kind === 'pontos-4' ? 4 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / n;
        const x = 24 + Math.cos(a) * 21;
        const y = 24 + Math.sin(a) * 21;
        svg.appendChild(dot(x, y, 0.9));
      }
      return;
    }
    case 'cantos': {
      const s = 5;
      const gap = 4;
      const corners = [
        [gap, gap, 1, 1],
        [48 - gap, gap, -1, 1],
        [gap, 48 - gap, 1, -1],
        [48 - gap, 48 - gap, -1, -1],
      ];
      for (const [x, y, dx, dy] of corners) {
        svg.appendChild(path(
          `M${x} ${y + dy * s} L${x} ${y} L${x + dx * s} ${y}`,
          strokeWidth * 0.8,
        ));
      }
      return;
    }
  }
}

// ─── Satellites (small repeated marks at mid radius) ────────────────
//
// Satellites orbit between the motif's edge and the frame's inner edge.
// They're a separate layer so the motif stays the visual anchor.

type Satelite = 'nenhum' | 'dots-3' | 'dots-4' | 'dots-6' | 'arcs-3' | 'arcs-4';
const SATELITES: readonly Satelite[] = [
  'nenhum', 'dots-3', 'dots-4', 'dots-6', 'arcs-3', 'arcs-4',
];

function addSatelites(svg: SVGSVGElement, kind: Satelite, radius: number, strokeWidth: number): void {
  if (kind === 'nenhum') return;
  const n = kind === 'dots-3' || kind === 'arcs-3' ? 3
    : kind === 'dots-4' || kind === 'arcs-4' ? 4
    : 6;
  const isDot = kind.startsWith('dots');
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const cx = 24 + Math.cos(a) * radius;
    const cy = 24 + Math.sin(a) * radius;
    if (isDot) {
      svg.appendChild(dot(cx, cy, 1.1));
    } else {
      // Small arc facing outward.
      const ax1 = 24 + Math.cos(a - 0.25) * radius;
      const ay1 = 24 + Math.sin(a - 0.25) * radius;
      const ax2 = 24 + Math.cos(a + 0.25) * radius;
      const ay2 = 24 + Math.sin(a + 0.25) * radius;
      svg.appendChild(path(`M${ax1.toFixed(2)} ${ay1.toFixed(2)} A${radius} ${radius} 0 0 1 ${ax2.toFixed(2)} ${ay2.toFixed(2)}`, strokeWidth * 0.9));
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export function gerarSigilo(seed: number): SVGSVGElement {
  const rng = makeRng(seed);
  const svg = baseSvg();

  const strokeWidth = 1.6 + rng() * 0.9;
  const frame = pick(rng, FRAMES);
  const motif = pick(rng, MOTIFS);
  const ornament = rng() < 0.55 ? pick(rng, ORNAMENTS) : 'nenhum';

  addFrame(svg, frame, strokeWidth);

  // Frame affects motif size — tighter frames demand smaller motif so
  // they don't collide with the enclosure.
  const motifRadius = FRAME_INNER_RADIUS[frame] * (0.75 + rng() * 0.15);
  addMotif(svg, motif, motifRadius, strokeWidth);

  // Satellites only when there's room (frame present) AND the motif is
  // compact enough — prevents visual crowding.
  const hasSatellites = frame !== 'nenhum' && motifRadius < 15 && rng() < 0.45;
  if (hasSatellites) {
    const sat = pick(rng, SATELITES.filter((s) => s !== 'nenhum'));
    const satRadius = (motifRadius + FRAME_INNER_RADIUS[frame] + 2) / 2 + 2;
    addSatelites(svg, sat, satRadius, strokeWidth);
  }

  addOrnament(svg, ornament, strokeWidth);

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
