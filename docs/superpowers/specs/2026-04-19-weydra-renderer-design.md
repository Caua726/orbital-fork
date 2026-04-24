# weydra-renderer — Design Spec

**Status:** draft · **Data:** 2026-04-19 · **Autor:** caua + Claude

## Resumo

Renderer gráfico 2D próprio em Rust + wgpu, substituindo Pixi.js no jogo Orbital. Primeiro projeto do namespace `weydra` (empresa). Arquitetura pensada pra evoluir de "renderer de Orbital" → "engine 2D reusável" → "engine completa com audio/physics/input" sem precisar refactor.

O jogo é renderizado hoje em Pixi v8 (WebGL2 / WebGPU / Canvas2D fallback). O alvo do weydra-renderer é **bater o Pixi em frame time no mobile low-end** (PowerVR BXM-8-256 reportado, Adreno/Mali faixa média) mantendo visual idêntico ao atual.

## Objetivos

1. Renderer 2D próprio controlado 100% por nós (sem dependência de Pixi)
2. Performance igual ou melhor que Pixi em todos os devices que o Orbital atende
3. Multi-plataforma via wgpu: WebGPU, WebGL2, Vulkan, Metal, DX12, GLES 3.0
4. API TypeScript com type-safety, ergonomia decente, overhead praticamente zero no hot path
5. Migração incremental — jogo **nunca quebra** durante o dev
6. Base reusável pra futuros jogos do ecossistema weydra

## Não-objetivos

- Não é uma reimplementação do Pixi — não vamos replicar API dele
- Não é engine com ECS/audio/physics/editor **na fase inicial** (escopo pode evoluir pra isso)
- Consoles (Switch/PS/Xbox) não estão no escopo atual

## Escopo por fase

- **Fase A (atual):** renderer funcionando no Orbital via web + scaffolding multi-plataforma (desktop nativo Windows/macOS/Linux + Android/iOS). Substitui Pixi completamente na web (M10). Native adapters têm skeleton e cargo-check passa em M1.5; adapters completos (M11 desktop, M12 mobile) entram se/quando houver demanda.
- **Fase B (futura):** engine 2D reusável por outros jogos. API abstrai Orbital-specifics.
- **Fase C (distante):** engine completa com audio/physics/input/asset pipeline. Fora do spec atual.

Design decisions do spec atual **não travam** evolução pra B ou C — princípio de fronteiras limpas do primeiro dia. Regra concreta: `core/` crate nunca importa `web-sys`, `js-sys`, `wasm-bindgen`, `winit`, nem nada platform-specific. Todas as platform deps vivem em `adapters/*`.

## Contexto: auditoria do Pixi atual

Auditoria completa gerada durante brainstorming (in-conversation, 2026-04-19). Resumo consolidado:

- **28 arquivos, 486 referências** a classes Pixi no código fonte
- Classes realmente usadas: Application, Container, Sprite, Graphics, Mesh, Shader, GlProgram/GpuProgram, UniformGroup, Geometry, Buffer, Texture, RenderTexture, TilingSprite, Text, AnimatedSprite, Rectangle, Assets, Ticker, ImageSource
- 2 shaders customizados (planeta.wgsl + GLSL, starfield.wgsl + GLSL)
- Graphics API: ~12 métodos (circle, rect, roundRect, moveTo, lineTo, arc, fill, stroke, clear)
- 2 blend modes: normal + add
- 2 scale modes: nearest (quase tudo) + linear (só fog)
- Hit-testing: majoritariamente custom via DOM addEventListener, MAS Pixi eventMode é usado mais do que parece — **5 objetos com `eventMode='static'`** em `minimapa.ts`, `tutorial.ts`, `painel.ts`, `selecao.ts`, e **~11 handlers `.on('pointer...')`** ativos (selection cards com hover+press, action buttons nos painéis, close button do tutorial, click-to-navigate no minimap). Migração precisa re-wire esses no M7-M9, não só M9
- **Não usa:** Filter (zero instâncias), BitmapFont, mask, cacheAsTexture, post-processing
- RenderTexture usado só pra shader warmup (não crítico)
- Text: **~30 usos** de `new Text(...)` distribuídos em 4 arquivos (`src/ui/painel.ts` ~24, `src/ui/selecao.ts`, `src/ui/tutorial.ts`, `src/world/nevoa.ts`) — audit inicial subestimou como "3 usos". M8 escopa os 30.

## Arquitetura

### Layout do repo

```
orbital-fork/
├── src/                              ← jogo TS
│   ├── shaders/                      ← shaders do JOGO (game-specific)
│   │   ├── planet.wgsl
│   │   └── starfield.wgsl
│   └── ... (importa de weydra-renderer/ts-bridge + consome .wgsl via Vite plugin)
│
├── weydra-renderer/                  ← raiz do projeto renderer (reusável)
│   ├── Cargo.toml                    ← workspace root
│   ├── core/                         ← crate: weydra-renderer
│   │   ├── Cargo.toml                ← deps: wgpu, bytemuck, glam, lyon, fontdue, naga
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── device.rs             ← wgpu Instance/Adapter/Device/Queue
│   │   │   ├── surface.rs            ← abstração de surface
│   │   │   ├── camera.rs             ← camera global (bind group 0)
│   │   │   ├── scene.rs              ← scene graph, slotmap handles
│   │   │   ├── transform.rs          ← affine 2D
│   │   │   ├── texture.rs            ← texture manager + atlas
│   │   │   ├── sprite.rs             ← sprite batcher
│   │   │   ├── graphics.rs           ← vector primitives via lyon
│   │   │   ├── mesh.rs               ← custom shader meshes (API genérica)
│   │   │   ├── shader.rs             ← shader registry, WGSL compile, reflection
│   │   │   ├── text.rs               ← bitmap font (fontdue)
│   │   │   ├── frame.rs              ← frame orchestration
│   │   │   └── pools/                ← per-shader-type uniform pools
│   │   ├── shaders/                  ← SÓ shaders genéricos do engine
│   │   │   ├── sprite.wgsl
│   │   │   ├── graphics.wgsl
│   │   │   └── text.wgsl
│   │   └── tests/
│   ├── adapters/
│   │   ├── wasm/                     ← crate: weydra-renderer-wasm
│   │   │   ├── Cargo.toml            ← deps: core + wasm-bindgen + web-sys
│   │   │   └── src/lib.rs
│   │   └── winit/                    ← crate: weydra-renderer-winit (fase B)
│   ├── vite-plugin-wgsl/             ← Vite plugin que transforma .wgsl em TS tipado
│   │   └── index.ts
│   ├── examples/                     ← demos standalone do renderer
│   │   ├── hello-clear/
│   │   ├── sprite-batcher/
│   │   └── custom-shader/            ← demo de como consumir shader custom
│   └── ts-bridge/                    ← API TS genérica, SEM conhecer shaders do jogo
│       ├── index.ts
│       ├── sprite.ts
│       ├── graphics.ts
│       └── mesh.ts                   ← renderer.createShader(wgsl, layout)
│
└── ... resto do jogo
```

