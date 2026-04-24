# weydra-renderer M7 Graphics Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Implementar API de vector graphics (circle, rect, roundRect, moveTo/lineTo, arc, fill, stroke, clear) equivalente ao `Pixi.Graphics`, com tessellation via `lyon` crate. Migrar orbit lines, rotas de naves, combat beams, rings de seleção. **Trails ficam em M3** (sprite pool, per-particle alpha). **Re-wire** dos 11 handlers Pixi eventMode (minimap, tutorial, painéis, selection cards) pra DOM addEventListener.

**Architecture:** Retained-mode Graphics com dirty flag. Cada Graphics object tem uma command list (circle, line, etc) que é tesselada lazy em vertex buffer via `lyon`. Render pass percorre Graphics objects não-dirty, reusa vertex buffer; dirty recomputa. Integrado no scene graph do scene.rs com z-order. Batching por color/stroke width não-viável em vector arbitrary — cada Graphics vira 1-2 draw calls (fill + stroke).

**Tech Stack:** lyon crate (tesselador 2D), wgpu vertex buffers, custom graphics.wgsl shader (flat-shaded triangles).

**Depends on:** M3 complete (scene graph + sprite pool patterns).

## Decisões de escopo (C6 + worldSpace)

**C6 — Trails ficam em sprite pool, não em Graphics.** Per-particle alpha muda toda frame → retessellation via lyon a cada frame (96+ tessellations/frame pra 4 naves × 24 particles) é desperdício. Sprite pool do M3 atualiza alpha via write direto no SoA `colors` array — zero tessellation. M7 drop migração de `engine-trails.ts`; trails usam M3's sprite infra.

**worldSpace flag** obrigatório no Graphics. Sem isso, M9 (UI overlays) não funciona. Cada `Graphics` tem `world_space: bool`; o shader lê isso via uniform + branch. Orbits, routes, beams, selection rings = `worldSpace: true`. UI backgrounds/buttons/minimap = `worldSpace: false`.

**Fill vs stroke em draw calls separados.** Cada Graphics object emite até 2 draw calls (fill triangles, stroke triangles) usando dois `VertexBuffers` distintos. Evita ambiguidade de ordering entre fill/stroke de comandos consecutivos — fill first sempre, stroke on top.

---

## File Structure

**New in core:**
- `core/src/graphics.rs` — Graphics command list, tessellation, draw
- `core/shaders/graphics.wgsl` — flat-shaded triangle pipeline

**Modified:**
- `core/Cargo.toml` — add `lyon = "1"`
- `adapters/wasm/src/lib.rs` — graphics create/destroy + method exports
- `ts-bridge/index.ts` — Graphics class mirroring Pixi API

**Game:**
- Modify: `src/world/naves.ts` — rota Graphics via weydra
- ~~Modify: `src/world/engine-trails.ts`~~ — **movido pro M3 (sprite-based)**
- Modify: `src/world/sistema.ts` — orbit lines
- Modify: `src/world/combate-resolucao.ts` — combat beams
- Modify: `src/ui/minimapa.ts` — minimap Graphics + re-wire pointerdown
- Modify: `src/ui/tutorial.ts` — tutorial Graphics + close button
- Modify: `src/ui/painel.ts` — painel backgrounds + action buttons
- Modify: `src/ui/selecao.ts` — selection cards + hover handlers
- Modify: `src/core/config.ts` — `weydra.graphics` flag

---

### Task 1: Add lyon dependency + graphics module skeleton

**Files:**
- Modify: `weydra-renderer/core/Cargo.toml`
- Create: `weydra-renderer/core/src/graphics.rs`

- [ ] **Step 1: Add lyon**

```toml
[dependencies]
lyon = "1"
```

- [ ] **Step 2: Graphics command list**

