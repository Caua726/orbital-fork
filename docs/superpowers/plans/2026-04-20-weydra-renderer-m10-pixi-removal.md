# weydra-renderer M10 Pixi Removal & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Endgame do projeto. Pixi.js é removido por completo. Canvas único (weydra). Feature flags `weydra.*` deletadas. Bundle final medido vs baseline pré-M1.

**Architecture:** Não há arquitetura nova. Este milestone é puro cleanup: deletar imports, deletar paths fallback em cada arquivo que branchava em flag, remover Pixi canvas do DOM, `npm uninstall pixi.js`. Z-order que era "Pixi em cima de weydra" vira z-order unificado dentro do scene graph do weydra (mesma escala f32 usada em todos os tipos).

**Tech Stack:** Nenhuma nova. Só remoções.

**Depends on:** M1-M9 complete + **todos os weydra flags ativos em production por pelo menos 1 release estável** (confiança de que o path weydra cobre todos os casos).

---

## File Structure

**Deleted:**
- `vite.config.ts` — remover quaisquer imports Pixi (se existirem)
- `src/weydra-loader.ts` — flag `weydra_m1` e branches ficam inúteis, simplificar
- `src/core/config.ts` — remover `weydra: { ... }` flags
- Canvas Pixi do `index.html` (se existir) e toda config relacionada ao Pixi

**Modified (remoção pesada):**
- `src/main.ts` — remover Pixi `Application.init`, ticker
- `src/world/mundo.ts` — remover `app`, `ticker`, containers Pixi
- `src/world/fundo.ts` — remover Pixi starfield path
- `src/world/naves.ts` — remover Pixi sprite path
- `src/world/planeta-procedural.ts` — remover Pixi mesh/bake path
- `src/world/nevoa.ts` — remover canvas 2D path
- `src/world/sistema.ts`, `src/world/engine-trails.ts`, `src/world/combate-resolucao.ts` — remover Graphics Pixi
- `src/ui/*.ts` — remover imports Pixi, branches fallback
- `src/world/spritesheets.ts` — deletar Pixi Texture creation
- `src/world/fundo-canvas.ts`, `src/world/planeta-canvas.ts` — avaliar se ainda usados (provavelmente removíveis)
- `package.json` — remover dep `pixi.js` + build:renderer flag cleanup
- `package-lock.json` — auto-atualizado

---

### Task 1: Pré-flight — validar coverage dos flags

**Files:**
- Read only — validação.

- [ ] **Step 1: Validar todos os flags ON produzem jogo 100% funcional**

Antes de deletar código, confirmar em prod (ou ambiente stable) que:
```js
__setWeydra('starfield', true);
__setWeydra('ships', true);
__setWeydra('planetsBaked', true);
__setWeydra('planetsLive', true);
__setWeydra('fog', true);
__setWeydra('graphics', true);
__setWeydra('text', true);
__setWeydra('ui', true);
location.reload();
```

Bateria de testes:
- Iniciar novo jogo
- Jogar 5 min — mover câmera, colonizar, construir, atacar
- Abrir todos os painéis (planeta, naves, pesquisa, tutorial, minimap)
- Salvar e carregar save
- Mobile: testar no iPhone e Android low-end (PowerVR)

Se **qualquer** feature quebra, M10 **não começa**. Volta pro M afetado e corrige.

- [ ] **Step 2: Criar backup branch antes de começar deletes**

```bash
git checkout -b pre-m10-backup
git push origin pre-m10-backup   # preservar remoto
git checkout main
git checkout -b m10-pixi-removal
```

- [ ] **Step 3: Pre-flight grep — baseline de todo uso Pixi**

Antes de deletar uma única linha, rodar e **committar o output** como baseline:

```bash
{
  echo "# Pixi audit pre-M10";
  echo "## Files with 'from pixi.js':";
  grep -rn "from 'pixi.js'" src/ | sort;
  echo "## Files with '@pixi/':";
  grep -rn "from '@pixi/" src/ | sort;
  echo "## Test files mocking pixi:";
  grep -rn "vi.mock('pixi" src/ | sort;
  echo "## npm ls pixi.js:";
  npm ls pixi.js 2>&1 | head -40;
  echo "## npm ls @pixi:";
  npm ls @pixi 2>&1 | head -40;
} > /tmp/pixi-audit-pre-m10.txt
cat /tmp/pixi-audit-pre-m10.txt
```