**Separação crítica:** shaders específicos do jogo (planet, starfield) vivem em `src/shaders/` do jogo. O renderer **não conhece Orbital**. Game consome API genérica pra registrar seus próprios shaders. Requisito pra escopo B (engine reusável) — outros jogos que usarem weydra-renderer trazem os shaders deles.

Princípio da separação core / adapters:

- `core/` **não conhece browser, TS, WASM**. Só wgpu + Rust puro. Roda em qualquer target que wgpu suporte.
- `adapters/xxx/` cada um é crate fina que traduz entre runtime-alvo e core. Adicionar target novo = nova pasta em `adapters/`, zero mudança no core.
- `ts-bridge/` mora dentro do weydra-renderer porque é parte da interface pública. Outros projetos que consumirem weydra também querem essas bindings.

### Stack técnica

- **Linguagem:** Rust (stable, nightly apenas se absolutamente necessário)
- **GPU:** wgpu nightly latest version+ (crate oficial WebGPU)
- **Browser binding:** wasm-bindgen + wasm-pack
- **Vector tessellation:** lyon crate
- **Text rasterization:** fontdue crate (bitmap font)
- **Serialization:** bytemuck pra `#[repr(C)]` → bytes
- **Math:** glam crate (vec/mat 2D otimizado)
- **Build:** Cargo workspaces + wasm-pack build
- **Test:** cargo test (native) + wasm-pack test (browser)

### Backends suportados

Via wgpu, herdados automaticamente:

| Alvo | Backend | Fase | Adapter |
|---|---|---|---|
| Chrome/Edge desktop | WebGPU | A | `adapters/wasm` |
| Chrome Android (browser) | WebGPU | A | `adapters/wasm` |
| Safari desktop 17+ | WebGPU | A | `adapters/wasm` |
| Firefox desktop | WebGL2 | A | `adapters/wasm` |
| Safari iOS 17+ (browser) | WebGL2 | A | `adapters/wasm` |
| Mobile browser low-end (PowerVR/Adreno/Mali) | WebGL2 | A | `adapters/wasm` |
| Hardware sem GPU (WARP/SwiftShader) | Canvas2D fallback (path TS existente) | A | — |
| Windows desktop native | DX12 / Vulkan | **A (scaffolding M1.5 / adapter M11)** | `adapters/native` |
| Linux desktop native | Vulkan | **A (scaffolding M1.5 / adapter M11)** | `adapters/native` |
| macOS desktop native | Metal | **A (scaffolding M1.5 / adapter M11)** | `adapters/native` |
| Android native (APK) | Vulkan | **A (scaffolding M1.5 / adapter M12)** | `adapters/android` |
| iOS native | Metal | **A (scaffolding M1.5 / adapter M12)** | `adapters/ios` |
| Steam Deck | Vulkan | A (via `adapters/native` Linux) | `adapters/native` |

**Consoles (Switch/PS/Xbox)**: fora de escopo atual. Se e quando virar objetivo, avaliamos SDK específico da época. Não desenhamos o renderer em função deles agora.

Backends **explicitamente não-alvo:**

- GLES 2.0 (sem instancing, shaders incompatíveis, <1% audiência)
- OpenGL 1.x (fixed function, impossível manter visual atual)
- Software raster custom via WASM (pior que Canvas2D nativo do browser)

## Estratégia de binding TS ↔ Rust

Abordagem: **wasm-bindgen + escape hatches de shared memory** (opção 6 da análise).

### Classificação de operações

| Tipo | Frequência | Mecanismo |
|---|---|---|
| Setup (create/destroy/upload) | Rara | wasm-bindgen direto, ergonômico |
| Hot path (position/color/visibility updates) | 1000s/frame | Escrita direta em `Float32Array`/`Uint32Array` views sobre WASM memory |
| Frame end | 1×/frame | `renderer.render()` via wasm-bindgen |

### Exposição de memória compartilhada

Rust aloca pools SoA (Structure-of-Arrays) em WASM linear memory. Exporta pointer + capacidade via wasm-bindgen. TS cria typed array views sobre os mesmos bytes.

```rust
#[wasm_bindgen]
impl Renderer {
    pub async fn new(canvas: HtmlCanvasElement) -> Renderer { /* ... */ }
    pub fn upload_texture(&mut self, bytes: &[u8], w: u32, h: u32) -> u32 { /* ... */ }
    pub fn create_sprite(&mut self, texture: u32) -> u64 { /* ... */ }
    pub fn destroy(&mut self, handle: u64) { /* ... */ }

    // Escape hatches pra hot path. wasm-bindgen NÃO aceita retorno de
    // `*const T` direto — expomos como u32/usize e reconstituímos a
    // view no TS via `wasm.memory.buffer + offset`.
    pub fn transforms_ptr(&self) -> u32 { self.transforms.as_ptr() as u32 }
    pub fn colors_ptr(&self) -> u32 { self.colors.as_ptr() as u32 }
    pub fn flags_ptr(&self) -> u32 { self.flags.as_ptr() as u32 }
    pub fn capacity(&self) -> u32 { /* ... */ }
    pub fn mem_version(&self) -> u32 { self.mem_version }  // incrementa se memory growth

    pub fn render(&mut self) { /* ... */ }
}
```

