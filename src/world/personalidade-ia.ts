/**
 * Procedural AI personality generation.
 *
 * Each enemy gets a "genome" at world creation — a randomized set of
 * weights that drives every decision the AI makes. Two AIs with the same
 * archetype will play differently because the random component is large.
 *
 * Archetype = base weights. Random rolls = ±25% on each weight + flavor.
 *
 * Difficulty multiplier scales the dangerous parameters (production
 * speed, fleet size, attack frequency) but NOT personality weights — a
 * brutal pacifist defender is still a defender, just better at it.
 */

export type Arquetipo = 'warlord' | 'trader' | 'scientist' | 'defender' | 'explorer';

export interface PersonalidadeIA {
  /** Stable id (used by ia-decisao to track per-AI state). */
  id: string;
  /** Display name — procedurally generated. */
  nome: string;
  /** Faction color (used for trail tint, planet ring, etc). */
  cor: number;
  arquetipo: Arquetipo;

  // Core decision weights — all roughly 0..1.5
  pesos: {
    /** Multiplier for attack action utility. */
    agressao: number;
    /** Multiplier for expansion (colonize neutro) utility. */
    expansao: number;
    /** Multiplier for economy actions (build factory/infra). */
    economia: number;
    /** Multiplier for research utility. */
    ciencia: number;
    /** Multiplier for defensive build (torreta) utility. */
    defesa: number;
    /** How much the AI weights punishing whoever attacked it last. */
    vinganca: number;
  };

  /** Preferred ship type — biases the production mix when no specific need. */
  naveFavorita: 'fragata' | 'torreta' | 'batedora' | 'cargueira';

  /** Min fleet size before the AI considers attacking. Higher = waits longer. */
  frotaMinAtaque: number;

  /** Min ticks before any aggressive action — gives the player breathing room. */
  paciencia: number;

  /** Fleet size cap — AI won't build past this. */
  frotaMax: number;

  /** Difficulty multiplier applied to production rate, fleet size, etc. */
  forca: number;
}

// Procedural name generation via syllable concatenation.
//
// Empire titles are picked from a pool that varies per archetype (a
// warlord is "Império", a trader is "Federação", etc), and the proper
// noun is built from random syllables for true variety.

const TITULOS_POR_ARQUETIPO: Record<Arquetipo, string[]> = {
  warlord:   ['Império', 'Domínio', 'Khanate', 'Horda', 'Legião'],
  trader:    ['Federação', 'Coletivo', 'Sindicato', 'Mercado', 'Aliança'],
  scientist: ['Conclave', 'Academia', 'Concílio', 'Ordem', 'Universidade'],
  defender:  ['Reino', 'Bastião', 'Fortaleza', 'Custódia', 'Sentinela'],
  explorer:  ['Frota', 'Caravana', 'Errantes', 'Nômades', 'Expedição'],
};

// Onset clusters (start of syllable) — mix of soft and hard consonants
const ONSETS = [
  'k', 'kr', 'v', 'vr', 'z', 'zh', 'th', 'x', 'q', 'qu', 'sh',
  'kh', 'dr', 'tr', 'sk', 'st', 'br', 'cl', 'gn', 'm', 'n',
  'r', 'l', 'b', 'd', 'g', 'p', 's', 'mr', 'sr',
];

// Nucleus (vowel patterns)
const VOGAIS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'oa', 'ia', 'yu', 'ar', 'or', 'er', 'ix', 'ax'];

// Coda (end of syllable)
const CODAS = ['', '', '', 'n', 'r', 's', 'x', 'l', 'th', 'sh', 'rk', 'st', 'm', 'k'];

function gerarSilaba(rng: () => number): string {
  return pickRng(ONSETS, rng) + pickRng(VOGAIS, rng) + pickRng(CODAS, rng);
}

