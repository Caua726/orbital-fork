# Árvore de Pesquisa e Vitórias — Design

Status: aprovado (2026-10-27)
Escopo: trocar a pesquisa por planeta por uma árvore do império em 4 ramos, alimentada pelo raro, e trocar o objetivo único da partida por vitórias no estilo Civilization (dominação, economia, tecnologia) que todos os impérios, inclusive a IA, podem alcançar.

## Por quê

Hoje a pesquisa não cria decisões:

- É por planeta (`src/world/sistema.ts:135` cria cada planeta com pesquisa zerada). Colonizar obriga a refazer tudo, o que pune a expansão.
- É uma fila linear (4 naves × 5 tiers) que todo mundo completa na mesma ordem. Cada tier só dá +40% de atributos (`src/world/combate.ts:35`).
- Custo fixo (5 raro, 60 s) em qualquer tier. O raro não tem outro uso.

E só o jogador pode vencer; a IA não persegue objetivo nenhum.

O que o jogador deve sentir: "vou montar minha estratégia". Focar em poder militar, em economia, em produção em massa, em tecnologia avançadíssima, ser equilibrado, ou pegar um pouco de cada — e essa escolha decidir como ele tenta vencer.

## Objetivos

- Pesquisa do império, compartilhada por todas as colônias (atuais e futuras).
- O raro produzido vira pontos de ciência automaticamente; mais colônias = pesquisa mais rápida.
- Árvore com 4 ramos: Militar, Economia, Produção, Tecnologia.
- Focar num ramo leva a uma pesquisa-chave forte; espalhar dá vários bônus baratos. Não dá pra pesquisar tudo numa partida.
- Vitórias selecionáveis na criação: Dominação, Economia, Tecnologia (todas marcadas por padrão). Nenhuma marcada = modo livre.
- IA usa as mesmas regras de pesquisa e pode vencer por qualquer vitória ativa.
- HUD mostra a corrida: progresso do jogador e dos rivais em cada vitória ativa.

## Não-objetivos

- Cultura (descartado explicitamente).
- Redesenho geral de UI/UX e onboarding — é o próximo projeto. As telas novas daqui seguem o estilo atual do HUD.
- Diplomacia.
- Escolhas exclusivas ("A ou B") na árvore. Podem vir depois se a árvore parecer rasa.
- Balanceamento por telemetria de partidas reais.

## Anti-objetivos (falha mesmo se funcionar)

- Pesquisa que exija micro por planeta ou ida frequente ao menu (por isso a fila).
- Ser possível completar a árvore inteira numa partida normal — mata a escolha.
- IA com regras de pesquisa diferentes das do jogador.
- Diálogos nativos (`alert`/`confirm`) ou recarregamento de tela; transições suaves como no resto do jogo.

## 1. Ciência: o raro vira pesquisa

- A cada ciclo de recurso (`CICLO_RECURSO_MS`), o raro que o planeta produziria (`obterProducaoNaturalCiclo(...).raro × producao`, mais bônus da árvore) não vai pro estoque do planeta: soma direto nos pontos de ciência do império dono. Comum = 1, Marte = 0,5, gasoso = 0 (valores atuais).
- Pontos entram na pesquisa ativa. Sem pesquisa ativa, acumulam num banco do império e são gastos quando uma for escolhida.
- O raro deixa de existir como recurso estocável: sai do estoque dos planetas, da carga das cargueiras, da barra de recursos e dos custos. No lugar, a UI mostra "Ciência: +X/ciclo".
- Neutros não pesquisam.

## 2. Estado de pesquisa por império

Novo estado por dono (`'jogador'` e cada `inimigoN`), fora dos planetas:

```ts
interface PesquisaImperio {
  concluidas: string[];        // ids de nós
  ativa: string | null;        // id do nó em andamento
  progresso: number;           // pontos já aplicados na ativa
  banco: number;               // pontos sem destino
  fila: string[];              // próximos nós, opcional
}
```

- Ao concluir a ativa, puxa o próximo válido da fila; se a fila estiver vazia, os pontos vão pro banco.
- Planeta conquistado passa a usar a pesquisa do novo dono. Nada é "roubado".
- Construir nave tier N continua exigindo fábrica ≥ N no planeta, além do nó pesquisado.
- `planeta.dados.pesquisas` e `planeta.dados.pesquisaAtual` deixam de existir.

