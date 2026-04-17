/**
 * Thematic word pools for procedural lore generation.
 *
 * Organized by subject (planet type, empire archetype, cultural aspect)
 * so generators can pick the right flavor without mixing tones. Each
 * bank strives for specificity — "florestas de vidro" beats "florestas
 * estranhas" — because lore feels hand-written when its nouns are.
 */

import type { Arquetipo } from '../personalidade-ia';

// ─── Biomas por tipo de planeta ──────────────────────────────────────

export const BIOMAS_COMUM: readonly string[] = [
  'florestas perpétuas de folhagem cromática',
  'oceanos salgados cortados por arquipélagos nômades',
  'savanas infinitas sob dois horizontes',
  'continentes cobertos de musgo luminescente',
  'tundras cintilantes onde a neve canta ao vento',
  'planícies verdejantes recortadas por rios de água densa',
  'cadeias de ilhas flutuantes ancoradas a nada',
  'selvas tropicais de ar espesso e céu violeta',
  'pradarias de capim metálico que reflete as estrelas',
];

export const BIOMAS_MARTE: readonly string[] = [
  'planícies de ferro oxidado e ventos eternos',
  'cânions vulcânicos ainda ativos',
  'crateras espelhadas refletindo nuvens rubras',
  'desertos de rubi onde nada sopra',
  'mares petrificados de silício cristalizado',
  'montanhas de óxido partidas por falhas tectônicas',
  'planaltos de obsidiana e poeira de ferro',
  'vales esculpidos por rios antigos há muito evaporados',
  'campos de dunas rubras cobertas por aurora magnética',
];

export const BIOMAS_GASOSO: readonly string[] = [
  'tempestades perpétuas de hélio carmesim',
  'anéis de tungstênio e gelo orbital',
  'estações flutuantes ancoradas em camadas de hidrogênio',
  'correntes de metano que serpenteiam o equador',
  'bandas atmosféricas estratificadas em nove cores distintas',
  'olhos de tempestade maiores que continentes',
  'cristais de amônia suspensos em ventos de 800 m/s',
  'aurorais jovianos que pintam o céu por dias',
  'camadas profundas onde hidrogênio se torna metálico',
];

export function biomasPorTipo(tipo: string): readonly string[] {
  if (tipo === 'marte') return BIOMAS_MARTE;
  if (tipo === 'gasoso') return BIOMAS_GASOSO;
  return BIOMAS_COMUM;
}

// ─── Civilizações originais do planeta (pré-contato) ─────────────────

export const CIVS_ORIGINAIS: readonly string[] = [
  'sílex cristalinos que crescem das rochas em padrões geométricos',
  'bestas gigantescas de olhos múltiplos que cantavam em uníssono',
  'colônias fúngicas sencientes espalhadas pelo subsolo',
  'predadores noturnos com memória genética transmissível',
  'anfíbios luminosos que habitavam as marés',
  'criaturas aladas que construíam torres de osso e minério',
  'formas vivas gasosas que se alimentavam de tempestades',
  'insetoides coletivos em colmeias com arquitetura sagrada',
  'bípedes pacíficos que dormiam séculos entre cada ciclo de vigília',
  'aracnoides miríades que tecia seda-aço entre as montanhas',
];

export const DESTINOS_CIVS: readonly string[] = [
  'extintos antes da chegada dos primeiros colonos',
  'desaparecidos sem deixar corpos, apenas estruturas',
  'ascendidos a uma forma de existência incompreensível',
  'dormentes, aguardando um sinal que nunca veio',
  'miscigenados com a vida microbiana atual do planeta',
  'fossilizados em camadas profundas após um grande cataclismo',
  'deixaram apenas inscrições que resistem à tradução',
  'emigraram em massa em direção às estrelas — nunca vistos outra vez',
];

// ─── Geológico / astronômico ────────────────────────────────────────

