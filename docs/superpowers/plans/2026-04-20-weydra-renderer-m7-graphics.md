# weydra-renderer M7 Graphics Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Implementar API de vector graphics (circle, rect, roundRect, moveTo/lineTo, arc, fill, stroke, clear) equivalente ao `Pixi.Graphics`, com tessellation via `lyon` crate. Migrar orbit lines, rotas de naves, combat beams, engine trails, rings de seleção. **Re-wire** dos 11 handlers Pixi eventMode (minimap, tutorial, painéis, selection cards) pra DOM addEventListener.

**Architecture:** Retained-mode Graphics com dirty flag. Cada Graphics object tem uma command list (circle, line, etc) que é tesselada lazy em vertex buffer via `lyon`. Render pass percorre Graphics objects não-dirty, reusa vertex buffer; dirty recomputa. Integrado no scene graph do scene.rs com z-order. Batching por color/stroke width não-viável em vector arbitrary — cada Graphics vira 1-2 draw calls (fill + stroke).

**Tech Stack:** lyon crate (tesselador 2D), wgpu vertex buffers, custom graphics.wgsl shader (flat-shaded triangles).

**Depends on:** M3 complete (scene graph + sprite pool patterns).

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
- Modify: `src/world/engine-trails.ts` — trails via weydra
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

impl Graphics {
    pub fn tessellate(&mut self, ctx: &GpuContext) {
        if !self.dirty { return; }

        let mut geometry: VertexBuffers<GraphicsVertex, u16> = VertexBuffers::new();
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
                            &mut BuffersBuilder::new(&mut geometry, |v: FillVertex| GraphicsVertex {
                                position: v.position().to_array(), color: *color,
                            }),
                        ).unwrap();
                    }
                    if let Some((width, color)) = stroke {
                        let opts = StrokeOptions::default().with_line_width(*width);
                        stroke_tess.tessellate_path(
                            &path, &opts,
                            &mut BuffersBuilder::new(&mut geometry, |v: StrokeVertex| GraphicsVertex {
                                position: v.position().to_array(), color: *color,
                            }),
                        ).unwrap();
                    }
                }
                // ... other cmds
                _ => todo!(),
            }
        }

        // Upload to GPU
        use wgpu::util::DeviceExt;
        self.vertex_buffer = Some(ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("graphics verts"),
            contents: bytemuck::cast_slice(&geometry.vertices),
            usage: wgpu::BufferUsages::VERTEX,
        }));
        self.index_buffer = Some(ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("graphics indices"),
            contents: bytemuck::cast_slice(&geometry.indices),
            usage: wgpu::BufferUsages::INDEX,
        }));
        self.index_count = geometry.indices.len() as u32;
        self.dirty = false;
    }
}
```

- [ ] **Step 2: Add graphics.wgsl**

`weydra-renderer/core/shaders/graphics.wgsl`:

```wgsl
struct CameraUniforms { camera: vec2<f32>, viewport: vec2<f32>, time: f32, _pad: vec3<f32> };
@group(0) @binding(0) var<uniform> cam: CameraUniforms;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>, @location(1) color: vec4<f32>) -> VsOut {
    let ndc = (pos - cam.camera) / (cam.viewport * 0.5);
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.color = color;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> { return in.color; }
```

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
    pub fn create_graphics(&mut self) -> u64 { ... }
    pub fn destroy_graphics(&mut self, h: u64) { ... }
    pub fn graphics_clear(&mut self, h: u64) { ... }
    pub fn graphics_circle(&mut self, h: u64, x: f32, y: f32, r: f32,
                            fill_rgba: u32, stroke_color: u32, stroke_width: f32) { ... }
    pub fn graphics_rect(&mut self, h: u64, x: f32, y: f32, w: f32, h_size: f32, ...) { ... }
    pub fn graphics_line(&mut self, h: u64, x1: f32, y1: f32, x2: f32, y2: f32, color: u32, width: f32) { ... }
    pub fn graphics_arc(&mut self, h: u64, cx: f32, cy: f32, r: f32, start: f32, end: f32, color: u32, width: f32) { ... }
}
```

- [ ] **Step 2: TS Graphics class mirrors Pixi**

```typescript
export class Graphics {
  constructor(public readonly handle: bigint, private r: Renderer) {}

  clear(): this { this.r.wasm.graphics_clear(this.handle); return this; }
  circle(x: number, y: number, r: number): this { this._pendingCircle = { x, y, r }; return this; }
  rect(x: number, y: number, w: number, h: number): this { this._pendingRect = { x, y, w, h }; return this; }
  // ... moveTo, lineTo, arc, roundRect

  fill(opts: { color: number; alpha?: number }): this {
    const rgba = packColor(opts.color, opts.alpha ?? 1);
    if (this._pendingCircle) {
      const { x, y, r } = this._pendingCircle;
      this.r.wasm.graphics_circle(this.handle, x, y, r, rgba, 0, 0);
      this._pendingCircle = null;
    }
    // ... similar for rect/roundRect
    return this;
  }

  stroke(opts: { color: number; width: number; alpha?: number }): this { /* ... */ return this; }
}

function packColor(rgb: number, a: number): number {
  return ((rgb >> 16) & 0xff) << 24 | ((rgb >> 8) & 0xff) << 16 | (rgb & 0xff) << 8 | Math.floor(a * 255);
}
```

- [ ] **Step 3: Commit**

```bash
git add weydra-renderer/
git commit -m "feat(weydra): Graphics class API mirrors Pixi.Graphics"
```

---

### Task 4: Migrate orbit lines, rotas, beams, trails, rings

- [ ] **Step 1: sistema.ts orbit lines**

Replace Pixi Graphics with weydra Graphics behind `weydra.graphics` flag.

- [ ] **Step 2: naves.ts rota lines + selection ring**

Same pattern.

- [ ] **Step 3: engine-trails.ts**

Trails as small circles via Graphics OR as dedicated sprite pool. Decision per perf: Graphics is ~10 circles × 4 naves = 40 tessellated shapes/frame; sprite pool is cheaper but loses line continuity. Recomendo Graphics com dirty flag (só retessela se trail cresceu).

- [ ] **Step 4: combate-resolucao.ts beams**

Linhas rápidas com fade — Graphics com lineTo + stroke.

- [ ] **Step 5: Commit**

```bash
git add src/world/
git commit -m "feat(orbital): migra orbit/rotas/beams/trails pra weydra Graphics"
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
