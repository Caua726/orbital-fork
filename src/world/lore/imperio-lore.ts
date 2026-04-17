/**
 * Procedural empire biography — narrative prose driven by the full
 * personality genome.
 *
 * Output is structured (sections with titles + paragraphs) so UI layers
 * can render it as real HTML with proper typography, not ASCII dividers.
 * Each section is 1-3 flowing paragraphs that weave bank entries
 * together with connective tissue, specific dates, and recurring
 * character references — not bullet lists.
 *
 * Every weight/trait on PersonalidadeIA influences the prose:
 *   - pesos.* → which conditional paragraphs fire, which adjectives used
 *   - naveFavorita → cited in military doctrine by name
 *   - paciencia → strike-first vs wait-generations tone
 *   - frotaMax / frotaMinAtaque → fleet composition language
 *   - forca → scale of triumphs referenced
 *
 * Determinism: output is pure function of (empireId, galaxySeed,
 * personalidade). Same inputs → identical biography every call.
 */

import type { Arquetipo, PersonalidadeIA } from '../personalidade-ia';
import { rngFor, pickRng, pickManyRng, intRng, capitalize } from './seeded-rng';
import { TRATAMENTOS_LIDERES } from './banks';

// ─── Public types ────────────────────────────────────────────────────

export interface PerfilEstrategico {
  agressao: 'baixa' | 'moderada' | 'alta' | 'extrema';
  expansao: 'contida' | 'regular' | 'agressiva';
  economia: 'austera' | 'equilibrada' | 'próspera';
  ciencia: 'tradicional' | 'curiosa' | 'erudita';
  defesa: 'exposta' | 'atenta' | 'inexpugnável';
  vinganca: 'esquecida' | 'vigilante' | 'implacável';
}

export interface SecaoLore {
  titulo: string;
  paragrafos: string[];
  /** Optional pullquote rendered below the section. */
  citacao?: string;
}

export interface ImperioLore {
  /** Empire name, rendered as main title. */
  titulo: string;
  /** One-line characterization. */
  subtitulo: string;
  /** Strategic profile — rendered as badge row. */
  perfil: PerfilEstrategico;
  /** Narrative body — ordered sections with prose paragraphs. */
  secoes: SecaoLore[];
  /** Sayings rendered at the end. */
  proverbios: string[];
}

export interface ImperioLoreContexto {
  empireId: string;
  galaxySeed: number;
  nomeImperio: string;
  personalidade: PersonalidadeIA;
  anoFundacao?: number;
}

// ─── Name banks for individuals ──────────────────────────────────────

const PREFIXOS_NOMES: readonly string[] = [
  'Ael', 'Vyr', 'Kyr', 'Mael', 'Thaed', 'Zor', 'Oren', 'Sael',
  'Kar', 'Dael', 'Ixen', 'Mor', 'Sy', 'Hael', 'Voth', 'Nyra', 'Kha',
];
const SUFIXOS_NOMES: readonly string[] = [
  'ith', 'ar', 'en', 'os', 'yan', 'eth', 'us', 'arn', 'ix',
  'oren', 'aen', 'ior', 'un', 'ax', 'orr', 'is', 'al',
];
const SOBRENOMES: readonly string[] = [
  'Vyn', 'Kaeros', 'Okhar', 'Velis', 'Thaed', 'Ryx', 'Solenn',
  'Morrath', 'Ixen', 'Kyr', 'Aerien', 'Volkyr', 'Thrae', 'Astor', 'Mirien',
];

function gerarNomePessoa(rng: () => number): string {
  return `${capitalize(pickRng(PREFIXOS_NOMES, rng) + pickRng(SUFIXOS_NOMES, rng))} ${pickRng(SOBRENOMES, rng)}`;
}

// ─── Archetype-specific storytelling beats ───────────────────────────