export const FENOMENOS_GEOLOGICOS: readonly string[] = [
  'atividade tectônica constante redesenha continentes a cada século',
  'campos magnéticos duplos criam zonas onde objetos flutuam',
  'núcleo planetário pulsa em intervalos regulares — ninguém sabe por quê',
  'gravidade varia 8% entre o polo norte e o sul',
  'dia local dura 73 horas; noites carregam temperaturas criogênicas',
  'o eixo se inclina gradualmente — inverno eterno chegará em cem mil anos',
  'geysers periódicos expelem água contendo metais pesados',
  'auroras planetárias são visíveis do espaço como um anel contínuo',
];

// ─── Descoberta / colonização ────────────────────────────────────────

export const MOTIVOS_COLONIZACAO: readonly string[] = [
  'pelos recursos raros sob a crosta',
  'como posto estratégico de controle de rotas',
  'após a perda de um mundo-natal em guerra anterior',
  'por uma seita que viu sinais religiosos no céu local',
  'para abrigar refugiados de um sistema colapsado',
  'como penitência imposta a uma facção dissidente',
  'pela descoberta de ruínas consideradas sagradas',
  'em um gesto territorial desafiador contra rivais',
];

// ─── Cultura local ───────────────────────────────────────────────────

export const COSTUMES_LOCAIS: readonly string[] = [
  'os nascidos aqui carregam tatuagens magnéticas que reagem ao polo planetário',
  'funerais acontecem ao amanhecer, queimando os mortos em ressonância com o sol',
  'a música é tocada exclusivamente em câmaras subterrâneas, onde o eco é sagrado',
  'crianças recebem nomes apenas aos doze anos, após superar uma provação',
  'três festivais anuais marcam as passagens dos ventos sazonais',
  'nenhuma construção pode ultrapassar a altura da menor montanha local',
  'tribunais são conduzidos em silêncio, usando apenas gestos codificados',
  'casamentos envolvem o plantio de uma árvore que crescerá enquanto durar a união',
  'todo adulto mantém um diário em linguagem privada que só é lido após sua morte',
  'o nome de quem trai a comunidade é apagado de todos os registros em ritual público',
];

export const RELIGIOES_PLANETA: readonly string[] = [
  'cultuam o sol local como um olho consciente que julga toda ação',
  'veneram os ventos como mensageiros dos ancestrais',
  'praticam um ateísmo militante — religião foi banida há gerações',
  'acreditam que o planeta é o último sonho de um deus moribundo',
  'seguem um panteão de nove deuses que trocam papéis a cada geração',
  'rezam para as ruínas pré-humanas, tratando-as como relíquias divinas',
  'não têm religião formal; sua filosofia é o pragmatismo rigoroso',
  'acreditam em reincarnação — cada alma retorna sete vezes antes de descansar',
];

// ─── Economia / especialização ───────────────────────────────────────

export const ESPECIALIDADES_ECONOMICAS: readonly string[] = [
  'mineração de metais pesados em cinturões profundos',
  'cultivo hidropônico de fungos alimentícios raros',
  'montagem final de componentes militares',
  'refinaria de combustível de fusão',
  'pesquisa exobiológica em ruínas',
  'fabricação de tecidos inteligentes exportados pela galáxia',
  'construção naval — estaleiros orbitais em polo norte',
  'entreposto de rotas comerciais entre três sistemas',
  'laboratórios de armamento experimental',
];

// ─── Tensões internas ────────────────────────────────────────────────

export const TENSOES_INTERNAS: readonly string[] = [
  'a geração mais jovem questiona abertamente a autoridade central',
  'uma dissidência religiosa cresce nas colônias subterrâneas',
  'facções econômicas disputam controle sobre a principal refinaria',
  'sindicatos de mineradores ameaçam greve pela sétima vez em uma década',
  'uma cidade inteira foi isolada após uma epidemia de origem desconhecida',
  'cientistas debatem publicamente sinais vindos do núcleo planetário',
  'veteranos de guerras antigas recusam-se a depor as armas',
  'nativos reivindicam terras concedidas há cem anos a colonos externos',
];

// ─── Governos / estruturas políticas ────────────────────────────────

