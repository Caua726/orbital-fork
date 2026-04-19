/**
 * Highlight personality/objective keywords inside lore prose with
 * custom tooltips.
 *
 * The lore generators output flowing Portuguese prose. This helper
 * walks the rendered text nodes and wraps matched keywords (agressão,
 * economia, conquista, etc.) with a span carrying a tooltip that
 * points back at which peso / objetivo / arquétipo the word evokes.
 * Makes the lore feel like a live game object — each personality cue
 * is traceable to a real gameplay field.
 */

import { attachTooltip } from './tooltip';

interface LoreKeyword {
  re: RegExp;
  tip: string;
}

// Patterns scanned for every text node; the EARLIEST match in the text
// wins regardless of pattern order. After wrapping a match, we recurse
// on the tail so a single sentence can carry several highlights.
const TIP_AGRESSAO = 'Agressão — peso da personalidade que controla o quanto o império prioriza ataques e campanhas militares.';
const TIP_EXPANSAO = 'Expansão — peso que mede o quanto o império tenta colonizar novos planetas neutros.';
const TIP_ECONOMIA = 'Economia — peso que controla o foco em fábricas, produção e acumulação de recursos.';
const TIP_CIENCIA = 'Ciência — peso que controla o foco em pesquisa e tecnologia de ponta.';
const TIP_DEFESA = 'Defesa — peso que controla o quanto o império fortifica e resiste a invasões.';
const TIP_VINGANCA = 'Vingança — peso que controla o quanto o império pune quem o atacou antes.';

const TIP_OBJ_CONQUISTA = 'Conquista — objetivo de eliminar todos os impérios rivais.';
const TIP_OBJ_SOBREV = 'Sobrevivência — objetivo de durar mais que os outros impérios.';
const TIP_OBJ_EXPLOR = 'Exploração — objetivo de descobrir todos os sistemas e planetas.';
const TIP_OBJ_CIENCIA = 'Ciência — objetivo de dominar toda a árvore de pesquisa.';
const TIP_OBJ_ECONOMIA = 'Economia — objetivo de acumular riqueza abundante.';

const TIP_ARQ_WARLORD = 'Arquétipo Guerreiro — perfil de império focado em ofensiva e frotas de batalha.';
const TIP_ARQ_TRADER = 'Arquétipo Comerciante — perfil de império focado em economia e comércio.';
const TIP_ARQ_SCIENTIST = 'Arquétipo Cientista — perfil de império focado em pesquisa e tecnologia.';
const TIP_ARQ_DEFENDER = 'Arquétipo Defensor — perfil de império focado em fortalezas e contenção.';
const TIP_ARQ_EXPLORER = 'Arquétipo Explorador — perfil de império focado em mobilidade e descoberta.';

// Tips adicionais pra sinalizar intensidade quando a prosa usa os
// labels do PerfilEstrategico (baixa/moderada/alta/extrema, etc.).
const TIP_AGRESSAO_INTENSIDADE = 'Nível de agressão do império — controla o quanto ele prioriza ofensivas no motor de decisão.';
const TIP_EXPANSAO_INTENSIDADE = 'Nível de expansão do império — controla o apetite por colonizar planetas neutros.';
const TIP_ECONOMIA_INTENSIDADE = 'Nível econômico do império — controla o foco em fábricas, produção e acumulação.';
const TIP_CIENCIA_INTENSIDADE = 'Nível científico do império — controla o foco em pesquisa e tecnologia.';
const TIP_DEFESA_INTENSIDADE = 'Nível defensivo do império — controla o quanto ele fortifica e resiste.';
const TIP_VINGANCA_INTENSIDADE = 'Nível de rancor do império — controla o quanto ele retalia ataques recebidos.';

const TIP_GOVERNO = 'Forma de governo — flavor do arquétipo. Não muda gameplay, mas reflete os pesos dominantes.';
const TIP_TITULO_LIDER = 'Tratamento do líder — varia por arquétipo do império.';
const TIP_TENSAO = 'Tensão interna — narrativa, não afeta gameplay. Dá pistas sobre o que ameaça a estabilidade.';
const TIP_CIVILIZACAO_ORIGINAL = 'Civilização original — espécie que habitava o planeta antes da colonização.';
const TIP_MOTIVO_COLONIZACAO = 'Motivo da colonização — por que o império chegou aqui. Narrativa.';
const TIP_BIOMA = 'Bioma planetário — flavor que depende do tipo do planeta (comum / árido / gasoso).';
const TIP_GEOLOGICO = 'Fenômeno geológico — narrativa ambiental do planeta.';