```ts
// ts-bridge wrapper — API ergonômica com writes diretos
class Sprite {
  set x(v: number) { renderer.views.transforms[this.handle * 4 + 0] = v; }
  set y(v: number) { renderer.views.transforms[this.handle * 4 + 1] = v; }
  // ...
}
```

### Custo medido vs alternativas

| Abordagem | Boundary crossings/frame | Custo estimado |
|---|---|---|
| wasm-bindgen per-call | ~1200 | 1-3ms |
| Raw extern "C" | ~1200 | 0.1-0.3ms |
| Shared memory manual | 1 | <0.05ms |
| **wasm-bindgen + shared memory (escolhido)** | **1** | **<0.05ms** |

### Capacidade pré-alocada + revalidação obrigatória

Pré-alocar capacidade ajuda mas **não é suficiente**. `WebAssembly.Memory` pode crescer por motivos fora do nosso controle:

- Upload de textura grande (staging buffer temporário no Rust)
- Lyon tessellation criando buffers novos durante `render()`
- Alocações transientes de wasm-bindgen glue (strings de erro, debugging)

Qualquer growth detacha o `ArrayBuffer` subjacente e invalida SILENCIOSAMENTE todos os typed array views — reads retornam 0, writes são no-op. Bug terrível de debugar.

**Mecanismo obrigatório:**

```rust
// core: mantém um version counter que incrementa após qualquer
// operação que pode ter causado memory growth
pub struct Renderer {
    mem_version: u32,
    // ...
}

// Método exposto ao TS
pub fn mem_version(&self) -> u32 { self.mem_version }
```

```ts
// ts-bridge: checa versão a cada operação que pode ter crescido memory.
// DUPLA checagem obrigatória: mem_version E `_wasm.memory.buffer` identity.
// `memory.grow()` detacha o ArrayBuffer silenciosamente; um bump de
// mem_version perdido (bug em Rust ou edge case) ainda invalidaria views.
class Renderer {
  private views: { transforms: Float32Array, /* ... */ };
  private lastMemVersion: number = 0;
  private lastBuffer: ArrayBuffer | null = null;

  private revalidate() {
    const v = this.wasm.mem_version();
    const buf = this.wasm.memory.buffer;
    if (v === this.lastMemVersion && buf === this.lastBuffer) return;
    this.views.transforms = new Float32Array(
      buf,
      this.wasm.transforms_ptr(),
      this.wasm.capacity() * 4
    );
    // ... recriar TODOS os views
    this.lastMemVersion = v;
    this.lastBuffer = buf;
  }

  uploadTexture(bytes: Uint8Array) {
    const id = this.wasm.upload_texture(bytes, ...);
    this.revalidate();  // upload pode ter causado growth
    return id;
  }

  render() {
    this.wasm.render();
    this.revalidate();  // render pode ter causado growth (lyon tessellation)
  }

  // Hot path: SEM revalidate, porque setters não alocam
  setPosition(h, x, y) {
    this.views.transforms[h * 4] = x;
    this.views.transforms[h * 4 + 1] = y;
  }
}
```

Revalidação vale só ~50ns (comparação de inteiro + reconstrução condicional de Float32Arrays). No hot path, pula. Em setup ops, chama sempre.

Capacidade inicial: 10.000 sprites, 500 meshes, 10.000 graphics nodes (~460KB). Generoso o suficiente pra raramente crescer.

## Scene graph + modelo de dados

### SlotMap com generational indices

Handles opacos (u64 = slot + generation). Remove + create no mesmo slot invalida handles antigos em vez de corromper.

### Entidades do core

**1. Sprite** — textured quad. Grosso do rendering (naves, planetas baked, UI icons).

**2. Graphics** — retained mode vector (círculos, linhas, arcos, retângulos). Tessellation via lyon, cached em vertex buffer. Dirty flag só re-tessela se mudou.

**3. Mesh** — shader customizado (planeta, starfield, futuros). Uniforms em pool SoA compartilhado.

### Memory layout (SoA)

```
Pool Transform  [N × 4 f32]   = N × 16 bytes    ← pointer exposto
Pool Color      [N × 1 u32]   = N × 4 bytes     ← pointer exposto
Pool Alpha      [N × 1 f32]   = N × 4 bytes     ← pointer exposto
Pool Flags      [N × 1 u8]    = N × 1 byte      ← pointer exposto
Pool Z-order    [N × 1 f32]   = N × 4 bytes     ← pointer exposto
Pool Texture    [N × 1 u32]   = N × 4 bytes     ← pointer exposto

Uniforms per-shader-type (um pool por tipo de shader):
  PlanetUniforms  [M × sizeof(PlanetUniforms)]   ← pointer exposto
  StarfieldUniforms [1 × sizeof(StarfieldUniforms)] ← pointer exposto
```

**Convenção de cor packed (u32):** layout `0xRR_GG_BB_AA` (R no byte mais significativo, A no mais baixo). TS `packColor(rgb, alpha)` usa `>>> 0` no final pra forçar unsigned. Rust unpack: `r = (c >> 24) & 0xff`, etc. Ver `sprite_batch.wgsl`, `text.wgsl`, `graphics.wgsl`.

**Convenção de Z-order (canônica, usada a partir do M3):** todos os pools/objetos ordenam por `z_order: f32` crescente (baixo renderiza primeiro):

| Layer | Z |
|---|---|
| STARFIELD | 0 |
| STARFIELD_BRIGHT | 1 |
| PLANET_BAKED | 10 |
| PLANET_LIVE | 11 |
| ORBITS | 20 |
| ROUTES | 25 |
| SHIP_TRAILS | 28 |
| SHIPS | 30 |
| BEAMS | 35 |
| FOG | 40 |
| UI_BACKGROUND | 50 |
| UI_GRAPHICS | 51 |
| UI_TEXT | 52 |
| UI_HOVER | 55 |

Constantes exportadas de `src/core/render-order.ts` (criado em M9 Task 0).

### Batching

`render()` percorre pools, filtra invisible, ordena por (z_order, texture_id, shader_id), agrupa em draw calls batched por (texture + shader + blend). Target: 5-15 draw calls por frame em cena típica do Orbital.

Instancing (draw múltiplos planetas com 1 call) fica pra quando virar gargalo provado — não upfront.

## Shader system

### Princípio