export const GOVERNOS_POR_ARQUETIPO: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'Regime militar hereditário — o Supremo Marechal comanda vitalício',
    'Junta de Generais — sete marechais governam em voto sigiloso',
    'Teocracia marcial — sacerdotes-guerreiros lideram em nome do Primeiro Caído',
    'Império absolutista sustentado por legiões juramentadas',
  ],
  trader: [
    'Confederação mercantil — o assento é comprado em leilão trimestral',
    'Concílio das Guildas — dezesseis cartéis equilibram o poder',
    'Meritocracia de contratos — quem financia mais rotas governa',
    'República corporativa sob carta fundadora de três séculos',
  ],
  scientist: [
    'Tecnocracia circular — o Conselho é renovado por exame a cada década',
    'Academia Suprema — cientistas eleitos por pares comandam',
    'Singularidade Auxiliada — decisões são delegadas a uma consciência artificial',
    'Filosofia-estado sob os Preceitos de Okhar',
  ],
  defender: [
    'Liga das Muralhas — quinze cidadelas federadas votam em consenso',
    'Teocracia guardiã — o Santuário escolhe o Protetor entre órfãos de guerra',
    'Sociedade dos Juramentados — cada cidadão é soldado reservista vitalício',
    'Monarquia constitucional guiada pela Carta Inviolável',
  ],
  explorer: [
    'Confederação nômade — tribos decidem em assembleia trianual',
    'Ordem dos Cartógrafos — quem mapeia mais longe fala mais alto',
    'Anarco-coletivo das Margens — sem capital fixa, sem líder fixo',
    'Irmandade dos Ventos Abertos — liderança flui por estação',
  ],
};

// ─── Objetivos principais do império ────────────────────────────────

export const OBJETIVOS_POR_ARQUETIPO: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'consolidar o domínio sobre cada sistema visível ao olho nu',
    'vingar a Queda dos Anciãos, derrotando todas as facções ligadas à traição',
    'forjar um império único capaz de resistir ao próximo grande silêncio',
    'recolher sob sua bandeira os fragmentos da antiga confederação militar',
  ],
  trader: [
    'tecer uma rede de rotas que conecte todos os sistemas habitáveis',
    'acumular capital suficiente para comprar a neutralidade eterna',
    'monopolizar o comércio de combustível de fusão no braço local',
    'dissolver as fronteiras militares pela simples força do mercado',
  ],
  scientist: [
    'decifrar o enigma da Era do Silêncio antes que qualquer outra facção',
    'alcançar a singularidade tecnológica dentro de três gerações',
    'catalogar toda forma de vida conhecida e suas origens',
    'provar que a consciência é transferível e tornar-se imortal como sociedade',
  ],
  defender: [
    'construir uma muralha de sistemas que jamais caia a invasores',
    'proteger os mundos indefesos da ganância de impérios maiores',
    'preservar a cultura original do mundo-natal a qualquer custo',
    'manter a paz interna mesmo diante do colapso de sistemas vizinhos',
  ],
  explorer: [
    'alcançar a fronteira e enviar sinal de que chegaram vivos',
    'mapear um terço da galáxia antes que a era atual se encerre',
    'descobrir o que silenciou as civilizações da Era Primeira',
    'encontrar um mundo-natal alternativo para o caso do atual falhar',
  ],
};

// ─── Rituais e tabus ────────────────────────────────────────────────

export const RITUAIS_POR_ARQUETIPO: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'cada recruta grava sua lâmina com o nome do primeiro inimigo que derrotará',
    'a cada década, os veteranos recitam em coro os nomes de todos os caídos',
    'trofeus de guerra são enterrados com cerimônia, nunca exibidos',
    'comandantes derrotados em batalha retornam ao lar por terra, jamais por nave',
  ],
  trader: [
    'todo contrato importante é selado com uma troca de objetos pessoais',
    'mercadores aposentados tatuam no antebraço as rotas que dominaram',
    'uma vez por ano, a Frota fecha as rotas por três dias em silêncio comemorativo',
    'nunca se negocia sobre um morto insepulto — considerado afronta ao descanso',
  ],
  scientist: [
    'todo cientista deve registrar um erro significativo antes de publicar descobertas',
    'as descobertas mais importantes são expostas nas paredes da Academia',
    'quem aceita um posto de liderança abdica do direito de pesquisar',
    'livros proibidos são preservados em câmaras blindadas, nunca destruídos',
  ],
  defender: [
    'a cada ameaça enfrentada, um novo tijolo é adicionado à Grande Muralha',
    'crianças de sete anos participam de um ritual anual de vigília noturna',
    'nenhum protetor pode reformar uma fortaleza que um ancestral ergueu',
    'os nomes dos caídos em defesa são gravados em pedra viva que cresce com o tempo',
  ],
  explorer: [
    'toda descoberta é nomeada por quem vem depois — nunca por quem descobriu',
    'navegadores mantêm diários que são queimados em sua morte',
    'tripulações que não retornam recebem monumento no ponto mais alto da capital',
    'o último ato de um capitão aposentado é traçar uma rota que jamais será tomada',
  ],
};