const LORE_KEYWORDS: LoreKeyword[] = [
  // ─── Pesos (palavras-chave diretas) ─────────────────────────────
  { re: /\b(agress[ãa]o|agressiv[oa]s?|ofensiv[oa]s?|bel[ií]cos?[oa]?s?|impiedos[oa]s?|ferocidade|selvageria)\b/gi, tip: TIP_AGRESSAO },
  { re: /\b(expans[ãa]o|expansionistas?|colonizar|coloniza[çc][ãa]o|fronteiras?|avan[çc]ar fronteiras?)\b/gi, tip: TIP_EXPANSAO },
  { re: /\b(economia|econ[ôo]mic[oa]s?|pr[óo]sper[oa]s?|auster[oa]s?|lucros?|riqueza|capital|mercantil|mercantis)\b/gi, tip: TIP_ECONOMIA },
  { re: /\b(ci[êe]ncia|cient[íi]fic[oa]s?|pesquisa|erudi[çc][ãa]o|erudit[oa]s?|tecnologia|conhecimento|saber|descobertas? cient[íi]ficas?)\b/gi, tip: TIP_CIENCIA },
  { re: /\b(defesa|defensiv[oa]s?|inexpugn[áa]v(?:eis|el)|fortaleza(?:s)?|trincheiras?|muralhas?|cidadelas?|escudos?|blindagens?)\b/gi, tip: TIP_DEFESA },
  { re: /\b(vingan[çc]a|implac[áa]v(?:eis|el)|rancor|vingativ[oa]s?|repres[áa]lia|retalia[çc][ãa]o|afronta)\b/gi, tip: TIP_VINGANCA },

  // ─── Perfil estratégico — intensidade explícita ─────────────────
  // Estes labels aparecem na narrativa ("a agressão é alta", etc.).
  { re: /\b(agress[ãa]o\s+(?:baixa|moderada|alta|extrema))\b/gi, tip: TIP_AGRESSAO_INTENSIDADE },
  { re: /\b(expans[ãa]o\s+(?:contida|regular|agressiva))\b/gi, tip: TIP_EXPANSAO_INTENSIDADE },
  { re: /\b(economia\s+(?:auster[ao]|equilibrad[ao]|pr[óo]sper[ao]))\b/gi, tip: TIP_ECONOMIA_INTENSIDADE },
  { re: /\b(ci[êe]ncia\s+(?:tradicional|curios[ao]|erudit[ao]))\b/gi, tip: TIP_CIENCIA_INTENSIDADE },
  { re: /\b(defesa\s+(?:exposta|atenta|inexpugn[áa]vel))\b/gi, tip: TIP_DEFESA_INTENSIDADE },
  { re: /\b(vingan[çc]a\s+(?:esquecida|vigilante|implac[áa]vel))\b/gi, tip: TIP_VINGANCA_INTENSIDADE },

  // ─── Objetivos (frases canônicas da prosa dos banks) ───────────
  { re: /\b(conquista|domina[çc][ãa]o|supremacia militar|consolidar o dom[íi]nio|forjar um imp[ée]rio|esmagar|submeter)\b/gi, tip: TIP_OBJ_CONQUISTA },
  { re: /\b(sobreviv[êe]ncia|resistir|preservar|penit[êe]ncia|preservar a cultura|cairemos [úu]ltimos)\b/gi, tip: TIP_OBJ_SOBREV },
  { re: /\b(explora[çc][ãa]o|descoberta|descobrir|mapear|cartografar|inexplorad[oa]s?|alcan[çc]ar a fronteira|singularidade inexplorada)\b/gi, tip: TIP_OBJ_EXPLOR },
  { re: /\b(singularidade tecnol[óo]gica|catalogar toda forma de vida|decifrar o enigma|era do sil[êe]ncio|consci[êe]ncia transfer[íi]vel)\b/gi, tip: TIP_OBJ_CIENCIA },
  { re: /\b(rotas comerciais|rede de rotas|com[ée]rcio|guildas?|cart[ée]is|entrepostos?|monopolizar|capital suficiente|acumular capital)\b/gi, tip: TIP_OBJ_ECONOMIA },

  // ─── Arquétipos (personagens, papéis, unidades) ─────────────────
  {
    re: /\b(guerreir[oa]s?|senhor(?:es)? da guerra|warlords?|marechal|marechais|lanceir[oa]s?|legi[õo]es? juramentad[oa]s?|legi[õo]es?|a[çc]o e sangue|frotas? de guerra|sid?er[úu]rgic[oa]s?|forjador(?:es|as)? de l[âa]minas?|cronistas? de guerra|recrutas?|tropas)\b/gi,
    tip: TIP_ARQ_WARLORD,
  },
  {
    re: /\b(mercador(?:es|as)?|comerciantes?|negociantes?|c[ôo]nsul do com[ée]rcio|corporativ[oa]s?|rep[úu]blica corporativa|confedera[çc][ãa]o mercantil|conc[íi]lio das guildas|meritocracia de contratos|contadores? de rota|artíficies? de luxo|int[ée]rpretes?)\b/gi,
    tip: TIP_ARQ_TRADER,
  },
  {
    re: /\b(cientistas?|s[áa]bi[oa]s?|pesquisador(?:es|as)?|academia suprema|academia|arquivistas?|exobi[óo]log[oa]s?|engenheiros? de ru[íi]nas|fil[óo]sofos? da mente|tecnocracia|decano|mente-pai|decanos? supremos?)\b/gi,
    tip: TIP_ARQ_SCIENTIST,
  },
  {
    re: /\b(defensor(?:es|as)?|guardi[ãa]os?|sentinelas?|protetor(?:es|as)?|pedreir[oa]s? de cidadela|m[ée]dic[oa]s? de guerra|inabal[áa]v(?:eis|el)|juramentad[oa]s?|liga das muralhas|teocracia guardi[ãa]|santu[áa]rio|vigilantes? noturn[oa]s?|mestres? de treino)\b/gi,
    tip: TIP_ARQ_DEFENDER,
  },
  {
    re: /\b(explorador(?:es|as)?|pioneir[oa]s?|navegador(?:es|as)?|cart[óo]graf[oa]s?|ventos? abertos?|confedera[çc][ãa]o n[ôo]made|anarco-coletivo|capit[ãa]o das fronteiras|bi[óo]log[oa]s? de campo|lingu[íi]stas? emergenciais?|reparador(?:es|as)? de casco|tribos)\b/gi,
    tip: TIP_ARQ_EXPLORER,
  },

  // ─── Títulos de liderança (TRATAMENTOS_LIDERES) ────────────────
  { re: /\b(supremo marechal|primeiro lanceiro|senhor das frotas|o impiedoso|primeiro mercador|senhor das rotas|a balan[çc]a|primeiro arquiteto|decano supremo|a resposta|protetor m[áa]ximo|senhor das muralhas|sentinela primeiro|o inabal[áa]vel|capit[ãa]o das fronteiras|primeiro dos ventos|navegador-mor|a b[úu]ssola)\b/gi, tip: TIP_TITULO_LIDER },

  // ─── Formas de governo (GOVERNOS_POR_ARQUETIPO) ────────────────
  { re: /\b(regime militar hereditário|junta de generais|teocracia marcial|imp[ée]rio absolutista|confedera[çc][ãa]o mercantil|conc[íi]lio das guildas|meritocracia de contratos|rep[úu]blica corporativa|tecnocracia circular|academia suprema|singularidade auxiliada|filosofia-estado|preceitos de okhar|liga das muralhas|teocracia guardi[ãa]|sociedade dos juramentados|monarquia constitucional|carta inviol[áa]vel|ordem dos cart[óo]grafos|irmandade dos ventos abertos|anarco-coletivo das margens)\b/gi, tip: TIP_GOVERNO },

  // ─── Tecnologias características (por arquétipo) ────────────────
  { re: /\b(blindagens? reativas?|muni[çc][ãa]o cin[ée]tica|comunica[çc][ãa]o quântica|comunica[çc][ãa]o encriptada|propulsores? de emerg[êe]ncia)\b/gi, tip: TIP_ARQ_WARLORD },
  { re: /\b(drones? suicidas?|c[âa]maras? de carga|cascos? modulares?|rastreador(?:es|as)? de rota|transponders?|intelig[êe]ncia coletiva)\b/gi, tip: TIP_ARQ_TRADER },
  { re: /\b(laborat[óo]rios? orbita(?:is|l)|laborat[óo]rios?|sensores? de longo alcance|campos? de pesquisa simulad[oa]s?|motores? experimenta(?:is|l)|armament[oa]s? experimenta(?:is|l))\b/gi, tip: TIP_ARQ_SCIENTIST },
  { re: /\b(escudos? est[áa]tic[oa]s?|cidadelas? orbita(?:is|l)|redes? de sensores?|sistemas? de evacua[çc][ãa]o|redund[âa]ncia tripla)\b/gi, tip: TIP_ARQ_DEFENDER },
  { re: /\b(cascos? leves?|sondas? autom[áa]ticas?|navega[çc][ãa]o por estrelas mortas|m[óo]dulos? de hiberna[çc][ãa]o|estrelas? mortas?)\b/gi, tip: TIP_ARQ_EXPLORER },

  // ─── Especialidades econômicas ─────────────────────────────────
  { re: /\b(minera[çc][ãa]o de metais pesados|metais pesados|cultivo hidrop[ôo]nico|refinaria de combust[íi]vel|fabrica[çc][ãa]o de tecidos|constru[çc][ãa]o naval|estaleiros? orbita(?:is|l)|estaleir[oa]s?)\b/gi, tip: TIP_ECONOMIA },
  { re: /\b(pesquisa exobiol[óo]gica|armament[oa]s? experimenta(?:is|l)|pesquisa exobiol[óo]gica em ru[íi]nas)\b/gi, tip: TIP_CIENCIA },

  // ─── Tensões internas (TENSOES_INTERNAS) ───────────────────────
  { re: /\b(dissid[êe]ncia religiosa|fac[çc][õo]es econ[ôo]micas|sindicatos de mineradores|veteranos de guerras antigas|recusam-se a depor as armas|nativos reivindicam|epidemia de origem desconhecida)\b/gi, tip: TIP_TENSAO },

  // ─── Civilizações originais / destinos ─────────────────────────
  { re: /\b(s[íi]lex cristalinos?|bestas gigantescas?|col[ôo]nias f[úu]ngicas|predadores noturnos|anf[íi]bios luminosos|criaturas aladas|formas vivas gasosas|insetoides coletivos|aracnoides? mir[íi]ades?|b[íi]pedes pac[íi]fic[oa]s?)\b/gi, tip: TIP_CIVILIZACAO_ORIGINAL },
  { re: /\b(extint[oa]s? antes|desaparecid[oa]s? sem deixar|ascendid[oa]s?|dormentes|miscigenad[oa]s?|fossilizad[oa]s?|inscri[çc][õo]es que resistem|emigraram em massa)\b/gi, tip: TIP_CIVILIZACAO_ORIGINAL },

  // ─── Motivos de colonização ────────────────────────────────────
  { re: /\b(posto estrat[ée]gico|controle de rotas|perda de um mundo-natal|seita que viu sinais|refugiados de um sistema|penit[êe]ncia imposta|ru[íi]nas consideradas sagradas|gesto territorial desafiador|recursos raros sob a crosta)\b/gi, tip: TIP_MOTIVO_COLONIZACAO },

  // ─── Biomas (indicativos do tipo de planeta) ────────────────────
  { re: /\b(florestas perp[ée]tuas|oceanos salgados|arquip[ée]lagos n[ôo]mades|savanas infinitas|musgo luminescente|tundras? cintilantes?|pradarias de capim met[áa]lico|ilhas flutuantes)\b/gi, tip: TIP_BIOMA },
  { re: /\b(plan[íi]cies de ferro oxidado|c[âa]nions? vulc[âa]nicos?|crateras espelhadas|desertos? de rubi|mares petrificados|planaltos? de obsidiana|dunas rubras|aurora magn[ée]tica)\b/gi, tip: TIP_BIOMA },
  { re: /\b(tempestades perp[ée]tuas|an[ée]is de tungst[êe]nio|esta[çc][õo]es flutuantes|correntes de metano|bandas atmosf[ée]ricas|olhos de tempestade|cristais de am[ôo]nia|aurorais jovianos|hidrog[êe]nio met[áa]lico)\b/gi, tip: TIP_BIOMA },

  // ─── Fenômenos geológicos ──────────────────────────────────────
  { re: /\b(atividade tect[ôo]nica constante|campos magn[ée]ticos duplos|n[úu]cleo planet[áa]rio pulsa|gravidade varia|inverno eterno|geysers peri[óo]dicos|auroras planet[áa]rias|falhas tect[ôo]nicas)\b/gi, tip: TIP_GEOLOGICO },

  // ─── Temas culturais genéricos (tom de narrativa) ──────────────
  { re: /\b(seita|cult[oa]s?|religios[oa]s?|sagrad[oa]s?|ancestrais?|veneram|cultua|tatuagens magn[ée]ticas|funerais? ao amanhecer|c[âa]maras subterr[âa]neas)\b/gi, tip: 'Traço cultural — pista narrativa, não altera diretamente os pesos gameplay.' },
];