WGSL é a única linguagem que escrevemos. wgpu traduz pra SPIR-V (Vulkan), MSL (Metal), HLSL (DX12), GLSL (WebGL2), WGSL nativo (WebGPU).

### Convenção de bind groups (padrão do engine)

Todos os shaders custom seguem esta convenção fixa:

| Bind group | Owner | Conteúdo |
|---|---|---|
| **0** | Engine | `uCamera: vec2<f32>`, `uViewport: vec2<f32>`, `uTime: f32`, matrices padrão |
| **1** | Shader custom | Uniforms específicos do shader (ex: PlanetUniforms, StarfieldUniforms) |
| **2** | Shader custom | Textures + samplers do shader |

Engine popula bind group 0 automaticamente a cada frame. Shader custom só declara o que é seu em bind groups 1/2.

**Convenção `CameraUniforms.viewport`:** em **world units** (`screenW/zoom`, `screenH/zoom`), NÃO em pixels. Caller (camera.ts) computa a divisão uma vez por frame e escreve no UBO. Shaders ficam zoom-agnostic (`camera + (uv - 0.5) * viewport` já está correto em qualquer zoom). Nenhum shader aplica zoom manualmente. Decidida em M2 e válida de M2 em diante.

```wgsl
// planet.wgsl
@group(0) @binding(0) var<uniform> camera: CameraUniforms;  // grátis, do engine
@group(1) @binding(0) var<uniform> planet: PlanetUniforms;  // próprio do shader
```

**Benefícios:**
- Shader custom não redeclara camera/viewport/time — ganha grátis
- Trocar câmera (ex: render pra minimap com câmera diferente) = rebind só do group 0
- Padrão comum em engines modernas (Bevy, Godot)

### Per-shader-type homogeneous pool

Cada tipo de shader (planet, starfield, etc.) tem seu próprio pool com `#[repr(C)]` struct tipada:

```rust
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct PlanetUniforms {
    pub u_time: f32,
    pub u_seed: f32,
    // ... campos alinhados a 16 bytes
}

pub struct PlanetPool {
    instances: Vec<PlanetUniforms>,
    gpu_buffer: wgpu::Buffer,
    slotmap: SlotMap<usize>,
}
```

Vantagens:
- Layout homogêneo → bind group único por pool
- Type safety total (struct Rust é fonte de verdade)
- Update buffer é `queue.write_buffer(&gpu_buffer, 0, bytemuck::cast_slice(&instances))`
- Naturalmente instanceable quando necessário

### TS wrappers — via Vite plugin (`vite-plugin-wgsl`)

Escrever wrappers TS à mão é tedioso e quebra sync quando o shader muda. Abordagem escolhida: **Vite plugin custom** que transforma `import` de `.wgsl` em módulo TS tipado automaticamente.

```ts
// game code
import planetShader from './shaders/planet.wgsl';

// Tipo inferido automaticamente do .wgsl:
//   planetShader.create(): PlanetInstance
//   PlanetInstance { uTime, uSeed, uLightOrigin, ... }

const instance = planetShader.create();
instance.uTime = 0.5;              // ← typed, zero overhead
instance.uSeed = 3.14;
instance.setLightOrigin(0.5, 0.5); // ← vec2 vira método
```

**Como o plugin funciona:**

1. Vite intercepta `import X from './path/shader.wgsl'`
2. Plugin lê o arquivo, passa pro `naga` (WASM ou CLI) pra extrair layout de uniforms (campos, offsets, tipos)
3. Plugin emite um módulo TypeScript virtual com classe tipada e setters que escrevem direto nas typed array views do renderer
4. Vite importa o módulo virtual normalmente

**Funciona nativamente com `npm run dev`:**
- Editar `planet.wgsl` → Vite detecta mudança → plugin regera → HMR reload instantâneo
- Zero arquivos `.ts` gerados no disco (não polui git, não tem "arquivo gerado vs fonte" sync issue)
- Integração é uma linha em `vite.config.ts`: `plugins: [wgslPlugin()]`

**Base técnica:** plugins existentes como `vite-plugin-glsl` ou `vite-plugin-wgsl-shader` cobrem parte do problema (importar shader source). A gente estende pra extrair layout de uniforms via `naga` e gerar types/setters.

**Benefícios:**
- WGSL é single source of truth — TS e Rust sempre em sync
- Mudar shader = editar `.wgsl`, tudo mais atualiza
- TypeScript compiler pega divergência em build (ex: campo renomeado)
- Works pra 2 ou 200 shaders igual

O plugin vai como task no M1 Foundation.

### Shaders existentes: port direto

`planeta.wgsl` e `starfield.wgsl` já são WGSL. Port = renomear bindings pra novo bind group layout. Zero mudança de lógica.

### Fallback WebGL2

wgpu traduz WGSL → GLSL 3.00 ES via `naga` crate. Features básicas (uniforms, textures, sampling) mapeiam limpo.

**Gaps conhecidos** que podem exigir ajuste shader-side:
- `textureNumLevels` não existe em GLSL 3.00 ES — hoje não usamos
- `textureDimensions` em recursos não-uniformes — hoje não usamos
- Dynamic array indexing em loops pode gerar GLSL inválido em alguns casos
- Arrays de cores indexados dinamicamente — `planeta.wgsl` usa `uColors0..uColors5` via switch, deve funcionar mas validar

M2 (starfield) e M5 (planet) são os testes reais do path WebGL2. Se algum shader exigir tweaks pro backend GL, adicionar como task extra no milestone afetado.

## Estratégia de migração

### Coexistência: dois canvases stacked

```html
<canvas id="weydra-canvas" style="z-index: 0; position: fixed; ...">
<canvas id="pixi-canvas"   style="z-index: 1; background: transparent; ...">
```

- Canvas Pixi com background transparente, Canvas weydra em baixo
- Camera x/y/zoom sincronizada entre os dois (mesmo source of truth no TS)
- Input (pointerdown etc.) continua no Pixi canvas
- Conforme sistemas migram, Pixi equivalents viram no-op
- No M10 (fim), Pixi canvas é removido

**Limitação aceita:** z-order entre objetos em canvases diferentes é fixo. Mitigado por migrar rigidamente bottom-up (starfield → ships → planets → graphics → UI).

### Milestones