const BERCO_POR_ARQUETIPO: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'em meio ao colapso de uma antiga confederação militar',
    'após a Grande Traição, quando sete clãs renegaram seus juramentos',
    'no rastro de uma campanha fracassada que deixou metade do sistema em ruínas',
    'durante os últimos anos do regime civil, que já era mais lembrança que autoridade',
  ],
  trader: [
    'em meio à prosperidade instável que seguiu uma década de pirataria endêmica',
    'quando seis guildas mercantes decidiram que era mais barato fundar uma nação que pagar tributos',
    'após a descoberta de uma rota direta entre dois sistemas anteriormente inacessíveis',
    'no período em que a antiga moeda imperial perdeu todo seu valor',
  ],
  scientist: [
    'no rescaldo da destruição da Academia Antiga, quando os sobreviventes se recusaram a dispersar',
    'após a descoberta de ruínas pré-humanas cujos textos começaram a ser decifrados',
    'quando uma consciência artificial herdada dos Primeiros despertou e reivindicou autoria',
    'durante o Grande Silêncio, quando apenas os cientistas ainda trabalhavam enquanto tudo calava',
  ],
  defender: [
    'no ano em que a Noite Vermelha quase extinguiu a civilização local',
    'depois que duas cidades cercadas juraram jamais separar suas milícias novamente',
    'em torno de um santuário ameaçado por invasões recorrentes',
    'após o fracasso catastrófico das garantias de proteção anteriormente oferecidas por potências maiores',
  ],
  explorer: [
    'quando uma frota de exploração jamais retornou ao mundo-natal e resolveu fundar o seu próprio',
    'em meio à descoberta de um corredor de rotas até então mapeado como intransitável',
    'após gerações vivendo em naves sem nunca fixarem capital',
    'no período em que a irmandade dos cartógrafos emancipou-se da coroa que os empregava',
  ],
};

const CONQUISTA_FUNDACIONAL: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'unificou doze bandeiras dispersas sob um único estandarte',
    'tomou a Cidadela Antiga em uma única investida de vinte dias',
    'impôs sua doutrina sobre quatro gerações de oposição',
    'reconstruiu a tradição militar sobre as ruínas da anterior',
  ],
  trader: [
    'estabeleceu a primeira rota comercial trans-sistemas documentada da era',
    'negociou a paz entre três facções rivais em uma semana de audiências',
    'acumulou riqueza suficiente para comprar a neutralidade vitalícia',
    'redigiu a Carta Mercantil que ainda hoje rege os contratos do império',
  ],
  scientist: [
    'publicou os Tratados Fundamentais que reescreveram sete disciplinas',
    'decifrou a primeira inscrição pré-humana há gerações considerada intraduzível',
    'construiu a Biblioteca Central, que nunca esteve vazia desde então',
    'provou uma hipótese que antes era considerada herética',
  ],
  defender: [
    'ergueu a Primeira Muralha, que resiste intocada há gerações',
    'repeliu três invasões em sequência sem perder uma única cidade',
    'redigiu o Código do Protetor, ainda hoje jurado por todos os guardiões',
    'fundou a Vigília Eterna, que mantém sentinela desde então',
  ],
  explorer: [
    'mapeou quinze sistemas que ninguém havia ousado atravessar',
    'estabeleceu a primeira rota conhecida através do Cinturão Escuro',
    'contactou três povos independentes sem disparar uma única arma',
    'fundou a Guilda dos Ventos Abertos, que ainda envia expedições trimestrais',
  ],
};

const DOUTRINA_MILITAR_NARRATIVA: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'O treino militar começa cedo: crianças acompanham oficiais em operações até entenderem que a violência organizada é linguagem nativa.',
    'A hierarquia militar permeia a vida civil — mesmo contratos privados seguem protocolos inspirados em ordens de marcha.',
    'Não há distinção formal entre soldado e cidadão: todos os adultos juram defesa, e muitos cumprem ativamente.',
  ],
  trader: [
    'As frotas mercantes são convertíveis em escolta em questão de horas. Todo capitão é também negociador — e, quando necessário, artilheiro.',
    'A doutrina prefere coalizões ad-hoc a armadas permanentes: mais barato, mais flexível, mais repleto de incentivos alinhados.',
    'Guerras são compradas tanto quanto lutadas — corretores de conflito operam legalmente ao lado dos comandantes.',
  ],
  scientist: [
    'O compromisso militar subordina-se à preservação do conhecimento: evacuam-se arquivos antes de tropas.',
    'A doutrina se apoia em superioridade tecnológica — drones, sensores, armas experimentais — compensando sempre a inferioridade numérica.',
    'Cientistas viajam com frotas de combate. Cada engajamento é também experimento registrado.',
  ],
  defender: [
    'A fortaleza é a unidade básica de planejamento: cada sistema é projetado para sobreviver isolado durante anos.',
    'Nenhum protetor jamais é transferido do posto sem consentimento explícito do Santuário original.',
    'A postura é invariavelmente reativa — o ataque preventivo é considerado herético, não apenas tática ruim.',
  ],
  explorer: [
    'A frota é organizada em células autônomas. Uma perdida não compromete as demais, e cada uma pode operar sem contato central.',
    'O combate é sempre evasivo: velocidade e dispersão primeiro, confronto direto apenas como último recurso.',
    'Cada capitão carrega a autoridade para declarar retirada ou pacto — centralização é considerada fragilidade.',
  ],
};