function gerarNomeProprio(rng: () => number): string {
  // 1-3 syllables, biased toward 2
  const numSilabas = rng() < 0.15 ? 1 : (rng() < 0.7 ? 2 : 3);
  let nome = '';
  for (let i = 0; i < numSilabas; i++) {
    nome += gerarSilaba(rng);
  }
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function pickRng<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETA_INIMIGO: number[] = [
  0xff5555, // hot red
  0xaa66ff, // purple
  0xffaa44, // orange
  0x55ffaa, // teal
  0xff66cc, // hot pink
  0xffe066, // gold
  0x66bbff, // ice blue
  0x99ee44, // acid green
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function jitter(base: number, frac = 0.25): number {
  return base * (1 + (Math.random() * 2 - 1) * frac);
}

const ARQUETIPOS: Record<Arquetipo, Omit<PersonalidadeIA, 'id' | 'nome' | 'cor' | 'forca'>> = {
  warlord: {
    arquetipo: 'warlord',
    pesos: { agressao: 1.4, expansao: 0.9, economia: 0.7, ciencia: 0.6, defesa: 0.5, vinganca: 1.2 },
    naveFavorita: 'fragata',
    frotaMinAtaque: 4,
    paciencia: 1,
    frotaMax: 30,
  },
  trader: {
    arquetipo: 'trader',
    pesos: { agressao: 0.5, expansao: 1.3, economia: 1.4, ciencia: 0.9, defesa: 0.8, vinganca: 0.6 },
    naveFavorita: 'cargueira',
    frotaMinAtaque: 6,
    paciencia: 4,
    frotaMax: 25,
  },
  scientist: {
    arquetipo: 'scientist',
    pesos: { agressao: 0.6, expansao: 0.9, economia: 0.9, ciencia: 1.6, defesa: 1.0, vinganca: 0.8 },
    naveFavorita: 'fragata',
    frotaMinAtaque: 7,
    paciencia: 5,
    frotaMax: 22,
  },
  defender: {
    arquetipo: 'defender',
    pesos: { agressao: 0.4, expansao: 0.7, economia: 1.1, ciencia: 1.0, defesa: 1.5, vinganca: 1.0 },
    naveFavorita: 'torreta',
    frotaMinAtaque: 8,
    paciencia: 6,
    frotaMax: 28,
  },
  explorer: {
    arquetipo: 'explorer',
    pesos: { agressao: 0.7, expansao: 1.5, economia: 0.8, ciencia: 0.8, defesa: 0.6, vinganca: 0.7 },
    naveFavorita: 'batedora',
    frotaMinAtaque: 5,
    paciencia: 2,
    frotaMax: 26,
  },
};

/**
 * Generate a fresh personality. `forca` is the difficulty multiplier
 * applied to the genome — does NOT change archetype, only intensity.
 *
 * `corForcada` is used by gerarPersonalidades to assign pre-shuffled
 * unique colors when generating a batch.
 */
export function gerarPersonalidade(id: string, forca: number, coresUsadas: Set<number> = new Set(), corForcada?: number): PersonalidadeIA {
  const arquetipo = pick<Arquetipo>(['warlord', 'trader', 'scientist', 'defender', 'explorer']);
  const base = ARQUETIPOS[arquetipo];

  let cor: number;
  if (corForcada !== undefined) {
    cor = corForcada;
  } else {
    // Single-AI path: random pick with retry
    cor = pick(PALETA_INIMIGO);
    let tries = 0;
    while (coresUsadas.has(cor) && tries < 16) {
      cor = pick(PALETA_INIMIGO);
      tries++;
    }
  }
  coresUsadas.add(cor);

  // Use a per-personality seed so the name is stable for a given id
  const seed = id.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + Math.floor(Math.random() * 0xFFFF);
  const rng = makeRng(seed);
  const titulo = pickRng(TITULOS_POR_ARQUETIPO[arquetipo], rng);
  const nomeProprio = gerarNomeProprio(rng);

  return {
    id,
    nome: `${titulo} ${nomeProprio}`,
    cor,
    arquetipo,
    pesos: {
      agressao: jitter(base.pesos.agressao),
      expansao: jitter(base.pesos.expansao),
      economia: jitter(base.pesos.economia),
      ciencia: jitter(base.pesos.ciencia),
      defesa: jitter(base.pesos.defesa),
      vinganca: jitter(base.pesos.vinganca),
    },
    naveFavorita: base.naveFavorita,
    frotaMinAtaque: Math.round(jitter(base.frotaMinAtaque, 0.3)),
    paciencia: Math.round(jitter(base.paciencia, 0.3)),
    frotaMax: Math.round(jitter(base.frotaMax, 0.2)),
    forca,
  };
}

/**
 * Generate N personalities at once with guaranteed unique colors.
 * Shuffles the palette and assigns one color per AI in order, so even
 * when N === PALETA_INIMIGO.length there are no collisions.
 *
 * If N exceeds PALETA_INIMIGO.length, extra AIs get a procedurally
 * generated color (HSL rotation around the wheel).
 */
export function gerarPersonalidades(quantidade: number, forca: number): PersonalidadeIA[] {
  // Shuffle palette
  const paleta = [...PALETA_INIMIGO];
  for (let i = paleta.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [paleta[i], paleta[j]] = [paleta[j], paleta[i]];
  }
  // If we need more colors than the palette, generate extras via HSL
  while (paleta.length < quantidade) {
    const h = Math.floor(Math.random() * 360);
    const s = 70 + Math.random() * 25;
    const l = 60 + Math.random() * 15;
    paleta.push(hslToHex(h, s, l));
  }

  const coresUsadas = new Set<number>();
  const lista: PersonalidadeIA[] = [];
  for (let i = 0; i < quantidade; i++) {
    lista.push(gerarPersonalidade(`inimigo${i + 1}`, forca, coresUsadas, paleta[i]));
  }
  return lista;
}

function hslToHex(h: number, s: number, l: number): number {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Difficulty presets — higher forca = stronger AI. */
export type Dificuldade = 'pacifico' | 'facil' | 'normal' | 'dificil' | 'brutal' | 'infernal';

export interface ConfiguracaoDificuldade {
  /** Number of AI factions to spawn. */
  quantidadeIas: number;
  /** Power multiplier passed to gerarPersonalidade as `forca`. */
  forca: number;
  /** Multiplier for AI tick rate (lower = AI thinks more often). */
  tickMs: number;
  /** Multiplier for starting fleet size. */
  frotaInicial: number;
  /** Starter factories per AI home. */
  fabricasIniciais: number;
}

export const PRESETS_DIFICULDADE: Record<Dificuldade, ConfiguracaoDificuldade> = {
  pacifico: { quantidadeIas: 0, forca: 0,    tickMs: 8000, frotaInicial: 0, fabricasIniciais: 0 },
  facil:    { quantidadeIas: 1, forca: 0.7,  tickMs: 6000, frotaInicial: 1, fabricasIniciais: 1 },
  normal:   { quantidadeIas: 2, forca: 1.0,  tickMs: 4000, frotaInicial: 2, fabricasIniciais: 2 },
  dificil:  { quantidadeIas: 3, forca: 1.4,  tickMs: 3000, frotaInicial: 3, fabricasIniciais: 3 },
  brutal:   { quantidadeIas: 4, forca: 2.0,  tickMs: 2500, frotaInicial: 4, fabricasIniciais: 4 },
  infernal: { quantidadeIas: 8, forca: 2.5,  tickMs: 2000, frotaInicial: 5, fabricasIniciais: 4 },
};