```rust
use lyon::path::Path;
use lyon::tessellation::*;

#[derive(Clone, Debug)]
pub enum GraphicsCmd {
    Circle { x: f32, y: f32, r: f32, fill: Option<[f32; 4]>, stroke: Option<(f32, [f32; 4])> },
    Rect { x: f32, y: f32, w: f32, h: f32, fill: Option<[f32; 4]>, stroke: Option<(f32, [f32; 4])> },
    RoundRect { x: f32, y: f32, w: f32, h: f32, r: f32, fill: Option<[f32; 4]>, stroke: Option<(f32, [f32; 4])> },
    LineTo { from: [f32; 2], to: [f32; 2], width: f32, color: [f32; 4] },
    Arc { cx: f32, cy: f32, r: f32, start: f32, end: f32, width: f32, color: [f32; 4] },
}

pub struct Graphics {
    pub commands: Vec<GraphicsCmd>,
    pub dirty: bool,
    // Tessellated output cache:
    pub vertex_buffer: Option<wgpu::Buffer>,
    pub index_buffer: Option<wgpu::Buffer>,
    pub index_count: u32,
}

impl Graphics {
    pub fn new() -> Self {
        Self { commands: Vec::new(), dirty: true, vertex_buffer: None, index_buffer: None, index_count: 0 }
    }
    pub fn clear(&mut self) { self.commands.clear(); self.dirty = true; }
    pub fn circle(&mut self, x: f32, y: f32, r: f32, fill: Option<[f32; 4]>, stroke: Option<(f32, [f32; 4])>) {
        self.commands.push(GraphicsCmd::Circle { x, y, r, fill, stroke });
        self.dirty = true;
    }
    // ... rect, roundRect, lineTo, arc
}
```

- [ ] **Step 3: Commit**

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): Graphics command list skeleton + lyon dep"
```

---

### Task 2: Tessellation implementation

- [ ] **Step 1: Tessellate commands into vertex/index buffers**

In `graphics.rs`:

```rust
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GraphicsVertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

pub struct Graphics {
    pub commands: Vec<GraphicsCmd>,
    pub dirty: bool,
    pub world_space: bool,
    pub fill_vertex_buffer: Option<wgpu::Buffer>,
    pub fill_index_buffer: Option<wgpu::Buffer>,
    pub fill_index_count: u32,
    pub stroke_vertex_buffer: Option<wgpu::Buffer>,
    pub stroke_index_buffer: Option<wgpu::Buffer>,
    pub stroke_index_count: u32,
    pub uniforms_buffer: wgpu::Buffer,
    pub uniforms_bind_group: wgpu::BindGroup,
}

impl Graphics {
    /// Re-tessella commands → vertex/index buffers.
    ///
    /// **Invariante crítica:** DEVE ser chamado antes de `Renderer::render()`
    /// abrir o render pass. Nunca de dentro de um callback TS durante frame
    /// (ex: event handler rodando entre begin_render_pass e end_render_pass).
    /// Replacing `self.fill_vertex_buffer` drops o wgpu::Buffer antigo, e se
    /// o render pass corrente ainda tem command encoder holding ref, vira
    /// use-after-free no GPU command stream.
    ///
    /// Convenção: todas as mutações Graphics (circle, fill, etc) só setam
    /// `self.dirty = true`. `Renderer::render()` chama `tessellate_all()`
    /// como primeiro passo, antes de `begin_render_pass`.
    pub fn tessellate(&mut self, ctx: &GpuContext) {
        if !self.dirty { return; }

        // Fill e stroke em buffers separados — draw call 1 fill, draw call 2 stroke.
        let mut fill_geometry: VertexBuffers<GraphicsVertex, u16> = VertexBuffers::new();
        let mut stroke_geometry: VertexBuffers<GraphicsVertex, u16> = VertexBuffers::new();
        let mut fill_tess = FillTessellator::new();
        let mut stroke_tess = StrokeTessellator::new();

        for cmd in &self.commands {
            match cmd {
                GraphicsCmd::Circle { x, y, r, fill, stroke } => {
                    let mut path = Path::builder();
                    path.add_circle([*x, *y].into(), *r, lyon::path::Winding::Positive);
                    let path = path.build();
                    if let Some(color) = fill {
                        let opts = FillOptions::default();
                        fill_tess.tessellate_path(
                            &path, &opts,
                            &mut BuffersBuilder::new(&mut fill_geometry, |v: FillVertex| GraphicsVertex {
                                position: v.position().to_array(), color: *color,
                            }),
                        ).unwrap();
                    }
                    if let Some((width, color)) = stroke {
                        let opts = StrokeOptions::default().with_line_width(*width);
                        stroke_tess.tessellate_path(
                            &path, &opts,
                            &mut BuffersBuilder::new(&mut stroke_geometry, |v: StrokeVertex| GraphicsVertex {
                                position: v.position().to_array(), color: *color,
                            }),
                        ).unwrap();
                    }
                }
                // ... other cmds (Rect, RoundRect, Line, Arc) seguem mesma pattern:
                // fill → fill_geometry, stroke → stroke_geometry
                _ => todo!(),
            }
        }

        // Upload fill + stroke separadamente
        use wgpu::util::DeviceExt;
        if !fill_geometry.vertices.is_empty() {
            self.fill_vertex_buffer = Some(ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("graphics fill verts"),
                contents: bytemuck::cast_slice(&fill_geometry.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            }));
            self.fill_index_buffer = Some(ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("graphics fill indices"),
                contents: bytemuck::cast_slice(&fill_geometry.indices),
                usage: wgpu::BufferUsages::INDEX,
            }));
            self.fill_index_count = fill_geometry.indices.len() as u32;
        } else {
            self.fill_vertex_buffer = None; self.fill_index_buffer = None; self.fill_index_count = 0;
        }
        if !stroke_geometry.vertices.is_empty() {
            self.stroke_vertex_buffer = Some(ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("graphics stroke verts"),
                contents: bytemuck::cast_slice(&stroke_geometry.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            }));
            self.stroke_index_buffer = Some(ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("graphics stroke indices"),
                contents: bytemuck::cast_slice(&stroke_geometry.indices),
                usage: wgpu::BufferUsages::INDEX,
            }));
            self.stroke_index_count = stroke_geometry.indices.len() as u32;
        } else {
            self.stroke_vertex_buffer = None; self.stroke_index_buffer = None; self.stroke_index_count = 0;
        }
        self.dirty = false;
    }
}
```

- [ ] **Step 2: Add graphics.wgsl**

`weydra-renderer/core/shaders/graphics.wgsl`:

```wgsl
// engine_camera.viewport em world units (convenção M2).
struct CameraUniforms { camera: vec2<f32>, viewport: vec2<f32>, time: f32, _pad0: f32, _pad1: f32, _pad2: f32 };