const CULTURA_NARRATIVA: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'A arte oficial celebra batalhas. Monumentos de guerra ocupam praças centrais; crianças aprendem os nomes das campanhas antes de aprenderem os dos poetas.',
    'A língua é dura, enxuta, modelada na gíria militar — onde outros povos gastam uma frase, eles gastam uma palavra.',
    'Tatuagens rituais registram feitos combativos. Ver alguém sem marcas na pele é, para muitos, sinal de vergonha silenciosa.',
  ],
  trader: [
    'Tapeçarias imensas narram rotas históricas, com cada curva do tecido representando uma travessia notável. Famílias guardam versões em miniatura como patrimônio.',
    'A língua adota empréstimos liberalmente: cada rota traz novos termos, e o vocabulário mercantil é consultado como outros povos consultam dicionários sagrados.',
    'Contratos são escritos com caligrafia ornamental. Quebrar um contrato é quebrar um objeto artístico — agravante cultural, não apenas legal.',
  ],
  scientist: [
    'A arte favorece o minimalismo: escultura de vidro que reage à luz, teatro mudo com gestos sincronizados, arquitetura fractal.',
    'O idioma foi refinado por gerações para evitar ambiguidade — conta mais de mil termos apenas para estados mentais.',
    'Bibliotecas são as construções mais ornamentadas da capital. Alguns dizem que a verdadeira moeda do império é o acesso aos arquivos.',
  ],
  defender: [
    'Hinos corais marcam cada cerimônia cívica. Toda criança aprende pelo menos três antes de completar dez anos.',
    'A língua antiga é preservada deliberadamente — falar a versão clássica é sinal de erudição e compromisso com as raízes.',
    'Fortalezas funcionam como galerias: cada muralha expõe em seus muros a história dos cercos que resistiu.',
  ],
  explorer: [
    'Mapas são arte sagrada. Copistas passam vidas aperfeiçoando a representação de uma única constelação.',
    'A língua evolui rapidamente, absorvendo gírias de cada povo contatado. Dialetos variam tanto entre tripulações que intérpretes ganham respeito oficial.',
    'Relicários em cada cidade guardam objetos de sistemas visitados. Um grão de areia distante pode valer mais que ouro do próprio planeta.',
  ],
};

// Weighted paragraphs — fire when specific pesos are extreme.
const PARAGRAFO_AGRESSAO_ALTA = [
  'O aparato de guerra não é contingência, é identidade: mais da metade do produto interno cívico flui pra frotas, muralhas e treino militar.',
  'A cultura recusa distinção entre "tempo de paz" e "tempo de guerra" — sempre há uma campanha, sempre houve.',
];
const PARAGRAFO_VINGANCA_ALTA = [
  'Os arquivos centrais mantêm códices dedicados a cada inimigo histórico. Descendentes de agressores permanecem vigiados mesmo séculos depois.',
  'Uma dívida de sangue não prescreve. Nomes de traidores são transmitidos verbalmente de geração em geração, mesmo quando todos os registros oficiais foram apagados.',
];
const PARAGRAFO_CIENCIA_ALTA = [
  'Cientistas aposentados recebem cerimônia equivalente a funeral de herói. Seus cadernos são preservados em câmaras climatizadas, intocadas por séculos.',
  'Questionar uma descoberta estabelecida não é insulto — é virtude. Professores perdem prestígio se nunca tiveram um aluno que os refutasse publicamente.',
];
const PARAGRAFO_DEFESA_ALTA = [
  'Mesmo casas ordinárias têm bunkers. A desconfiança não é neurose: é tradição ensinada como virtude cívica.',
  'Alarmes de emergência são testados diariamente em toda capital. Turistas frequentemente se assustam; locais sequer param de conversar.',
];
const PARAGRAFO_EXPANSAO_ALTA = [
  'Mapas oficiais marcam em vermelho os sistemas "ainda não reivindicados" — o vocabulário é deliberado, uma expansão contínua é lei de fato.',
  'Cada nova bandeira hasteada em sistema recém-colonizado é feriado nacional por sete dias. A cultura é de progressão permanente.',
];
const PARAGRAFO_ECONOMIA_ALTA = [
  'Listas públicas dos maiores contribuintes econômicos são lidas em voz alta anualmente. Riqueza é virtude cívica explícita.',
  'Contratos centenários são guardados em relicários. Bibliotecas tratam acordos mercantis como outros povos tratam escrituras sagradas.',
];

