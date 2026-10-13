# Orbital — Roadmap

Este arquivo descreve apenas trabalho futuro. O histórico detalhado das etapas do Weydra permanece em `docs/superpowers/`.

## Entregue

- Loop single-player com geração procedural, economia, pesquisa, fog of war, combate, colonização e IA.
- Configuração de partida, dificuldade e múltiplos objetivos de vitória.
- Vitória/derrota com estatísticas e continuação pós-vitória em sandbox.
- Save/load versionado com migrações, reconciliação, recuperação e dois backends de persistência.
- Motores Pixi e Weydra completos, seleção atômica e troca transacional em runtime.
- Fallbacks de backend, rollback de sessão e telas de erro recuperáveis.
- Controles desktop/mobile, acessibilidade básica, internacionalização e deploy web.

## Próximas prioridades

- Instrumentar dirty tracking por entidade para reduzir serialização no modo IndexedDB.
- Balancear numericamente os objetivos de economia, ciência e sobrevivência com telemetria de partidas reais.
- Completar onboarding e descrição de progresso de objetivo no HUD.
- Consolidar o estilo pixel-art e melhorar feedback visual de combate e rotas.
- Fechar a matriz visual automatizada: os gates cobrem Pixi/WebGL, Weydra/WebGL2 (determinismo + troca de engine), Weydra/WebGPU e perda de contexto; falta Pixi/WebGPU e a matriz manual de GPUs/drivers móveis.

## Longo prazo

- Mais conteúdo estratégico, eventos e variação de mapas.
- IA adaptativa e ferramentas de balanceamento/replay.
- Investigar multiplayer somente depois de estabilizar o loop single-player e o modelo determinístico.