function encontrarPrimeiroMatch(text: string): { start: number; end: number; tip: string } | null {
  let bestStart = Infinity;
  let bestEnd = 0;
  let bestTip = '';
  for (const kw of LORE_KEYWORDS) {
    // matchAll returns an iterator; the first yield is the earliest
    // match for this pattern, which is what we want. Using .next()
    // avoids eagerly collecting the whole list.
    kw.re.lastIndex = 0;
    const iter = text.matchAll(kw.re);
    const first = iter.next();
    if (first.done || first.value.index === undefined) continue;
    const m = first.value;
    const idx = m.index;
    if (idx < bestStart) {
      bestStart = idx;
      bestEnd = idx + m[0].length;
      bestTip = kw.tip;
    }
  }
  if (bestStart === Infinity) return null;
  return { start: bestStart, end: bestEnd, tip: bestTip };
}

/**
 * Walks `container` recursively and wraps any matched keyword in a
 * span with a tooltip bound. Already-wrapped spans are skipped so
 * it's safe to call after rebuilding the lore DOM on every tick.
 *
 * Text-content-based cache: the full text is hashed (via a small
 * fnv-1a) and stashed on the container's dataset. If the hash
 * matches the previous run, the TreeWalker + regex scan are skipped
 * entirely — this function was previously doing ~50 regex passes on
 * every section rebuild, even when the lore prose was static.
 */