## 3. A árvore

Cada ramo tem linhas de nós encadeados (nível 1 → 5). Um nó exige o anterior da mesma linha. Custo = `base × crescimento^(nível−1)`; o ramo Tecnologia tem base maior. Cada ramo termina numa **pesquisa-chave** que exige o nível máximo de pelo menos uma linha do ramo.

Lista inicial (os números são do construtor e serão calibrados):

**Militar** — qualidade da frota
- Linhas: Fragata 1–5, Torreta 1–5, Batedora 1–5 (tiers de nave atuais).
- Linha extra: Blindagem 1–3 (+HP em todas as naves de combate).
- Chave: "Doutrina de Guerra" — dano +X% para todo o império.

**Economia** — riqueza
- Linhas: Cargueira 1–5 (tiers atuais), Rendimento Planetário 1–5 (+% produção), Exploração de Marte e Gasosos 1–3 (+rendimento nesses tipos).
- Chave: "Mercado Galáctico" — +X% de toda a produção e ciência.

**Produção** — quantidade e expansão
- Linhas: Linha de Montagem 1–5 (−% tempo de construção de naves e edifícios), Padronização 1–3 (−% custo em comum), Colonização 1–3 (colonizadora mais barata e rápida).
- Chave: "Estaleiros Orbitais" — planeta com fábrica 5 produz 2 naves ao mesmo tempo.

**Tecnologia** — avançadíssima, fim de jogo
- Abre só depois de N nós concluídos somando os outros ramos (N a calibrar; ideia: perto de metade de dois ramos).
- Linhas: Sensores 1–3 (+raio de visão), Propulsão 1–3 (+velocidade das naves), Escudos 1–3 (redução de dano).
- Chave: "Megaprojeto" — pesquisa muito cara; concluir dá a vitória por Tecnologia (se ativa). Iniciar o Megaprojeto avisa todos os impérios.

Meta de ritmo: numa partida padrão, quem foca chega a uma chave; quem espalha completa os níveis 1–2 de quase tudo; ninguém completa a árvore.

Os efeitos entram nos pontos onde os números já são calculados hoje (`getStatsCombate`, `obterProducaoNaturalCiclo`, `calcularTempoConstrucaoMs`, `calcularTempoColonizadoraMs`, `capacidadeCargaCargueira`, raio de visão em `visao.ts`, velocidade das naves). A definição da árvore fica em dados (um arquivo com os nós, custos e efeitos), não espalhada em `if`s.

## 4. Vitórias

`MatchStateDTO.objective` (único) vira uma lista de vitórias ativas, mais o vencedor:

```ts
type Vitoria = 'dominacao' | 'economia' | 'tecnologia';
interface MatchStateDTO {
  vitorias: Vitoria[];            // vazio = modo livre
  vencedor?: { dono: string; vitoria: Vitoria };
  // status, relógios etc. como hoje
}
```

- **Dominação:** um império vence quando todos os rivais foram eliminados (sem planetas e sem colonizadora com alvo neutro — a mesma regra que hoje define derrota do jogador, aplicada a cada império).
- **Economia:** manter ≥ 50% da produção total da galáxia entre impérios não neutros (`participacaoProducao` atual, por império) por um tempo contínuo (ideia: 3 minutos de simulação). Cair abaixo zera o contador.
- **Tecnologia:** concluir o Megaprojeto.
- Checagem para todos os impérios a cada tick de `atualizarMatchState`. O primeiro a cumprir vence.
- Vitória da IA = tela de derrota do jogador, dizendo qual império venceu e por qual vitória. Vitória do jogador mantém a opção atual de continuar como sandbox.
- Derrota do jogador por eliminação continua como hoje.
- Avisos: quando um rival passa de ~75% de alguma vitória (ou inicia o Megaprojeto), toast + entrada no log de eventos.
- Sobrevivência e Exploração saem.

## 5. IA