// Per-graphics uniform: world_space=1 (orbits/routes/beams) ou 0 (UI).
struct GraphicsUniforms { world_space: f32, _pad0: f32, _pad1: f32, _pad2: f32 };

@group(0) @binding(0) var<uniform> cam: CameraUniforms;
@group(1) @binding(0) var<uniform> gfx: GraphicsUniforms;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>, @location(1) color: vec4<f32>) -> VsOut {
    // world_space=1: subtract camera antes do NDC (vertex em world coords)
    // world_space=0: UI overlay — pos é em screen px, converte via viewport
    //                sem aplicar camera.
    var ndc: vec2<f32>;
    if (gfx.world_space > 0.5) {
        ndc = (pos - cam.camera) / (cam.viewport * 0.5);
    } else {
        ndc = (pos / cam.viewport * 2.0) - vec2<f32>(1.0, 1.0);
    }
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.color = color;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> { return in.color; }
```

Nota: para UI, `pos` é em **pixels de tela** (mesma escala que hit-test DOM × DPR). Para world, `pos` é em **world units** (mesma escala que camera/viewport).

- [ ] **Step 3: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): lyon tessellation for Graphics circle/rect/stroke"
```

---

### Task 3: Graphics API in WASM adapter + TS bridge

**Files:**
- Modify: `adapters/wasm/src/lib.rs`
- Modify: `ts-bridge/index.ts`

- [ ] **Step 1: Expose graphics ops**

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn create_graphics(&mut self, world_space: bool) -> u64 { ... }
    pub fn destroy_graphics(&mut self, h: u64) { ... }
    pub fn graphics_clear(&mut self, h: u64) { ... }
    pub fn graphics_circle(&mut self, h: u64, x: f32, y: f32, r: f32,
                            fill_rgba: u32, stroke_color: u32, stroke_width: f32) { ... }
    pub fn graphics_rect(&mut self, h: u64, x: f32, y: f32, w: f32, h_size: f32, ...) { ... }
    pub fn graphics_round_rect(&mut self, h: u64, x: f32, y: f32, w: f32, h_size: f32, radius: f32, ...) { ... }
    pub fn graphics_line(&mut self, h: u64, x1: f32, y1: f32, x2: f32, y2: f32, color: u32, width: f32) { ... }
    pub fn graphics_arc(&mut self, h: u64, cx: f32, cy: f32, r: f32, start: f32, end: f32, color: u32, width: f32) { ... }
}
```

Cada `Graphics` owns seu próprio `GraphicsUniforms` buffer (4 bytes `world_space` + pad) + bind group 1. Criado em `create_graphics` baseado no parâmetro; imutável após criação.

- [ ] **Step 2: TS Graphics class mirrors Pixi**

```typescript
/**
 * Mirror do Pixi Graphics API: `.circle(...).fill({...}).circle(...).fill({...})`.
 * Cuidado: cada shape fica `_pending` até o próximo fill()/stroke(), que flush
 * e zera. Se o caller fizer `.circle().circle().fill()`, o primeiro circle é
 * silenciosamente perdido — detecta e warn em dev.
 */