Ordem rígida bottom-up pra respeitar z-order durante coexistência Pixi+weydra. Cada M é independente do ponto de vista de rollback (pode desligar via flag sem afetar os outros), mas tecnicamente depende dos anteriores.

#### M1 — Foundation

**Escopo:** Infraestrutura crua. Nada renderiza, nada é migrado. Só prova que o pipeline Rust→wgpu→WASM→TS→Vite→canvas funciona end-to-end.

**Entregáveis:**
- Cargo workspace com `core/` (Rust + wgpu) + `adapters/wasm/` (wasm-bindgen)
- Primitivas core: `GpuContext` (Instance/Adapter/Device/Queue), `RenderSurface` (swap chain), `render_clear` (render pass trivial)
- `CameraUniforms` struct (placeholder — bind group 0 preparado mas não preenchido ainda)
- Native example (`examples/hello-clear/`) com winit — valida core sem browser
- WASM adapter expondo `Renderer::new(canvas)`, `render()`, `resize()`
- `ts-bridge/` com `initWeydra()` + `Renderer.create(canvas)`
- `vite-plugin-wgsl` passthrough (M1 só retorna source string; reflection vem no M2)
- Segundo canvas `#weydra-canvas` no `index.html` atrás do Pixi canvas (z-index 0 vs 1)
- Loader em `src/weydra-loader.ts` atrás de flag `localStorage.weydra_m1`
- Build script `build:renderer` no `package.json` + plugins Vite (wasm + top-level-await + wgsl)

**Critério de merge:** com flag on, canvas weydra pinta preto a 60fps atrás do Pixi, zero regressão no jogo (Pixi continua renderizando normal), `cargo build --workspace` + `cargo test` + `npm run dev` + `npm run build` todos limpos.

**Resultado prático:** nada visível pro jogador. Infra pronta pros próximos Ms se plugarem.

---

#### M1.5 — Multi-Platform Scaffolding

**Escopo:** Preparar o workspace pra futura compatibilidade nativa (Windows, macOS, Linux desktop + Android + iOS) sem construir os adapters completos ainda. É parallel-track — não bloqueia M2+. Objetivo é garantir que escolhas feitas em M2-M10 não pintem o projeto num canto "web-only".

**Entregáveis:**
- `adapters/native/` crate skeleton (winit + wgpu, promove `examples/hello-clear` pra adapter reutilizável)
- `adapters/android/` crate skeleton (winit com feature `android-activity`, cargo check cross-compila)
- `rust-toolchain.toml` com targets `wasm32-unknown-unknown`, `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-gnu`, `aarch64-apple-darwin`, `aarch64-linux-android`, `aarch64-apple-ios`
- Feature flags por plataforma no `core/Cargo.toml`: `web` (default se não há outra), `native`, `android`, `ios`
- Audit do `core/` crate: **zero** deps `web-sys`, `js-sys`, `wasm-bindgen` — core é platform-agnostic por construção
- Documento `docs/weydra-renderer/platform-guards.md` listando o que M2-M10 podem/não podem importar em cada crate
- CI matrix (local script inicialmente, GitHub Actions eventualmente): `cargo check` pra cada target
- README do weydra-renderer com matriz de plataformas suportadas vs status
- Tag `v0.1-multiplatform` quando todos os `cargo check` passam

**Critério de merge:** `cargo check --target X` passa pra web, native Linux, native Windows (via mingw), native macOS, Android. `adapters/native` roda o hello-clear window com clear color. Core crate tem zero imports browser-specific (grep automated). Nenhuma regressão no path WASM existente (M1 continua funcionando).

**Resultado prático:** nada visível pro jogador. Estratégico: qualquer decisão em M2-M10 que acidentalmente use `web-sys` em core quebra o build Linux/Android/iOS imediatamente, catch cedo. Opcional: pode rodar em paralelo com M2+, não bloqueia.

---

#### M2 — Starfield

**Escopo:** Primeiro shader custom real rodando. Starfield procedural do Orbital migra pro weydra. Estabelece convenção de bind groups + uniform pool pattern.

**Entregáveis:**
- `ShaderRegistry` em Rust (compilação WGSL, cache por hash)
- `EngineBindings` (bind group 0: `CameraUniforms` buffer ligado, visível a todos os shaders)
- `UniformPool<T>` genérico (homogeneous Vec<T>, mirror GPU buffer, pointer exposto)
- `Mesh` primitive (fullscreen quad + custom shader + bind groups 0/1)
- Port de `src/shaders/starfield.wgsl` pra convenção de bind groups (group 0 engine + group 1 custom)
- Extensão do `vite-plugin-wgsl`: usa `wgsl_reflect` pra extrair uniform layouts + gera TS typed accessors on-the-fly
- Flag `weydra.starfield` — ativa, `src/world/fundo.ts` desativa o path Pixi e chama weydra

**Nota:** `TilingSprite` do bright star layer **fica em Pixi até M3** (precisa texture bind group 2 + sprite pool infra). M2 scope cobre só o procedural starfield via shader.

**Critério de merge:** starfield renderiza via weydra com visual pixel-parity vs Pixi. Frame time `fundo` ≤ Pixi baseline. Vite HMR funciona quando edita `starfield.wgsl`.

**Resultado prático:** invisível pro jogador (paridade exigida). Dev experience: primeiro shader rodando, feedback loop completo validado.

---

#### M3 — Ships

**Escopo:** Primeiro sistema com muitas entidades. Sprite batcher + shared memory + SlotMap nascem aqui. É o milestone mais "transformador" — depois dele a estratégia de binding está completa e todos os próximos Ms reusam.