function hashText(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function aplicarTooltipsLore(container: HTMLElement): void {
  const text = container.textContent ?? '';
  const hash = hashText(text);
  if (container.dataset.loreTooltipHash === hash) return;
  container.dataset.loreTooltipHash = hash;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains('has-tooltip')) return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains('has-tooltip-box')) return NodeFilter.FILTER_REJECT;
      if (parent.dataset.tooltipBound === '1') return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  let cursor: Node | null;
  while ((cursor = walker.nextNode())) textNodes.push(cursor as Text);
  for (const node of textNodes) processTextNode(node);
}

function processTextNode(node: Text): void {
  const text = node.textContent ?? '';
  if (text.length < 3) return;

  const match = encontrarPrimeiroMatch(text);
  if (!match) return;

  const parent = node.parentNode;
  if (!parent) return;
  const matched = text.slice(match.start, match.end);
  const before = text.slice(0, match.start);
  const after = text.slice(match.end);

  const span = document.createElement('span');
  span.textContent = matched;
  attachTooltip(span, match.tip, 'text');

  const frag = document.createDocumentFragment();
  if (before) frag.appendChild(document.createTextNode(before));
  frag.appendChild(span);
  const afterNode = after ? document.createTextNode(after) : null;
  if (afterNode) frag.appendChild(afterNode);

  parent.replaceChild(frag, node);

  if (afterNode) processTextNode(afterNode);
}
