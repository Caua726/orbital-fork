# weydra-renderer M4 Planets (Baked) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Renderizar planetas em modo baked via weydra-renderer (planetas pequenos ou distantes que não precisam shader live). Reaproveitar sprite pool do M3 + adicionar pipeline de bake (render pra RenderTexture → extrair como textura de sprite).

**Architecture:** Pipeline de bake baseado no existente (`bakePlaneta()` no Pixi): cria um quad mesh temporário rodando o planet shader, renderiza pra uma RenderTexture em resolução controlada, promove o resultado pra textura do sprite pool. Integração mantém os thresholds `AUTO_BAKE_PX`/`AUTO_UNBAKE_PX` existentes + o `precompilarBakesPlanetas` do loading screen.

**Tech Stack:** M3 foundation (sprite pool, texture registry) + wgpu render-to-texture.

**Depends on:** M3 complete. Shader (planeta.wgsl) port fica pro M5, então M4 pode temporariamente usar Pixi pra gerar o bake e importar o resultado no weydra — ou esperar M5 e fazer bake full-weydra. Escolha no Task 1.

---

## Decisão crítica (resolver antes do Task 1)

**Opção A — bake via Pixi, sprite display via weydra:**
- M4 menos trabalho: bake pipeline Pixi existente gera canvas/texture, a gente faz upload pro weydra via `uploadTexture`
- Dependência de Pixi mantida até M5
- Rollback fácil

**Opção B — bake full-weydra:**
- Requer port de `planeta.wgsl` pra weydra antes de M5
- Elimina dependência Pixi no caminho de planet já no M4
- Mais trabalho aqui, menos no M5

**Recomendação:** Opção A (menos risco). M4 valida sprite-de-planeta + infra de gerenciamento (auto-bake/unbake). M5 faz port completo do shader e refaz o bake pelo caminho weydra.

O plano abaixo assume Opção A. Ajustar se escolher B.

---

## File Structure

**New in core:**
- `core/src/render_target.rs` — RenderTexture abstraction (renderable texture + view)

**Modified:**
- `core/src/texture.rs` — TextureRegistry gains `upload_from_canvas` (nearest sampler already default)
- `adapters/wasm/src/lib.rs` — expose `upload_texture_from_canvas(canvas)` for browser-native path (reuse OffscreenCanvas via web-sys)

**Game:**
- Modify: `src/core/config.ts` — `weydra.planetsBaked` flag
- Modify: `src/world/planeta-procedural.ts` — branch bake path per flag
- Modify: `src/world/mundo.ts` — at atualizarTempoPlanetas, use weydra sprite when `_weydraBakedSprite` set

---

### Task 1: RenderTexture abstraction (para M5)

**Files:**
- Create: `weydra-renderer/core/src/render_target.rs`

- [ ] **Step 1: Write RenderTarget**

Create `weydra-renderer/core/src/render_target.rs`:

```rust
use crate::device::GpuContext;

pub struct RenderTarget {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub format: wgpu::TextureFormat,
    pub width: u32,
    pub height: u32,
}

impl RenderTarget {
    pub fn new(ctx: &GpuContext, width: u32, height: u32, format: wgpu::TextureFormat) -> Self {
        let texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("weydra render target"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Self { texture, view, format, width, height }
    }
}
```

- [ ] **Step 2: Export + commit**

```rust
pub mod render_target;
pub use render_target::RenderTarget;
```

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): RenderTarget abstraction for offscreen rendering"
```

---

### Task 2: WASM adapter — upload from canvas

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`

- [ ] **Step 1: Add canvas-to-texture method**

Uses web-sys to read ImageData from a canvas and upload:

**Nenhuma nova API necessária** — `upload_texture(bytes, w, h)` do M3 já é suficiente. Removido o wrapper `upload_texture_from_image_data` que só redirecionava pra `upload_texture` sem adicionar nada.

Game side usa diretamente:
```typescript
const imageData = canvas2d.getImageData(0, 0, w, h);
const rgba = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
const h = r.uploadTexture(rgba, w, h);
```

- [ ] **Step 2: Rebuild + commit**

```bash
cd weydra-renderer/adapters/wasm
wasm-pack build --target web --out-dir pkg
git add weydra-renderer/adapters/wasm/
git commit -m "feat(weydra-wasm): canvas-to-texture upload helper"
```

---

### Task 3: Game-side bake bridge

**Files:**
- Modify: `src/world/planeta-procedural.ts`

- [ ] **Step 1: Add weydra bake path to bakePlaneta()**

The existing `bakePlaneta(planeta)` generates a Pixi Texture via `renderer.generateTexture(...)`. Add a companion path:

```typescript
async function bakePlanetaWeydra(planeta: any): Promise<void> {
  const r = getWeydraRenderer();
  if (!r) return;
  if ((planeta as any)._weydraBakedSprite) return;

  // Use the existing Pixi bake pipeline to generate a canvas-based texture.
  // Then upload bytes into weydra's texture registry, create a sprite.
  const mesh = planeta as Mesh;
  const shader = (mesh as any)._planetShader as Shader | undefined;
  if (!shader) return;

  const tamanho = mesh.scale.x;
  const frameSize = Math.max(64, tamanho * 1.08);

  // Render the Pixi mesh to an offscreen canvas via extract API
  const canvas = (_appRef as Application).renderer.extract.canvas({
    target: mesh as any,
    resolution: 1,
    frame: new Rectangle(0, 0, frameSize, frameSize),
    antialias: false,
  }) as HTMLCanvasElement;

  const ctx2d = canvas.getContext('2d')!;
  const imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
  // imageData.data é Uint8ClampedArray; .buffer pode ter byteOffset != 0.
  // Construir view com offset+length explícitos pra não uploadar lixo.
  const rgba = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  const texHandle = r.uploadTexture(rgba, canvas.width, canvas.height);

  const sprite = r.createSprite(texHandle, frameSize, frameSize);
  sprite.x = planeta.x;
  sprite.y = planeta.y;
  sprite.zOrder = 0;
  sprite.visible = true;
  (planeta as any)._weydraBakedSprite = sprite;

  // Hide the live Pixi mesh
  mesh.visible = false;
}
```