**Entregáveis:**
- Generational `SlotMap<T>` em Rust (handles opacos `u64` = slot+generation)
- `TextureRegistry` com `upload_rgba(bytes, w, h) -> Handle`, nearest sampler por padrão
- `SpritePool` SoA: arrays contíguos `transforms` (Vec<[f32;4]>), `uvs` (Vec<[f32;4]>), `colors` (Vec<u32>), `flags` (Vec<u8>), `z_order` (Vec<f32>), `textures` (Vec<u32>)
- Ponteiros de cada array expostos via wasm-bindgen como `u32` (cast de `*const T as u32`)
- `mem_version` counter pra detecção de memory growth + revalidação no ts-bridge
- Shader `sprite_batch.wgsl` com storage buffer + instance_index (path WebGPU) **E** `sprite_batch_instanced.wgsl` com per-instance vertex attributes (path WebGL2) — detecção no boot via `adapter.get_info().backend`, pipelines alternativas, mesma API pública. **Ambos paths são obrigatórios pro merge M3** (Firefox, Safari iOS 17+, PowerVR no Phase A dependem do WebGL2)
- Sprite batcher em Rust: sort por (texture_id, z_order), 1 draw call por textura com N instances
- TS `Sprite` class com setters que escrevem direto nos `Float32Array`/`Uint32Array` views
- Spritesheet loading: `ships.png` (96×96 cells, 5 cols × 4 rows, tier variants)
- Sub-frame UVs + tint (fragata vermelha)
- Trails completos via sprite pool (per-particle alpha via write direto em `colors` SoA, zero tessellation) — NÃO migram via Graphics em M7
- Bright star layer (TilingSprite) absorvido de M2 — sprite simples com UV repeat, texture bind group 2 já presente aqui
- Flag `weydra.ships` — naves renderizam via weydra
- Ship select via DOM addEventListener confirmado (já é DOM hoje, só validar)

**Critério de merge:** todas as naves via weydra, visual idêntico (position, scale, tint, flip horizontal, trails), selecionar clicando funciona, frame time ≤ Pixi com 40 naves + stress test 300 naves passa.

**Resultado prático:** invisível pro jogador, mas internamente é O momento em que weydra fica "pronto pra valer" — a partir daqui qualquer coisa nova pluga em cima do sprite pool.

---

#### M4 — Planets (baked mode)

**Escopo:** Planetas pequenos/distantes (abaixo de `AUTO_BAKE_PX=40`) renderizam via weydra sprite pool. Reaproveita M3, adiciona só o pipeline de bake.

**Entregáveis:**
- `RenderTarget` abstraction no core (texture renderable + view)
- WASM adapter: `upload_texture_from_image_data(bytes, w, h)` pra promover um bake Pixi pro weydra
- Branch em `bakePlaneta()` (`planeta-procedural.ts`): se flag `weydra.planetsBaked`, usa pipeline "Pixi extract canvas → bytes → weydra upload → sprite" (decisão: Pixi ainda gera a textura no M4; full-weydra bake fica pro M5 quando o shader for portado)
- **Bake queue 1-por-frame** via `processBakeQueueWeydra()` — chamado a cada frame pelo game loop. `renderer.extract.canvas` é síncrono (10-50ms); fire-and-forget em loop de planeta empilharia stalls no mesmo frame
- Integração com `AUTO_BAKE_PX` / `AUTO_UNBAKE_PX` existentes
- `precompilarBakesPlanetas` no loading também passa pelo path weydra se flag on
- Cleanup na transição baked ↔ live (destroy weydra sprite, restore Pixi mesh visibility)

**Critério de merge:** planetas pequenos renderizam via weydra, transição baked↔live suave, `precompilarBakesPlanetas` funciona, stalls de auto-bake reduzidos.

**Resultado prático:** stalls de 2-4ms no auto-bake hoje caem pra ~0.5-1ms. Pouco perceptível sem profiler, mas mobile low-end sente menos hitches.

---

#### M5 — Planets (live shader)

**Escopo:** O milestone mais complexo do projeto. Port do shader procedural do planeta (FBM + cloud circles + PCG hash + 24 uniforms) pra weydra com paridade visual bit-exata.

**Entregáveis:**
- Port de `src/shaders/planeta.wgsl` pra convenção bind groups (group 0 engine, group 1 `PlanetUniforms` struct)
- `PlanetUniforms` struct `#[repr(C)]` em Rust com 24 campos (u_time, u_seed, u_rotation, u_light_origin, u_colors[6], etc) matchando o WGSL
- `PlanetPool` homogeneous: `Vec<PlanetUniforms>` contíguo, cada slot = 1 instance, **único bind group compartilhado com `has_dynamic_offset: true`** — offset do slot passado no `set_bind_group` em tempo de draw (capacity 256 slots). Stride arredondado pra `min_uniform_buffer_offset_alignment` (tipicamente 256 bytes)
- `PlanetInstance` TS class com setters tipados (gerados pelo vite-plugin-wgsl idealmente; fallback manual)
- Registration do shader no boot via `renderer.createPlanetShader(wgslSrc)`
- Branch em `criarPlanetaProceduralSprite`: se `weydra.planetsLive`, cria `PlanetInstance` e retorna objeto stub compatível com o contrato esperado pelo resto do código
- `atualizarTempoPlanetas` atualiza uTime, uRotation via shared memory writes
- `atualizarLuzPlaneta` via `setLightOrigin` no instance
- **Determinism test**: cena controlada (1 planeta, seed fixo, camera fixa, time=0) renderizada em Pixi e weydra, hash do framebuffer comparado. Tolerance: 0-bit drift ideal, 1-bit aceitável
- Full-weydra bake: substitui o path híbrido do M4 (Pixi extract) por render-to-RenderTarget no weydra nativo
- Flag `weydra.planetsLive`

**Critério de merge:** planetas grandes (shader live) renderizam via weydra visual-identico, determinism test passa em 1 cena de referência, full-weydra bake funciona sem dependência Pixi, frame time ≤ Pixi.

**Resultado prático:** invisível pro jogador se paridade mantida. Maior risco do projeto — bugs de shader determinism podem ficar sutis (ex: nuvem levemente deslocada, paleta 1-bit off).

---

#### M6 — Fog-of-War

**Escopo:** Neblina de visão procedural via shader em vez de canvas+upload. Abordagem mais simples: uniform array com N fontes de visão, fragment shader calcula alpha per-pixel.

**Entregáveis:**
- `FogUniforms` struct com array fixo de 64 `VisionSource { position, radius }`
- `src/shaders/fog.wgsl` — fullscreen fragment que itera sources e calcula coverage via `smoothstep(radius, radius*0.75, distance)`
- WASM adapter: `create_fog_shader(wgsl)`, `fog_ptr()`, `fog_max_sources()`
- TS `FogLayer` class: `setBaseAlpha`, `setSource(i, x, y, r)`, `setActiveCount(n)`
- Branch em `src/world/nevoa.ts::desenharNeblinaVisao`: se `weydra.fog`, popula uniform array com fontes ativas, skip canvas draw + upload
- Flag `weydra.fog`