Validar que **cada arquivo listado tem path weydra implementado**. Se algum não tem, voltar pro M correspondente e só então começar M10.

- [ ] **Step 4: Audit + migrate tests ANTES de qualquer delete**

Tests que mockam ou importam Pixi precisam **migração feita já** antes das Tasks 2-4 começarem. Se testes importarem um arquivo de `src/world/` que vai ser editado, eles quebram no próximo `npm run test`:

```bash
grep -rn -l "pixi" src/**/*.test.ts src/**/*.spec.ts 2>/dev/null
```

Para cada arquivo retornado:
- Se mockava `pixi.js`: substituir por mock de `@weydra/renderer` equivalente
- Se testava lógica renderer-agnostic (ex: `atualizarMundo` com mock de Pixi): remover imports Pixi, injetar mock de `getWeydraRenderer()` via `vi.mock('./weydra-loader', () => ({ getWeydraRenderer: () => mockRenderer }))`
- Se era teste de Pixi-specific (e não tem análogo weydra): deletar o teste

Rodar `npm run test` depois desta migração — precisa passar **antes de começar Task 2**. Commit:

```bash
git add src/**/*.test.ts src/**/*.spec.ts
git commit -m "refactor(tests): migrate Pixi mocks to weydra (prep for M10)"
```

Durante Tasks 2-4, `npm run test` é rodado após cada arquivo editado. Se falhar: o ponto fraco é migração incompleta (não o delete), voltar e corrigir o teste.

---

### Task 2: Remover paths Pixi do código de jogo

**Files:**
- Modify: `src/world/fundo.ts`
- Modify: `src/world/naves.ts`
- Modify: `src/world/planeta-procedural.ts`
- Modify: `src/world/nevoa.ts`
- Modify: `src/world/sistema.ts`
- Modify: `src/world/engine-trails.ts`
- Modify: `src/world/combate-resolucao.ts`
- Modify: `src/world/mundo.ts`

- [ ] **Step 1: Para cada arquivo, remover branch fallback**

Pattern:
```typescript
// Antes:
if (getConfig().weydra.XXX) {
  // weydra path
  return;
}
// Pixi fallback
// ... 50 linhas

// Depois:
// só weydra path, inline (se return virar único return, dropar o if)
```

Também remove:
- `import { ... } from 'pixi.js'` no topo do arquivo
- Qualquer campo `_pixi*` em objetos
- Qualquer `app.renderer.generateTexture`, `container.addChild`, `ticker.add`
- Helpers que só servem pro Pixi path (ex: `bakePlaneta` do Pixi se existir junto com `bakePlanetaWeydra`)

- [ ] **Step 2: Rodar a suite de testes**

```bash
npm run type-check
npm run test
npm run build
```

Esperado: type-check passa (provavelmente vai reclamar de imports não usados ou typing vazio — fix on the fly). Tests pass. Build succeeds.

- [ ] **Step 3: Commit por arquivo**

Um commit por arquivo torna review/revert mais fácil:
```bash
git add src/world/fundo.ts && git commit -m "refactor(world): remove Pixi starfield path"
git add src/world/naves.ts && git commit -m "refactor(world): remove Pixi ship rendering path"
git add src/world/planeta-procedural.ts && git commit -m "refactor(world): remove Pixi planet render/bake paths"
git add src/world/nevoa.ts && git commit -m "refactor(world): remove canvas 2D fog path"
git add src/world/sistema.ts && git commit -m "refactor(world): remove Pixi orbit graphics"
git add src/world/engine-trails.ts && git commit -m "refactor(world): remove Pixi trail graphics"
git add src/world/combate-resolucao.ts && git commit -m "refactor(world): remove Pixi beam graphics"
git add src/world/mundo.ts && git commit -m "refactor(world): remove Pixi containers + ticker"
```