- [ ] **Step 2: Branch atualizarTempoPlanetas**

In `atualizarTempoPlanetas`, when processing a baked planet, update weydra sprite position:

```typescript
if ((planeta as any)._weydraBakedSprite) {
  const s = (planeta as any)._weydraBakedSprite;
  s.x = planeta.x;
  s.y = planeta.y;
  continue;
}

// Auto-bake threshold check (existing AUTO_BAKE_PX logic)
if (tamPx < AUTO_BAKE_PX && !alreadyBaked) {
  if (getConfig().weydra.planetsBaked) {
    // Fila 1-bake-por-frame: fire-and-forget no mesmo frame stacka stalls
    // (renderer.extract.canvas é sync, 10-50ms cada). Em vez disso enfileira
    // — o scheduler abaixo processa 1 por frame.
    enqueueBakeWeydra(planeta);
  } else {
    bakePlaneta(planeta); // existing Pixi path
  }
}

// Auto-unbake when big
if (tamPx > AUTO_UNBAKE_PX && (planeta as any)._weydraBakedSprite) {
  unbakePlanetaWeydra(planeta);
}
```

- [ ] **Step 2b: Bake queue scheduler**

```typescript
// No mesmo arquivo (planeta-procedural.ts):
const _bakeQueue: any[] = [];
const _bakeSet = new WeakSet<object>();

export function enqueueBakeWeydra(planeta: any): void {
  if (_bakeSet.has(planeta)) return; // já na fila
  _bakeSet.add(planeta);
  _bakeQueue.push(planeta);
}

/** Chamar uma vez por frame a partir do game loop. */
export function processBakeQueueWeydra(): void {
  const planeta = _bakeQueue.shift();
  if (!planeta) return;
  _bakeSet.delete(planeta);
  void bakePlanetaWeydra(planeta); // agora sim single-planeta → 1 stall máx por frame
}
```

Registrar `processBakeQueueWeydra()` no game loop principal (ex: depois de `atualizarTempoPlanetas`).

- [ ] **Step 3: Unbake destroys weydra sprite**

```typescript
function unbakePlanetaWeydra(planeta: any): void {
  const r = getWeydraRenderer();
  const sprite = (planeta as any)._weydraBakedSprite;
  if (!sprite || !r) return;
  r.destroySprite(sprite);
  (planeta as any)._weydraBakedSprite = null;
  (planeta as any).visible = true; // show live mesh again
}
```

- [ ] **Step 4: precompilarBakesPlanetas support**

In the existing `precompilarBakesPlanetas` (called from loading screen), add weydra path:

```typescript
if (getConfig().weydra.planetsBaked) {
  await bakePlanetaWeydra(planeta);
} else {
  bakePlaneta(planeta);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/world/planeta-procedural.ts
git commit -m "feat(orbital): bake planetas pequenos via weydra (Pixi gera, weydra exibe)"
```

---

### Task 4: Config flag + validation

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: Add flag**

```typescript
weydra: {
  starfield: boolean;
  ships: boolean;
  planetsBaked: boolean; // M4
}
```

Default: false.

- [ ] **Step 2: Test enable**

Enable via console or config UI:
```js
__setWeydra('planetsBaked', true);
location.reload();
```

Game should show:
- Baked planets rendered via weydra sprite pool
- Transition suave entre baked e live (quando zooma in/out)
- `precompilarBakesPlanetas` fase mostra sprites weydra no carregamento

- [ ] **Step 3: Visual parity**

Planet sprites baked should be pixel-identical to Pixi's generateTexture output (since the bake is still generated via Pixi internally — weydra is just displaying the result).

- [ ] **Step 4: Performance**

Frame time sem stalls quando auto-bake dispara (hoje 2-4ms). Esperado com weydra path: 0.5-1ms (menos overhead de Pixi sprite construction + scene graph insertion).

- [ ] **Step 5: Mark complete**

```markdown
## M4 Status: Complete (YYYY-MM-DD)
Baked planets displayed via weydra sprite pool. Auto-bake/unbake flow integrated.
```

```bash
git add docs/superpowers/specs/2026-04-19-weydra-renderer-design.md src/core/config.ts
git commit -m "feat(orbital): weydra.planetsBaked flag + docs M4 complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Baked planets via weydra sprite pool (reusa M3)
- ✅ AUTO_BAKE_PX / AUTO_UNBAKE_PX thresholds mantidos
- ✅ precompilarBakesPlanetas integrado
- ✅ Feature flag

**Deferred:**
- Full-weydra bake (Pixi ainda gera a textura) — resolvido no M5 com port do shader
- Ring (anel) de seleção de planeta — fica em Pixi até M7 (graphics primitives)

**Risks:**
- `renderer.extract.canvas` readback de Pixi pra CPU é lento (10-50ms pro primeiro planeta). Se gargalo, movemos bake pra M5 direto (full-weydra).
- ImageData transfer JS→WASM envolve memcpy de ~16KB por bake — tolerável mas vale medir.
- Tamanho do sprite: o bug que resolvemos antes (sprite.width = tamanho vs frameSize) aplica aqui. No weydra, criar sprite com `displayW = frameSize` e ajustar UV/position pra compensar o padding de 8%.