**Critério de merge:** fog renderiza via weydra com bordas suaves comparáveis ao destination-out, acompanha camera, cap de 64 sources suficiente pro gameplay atual, frame time `fog` constante (elimina o spike p95 que o canvas+upload tinha).

**Resultado prático:** jogador não percebe diferença visual. Frame time fica mais estável (spike some).

---

#### M7 — Graphics primitives

**Escopo:** API vector (circle/rect/roundRect/lineTo/arc/fill/stroke/clear) equivalente ao `Pixi.Graphics`, com tessellation via crate `lyon`. Migra orbit lines, rotas, beams, rings. **Trails NÃO migram aqui** — ficam em sprite pool (M3) porque per-particle alpha muda toda frame e lyon retessellation seria desperdício. **Também re-wire de TODOS os pointer events Pixi pra DOM** (5 objetos eventMode + ~11 handlers).

`Graphics` expõe flag `worldSpace: boolean` no construtor — `true` pra orbits/routes/beams/rings (world coords), `false` pra UI overlays (screen px). Shader branch interno via uniform.

**Entregáveis:**
- `Graphics` module no core com command list + dirty flag
- Integração `lyon` (tessellator 2D): fill + stroke geram vertex/index buffers, cacheados até `clear()` ou nova op
- `graphics.wgsl` flat-shaded triangle pipeline (só position + color por vertex)
- WASM exports: `create_graphics`, `graphics_circle/rect/roundRect/line/arc`, `graphics_fill/stroke/clear`
- TS `Graphics` class mirror Pixi API (fluent: `.circle(...).fill(...).stroke(...)`)
- Migração em `src/world/sistema.ts` (orbit lines), `src/world/naves.ts` (rotas + selection ring), `src/world/combate-resolucao.ts` (beams), `src/world/mundo.ts` (anel cache já existe, só trocar backend). `engine-trails.ts` **NÃO** migra aqui — foi em M3 via sprite pool
- **Re-wire DOM events** em `src/ui/minimapa.ts` (click-to-navigate), `src/ui/tutorial.ts` (close button), `src/ui/painel.ts` (action buttons), `src/ui/selecao.ts` (card hover/press): substituir `eventMode + .on('pointer...')` por `canvas.addEventListener` + hit-test manual contra bounds
- Flag `weydra.graphics`

**Critério de merge:** todos os graphics via weydra, visual idêntico (aceitando diff sub-pixel em tessellation), todos os cliques/hovers migrados pra DOM funcionam, frame time em cena graphics-heavy ≤ Pixi.

**Resultado prático:** jogador não percebe diferença visual nem de input. Anel cache + lyon dirty tracking deixa frame time mais estável em cenas com muitos Graphics.

---

#### M8 — Text labels

**Escopo:** Rendering de texto via bitmap font em vez do `Pixi.Text` (que usa canvas fillText + upload). Integração com `fontdue` crate pra rasterizar glyphs.

**Entregáveis:**
- Integração crate `fontdue` no core
- Font file bundled no WASM (escolher entre Silkscreen/VT323 — as que usamos no CSS hoje)
- Glyph atlas gerado no boot em 2-3 tamanhos (pro texto de label pequeno, tutorial médio, título grande)
- `Text` primitive no core: recebe string + position + size + color, look up glyphs no atlas, emite vertex buffer com quads
- WASM exports: `create_text`, `set_text_content`, `set_text_position`
- TS `Text` class
- Migração dos ~30 usos de `Pixi.Text` distribuídos em `src/ui/painel.ts` (~24), `src/ui/selecao.ts`, `src/ui/tutorial.ts`, `src/world/nevoa.ts`. Helper `criarText` em `src/ui/_text-helper.ts` escolhe weydra vs Pixi path pelo flag
- Conteúdo dinâmico funciona — cada update vira lookup no atlas + vertex buffer rebuild
- Flag `weydra.text`

**Critério de merge:** texto via weydra legível, fonte pixel-art igual ou melhor que Pixi.Text default, update dinâmico (mudança de nome de planeta) funciona, zero uso de `Pixi.Text` no código.

**Resultado prático:** jogador vê a mesma fonte (se escolhida igual). Update de label é dramaticamente mais rápido (Pixi.Text cria canvas + uploads textura por update; atlas é grátis).

---

#### M9 — UI (minimap/tutorial/painéis)

**Escopo:** Últimos overlays Pixi migram. Basicamente é reusar M7 + M8 pra recriar os elementos que sobraram em Pixi.

**Entregáveis:**
- `src/ui/minimapa.ts` inteiro via weydra: background Graphics + dots Graphics + viewport rect Graphics + título Text (DOM event click-to-navigate já migrado em M7)
- `src/ui/tutorial.ts`: frame Graphics + Text + close button (graphics + DOM event já migrado em M7)
- `src/ui/painel.ts`: backgrounds Graphics + botões (graphics + text; DOM events de action buttons já migrados em M7)
- `src/ui/selecao.ts`: selection cards (backgrounds + text + hover state; DOM events já migrados em M7)
- Qualquer Pixi.Container/Sprite/Graphics remanescente em `src/ui/` erradicado
- Flag `weydra.ui`

**Critério de merge:** `grep -rn "from 'pixi.js'" src/ui/` retorna vazio, todas as UIs funcionam identicamente (visual + input), flag pode ser desligado pra fallback mas é o último uso de Pixi em UI.

**Resultado prático:** jogador não percebe. Internamente, `src/ui/` não depende mais de Pixi.

---

#### M10 — Pixi removal + cleanup

**Escopo:** Endgame. Pixi completamente removido do projeto.