---

### Task 3: Remover paths Pixi dos overlays UI

**Files:**
- Modify: `src/ui/*.ts`

- [ ] **Step 1: Limpar cada arquivo UI**

Pattern similar ao Task 2. Remove:
- `import { ... } from 'pixi.js'`
- Branch `if (getConfig().weydra.ui) { ... }`
- Helpers como `_text-helper.ts` simplificam: só o path weydra sobra (deletar import Pixi `Text`)

- [ ] **Step 2: Validar grep vazio**

```bash
grep -rn "from 'pixi.js'" src/
```

Esperado: **zero resultados**.

- [ ] **Step 3: Commit**

```bash
git add src/ui/
git commit -m "refactor(ui): remove all Pixi imports and fallback paths"
```

---

### Task 4: Simplificar spritesheets + remover canvas helpers

**Files:**
- Modify: `src/world/spritesheets.ts`
- Delete: `src/world/fundo-canvas.ts` (se não tiver outros consumidores)
- Delete: `src/world/planeta-canvas.ts` (idem)

- [ ] **Step 1: Spritesheets — só bytes, sem Pixi.Texture**

```typescript
// Antes:
sheet.texture = await Assets.load(url); // Pixi
sheet.rawBytes = /* ... */;

// Depois:
sheet.rawBytes = /* ... */;
sheet.weydraTexture = r.uploadTexture(sheet.rawBytes, sheet.width, sheet.height);
```

- [ ] **Step 2: Avaliar fundo-canvas/planeta-canvas**

Esses arquivos eram helpers de canvas 2D pra fog low-res e baked planets. Se M5 substituiu o planet bake por shader nativo e M6 substituiu o fog, eles ficam órfãos. Confirmar via `grep -rn 'from .*fundo-canvas' src/`.

Se órfãos: deletar.
```bash
rm src/world/fundo-canvas.ts src/world/planeta-canvas.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/world/
git commit -m "refactor(world): spritesheets raw-bytes-only + delete canvas helpers"
```

---

### Task 5: Remover Pixi canvas + Application do bootstrap

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/weydra-loader.ts`

- [ ] **Step 1: Remove Pixi canvas do HTML**

Se `index.html` tinha `<canvas id="pixi-canvas">`, deletar. O weydra canvas fica sozinho:
```html
<canvas id="weydra-canvas" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0;"></canvas>
```

(Sem z-index se for o único.)

- [ ] **Step 2: Extrair game-tick do startTicker Pixi**

Antes de deletar Pixi Application, **extrair** a closure que roda dentro de `app.ticker.add(...)` em `src/main.ts` pra uma função pura. O corpo real de `startTicker` lê/escreve ~8 módulos-level bindings e chama funções que hoje tomam `app`. Listar tudo explicitamente:

```typescript
// src/game-loop.ts (novo arquivo)
import { atualizarMundo, atualizarCamera, aplicarEdgeScrollAoCamera, type Mundo } from './world/mundo';
import type { Camera } from './core/camera';
import type { PanState } from './core/pan';
import type { MundoMenu } from './world/mundo-menu';

export interface GameLoopState {
  // Valores módulo-level do main.ts que ticker lia/escrevia.
  // Passa por referência — main.ts mantém o objeto e mutações são visíveis.
  mundo: Mundo | null;
  mundoMenu: MundoMenu | null;
  gameStarted: boolean;
  cinematicTime: number;
  fimTocado: boolean;
  hudAcumMs: number;
  gameSpeed: number;   // substitui app.ticker.speed
}

export interface GameLoopDeps {
  camera: Camera;
  panState: PanState;                                      // mutável, capturado por teclado handlers
  canvas: HTMLCanvasElement;                               // substitui app.canvas
  getCanvasCssSize: () => { width: number; height: number }; // substitui app.screen
  onProfilingRender?: (gpuMs: number) => void;             // GPU time via timestamp query (setup em Step 6); fallback: skip
  updateHud: () => void;                                   // substitui as N chamadas HUD individuais
}