interface PendingShape {
  kind: 'circle';
  x: number; y: number; r: number;
} | {
  kind: 'rect' | 'roundRect';
  x: number; y: number; w: number; h: number; radius?: number;
};

export class Graphics {
  private _pending: PendingShape | null = null;
  public zOrder = 0;

  constructor(
    public readonly handle: bigint,
    private r: Renderer,
    public readonly worldSpace: boolean,
  ) {}

  clear(): this {
    this._pending = null;
    this.r.wasm.graphics_clear(this.handle);
    return this;
  }

  private pushPending(next: PendingShape): this {
    if (this._pending) {
      // dev-warn: shape desenhada sem fill/stroke, vira no-op
      if (import.meta.env?.DEV) {
        console.warn('[Graphics] shape dropped (called before fill/stroke):', this._pending);
      }
    }
    this._pending = next;
    return this;
  }

  circle(x: number, y: number, r: number): this {
    return this.pushPending({ kind: 'circle', x, y, r });
  }
  rect(x: number, y: number, w: number, h: number): this {
    return this.pushPending({ kind: 'rect', x, y, w, h });
  }
  roundRect(x: number, y: number, w: number, h: number, radius: number): this {
    return this.pushPending({ kind: 'roundRect', x, y, w, h, radius });
  }
  // moveTo/lineTo/arc: não usam _pending (são comandos imediatos já no path builder)

  fill(opts: { color: number; alpha?: number }): this {
    const rgba = packColor(opts.color, opts.alpha ?? 1);
    const p = this._pending;
    this._pending = null;
    if (!p) return this;
    if (p.kind === 'circle') {
      this.r.wasm.graphics_circle(this.handle, p.x, p.y, p.r, rgba, 0, 0);
    } else if (p.kind === 'rect') {
      this.r.wasm.graphics_rect(this.handle, p.x, p.y, p.w, p.h, rgba, 0, 0);
    } else if (p.kind === 'roundRect') {
      this.r.wasm.graphics_round_rect(this.handle, p.x, p.y, p.w, p.h, p.radius ?? 0, rgba, 0, 0);
    }
    return this;
  }

  stroke(opts: { color: number; width: number; alpha?: number }): this {
    const rgba = packColor(opts.color, opts.alpha ?? 1);
    const p = this._pending;
    this._pending = null;
    if (!p) return this;
    if (p.kind === 'circle') {
      this.r.wasm.graphics_circle(this.handle, p.x, p.y, p.r, 0, rgba, opts.width);
    } else if (p.kind === 'rect') {
      this.r.wasm.graphics_rect(this.handle, p.x, p.y, p.w, p.h, 0, rgba, opts.width);
    } else if (p.kind === 'roundRect') {
      this.r.wasm.graphics_round_rect(this.handle, p.x, p.y, p.w, p.h, p.radius ?? 0, 0, rgba, opts.width);
    }
    return this;
  }
}

/**
 * Pack RGB (number 0xRRGGBB) + alpha (0..1) into a u32 laid out as
 * `0xRR_GG_BB_AA` (R in the high byte, A in the low byte). The Rust side
 * MUST unpack in the same order:
 *
 * ```rust
 * // core/src/graphics.rs (unpack side)
 * fn unpack_rgba(packed: u32) -> [f32; 4] {
 *     let r = ((packed >> 24) & 0xff) as f32 / 255.0;
 *     let g = ((packed >> 16) & 0xff) as f32 / 255.0;
 *     let b = ((packed >>  8) & 0xff) as f32 / 255.0;
 *     let a = ( packed        & 0xff) as f32 / 255.0;
 *     [r, g, b, a]
 * }
 * ```
 *
 * Same pack order already used by sprite_batch.wgsl (M3) and text.wgsl (M8).
 */
