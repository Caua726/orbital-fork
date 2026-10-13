# Orbital

Jogo de estratégia espacial single-player: explore uma galáxia procedural, desenvolva colônias, pesquise tecnologias e dispute território com impérios controlados por IA.

## Estado atual

- Partidas completas com objetivos de conquista, economia, ciência, sobrevivência, exploração ou modo livre.
- Fog of war, combate automático, colonização, pesquisa, economia e personalidades de IA.
- Save/load versionado, migração de saves antigos, autosave em `localStorage` ou IndexedDB e exportação para recuperação.
- Dois motores gráficos completos e mutuamente exclusivos:
  - **Weydra**: renderer Rust/WASM com backends WebGPU e WebGL2.
  - **Pixi**: renderer clássico com backends WebGL, WebGPU e Canvas.
- Troca de motor e backend durante a execução. A partida é serializada, o renderer é reconstruído e, se houver falha, o motor anterior é restaurado automaticamente.
- Telas dedicadas para erros de boot, criação/carregamento de mundo, corrupção de save e falhas de troca de renderer.

## Desenvolvimento

Requisitos: Node.js 22+ e npm ou Bun. O adapter WASM do Weydra — o motor padrão — exige Rust conforme `weydra-renderer/rust-toolchain.toml` e `wasm-pack`.

`pkg/` (saída do `wasm-pack`) e `dist/` (saída do `tsc`) não estão versionados, e o `ts-bridge` depende do `pkg/` por `file:`. Num clone novo, gere o adapter antes de instalar — o `bun install` falha sem ele, o `npm install` apenas ignora o dep — e o plugin antes de rodar testes ou servidor:

```bash
npm run build:renderer   # adapter WASM do Weydra (wasm-pack)
npm install
npm run build:plugin     # plugin WGSL (tsc) — carregado por vite.config e vitest.config
npm run dev
```

`npm run build` roda os dois passos anteriores via `prebuild` antes do bundle Vite.

Comandos principais:

```bash
npm run typecheck
npm run lint
npm test
npm run test:determinism
npm run test:engine-switch
npm run test:fog-parity
npm run build
```

`npm run test:determinism` compara Pixi/WebGL contra Weydra/WebGL2 e, quando o navegador oferece adapter, também Weydra/WebGPU (passe pulado, não falhado, sem adapter; ajuste as flags do Chromium com `ORBITAL_WEBGPU_ARGS`). `npm run test:engine-switch` troca de motor numa partida ao vivo, cobre um viewport maior que 2048 px e a recuperação após perda de contexto. `npm run test:fog-parity` exige que a névoa tenha a mesma cor nas duas engines, que o canvas do Pixi respeite `fogAlpha` e que um sol atrás da névoa continue visível.

`npm run build` recompila o adapter WASM do Weydra e o plugin WGSL antes do bundle Vite. Para servir em outra subpasta, defina `VITE_BASE_PATH` (o padrão de deploy é `/orbital-fork/`).

## Arquitetura dos motores

A configuração persistida em `rendering.engine` seleciona exatamente um motor. A UI não permite misturar subsistemas Pixi e Weydra. Uma troca em runtime segue uma transação lógica:

1. captura um DTO sem referências gráficas e grava um snapshot de emergência;
2. pausa input, música, autosave e simulação;
3. desmonta mundo, HUD e renderer atuais;
4. inicializa o motor/backend solicitado e reconstrói a partida;
5. em falha, repete a reconstrução com a configuração anterior.

O save não contém objetos Pixi/Weydra; sprites, shaders, containers e listeners são sempre recriados. Falhas repetidas no loop Weydra acionam recuperação automática no Pixi.

## Licença

[MIT](LICENSE). Consulte [ROADMAP.md](ROADMAP.md) para o trabalho futuro.