**Entregáveis:**
- Delete canvas Pixi do `index.html`
- Delete todos os feature flags `weydra.*` do config (eram só pra migração)
- Delete `Application`, `Ticker`, `Container`, `Sprite`, `Graphics`, `Mesh`, `Shader`, `Texture`, `TilingSprite`, `Text`, `AnimatedSprite` — todas referências Pixi
- Delete todos os `import ... from 'pixi.js'`
- `npm uninstall pixi.js` — remove do `package.json`
- Canvas único (weydra) com scene graph unificado. z-order flexível resolve o problema das camadas interleaved
- Testes: save/load roundtrip, mobile low-end (PowerVR), Safari iOS
- Comparação de perf final: branch pre-M1 (só Pixi) vs pós-M10 (só weydra) em 1 cena de referência
- Tag release no git

**Critério de merge:** `grep -rn "pixi" package.json` retorna zero, `grep -rn "from 'pixi.js'" src/` retorna zero, bundle JS + WASM final menor que bundle JS com Pixi, frame time em mobile low-end melhor que baseline pre-M1.

**Resultado prático:** é ONDE o jogador pode perceber diferença — se tudo deu certo, mobile low-end sente jogo mais fluido (menos hitches, frame time médio melhor). No desktop de alta performance, possível empate (GPU não era gargalo). Bundle total comparável (perdeu Pixi ~500KB, ganhou WASM ~500KB-2MB dependendo do que saiu).

### Feature flags por sistema

```ts
interface WeydraFlags {
  starfield: boolean;    // M2
  ships: boolean;        // M3
  planetsBaked: boolean; // M4
  planetsLive: boolean;  // M5
  fog: boolean;          // M6
  graphics: boolean;     // M7
  text: boolean;         // M8
  ui: boolean;           // M9
}
```

Todas default `false`. Cada milestone liga a sua quando pronto. **Rollback instantâneo por sistema** desabilitando flag. No M10, flags e código Pixi são removidos.

## Testing + validation

### Níveis de teste

1. **Unit tests Rust** (sem GPU) — transform math, SlotMap, tessellation correctness
2. **Integration tests com GPU native** — `cargo test` em CI com Vulkan/Metal/DX12 headless
3. **Integration tests WASM** — `wasm-pack test --headless` em Chrome + Firefox
4. **Visual parity tests** — Playwright + pixelmatch, cenas baseline, tolerance ≤1% de pixels com Δ≥3 RGB
5. **Performance benchmarks** — cena estressante (300 naves + 50 planetas) comparando Pixi vs weydra via profiling logger existente
6. **Browser compatibility matrix** — manual em Chrome desktop/Android, Safari desktop/iOS, Firefox, devices low-end PowerVR

### Red flags que travam merge

- Visual: planeta com gradient errado, ship com posição flutuante, fog com borda dura
- Perf: frame time p95 regrediu >0.1% vs Pixi
- Crash: wgpu emite validation error em qualquer backend
- Platform: quebra em Safari iOS ou PowerVR mobile

### Dev loop

```
Edit Rust → wasm-pack build --dev (3-8s) → Vite HMR → enable flag → test
```

Ciclo <30s entre edit e validação visual.

### Riscos identificados

- **Shader determinism:** planeta usa PCG hash bit-exact. wgpu traduz WGSL pros backends, pode haver 1-bit drift entre MSL/HLSL/GLSL. Plano: teste de hash do framebuffer em cena de referência.
- **Tessellation lyon:** pode gerar polygon count diferente do Pixi. Plano: teste de parity pixel-a-pixel em cena com só Graphics.
- **WebGL2 feature coverage:** wgpu não suporta tudo WGSL em WebGL2. Validar cedo — M2 já exerce shader complexo.
- **Input no canvas inferior:** durante migração, se algum sistema precisar de hit-test no weydra canvas, precisamos de `pointer-events: auto` condicional. Plano: re-wire de **todos** os pointer events Pixi pra DOM acontece em M7 (antes do M9 migrar o visual das UIs).

## Riscos gerais e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Projeto pausa no meio da migração | Média | Baixo | Rollback por flag, Pixi continua funcional até M10 |
| M5 (planet shader) é o mais complexo do projeto | Alta | Médio | Migração incremental não trava outros M; pode pular M5 e fazer M6+ primeiro em paralelo |
| Performance não supera Pixi em mobile | Baixa | Alto | Benchmarks desde M2; abort se regression confirmada |
| wgpu bug de driver em browser-específico | Média | Médio | Fallback path Pixi via flag; report upstream |
| Scope creep (B ou C antes da hora) | Alta | Médio | Spec explícita: só expandir após M10 estável em prod |
| Bundle WASM muito pesado | Baixa | Baixo | Usuário explicitou que não importa; wasm-opt -O4 no release |
| Safari iOS diferente de Safari desktop | Média | Médio | Teste manual iOS por milestone |

## Decisões resolvidas (histórico)

Todas as open questions iniciais foram resolvidas durante escrita dos plans M1-M10:

- **Build:** `wasm-pack build --target web` — padrão usado em M1 Task 7 + script `npm run build:renderer`
- **Vite integration:** `vite-plugin-wasm` + `vite-plugin-top-level-await` + `@weydra/vite-plugin-wgsl` custom — M1 Task 10
- **Pointer export:** `*const T as u32` via wasm-bindgen + reconstrução no TS via `new Float32Array(memory.buffer, ptr, len)` — documentado em "Estratégia de binding"
- **Textura management:** atlas por tipo (ships.png, font atlases per-size, bake de planeta individual por textura) — M3/M8
- **Spritesheet:** mantém PNGs atuais; game-side converte pra RGBA bytes via OffscreenCanvas.getImageData antes do upload — M3 Task 7

## Status dos plans

Todos os plans M1-M10 escritos e revisados (10 rodadas de code review, ~80 bugs técnicos corrigidos + 6 decisões conceituais aplicadas). Última revisão declarou "ALL CLEAN — shippable". Implementação começa por **M1 Foundation**.

## Referências

- wgpu docs: https://wgpu.rs/
- WebAssembly Boundary Tax (OpenUI case): https://aitoolly.com/ai-news/article/2026-03-21-why-openui-rewrote-their-rust-wasm-parser-in-typescript-to-achieve-a-3x-speed-increase
- wasm-bindgen: https://github.com/rustwasm/wasm-bindgen
- lyon tessellation: https://docs.rs/lyon/
- fontdue: https://docs.rs/fontdue/
- Pixi audit: seção **Contexto** deste spec (consolidado in-line)