function packColor(rgb: number, a: number): number {
  // `>>> 0` força unsigned: JS bitwise ops trabalham com int32 signed, então
  // `(0xFF << 24)` vira `-16777216`. wasm-bindgen rejeita / corrompe no
  // boundary JS→Rust u32. `x >>> 0` converte pra uint32 sem perda.
  return (((rgb >> 16) & 0xff) << 24 | ((rgb >> 8) & 0xff) << 16 | (rgb & 0xff) << 8 | Math.floor(a * 255)) >>> 0;
}
```

Rust side: cada `GraphicsCmd` tessela para **dois** `VertexBuffers` separados (`fill_geometry`, `stroke_geometry`). Em render, draw fill primeiro, stroke depois. Evita índice aliasing quando múltiplos comandos interleave fill/stroke.

- [ ] **Step 3: Commit**

```bash
git add weydra-renderer/
git commit -m "feat(weydra): Graphics class API mirrors Pixi.Graphics"
```

---

### Task 4: Migrate orbit lines, rotas, beams, rings

- [ ] **Step 1: sistema.ts orbit lines**

Replace Pixi Graphics with weydra Graphics behind `weydra.graphics` flag. `worldSpace: true`.

- [ ] **Step 2: naves.ts rota lines + selection ring**

Same pattern. `worldSpace: true`.

- [ ] **Step 3: ~~engine-trails.ts~~ — SKIP (migrou em M3 via sprite pool)**

Per decisão C6 no topo deste plano, trails NÃO migram em M7. Já foram feitos como sprites em M3 (per-particle alpha via write direto em `colors` SoA). Pular este step.

- [ ] **Step 4: combate-resolucao.ts beams**

Linhas rápidas com fade — Graphics com lineTo + stroke. `worldSpace: true`.

- [ ] **Step 5: Commit**

```bash
git add src/world/
git commit -m "feat(orbital): migra orbit/rotas/beams pra weydra Graphics"
```

---

### Task 5: Re-wire Pixi event handlers to DOM

Per audit, 5 `eventMode='static'` objetos + ~11 `.on('pointer...')` handlers em:
- `src/ui/minimapa.ts` — click-to-navigate
- `src/ui/tutorial.ts` — close button
- `src/ui/painel.ts` — action buttons (varies)
- `src/ui/selecao.ts` — card hover/press

**Approach:** cada um vira `element.addEventListener('pointerdown', ...)` num DOM element overlay OU hit-testing custom contra as coordinates renderizadas.

Pra minimap específicamente: minimap é renderizado na tela, mantém seus bounds, `canvas.addEventListener('pointerdown', e => { if inside minimap bounds → handle })`.

- [ ] **Step 1: minimap**

Substitui `.eventMode='static' + .on('pointerdown')` por listener no weydra-canvas (ou no HTML container). Calcula bounds do minimap, testa click.

- [ ] **Step 2: tutorial close button**

Idem — bounds do botão X, check click coord.

- [ ] **Step 3: painel buttons**

Idem pra cada botão.

- [ ] **Step 4: selection cards hover/press**

`pointermove` global no canvas, calcula hover de cada card. `pointerdown` + release pra press.

- [ ] **Step 5: Commit**

```bash
git add src/ui/
git commit -m "refactor(ui): re-wire 11 Pixi event handlers to DOM addEventListener"
```

---

### Task 6: Validation + flag + mark complete

- [ ] **Step 1: Visual parity**

Todos os elementos Graphics renderizam visualmente idêntico ao Pixi.

- [ ] **Step 2: Input funciona**

Minimap click, tutorial close, painel buttons, selection hover/press — todos reagem.

- [ ] **Step 3: Perf**

Graphics dirty cache hit em cenas típicas (rings só mudam ao selecionar). Frame time `planetas_anel` já otimizado pro cache; esperado empate com Pixi.

- [ ] **Step 4: Mark M7 complete**

```markdown
## M7 Status: Complete (YYYY-MM-DD)
Graphics primitives via lyon. Input re-wired to DOM. 5 UI Pixi objects + 11 handlers migrados.
```

```bash
git add src/ docs/
git commit -m "feat(orbital): M7 Graphics complete + event re-wire"
```

---

## Self-Review

- ✅ lyon tessellation
- ✅ Retained mode com dirty flag
- ✅ 5 Graphics primitive methods (circle/rect/roundRect/line/arc)
- ✅ Event handlers re-wired
- ✅ Flag + rollback

**Risks:**
- lyon tessellation de arcs pode gerar contornos diferentes do Pixi (point count, edge smoothness). Visual diff esperado mas quase imperceptível.
- Trails com Graphics pode ser lento se tesselar cada frame — dirty flag crítico. Se problema, cache vertex buffer por trail.
- DOM event coordinate math precisa bater canvas CSS size vs backing store. `getBoundingClientRect + devicePixelRatio`.