const PARAGRAFO_PESOS_ALTOS: Record<string, string[]> = {
  agressao: PARAGRAFO_AGRESSAO_ALTA,
  vinganca: PARAGRAFO_VINGANCA_ALTA,
  ciencia: PARAGRAFO_CIENCIA_ALTA,
  defesa: PARAGRAFO_DEFESA_ALTA,
  expansao: PARAGRAFO_EXPANSAO_ALTA,
  economia: PARAGRAFO_ECONOMIA_ALTA,
};

const PARAGRAFO_AGRESSAO_BAIXA = 'Militantes que pregam guerra pré-emptiva são marginalizados socialmente. A preferência cultural é o recuo sobre o confronto, mesmo quando tal postura é mal interpretada por rivais.';
const PARAGRAFO_VINGANCA_BAIXA = 'Perdoar é virtude explícita, amparada por doutrina de Estado. Anistias amplas após cada conflito interno são tradição — virar a página é tratado como dever.';
const PARAGRAFO_CIENCIA_BAIXA = 'O ceticismo contra "novidades técnicas" é profundo. Muitos preferem métodos testados por séculos, mesmo quando alternativas claramente superiores já circulam nas facções vizinhas.';
const PARAGRAFO_DEFESA_BAIXA = 'A sociedade minimiza fortificações deliberadamente. A doutrina prefere mobilidade, dispersão e velocidade de reação — muralhas, dizem seus estrategistas, atraem os predadores.';
const PARAGRAFO_EXPANSAO_BAIXA = 'A doutrina oficial prega consolidação profunda antes de qualquer nova expansão. Novas anexações exigem debate público prolongado e sofrem oposição instintiva.';
const PARAGRAFO_ECONOMIA_BAIXA = 'Ostentação econômica é considerada vulgar. Mesmo ricos se esforçam pra passar despercebidos em público; o recato material é virtude cultural.';

// Exported so generation can splice low-weight paragraphs when needed.
export const PARAGRAFO_PESOS_BAIXOS: Record<string, string> = {
  agressao: PARAGRAFO_AGRESSAO_BAIXA,
  vinganca: PARAGRAFO_VINGANCA_BAIXA,
  ciencia: PARAGRAFO_CIENCIA_BAIXA,
  defesa: PARAGRAFO_DEFESA_BAIXA,
  expansao: PARAGRAFO_EXPANSAO_BAIXA,
  economia: PARAGRAFO_ECONOMIA_BAIXA,
};

const CITACOES_BASE: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'Força é a única verdade.',
    'Nosso sangue molhou esses mundos.',
    'Quem hesita, cai.',
    'A paz é o prêmio do vencedor.',
    'A honra pesa mais que o aço, mas ambos são necessários.',
  ],
  trader: [
    'Toda fronteira é um mercado esperando.',
    'Ouro fala quando armas calam.',
    'O preço é sempre negociável — a palavra dada, não.',
    'Riqueza é um idioma universal.',
    'Uma guerra é apenas um contrato mal negociado.',
  ],
  scientist: [
    'Saber é sobreviver.',
    'Cada estrela é uma pergunta.',
    'A ignorância é um abismo evitável.',
    'Luz, sempre mais luz.',
    'Toda descoberta reescreve o passado.',
  ],
  defender: [
    'Nosso muro é nossa verdade.',
    'Cairemos últimos.',
    'Proteger é o mais alto dever.',
    'Um escudo vale mais que cem espadas.',
    'A paz custa vigilância eterna — pagamos de bom grado.',
  ],
  explorer: [
    'O horizonte nunca dorme.',
    'Parar é morrer devagar.',
    'Lá fora, sempre lá fora.',
    'Mapas são convites, não limites.',
    'Somos peregrinos das estrelas.',
  ],
};

const CITACOES_PESOS: Record<string, string[]> = {
  agressao_alta: ['Hesitar é trair os que vieram antes.'],
  vinganca_alta: ['Memória longa, lâmina afiada — esta é a disciplina.', 'Esquecer a afronta é traí-la duas vezes.'],
  vinganca_baixa: ['Cada vingança adiada é uma geração salva.', 'Perdoar é o luxo dos fortes.'],
  ciencia_alta: ['Toda pergunta carrega sua própria resposta.', 'Uma ignorância admitida é mais sagrada que uma certeza repetida.'],
  defesa_alta: ['A muralha é filha do medo — e fizemos do medo virtude.'],
  expansao_alta: ['Onde o sol alcança, nós alcançamos em seguida.'],
  economia_alta: ['Não há poder sem fluxo — e fluxo é comércio.'],
};

// ─── Helpers ─────────────────────────────────────────────────────────