export function gameTick(dtMs: number, state: GameLoopState, deps: GameLoopDeps): void {
  // Mover TODO o corpo original do `startTicker().add(...)` callback aqui.
  // Substituições mecânicas:
  //   app.screen.width           → deps.getCanvasCssSize().width
  //   app.screen.height          → deps.getCanvasCssSize().height
  //   app.canvas                 → deps.canvas
  //   app.ticker.deltaMS         → dtMs  (parâmetro)
  //   app.ticker.speed           → state.gameSpeed
  //   app.renderer.render(...)   → removido (weydra renderiza próprio)
  //   _mundo                     → state.mundo
  //   _mundoMenu                 → state.mundoMenu
  //   _gameStarted               → state.gameStarted
  //   _cinematicTime             → state.cinematicTime
  //   _fimTocado                 → state.fimTocado
  //   _hudAcumMs                 → state.hudAcumMs
  //   _panState                  → deps.panState
  //   camera                     → deps.camera
  //
  // Funções que hoje tomam `app` (atualizarCamera, aplicarEdgeScroll etc):
  // modificar a assinatura pra aceitar `{ width, height }` ou `camera` direto.
  // Essa é a segunda parte do Step 2 — refactor das funções chamadas, não só do ticker.
}

/** Set externa via debug-menu, UI, etc — troca o global que o tick lê. */
export function setGameSpeed(state: GameLoopState, v: number): void {
  state.gameSpeed = v;
}
```

Este é o **passo crítico** do M10. 3 sub-steps:

1. Copiar corpo literal de `startTicker` → `gameTick`, substituir refs conforme tabela
2. Atualizar `atualizarCamera(mundo, app)` → `atualizarCamera(mundo, { width, height })`, idem `aplicarEdgeScrollAoCamera` e outras funções que tomam `app`
3. Em `main.ts`, criar `const _state: GameLoopState = { mundo: null, ... }` e expor `setGameSpeed(_state, v)` pros callers (debug-menu)

Não pular nenhum. Perder qualquer ref acima vira NaN ou pan quebrado.

- [ ] **Step 3: Adaptar context-loss handler pra WebGPU**

Pixi v8 usa DOM `webglcontextlost` event no canvas. wgpu usa `GPUDevice.lost` Promise. Adicionar em `weydra-loader.ts`:

```typescript
// Depois de Renderer.create():
_renderer.onDeviceLost((reason) => {
  // mostrar dialog "GPU perdeu contexto, recarregue a página"
  // mesma UX que o path Pixi tinha
  mostrarDialogContextoPerdido(reason);
});
```

Expor via adapter wasm. **Requer `wasm-bindgen-futures` no Cargo.toml do adapter** (se ainda não tiver):

```toml
# weydra-renderer/adapters/wasm/Cargo.toml
[dependencies]
# ... existing
wasm-bindgen-futures = "0.4"
```

```rust
// weydra-renderer/adapters/wasm/src/lib.rs
use wasm_bindgen_futures::spawn_local;
use std::sync::Arc;

#[wasm_bindgen]
impl Renderer {
    pub fn on_device_lost(&self, callback: js_sys::Function) {
        // device é Arc internally em wgpu, clone é cheap e segue pro async task.
        let device = self.ctx.device.clone();
        spawn_local(async move {
            let info = device.lost().await;
            let reason = format!("{:?}: {}", info.reason, info.message);
            let this = JsValue::NULL;
            let _ = callback.call1(&this, &JsValue::from_str(&reason));
        });
    }
}
```

**Sharp edge:** se o `Renderer` for dropped antes do device ser perdido, o `spawn_local` continua rodando com o `device` clonado; mas como `device.lost()` só fulfill quando o device é explicitamente lost, e drop do Renderer dispara drop do device (se for a última ref), a promise resolve com cleanup reason e callback dispara — benign. Não há race aqui.

- [ ] **Step 4: Remove Application.init de main.ts**

Tudo que era Pixi bootstrap (criar `Application`, ticker, stage) vai embora. Chamadas a `app.screen.*` passam a usar o canvas weydra direto; chamadas a `app.renderer.render()` somem (weydra renderiza via seu próprio loop).

```typescript
// Antes:
const app = new Application();
await app.init({ /* ... */ });
app.ticker.add((ticker) => { /* 100 linhas */ });

