/**
 * Procedural faction lore generator — gives each AI a small backstory
 * (founding year, homeworld description, ideology, defining moment,
 * motto). Purely cosmetic — shown in tooltips, enriches immersion.
 *
 * Generation is deterministic per (id + archetype) when a seed is
 * provided, and uses archetype-biased word banks so warlords feel
 * violent and traders feel diplomatic.
 */

import type { Arquetipo } from './personalidade-ia';
import type { LoreFaccaoDTO } from './save/dto';

// ─── Word banks per archetype ───────────────────────────────────────

const IDEOLOGIAS: Record<Arquetipo, string[]> = {
  warlord: [
    'cultua a supremacia militar',
    'acredita que a paz é uma ilusão entre guerras',
    'venera o aço e o sangue',
    'busca erguer um império por conquista',
    'jurou esmagar toda resistência',
  ],
  trader: [
    'prospera pelas rotas comerciais',
    'vê cada guerra como desperdício de lucro',
    'conecta estrelas por comércio, não tratados',
    'enriquece negociando entre inimigos',
    'constrói alianças forjadas em ouro',
  ],
  scientist: [
    'persegue segredos cósmicos esquecidos',
    'troca soberania por conhecimento',
    'acredita que a ciência transcende fronteiras',
    'estuda estrelas moribundas em busca de respostas',
    'eleva pesquisadores acima de reis',
  ],
  defender: [
    'protege os fracos com muralhas intransponíveis',
    'jurou nunca iniciar guerra, nunca perder uma',
    'cultua ancestrais caídos em defesa',
    'ergue fortalezas antes de ergue colônias',
    'teme o caos mais que a própria morte',
  ],
  explorer: [
    'busca fronteiras além do mapa',
    'considera cada sistema inexplorado um chamado',
    'cultua o vazio entre estrelas',
    'traça rotas onde outros veem escuridão',
    'acredita que parar é morrer',
  ],
};

const HOMEWORLDS: string[] = [
  'planeta árido orbitando uma anã vermelha',
  'mundo oceânico sob duas luas',
  'lua vulcânica presa em ressonância',
  'gigante gasoso colonizado por estações flutuantes',
  'planeta-cristal de gelo metálico',
  'mundo de savanas infinitas com céus púrpuros',
  'colônia subterrânea escavada num asteroide',
  'planeta-jardim sob um sol duplo',
  'mundo tempestuoso de continentes nômades',
];

const EVENTOS_MARCANTES: Record<Arquetipo, string[]> = {
  warlord: [
    'venceu a Guerra do Véu Negro',
    'pulverizou a frota rebelde em Tauron',
    'tomou doze sistemas em cem dias',
    'jurou vingança após o Cerco de Kyras',
  ],
  trader: [
    'fundou a Grande Rota do Xerasc',
    'negociou o fim da Guerra dos Três Sóis',
    'abriu o primeiro mercado interestelar',
    'sobreviveu ao Colapso do Câmbio',
  ],
  scientist: [
    'decifrou as runas da Esfera de Okhar',
    'cartografou um buraco de minhoca',
    'criou o primeiro IA senciente de sua espécie',
    'provou a existência da matéria espelho',
  ],
  defender: [
    'resistiu ao Assédio de Mil Anos',
    'fundou a Liga das Muralhas',
    'salvou milhões durante a Noite Vermelha',
    'ergue a Cidadela Perpétua',
  ],
  explorer: [
    'atravessou o Cinturão Esquecido',
    'traçou a primeira rota à Borda',
    'descobriu a Nebulosa Silente',
    'pereceu quase toda uma vez nos Vazios',
  ],
};

const CITACOES: Record<Arquetipo, string[]> = {
  warlord: [
    '"Força é a única verdade."',
    '"Quem hesita, cai."',
    '"Nosso sangue molhou esses mundos."',
    '"A paz é o prêmio do vencedor."',
  ],
  trader: [
    '"Toda fronteira é um mercado esperando."',
    '"Ouro fala quando armas calam."',
    '"O preço é sempre negociável."',
    '"Comércio é o único idioma universal."',
  ],
  scientist: [
    '"Saber é sobreviver."',
    '"Cada estrela é uma pergunta."',
    '"A ignorância é um abismo evitável."',
    '"Luz, sempre mais luz."',
  ],
  defender: [
    '"Nosso muro é nossa verdade."',
    '"Cairemos últimos."',
    '"Proteger é o mais alto dever."',
    '"Nunca mais uma Noite Vermelha."',
  ],
  explorer: [
    '"O horizonte nunca dorme."',
    '"Parar é morrer devagar."',
    '"Lá fora, sempre lá fora."',
    '"Mapas são só convites."',
  ],
};

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Generate a lore entry for a faction. Deterministic for a given (id, archetype). */
export function gerarLoreFaccao(id: string, arquetipo: Arquetipo): LoreFaccaoDTO {
  const seed =
    id.split('').reduce((s, c) => s + c.charCodeAt(0), 0) +
    arquetipo.charCodeAt(0) * 37;
  const rng = mulberry32(seed);
  return {
    anoFundacao: -Math.round(500 + rng() * 4500),
    homeworldDescricao: pick(HOMEWORLDS, rng),
    ideologia: pick(IDEOLOGIAS[arquetipo], rng),
    eventoMarcante: pick(EVENTOS_MARCANTES[arquetipo], rng),
    citacao: pick(CITACOES[arquetipo], rng),
  };
}

/** Render lore as a multi-line string for tooltips. */
export function formatarLore(lore: LoreFaccaoDTO): string {
  const anos = Math.abs(lore.anoFundacao);
  return [
    `Fundada há ${anos.toLocaleString('pt-BR')} ciclos estelares em ${lore.homeworldDescricao}.`,
    `${lore.ideologia.charAt(0).toUpperCase()}${lore.ideologia.slice(1)}.`,
    lore.eventoMarcante.charAt(0).toUpperCase() + lore.eventoMarcante.slice(1) + '.',
    lore.citacao,
  ].join('\n');
}