function nomeNaveTraducao(favorita: string): string {
  switch (favorita) {
    case 'fragata': return 'fragatas de combate';
    case 'torreta': return 'torres orbitais fortificadas';
    case 'batedora': return 'batedoras de reconhecimento longo';
    case 'cargueira': return 'cargueiras blindadas convertíveis';
    default: return favorita;
  }
}

function composicaoFrotaNarrativa(p: PersonalidadeIA): string {
  const nave = nomeNaveTraducao(p.naveFavorita);
  const tamanho = p.frotaMax >= 28
    ? 'frotas massivas e permanentes'
    : p.frotaMax >= 22
      ? 'armadas de porte considerável'
      : 'forças compactas e móveis';
  const engajamento = p.frotaMinAtaque <= 3
    ? 'dispostas a engajar mesmo em minoria quando a ocasião exige'
    : p.frotaMinAtaque <= 5
      ? 'que atacam assim que encontram equilíbrio numérico'
      : 'que só investem quando dispõem de superioridade clara';
  return `A espinha dorsal militar é composta por ${nave}, organizadas em ${tamanho} — unidades ${engajamento}.`;
}

function filosofiaCombateNarrativa(p: PersonalidadeIA): string {
  if (p.paciencia <= 2) {
    return 'Age ao primeiro sinal de fraqueza alheia. A paciência é vista como hesitação disfarçada, e oficiais que a praticam demais são frequentemente substituídos.';
  }
  if (p.paciencia <= 4) {
    return 'Prefere aguardar o momento oportuno, mas não hesita quando ele se apresenta. Campanhas são planejadas com precisão, e executadas em ritmo.';
  }
  if (p.paciencia <= 6) {
    return 'Paciência é doutrina — campanhas demoram décadas de preparação antes do primeiro movimento. O inimigo desavisado costuma subestimar o quanto já foi observado.';
  }
  return 'A paciência é virtude sagrada. Gerações inteiras aguardam o que os anciãos consideram momento correto, e a pressa é interpretada como incompreensão dos princípios.';
}

function construirPerfil(p: PersonalidadeIA): PerfilEstrategico {
  const { agressao: ag, expansao: ex, economia: ec, ciencia: ci, defesa: de, vinganca: vi } = p.pesos;
  return {
    agressao: ag >= 1.4 ? 'extrema' : ag >= 1.1 ? 'alta' : ag >= 0.7 ? 'moderada' : 'baixa',
    expansao: ex >= 1.2 ? 'agressiva' : ex >= 0.8 ? 'regular' : 'contida',
    economia: ec >= 1.2 ? 'próspera' : ec >= 0.8 ? 'equilibrada' : 'austera',
    ciencia: ci >= 1.2 ? 'erudita' : ci >= 0.8 ? 'curiosa' : 'tradicional',
    defesa: de >= 1.2 ? 'inexpugnável' : de >= 0.8 ? 'atenta' : 'exposta',
    vinganca: vi >= 1.2 ? 'implacável' : vi >= 0.8 ? 'vigilante' : 'esquecida',
  };
}

function pesosOrdenados(p: PersonalidadeIA): Array<[string, number]> {
  return [
    ['agressao', p.pesos.agressao], ['expansao', p.pesos.expansao],
    ['economia', p.pesos.economia], ['ciencia', p.pesos.ciencia],
    ['defesa', p.pesos.defesa], ['vinganca', p.pesos.vinganca],
  ];
}

function subtituloPorPersonalidade(a: Arquetipo, perfil: PerfilEstrategico): string {
  const base: Record<Arquetipo, string> = {
    warlord: 'império marcial',
    trader: 'confederação mercantil',
    scientist: 'tecnocracia do conhecimento',
    defender: 'liga guardiã',
    explorer: 'povo nômade das estrelas',
  };
  let extra = '';
  if (perfil.agressao === 'extrema') extra = ' de fervor belicista raro';
  else if (perfil.ciencia === 'erudita') extra = ' obcecada pela compreensão do cosmos';
  else if (perfil.economia === 'próspera') extra = ' de alcance comercial impressionante';
  else if (perfil.vinganca === 'implacável') extra = ' de memória mais longa que sua fronteira';
  else if (perfil.defesa === 'inexpugnável') extra = ' com doutrina defensiva lendária';
  else if (perfil.expansao === 'agressiva') extra = ' em expansão incessante';
  return base[a] + extra;
}

// ─── Section builders — assemble flowing prose ──────────────────────