// ─── Tecnologia característica ───────────────────────────────────────

export const TECNOLOGIAS_POR_ARQUETIPO: Record<Arquetipo, readonly string[]> = {
  warlord: [
    'blindagens reativas auto-reparáveis e munição cinética hipersônica',
    'comunicação encriptada por ressonância quântica — impossível de interceptar',
    'drones suicidas guiados por inteligência coletiva',
    'propulsores de emergência capazes de manobras que esmagam pilotos',
  ],
  trader: [
    'cascos modulares trocáveis em estações — a mesma nave vira cargueira ou escolta',
    'rastreadores de rota adaptativos que calculam lucro por parsec',
    'câmaras de carga com atmosfera controlada independente',
    'transponders de confiança mútua entre guildas aliadas',
  ],
  scientist: [
    'sensores de longo alcance capazes de detectar estruturas atômicas distantes',
    'laboratórios orbitais autônomos gerenciados por IA especializada',
    'campos de pesquisa simulados — testam hipóteses sem riscos físicos',
    'motores experimentais que vazam radiação exótica, mas alcançam distâncias inusitadas',
  ],
  defender: [
    'escudos estáticos multi-camadas capazes de absorver armamento de capital',
    'cidadelas orbitais com redundância tripla em todos os sistemas',
    'redes de sensores formando perímetro cobrindo o sistema inteiro',
    'sistemas de evacuação automatizados que operam mesmo sem comando central',
  ],
  explorer: [
    'cascos leves otimizados para autonomia em detrimento de combate',
    'sondas automáticas lançadas periodicamente — cada uma uma memória da frota',
    'navegação por estrelas mortas usando algoritmos de retroprojeção',
    'módulos de hibernação que permitem viagens de décadas',
  ],
};

// ─── Pronomes / tratamentos ─────────────────────────────────────────

export const TRATAMENTOS_LIDERES: Record<Arquetipo, readonly string[]> = {
  warlord:   ['Supremo Marechal', 'Primeiro Lanceiro', 'Senhor das Frotas', 'O Impiedoso'],
  trader:    ['Primeiro Mercador', 'Senhor das Rotas', 'Cônsul do Comércio', 'A Balança'],
  scientist: ['Primeiro Arquiteto', 'Decano Supremo', 'Mente-Pai', 'A Resposta'],
  defender:  ['Protetor Máximo', 'Senhor das Muralhas', 'Sentinela Primeiro', 'O Inabalável'],
  explorer:  ['Capitão das Fronteiras', 'Primeiro dos Ventos', 'Navegador-Mor', 'A Bússola'],
};

// ─── Profissões populares ────────────────────────────────────────────

export const PROFISSOES_POR_ARQUETIPO: Record<Arquetipo, readonly string[]> = {
  warlord:   ['lanceiros de linha', 'siderúrgicos', 'forjadores de lâminas', 'cronistas de guerra'],
  trader:    ['contadores de rota', 'navegadores comerciais', 'artífices de luxo', 'intérpretes'],
  scientist: ['exobiólogos', 'filósofos da mente', 'engenheiros de ruínas', 'arquivistas'],
  defender:  ['pedreiros de cidadela', 'médicos de guerra', 'vigilantes noturnos', 'mestres de treino'],
  explorer:  ['cartógrafos', 'biólogos de campo', 'linguistas emergenciais', 'reparadores de casco'],
};