// Depois:
// nada aqui — startWeydra() chama gameTick() dentro do seu rAF loop
```

- [ ] **Step 5: Weydra-loader — flag removido, game-tick integrado**

```typescript
import { gameTick } from './game-loop';
import { camera } from './core/camera';
import starfieldWgsl from './shaders/starfield.wgsl';
import planetWgsl from './shaders/planet.wgsl';
import fogWgsl from './shaders/fog.wgsl';

let _renderer: Renderer | null = null;
let _lastT = performance.now();
const _teardownHandlers: Array<() => void> = [];

export function teardownWeydra(): void {
  for (const fn of _teardownHandlers.splice(0)) fn();
  _renderer = null;
}

export async function startWeydra(
  state: GameLoopState,
  panState: PanState,
  updateHud: () => void,
) {
  const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement;
  const syncSize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  syncSize();

  await initWeydra();
  _renderer = await Renderer.create(canvas);
  _renderer.createStarfield(starfieldWgsl);
  _renderer.createPlanetShader(planetWgsl);
  _renderer.createFogShader(fogWgsl);

  _renderer.onDeviceLost((reason) => {
    mostrarDialogContextoPerdido(reason);
  });

  // Resize handler stored in module state pra permitir remoção em teardown
  // (context-lost recovery, test cleanup). Handler null-guards `_renderer`.
  const onResize = () => {
    syncSize();
    _renderer?.resize(canvas.width, canvas.height);
  };
  window.addEventListener('resize', onResize);
  _teardownHandlers.push(() => window.removeEventListener('resize', onResize));

  const deps: GameLoopDeps = {
    camera,
    panState,
    canvas,
    getCanvasCssSize: () => ({
      width: canvas.width / (window.devicePixelRatio || 1),
      height: canvas.height / (window.devicePixelRatio || 1),
    }),
    // GPU timestamp via wgpu timestamp query. Setup separado (Step 6 opcional —
    // postergável: no dia 1 deixa undefined, profiling HUD fica sem bucket render
    // — aceitável, Pixi bucket viraria zero depois do uninstall de qualquer jeito).
    onProfilingRender: undefined,
    updateHud,
  };

  const loop = (t: number) => {
    const dtMs = Math.min(100, t - _lastT); _lastT = t;
    tickOverlays(dtMs / 1000);
    gameTick(dtMs, state, deps);
    _renderer!.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
```

`state`, `panState`, `updateHud` são criados em `main.ts` e passados via parâmetro — mantém refs mutáveis visíveis em ambos lados. Exemplo em main.ts:

```typescript
const _state: GameLoopState = { mundo: null, mundoMenu: null, gameStarted: false, cinematicTime: 0, fimTocado: false, hudAcumMs: 0, gameSpeed: 1 };
const _panState: PanState = { left: false, right: false, up: false, down: false };
void startWeydra(_state, _panState, updateHud);
```

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.ts src/weydra-loader.ts
git commit -m "refactor(bootstrap): single weydra canvas + remove Pixi Application"
```

---

### Task 6: Remover weydra feature flags

**Files:**
- Modify: `src/core/config.ts`
- Modify: todos os arquivos que usavam `getConfig().weydra.*`

- [ ] **Step 1: Deletar bloco weydra do config**

```typescript
// Antes:
interface Config {
  // ...
  weydra: {
    starfield: boolean;
    ships: boolean;
    planetsBaked: boolean;
    planetsLive: boolean;
    fog: boolean;
    graphics: boolean;
    text: boolean;
    ui: boolean;
  };
}

// Depois:
interface Config {
  // ... (sem weydra)
}
```

Também remove console helpers `__setWeydra`, `__getWeydra`.

- [ ] **Step 2: Grep por referências restantes**

```bash
grep -rn "getConfig().weydra" src/
grep -rn "__setWeydra" src/
```

Ambos devem retornar **vazio** depois das remoções de Tasks 2-5.

- [ ] **Step 3: Commit**

```bash
git add src/core/config.ts src/
git commit -m "refactor(config): remove weydra feature flags — migration complete"
```

---

### Task 7: Uninstall Pixi + limpar Vite config

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `package-lock.json` (automático)

- [ ] **Step 1: Audit dep tree antes do uninstall**

```bash
npm ls pixi.js 2>&1 | tee /tmp/pixi-tree-pre-uninstall.txt
npm ls 2>&1 | grep -i '@pixi' | tee -a /tmp/pixi-tree-pre-uninstall.txt
```

Se qualquer `@pixi/*` aparecer como top-level, listar e desinstalar junto:
```bash
# exemplo: se @pixi/sound existisse
npm uninstall pixi.js @pixi/sound
```

Transitive deps (pacotes que pedem Pixi internamente) **podem** sobreviver — esses dependem de outros consumidores e não são problema enquanto nada do jogo importa deles.

- [ ] **Step 2: Uninstall**

```bash
npm uninstall pixi.js
```

- [ ] **Step 3: Validar grep**

```bash
grep -rn "pixi" package.json
grep -rn "from 'pixi.js'" src/
grep -rn "from '@pixi" src/
npm ls pixi.js 2>&1 | grep -v "empty\|(empty)" | grep pixi
```

Primeiros 3: zero. Último: vazio ou "(empty)".

- [ ] **Step 3: Vite config cleanup**

Se tinha algum plugin específico pro Pixi (unlikely), remover. Garantir que `wasm` + `topLevelAwait` + `wgsl` ainda estão ativos.

- [ ] **Step 4: Build + test full**

```bash
npm run type-check
npm run test
npm run build
npm run preview
```

Esperado: tudo passa. `dist/` produzido. Visualmente jogar 5 min no preview — ok.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore: uninstall pixi.js — renderer is now 100% weydra"
```

---

### Task 8: Apply unified z-order em todos os world pools

**Files:**
- Modify: `src/world/fundo.ts`, `src/world/naves.ts`, `src/world/planeta-procedural.ts`, `src/world/nevoa.ts`, `src/world/sistema.ts`, `src/world/engine-trails.ts`, `src/world/combate-resolucao.ts`

- [ ] **Step 1: Verificar render-order.ts existe**

`src/core/render-order.ts` **já foi criado em M9 Task 0** com todas as constants. Confirmar:

```bash
cat src/core/render-order.ts
```

Se o arquivo não tem entries pra world layers (SHIPS, STARFIELD, PLANET_*, etc), adicionar **só os faltantes** — sem duplicar bloco Z. Esperado: M9 já criou tudo. Se por acaso algum M intermediário editou, mergear.

- [ ] **Step 2: Assign zOrder em cada world entity**

Durante M2-M7, cada sistema já deveria ter setado `zOrder` ao criar seus sprites/graphics — se não fizeram, é uma dívida que M10 fecha agora. Auditoria:

```bash
grep -rn "zOrder" src/world/
```

Para cada pool/objeto que não tem zOrder explícito, atribuir conforme convenção em `render-order.ts`:

```typescript
import { Z } from '../core/render-order';
ship.zOrder = Z.SHIPS;
planet.zOrder = Z.PLANET_LIVE;
starfield.zOrder = Z.STARFIELD;
// etc
```

- [ ] **Step 3: Commit**

```bash
git add src/world/
git commit -m "refactor(order): apply unified z-order across world pools"
```

---

### Task 9: Performance final + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-04-19-weydra-renderer-design.md`

- [ ] **Step 1: Benchmark pre-M1 vs pós-M10**

Rodar no mesmo device (e.g. Android low-end PowerVR):
- Cena de referência: 1 sistema com 15 planetas + 40 naves + painel aberto
- Medir frame time avg + p95 em 60 segundos

Comparar:
- `git checkout <commit antes do M1>` → medir → `pre-M1.json`
- `git checkout main` → medir → `post-M10.json`

**Gate criteria (hard pass/fail — M10 não é merged se falhar):**

| Métrica | Critério |
|---|---|
| Frame time p95 (PowerVR low-end) | ≤ 110% do pre-M1 p95 |
| Frame time avg (qualquer device-alvo) | ≤ 105% do pre-M1 avg |
| Bundle JS+WASM gzipped | ≤ 120% do pre-M1 JS gzipped |
| Cold start time (até primeira frame) | ≤ 150% do pre-M1 |

Se qualquer métrica falhar:
1. Merge do M10 é **abortado**
2. Branch `m10-pixi-removal` fica parked
3. Issue aberta com profile capture
4. Fix prioritizado; só re-tentar M10 quando todas as gates passarem

Objetivo (não-gate, aspiracional): 15-30% melhor p95 em mobile low-end — mas falha desse objetivo **não** trava merge, só das gates acima.

- [ ] **Step 2: Bundle size**

```bash
npm run build
ls -lh dist/assets/
```

Comparar com pre-M1. Pixi era ~500KB gzipped. Weydra WASM é ~500KB-2MB dependendo de features. Esperado: comparável.

- [ ] **Step 3: Atualizar spec — M10 complete + Fase A complete**

Adicionar no fim do spec:

```markdown
## M10 Status: Complete (YYYY-MM-DD)

Pixi.js removed. Single-canvas weydra renderer in production.

Bundle: dist/orbital.js = XKB gzipped, weydra.wasm = YKB gzipped
(pre-M1 baseline: ZKB + Pixi ~500KB gz).

Frame time median (Android low-end PowerVR, scene referência):
- pre-M1: 22.4ms avg, 38ms p95
- post-M10: 16.8ms avg, 24ms p95

Fase A goal atingido. Fase B (engine reusável pra outros jogos weydra) fica pra backlog.
```

- [ ] **Step 4: Tag release**

```bash
git tag -a v2.0-weydra -m "weydra-renderer Fase A complete — Pixi-free"
git push origin v2.0-weydra
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/superpowers/specs/
git commit -m "docs(weydra-renderer): mark M10 + Fase A complete"
```

---

### Task 10: Deploy + soak

- [ ] **Step 1: Deploy pra staging (ou GitHub Pages direto se for o env)**

Jogar em todos os devices que o projeto suporta:
- Chrome desktop + Firefox + Safari
- Chrome Android
- Safari iOS (iPhone SE, iPhone 14)
- Android low-end real (PowerVR target)

Soak de 10-30 min por device. Monitorar DevTools console pra validation errors wgpu ou JS crashes.

- [ ] **Step 2: Rollback plan**

Se regressão detectada em staging: reverter pro `pre-m10-backup` branch e abrir issue específica pro bug. M10 não é "merge então corrige em follow-up" — ou está limpo ou volta.

---

## Self-Review

**Spec coverage:**
- ✅ Canvas Pixi removido
- ✅ `import 'pixi.js'` zero hits em `src/`
- ✅ `pixi.js` dep uninstall
- ✅ Feature flags deletadas
- ✅ Single weydra canvas
- ✅ Z-order unified
- ✅ Benchmark pre vs pós
- ✅ Tag release

**Not attempted (intencional):**
- Otimizações de performance agressivas (já validadas ao longo de M1-M9; se precisa mais, vira Fase B backlog)
- Refactor de scene graph pra hierarchy (Fase B)
- Editor/inspector do weydra (Fase B/C)

**Risks:**
- Bug latente em weydra path que nunca foi exercido em prod aparece agora sem fallback. Mitigação: Task 1 (pré-flight com todos os flags on por 1 release antes de começar M10).
- Dependente transitiva de Pixi (ex: algum helper usa `@pixi/colord`). `npm uninstall pixi.js` pode quebrar. Mitigação: fazer `npm ls pixi.js` antes pra ver o tree.
- Build em CI pode pegar cache stale de `pkg/` do weydra — documentar que CI roda `build:renderer` fresh.
- `index.html` em GitHub Pages: URL de assets muda se o bundle hash mudar. Forçar cache invalidation após deploy.