function secaoOrigem(
  arq: Arquetipo,
  anoFundacao: number,
  fundador: { titulo: string; nome: string },
  liderAtual: { titulo: string; nome: string },
  rng: () => number,
): SecaoLore {
  const berco = pickRng(BERCO_POR_ARQUETIPO[arq], rng);
  const conquista = pickRng(CONQUISTA_FUNDACIONAL[arq], rng);
  const anos = Math.abs(anoFundacao);
  const anoFmt = anos.toLocaleString('pt-BR');

  const p1 = `Fundado há cerca de ${anoFmt} ciclos, ${berco}. Foi ${fundador.titulo.toLowerCase()} ${fundador.nome} quem selou o pacto que deu origem à nação, reunindo dissidentes, veteranos e sobreviventes sob um único juramento.`;

  const p2 = `Nas primeiras décadas, ${fundador.nome} ${conquista}. Desde então, o feito é repetido em cerimônia anual, e seu nome permanece invocado em funerais militares, nomeações de oficiais e em toda atribuição formal de comando.`;

  const p3 = `Após ${anoFmt} ciclos e sucessivas linhagens de liderança, a bandeira é atualmente conduzida por ${liderAtual.titulo.toLowerCase()} ${liderAtual.nome}, cuja ascensão seguiu o ritual tradicional estabelecido pelo fundador.`;

  return { titulo: 'Origem', paragrafos: [p1, p2, p3] };
}

function secaoGovernoIdeologia(
  governo: string,
  objetivo: string,
  ideologiaExtra: string[],
  liderAtual: { titulo: string; nome: string },
): SecaoLore {
  const p1 = `O poder político estrutura-se como ${governo.toLowerCase()}. ${liderAtual.titulo} ${liderAtual.nome} responde a esta tradição — e, mais do que administrar, é responsável por manter vivo o propósito original que fundou o império.`;
  const p2 = `O objetivo declarado, reiterado em documentos oficiais e transmitido a cada nova geração, é ${objetivo}. Toda política pública é justificada em referência a este horizonte.`;
  const paragrafos = [p1, p2, ...ideologiaExtra];
  return { titulo: 'Governo e propósito', paragrafos };
}

function secaoCultura(arq: Arquetipo, pesosExtras: string[], rituaisExtras: string[], rng: () => number): SecaoLore {
  const paragrafos: string[] = [];
  // Pick 2 of 3 cultura narrativa beats; combine them into flowing prose
  const beats = pickManyRng(CULTURA_NARRATIVA[arq], 2, rng);
  paragrafos.push(beats[0]);
  paragrafos.push(beats[1]);
  if (pesosExtras.length > 0) paragrafos.push(pesosExtras[0]);
  if (rituaisExtras.length > 0) {
    paragrafos.push(`Entre os rituais que atravessam gerações: ${rituaisExtras.join('; ')}.`);
  }
  return { titulo: 'Cultura e cotidiano', paragrafos };
}

function secaoMilitar(arq: Arquetipo, p: PersonalidadeIA, rng: () => number): SecaoLore {
  const paragrafos: string[] = [];
  const base = pickRng(DOUTRINA_MILITAR_NARRATIVA[arq], rng);
  paragrafos.push(base);
  paragrafos.push(composicaoFrotaNarrativa(p));
  paragrafos.push(filosofiaCombateNarrativa(p));
  return { titulo: 'Doutrina militar', paragrafos };
}

function secaoPresente(p: PersonalidadeIA, rng: () => number): SecaoLore {
  const pesos = pesosOrdenados(p).sort((a, b) => a[1] - b[1]);
  const [nomeFraco, valorFraco] = pesos[0];
  const paragrafos: string[] = [];

  if (valorFraco <= 0.7) {
    paragrafos.push(
      gerarDesafioPorFraqueza(nomeFraco, rng),
    );
  } else {
    paragrafos.push(
      'Tensões crescentes dividem a elite dirigente sobre as prioridades da próxima década. O debate é aberto, intenso, e por enquanto inconclusivo.',
    );
  }

  const [nomeForte, valorForte] = pesosOrdenados(p).sort((a, b) => b[1] - a[1])[0];
  if (valorForte >= 1.3) {
    paragrafos.push(
      `Apesar disso, o fervor em torno de ${traduzirPeso(nomeForte)} segue intacto — para muitos, a identidade nacional depende dele.`,
    );
  }

  return { titulo: 'O presente', paragrafos };
}

function traduzirPeso(nome: string): string {
  const map: Record<string, string> = {
    agressao: 'a postura agressiva',
    expansao: 'o projeto de expansão',
    economia: 'o florescimento econômico',
    ciencia: 'a busca pelo conhecimento',
    defesa: 'a vocação defensiva',
    vinganca: 'a memória das afrontas históricas',
  };
  return map[nome] ?? 'suas convicções centrais';
}