- O candidato "pesquisar" em `ia-utilidade.ts` passa a avaliar os nós disponíveis do império (não por planeta) e enfileira um por vez.
- Peso por ramo vem da personalidade: `agressao` → Militar, `economia` → Economia, `expansao` → Produção, `ciencia` → Tecnologia, `defesa` → Militar (Torreta/Blindagem/Escudos).
- Cada IA persegue as vitórias ativas que combinam com o arquétipo (warlord → Dominação, trader → Economia, scientist → Tecnologia; defender e explorer escolhem pela situação). O construtor decide como isso pesa nas ações existentes.
- Mantém o determinismo atual da IA (jitter determinístico).
- **A IA produz pelo mesmo caminho do jogador:** fila, tempo de construção, tier de nave pesquisado e fábrica ≥ N. Acabam a nave instantânea sempre T1 (`ia-decisao.ts`, `produzir_nave`) e os descontos de custo/tempo por `forca`.
- **Dificuldade vira bônus de rendimento:** `forca` passa a multiplicar a produção e a ciência da IA (ex.: difícil = +40%). Quantidade de IAs, `tickMs`, frota e fábricas iniciais continuam como hoje.

## 6. Interface

- **Tela de pesquisa do império:** modal com os 4 ramos lado a lado, nós com estado (concluído, disponível, bloqueado, ativo, na fila), custo, efeito e progresso. Clicar define a ativa; outra ação adiciona à fila. Atalho de teclado e botão no HUD. Versão mobile em bottom-sheet, como os outros painéis.
- **HUD:** pesquisa ativa com barra de progresso e ciência por ciclo.
- **Corrida das vitórias:** painel compacto com o progresso do jogador e o do rival mais próximo em cada vitória ativa; detalhes por império no `empire-modal`.
- **Criação do mundo:** o passo "Objetivo" do `new-world-modal` vira checkboxes das 3 vitórias (todas marcadas). Nenhuma marcada = livre. A regra atual "pacífico + sobrevivência → livre" some; em pacífico, Dominação fica desmarcada e desabilitada.
- **Saem:** a aba "pesquisa" do `build-panel`, do `planet-drawer` e do `mobile-build`; o raro na barra de recursos; textos de custo em raro.
- Toda string nova passa pelo i18n (`src/core/i18n/dict.ts`).

## 7. Save

Schema 3 → 4, migração em `src/world/save/migrations.ts`:

- Pesquisa por império = união dos tiers concluídos em todos os planetas daquele dono, mapeada para os nós das linhas de nave.
- `pesquisaAtual` de cada planeta é descartada; o tempo já investido não é devolvido.
- Raro em estoque nos planetas e na carga das naves vira pontos no banco de ciência do dono.
- Objetivo antigo: `conquista` → `['dominacao']`, `economia` → `['economia']`, `ciencia` → `['tecnologia']`, `sobrevivencia`/`exploracao`/`livre` → `[]` (livre).
- Reconciler e testes de save atualizados para o novo formato.

## 8. Testes

- Unitários (vitest): progresso e conclusão de nós, fila, banco, pré-requisitos, desbloqueio do ramo Tecnologia, aplicação dos efeitos, cada condição de vitória (jogador e IA), contador contínuo da Economia, migração 3 → 4.
- Os gates existentes (`test:determinism`, `test:engine-switch`, `test:fog-parity`) continuam passando.

## Decisões tomadas na revisão (escolhas do Claude, aprovadas com o documento)

- **Nível 1 grátis:** Fragata 1, Torreta 1, Batedora 1 e Cargueira 1 já vêm concluídos para todos os impérios. Não contam para desbloquear o ramo Tecnologia. A migração os marca como concluídos.
- **Modo pacífico** (0 IAs): Dominação e Economia ficam desmarcadas e desabilitadas (sozinho, o jogador teria 100% da produção). Tecnologia pode ser marcada, como desafio solo.
- **Megaprojeto sem a vitória por Tecnologia:** continua existindo como chave, com outro efeito: +X% de ciência e de produção para todo o império.
- **Névoa e primeiro contato:** rivais ainda não encontrados aparecem na corrida como "Império desconhecido", com o progresso visível e sem nome nem sigilo.
- **Partida de referência pra calibrar:** dificuldade normal, tamanho de galáxia padrão, cerca de 45–60 min.
- **Depois que o jogador vence e continua em sandbox:** as checagens de vitória param.

## Decisões do construtor

- Todos os números: custos, crescimento, N do ramo Tecnologia, % dos efeitos, limiar e duração da Economia, limiar de aviso.
- Nomes finais dos nós e textos.
- Visual exato da tela de pesquisa e do painel de corrida, dentro do estilo atual.
- Como a IA pesa a vitória-alvo nas ações.
