import { TIPO_PLANETA } from './planeta';

interface PaletaFonemas {
  onsets: string[];
  vowels: string[];
  codas: string[];
  // 0..1 — chance of a syllable having a closing consonant
  codaChance: number;
  // Allowed syllable counts for a name
  silabasMin: number;
  silabasMax: number;
}

// Soft, flowing — temperate / habitable worlds
const PALETA_COMUM: PaletaFonemas = {
  onsets: ['l', 'm', 'n', 'r', 's', 'v', 'el', 'ly', 'ner', 'sol', 'mae', 'ari'],
  vowels: ['a', 'e', 'i', 'o', 'ae', 'ia', 'ea'],
  codas: ['n', 'l', 'r', 's', 'th'],
  codaChance: 0.45,
  silabasMin: 2,
  silabasMax: 3,
};

// Hard, percussive — rocky / desert worlds
const PALETA_MARTE: PaletaFonemas = {
  onsets: ['k', 't', 'kh', 'sh', 'r', 'z', 'kr', 'tr', 'zar', 'kha', 'tor'],
  vowels: ['a', 'o', 'u', 'ar', 'ur'],
  codas: ['k', 'sh', 'r', 'n', 'th', 'kh'],
  codaChance: 0.7,
  silabasMin: 2,
  silabasMax: 3,
};

// Deep, drawn-out — gas giants
const PALETA_GASOSO: PaletaFonemas = {
  onsets: ['v', 'z', 'th', 'n', 'm', 'vh', 'zo', 'mu', 'thae'],
  vowels: ['o', 'u', 'ae', 'oa', 'ua', 'au'],
  codas: ['n', 'm', 'th', 'r'],
  codaChance: 0.5,
  silabasMin: 2,
  silabasMax: 4,
};

const PALETAS: Record<string, PaletaFonemas> = {
  [TIPO_PLANETA.COMUM]: PALETA_COMUM,
  [TIPO_PLANETA.MARTE]: PALETA_MARTE,
  [TIPO_PLANETA.GASOSO]: PALETA_GASOSO,
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function gerarSilaba(p: PaletaFonemas): string {
  const onset = pick(p.onsets);
  const vowel = pick(p.vowels);
  const coda = Math.random() < p.codaChance ? pick(p.codas) : '';
  return onset + vowel + coda;
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const _nomesUsados = new Set<string>();

export function resetarNomesPlanetas(): void {
  _nomesUsados.clear();
}

export function gerarNomePlaneta(tipoPlaneta: string): string {
  const paleta = PALETAS[tipoPlaneta] ?? PALETA_COMUM;
  const range = paleta.silabasMax - paleta.silabasMin + 1;

  for (let attempt = 0; attempt < 6; attempt++) {
    const silabas = paleta.silabasMin + Math.floor(Math.random() * range);
    let nome = '';
    for (let i = 0; i < silabas; i++) nome += gerarSilaba(paleta);
    nome = capitalizar(nome);
    if (!_nomesUsados.has(nome)) {
      _nomesUsados.add(nome);
      return nome;
    }
  }

  // Collision after retries — append a numeric tag to guarantee uniqueness
  let nome = '';
  const silabas = paleta.silabasMin + Math.floor(Math.random() * range);
  for (let i = 0; i < silabas; i++) nome += gerarSilaba(paleta);
  nome = `${capitalizar(nome)}-${_nomesUsados.size}`;
  _nomesUsados.add(nome);
  return nome;
}