function gerarDesafioPorFraqueza(nome: string, rng: () => number): string {
  const pool: Record<string, string[]> = {
    agressao: [
      'Uma ala militar interna pressiona por postura mais ofensiva — a doutrina atual é vista por alguns como excessivamente cautelosa, e oficiais veteranos renunciaram em protesto.',
      'Facções marginais reclamam que o império perdeu o apetite pelo confronto. Os opositores classificam tal postura como lucidez, mas a discussão é tensa e pública.',
    ],
    expansao: [
      'Colonizadores dissidentes reclamam que a expansão anda lenta demais — migrações ilegais aumentam nas fronteiras, e o governo ainda não decidiu como responder.',
      'Uma facção política insiste que a consolidação excessiva está condenando o império à irrelevância. O debate divide gerações e cada lado acusa o outro de traição.',
    ],
    economia: [
      'Empresários independentes pressionam por desregulamentação. O governo resiste, mas o apoio político para manter o status quo esvaece a cada trimestre.',
      'Greves recorrentes nos setores produtivos ameaçam o orçamento militar dos próximos anos. Os sindicatos argumentam que sustentam o império; a elite discute em silêncio.',
    ],
    ciencia: [
      'Cientistas influentes criticam publicamente o baixo investimento em pesquisa básica. Uma onda de exílio acadêmico começou — os melhores pesquisadores buscam abrigo em facções rivais.',
      'Um escândalo recente expôs que descobertas importantes foram suprimidas por conveniência política. A confiança na elite intelectual despencou.',
    ],
    defesa: [
      'Múltiplos incidentes fronteiriços recentes expuseram vulnerabilidades que muitos consideram inaceitáveis. Engenheiros militares alertam que muralhas antigas precisam de investimento urgente.',
      'A doutrina defensiva, antes intocada, é criticada por uma nova geração de oficiais que argumenta ser insuficiente para ameaças contemporâneas.',
    ],
    vinganca: [
      'Sobreviventes de uma afronta histórica exigem ação — a liderança prefere deixar o assunto morrer, o que alimenta movimentos populares de memória.',
      'Descendentes de uma derrota antiga se organizam publicamente para pressionar por reparação tardia. A elite tenta ignorar; o povo, não.',
    ],
  };
  return pickRng(pool[nome] ?? [
    'Tensões políticas crescentes afetam o rumo das próximas décadas. Não há consenso claro entre as elites dirigentes.',
  ], rng);
}

// ─── Main generator ─────────────────────────────────────────────────

export function gerarImperioLore(ctx: ImperioLoreContexto): ImperioLore {
  const p = ctx.personalidade;
  const rng = rngFor(`imperio:${ctx.empireId}`, ctx.galaxySeed);
  const arq = p.arquetipo;

  const fundador = {
    titulo: pickRng(TRATAMENTOS_LIDERES[arq], rng),
    nome: gerarNomePessoa(rng),
  };
  const liderAtual = {
    titulo: pickRng(TRATAMENTOS_LIDERES[arq], rng),
    nome: gerarNomePessoa(rng),
  };
  const anoFundacao = ctx.anoFundacao ?? -intRng(800, 3500, rng);

  // Ideological extras driven by weights
  const ideologiaExtras: string[] = [];
  if (p.pesos.vinganca >= 1.2) ideologiaExtras.push(PARAGRAFO_VINGANCA_ALTA[0]);
  else if (p.pesos.vinganca <= 0.6) ideologiaExtras.push(PARAGRAFO_VINGANCA_BAIXA);
  if (p.pesos.expansao >= 1.3) ideologiaExtras.push(PARAGRAFO_EXPANSAO_ALTA[0]);
  else if (p.pesos.expansao <= 0.7) ideologiaExtras.push(PARAGRAFO_EXPANSAO_BAIXA);

  // Collect high-weight cultural paragraphs (up to 2)
  const pesosAltos = pesosOrdenados(p)
    .filter(([_, v]) => v >= 1.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  const culturaExtras = pesosAltos.map(([nome]) => pickRng(PARAGRAFO_PESOS_ALTOS[nome] ?? [], rng)).filter(Boolean);

  // Ritual extras based on highest peso
  const rituaisExtras: string[] = [];
  if (p.pesos.defesa >= 1.3) rituaisExtras.push('crianças participam de exercícios defensivos anuais desde os sete anos');
  if (p.pesos.vinganca >= 1.3) rituaisExtras.push('nomes dos inimigos históricos são recitados em cerimônia trimestral');
  if (p.pesos.ciencia >= 1.3) rituaisExtras.push('cada descoberta significativa é anunciada em feriado de três dias');

  const governo = pickRng(GOVERNOS_NARRATIVO[arq], rng);
  const objetivo = pickRng(OBJETIVOS_NARRATIVO[arq], rng);

  const perfil = construirPerfil(p);
  const subtitulo = subtituloPorPersonalidade(arq, perfil);

  // Quotes — archetype base + weight bonus
  const proverbios = pickManyRng(CITACOES_BASE[arq], 3, rng);
  for (const [nome, v] of pesosOrdenados(p)) {
    if (v >= 1.3 && CITACOES_PESOS[`${nome}_alta`]) {
      proverbios.push(pickRng(CITACOES_PESOS[`${nome}_alta`], rng));
      break;
    }
    if (v <= 0.55 && CITACOES_PESOS[`${nome}_baixa`]) {
      proverbios.push(pickRng(CITACOES_PESOS[`${nome}_baixa`], rng));
      break;
    }
  }

  const secoes: SecaoLore[] = [
    secaoOrigem(arq, anoFundacao, fundador, liderAtual, rng),
    secaoGovernoIdeologia(governo, objetivo, ideologiaExtras, liderAtual),
    secaoCultura(arq, culturaExtras, rituaisExtras, rng),
    secaoMilitar(arq, p, rng),
    secaoPresente(p, rng),
  ];

  return {
    titulo: ctx.nomeImperio,
    subtitulo,
    perfil,
    secoes,
    proverbios,
  };
}

const GOVERNOS_NARRATIVO: Record<Arquetipo, readonly string[]> = {
  warlord: ['regime militar hereditário', 'junta de generais', 'teocracia marcial', 'império absolutista sustentado por legiões'],
  trader: ['confederação mercantil', 'concílio das guildas', 'meritocracia de contratos', 'república corporativa'],
  scientist: ['tecnocracia circular', 'academia suprema', 'singularidade auxiliada por consciência artificial', 'filosofia-estado'],
  defender: ['liga de cidadelas federadas', 'teocracia guardiã', 'sociedade de juramentados', 'monarquia constitucional'],
  explorer: ['confederação nômade', 'ordem dos cartógrafos', 'anarco-coletivo das margens', 'irmandade dos ventos abertos'],
};

const OBJETIVOS_NARRATIVO: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'consolidar o domínio sobre cada sistema visível ao olho nu',
    'vingar a Queda dos Anciãos derrotando todas as facções ligadas à antiga traição',
    'forjar um império único capaz de resistir ao próximo grande silêncio',
  ],
  trader: [
    'tecer uma rede de rotas que conecte todos os sistemas habitáveis',
    'acumular capital suficiente para comprar a neutralidade eterna',
    'dissolver as fronteiras militares pela simples força do mercado',
  ],
  scientist: [
    'decifrar o enigma da Era do Silêncio antes que qualquer outra facção',
    'alcançar a singularidade tecnológica dentro de três gerações',
    'provar que a consciência é transferível e tornar-se imortal como sociedade',
  ],
  defender: [
    'construir uma muralha de sistemas que jamais caia a invasores',
    'proteger os mundos indefesos da ganância de impérios maiores',
    'preservar a cultura original do mundo-natal a qualquer custo',
  ],
  explorer: [
    'mapear um terço da galáxia antes que a era atual se encerre',
    'descobrir o que silenciou as civilizações da Era Primeira',
    'encontrar um mundo-natal alternativo para o caso do atual falhar',
  ],
};

// ─── Plain-text fallback (tests, clipboard export) ──────────────────

export function formatarImperioLorePlain(lore: ImperioLore): string {
  const l: string[] = [];
  l.push(lore.titulo.toUpperCase());
  l.push(lore.subtitulo);
  l.push('');

  const perf = lore.perfil;
  l.push(
    `Agressão ${perf.agressao} · Expansão ${perf.expansao} · ` +
    `Economia ${perf.economia} · Ciência ${perf.ciencia} · ` +
    `Defesa ${perf.defesa} · Vingança ${perf.vinganca}`,
  );
  l.push('');

  for (const sec of lore.secoes) {
    l.push(sec.titulo);
    for (const p of sec.paragrafos) {
      l.push('');
      l.push(p);
    }
    if (sec.citacao) {
      l.push('');
      l.push(`  "${sec.citacao}"`);
    }
    l.push('');
  }

  l.push('Provérbios:');
  for (const p of lore.proverbios) l.push(`  "${p}"`);

  return l.join('\n');
}

/** Backward-compat shim for any remaining callers. */
export const formatarImperioLore = (lore: ImperioLore, _nome: string): string =>
  formatarImperioLorePlain(lore);
