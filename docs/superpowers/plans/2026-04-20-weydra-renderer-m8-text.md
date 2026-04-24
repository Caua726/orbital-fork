# weydra-renderer M8 Text Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Substituir todos os usos de `Pixi.Text` por rendering via bitmap font no weydra. Fonte rasterizada via `fontdue`, glyphs armazenados num atlas, texto vira vertex buffer de quads que sample o atlas. Update de label (ex: "Humanos · 3/5") passa a ser write direto no buffer de vertex, sem recriar canvas nem upload de textura por frame.

**Architecture:** `fontdue` rasteriza a fonte escolhida em 2-3 tamanhos fixos (pequeno pra labels de fog/painel, médio pra títulos, grande pra tutorial). No boot, o engine gera um atlas RGBA com todos os glyphs ASCII imprimíveis + acentos usados pelo jogo. Runtime: cada `Text` instance é um vertex buffer cacheado, invalidado quando `set text(...)` troca conteúdo. Draw = 1 call por atlas texture (todos os textos compartilham o mesmo atlas).

**Tech Stack:** `fontdue` crate + M3 sprite/texture infra + M7 vertex buffer management (se já criado) + `wasm-bindgen` exports.

**Depends on:** M3 (TextureRegistry), M7 (lyon/vertex buffer patterns — ajuda mas não bloqueia).

**Scope audit real do jogo (grep em 2026-04-24):** 30 usos de `new Text()` em 4 arquivos:
- `src/ui/painel.ts` (~24 instâncias — labels de planeta, naves, pesquisa, carga, edifícios)
- `src/ui/selecao.ts` (selection cards)
- `src/ui/tutorial.ts` (título + linhas + close button)
- `src/world/nevoa.ts` (labels de memória — nome/owner/build count)

O spec original dizia "3 usos" — era baseado em audit incompleto. Plano abaixo trata todos os 4 arquivos. M9 usa esse mesmo Text API pra UI final.

---

## File Structure

**New in core:**
- `core/src/text.rs` — Font loader, GlyphAtlas, Text primitive
- `core/src/fonts/` — font files bundled via `include_bytes!` (Silkscreen.ttf ou VT323.ttf)
- `core/shaders/text.wgsl` — text quad shader (samples atlas, aplica tint)

**Modified in core:**
- `core/src/lib.rs` — exports

**Modified in adapters/wasm:**
- `adapters/wasm/src/lib.rs` — `create_text`, `set_text_content`, `set_text_position`, `set_text_color`

**Modified in ts-bridge:**
- `ts-bridge/index.ts` — `Text` class com `.text = "..."`, `.x`, `.y`, `.color`

**New in vite-plugin-wgsl:**
- nenhum

**Game:**
- Modify: `src/core/config.ts` — `weydra.text` flag
- Modify: `src/ui/painel.ts` — branch cada `new Text()` via flag
- Modify: `src/ui/selecao.ts` — idem
- Modify: `src/ui/tutorial.ts` — idem
- Modify: `src/world/nevoa.ts` — labels de fog memory

---

### Task 1: Escolha de fonte + bundling

**Files:**
- Create: `weydra-renderer/core/src/fonts/silkscreen.ttf` (ou VT323 — decisão no step 1)

- [ ] **Step 1: Escolher fonte**

Orbital hoje usa `font-family: monospace` no CSS + Pixi Text default. Pra bater pixel-art feel:

- **Silkscreen** (Jason Kottke, SIL Open Font License) — bitmap-style, 8px base, ideal pra UI pequena
- **VT323** (Google Fonts, Open Font License) — terminal-style, melhor pra texto maior

Recomendação: **Silkscreen** pra labels pequenas (painel, fog), **VT323** pra tutorial/título. Bundleamos ambas.

Download:
```bash
mkdir -p weydra-renderer/core/src/fonts
curl -L -o weydra-renderer/core/src/fonts/silkscreen.ttf https://github.com/google/fonts/raw/main/ofl/silkscreen/Silkscreen-Regular.ttf
curl -L -o weydra-renderer/core/src/fonts/vt323.ttf https://github.com/google/fonts/raw/main/ofl/vt323/VT323-Regular.ttf
```

- [ ] **Step 2: Commit assets**

```bash
git add weydra-renderer/core/src/fonts/
git commit -m "chore(weydra-renderer): bundle Silkscreen + VT323 font files"
```

---

### Task 2: fontdue integration + GlyphAtlas

**Files:**
- Create: `weydra-renderer/core/src/text.rs`
- Modify: `weydra-renderer/core/Cargo.toml`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Add fontdue to Cargo.toml**

```toml
[dependencies]
# ... existing
fontdue = "0.9"
```

- [ ] **Step 2: Write text module**

Create `weydra-renderer/core/src/text.rs`:

```rust
use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};
use crate::texture::TextureRegistry;
use fontdue::{Font, FontSettings};

/// Bitmap glyph atlas baked at init time for a specific font + px size.
/// All glyphs packed into a single RGBA texture via row-first packing.
pub struct GlyphAtlas {
    pub texture: Handle,
    pub atlas_w: u32,
    pub atlas_h: u32,
    pub px_size: f32,
    pub line_height: f32,
    pub glyphs: std::collections::HashMap<char, GlyphInfo>,
}

#[derive(Copy, Clone, Debug)]
pub struct GlyphInfo {
    pub uv: [f32; 4],          // u, v, w, h in atlas (normalized)
    pub quad_size: [f32; 2],   // width, height in px
    pub quad_offset: [f32; 2], // xmin, ymin in px (from baseline)
    pub advance: f32,          // pen advance in px
}

/// Characters we rasterize at init: ASCII printable + Portuguese accents.
pub const DEFAULT_CHARSET: &str = concat!(
    " !\"#$%&'()*+,-./0123456789:;<=>?@",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`",
    "abcdefghijklmnopqrstuvwxyz{|}~",
    "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇñÑ·…",
);

pub fn bake_atlas(
    ctx: &GpuContext,
    textures: &mut TextureRegistry,
    font_bytes: &[u8],
    px_size: f32,
    charset: &str,
) -> GlyphAtlas {
    let font = Font::from_bytes(font_bytes, FontSettings::default())
        .expect("failed to parse font");

    // Rasterize each glyph, collect into Vec<(char, metrics, bitmap)>
    let mut rasters: Vec<(char, fontdue::Metrics, Vec<u8>)> = Vec::new();
    let mut max_h: u32 = 0;
    let mut total_w: u32 = 0;
    for ch in charset.chars() {
        let (metrics, bitmap) = font.rasterize(ch, px_size);
        max_h = max_h.max(metrics.height as u32);
        total_w += metrics.width as u32 + 2; // 1px padding each side
        rasters.push((ch, metrics, bitmap));
    }

    // Pack into grid: target ~sqrt of total area (width × row_height).
    // total_w already sums glyph widths; multiply by row_h to get true area.
    let row_h = max_h + 2;
    let total_area = (total_w as f32) * (row_h as f32) * 1.2; // 20% slack
    let atlas_w_target = total_area.sqrt().ceil() as u32;
    let atlas_w = atlas_w_target.next_power_of_two().max(256);

    let mut pen_x: u32 = 0;
    let mut pen_y: u32 = 0;
    let mut atlas_h: u32 = row_h;
    let mut glyphs = std::collections::HashMap::new();

    // First pass: compute positions
    let mut positions: Vec<(char, u32, u32, fontdue::Metrics)> = Vec::new();
    for (ch, metrics, _) in &rasters {
        let w = metrics.width as u32 + 2;
        if pen_x + w > atlas_w {
            pen_x = 0;
            pen_y += row_h;
            atlas_h = pen_y + row_h;
        }
        positions.push((*ch, pen_x + 1, pen_y + 1, *metrics));
        pen_x += w;
    }

    // Round atlas_h up to power-of-two for nice GPU alignment
    let atlas_h = atlas_h.next_power_of_two();

    // Allocate RGBA buffer, copy each glyph bitmap (A → RGBA white with glyph alpha)
    let mut buf = vec![0u8; (atlas_w * atlas_h * 4) as usize];
    for ((_ch, metrics, bitmap), (_, x, y, _)) in rasters.iter().zip(positions.iter()) {
        for gy in 0..metrics.height {
            for gx in 0..metrics.width {
                let src = bitmap[gy * metrics.width + gx];
                let dst = (((y + gy as u32) * atlas_w) + (x + gx as u32)) as usize * 4;
                buf[dst + 0] = 255;
                buf[dst + 1] = 255;
                buf[dst + 2] = 255;
                buf[dst + 3] = src;
            }
        }
    }

    // Populate glyphs HashMap with UV info
    for (ch, x, y, metrics) in positions {
        let uv = [
            x as f32 / atlas_w as f32,
            y as f32 / atlas_h as f32,
            metrics.width as f32 / atlas_w as f32,
            metrics.height as f32 / atlas_h as f32,
        ];
        glyphs.insert(ch, GlyphInfo {
            uv,
            quad_size: [metrics.width as f32, metrics.height as f32],
            quad_offset: [metrics.xmin as f32, metrics.ymin as f32],
            advance: metrics.advance_width,
        });
    }

    let texture = textures.upload_rgba(ctx, &buf, atlas_w, atlas_h);
    let line_height = font.horizontal_line_metrics(px_size)
        .map(|m| m.new_line_size)
        .unwrap_or(px_size * 1.2);

    GlyphAtlas { texture, atlas_w, atlas_h, px_size, line_height, glyphs }
}

/// A live text node. Re-tessellates vertex buffer on content change.
/// Owns its own TextUniforms buffer (16 bytes) + bind group for group 1.
pub struct TextNode {
    pub atlas: usize, // index into renderer's atlases Vec
    pub content: String,
    pub position: [f32; 2],
    pub color: u32,
    pub visible: bool,
    pub z_order: f32,
    pub vertex_buffer: wgpu::Buffer,
    pub vertex_count: u32,
    pub capacity_chars: usize,
    /// When true, vs_main subtracts camera and uses world coords;
    /// when false, pos is screen-space pixels (UI overlays).
    pub world_space: bool,
    /// TextUniforms buffer (16 bytes: [world_space, pad, pad, pad]).
    pub uniforms_buffer: wgpu::Buffer,
    /// Bind group 1 (TextUniforms) — one per node, rebuilt only when layout
    /// changes (never, post-construction). Cheap; each node adds 1 bind group.
    pub uniforms_bind_group: wgpu::BindGroup,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct TextUniforms {
    pub world_space: f32,
    pub _pad: [f32; 3],
}

impl TextNode {
    pub fn new(
        ctx: &GpuContext,
        atlas: usize,
        capacity_chars: usize,
        uniforms_layout: &wgpu::BindGroupLayout,
    ) -> Self {
        let byte_size = (capacity_chars * 6 * std::mem::size_of::<TextVertex>()) as u64;
        let vertex_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("text vertex buffer"),
            size: byte_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniforms_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("text uniforms"),
            size: std::mem::size_of::<TextUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniforms_bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("text uniforms bg"),
            layout: uniforms_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniforms_buffer.as_entire_binding(),
            }],
        });
        Self {
            atlas,
            content: String::new(),
            position: [0.0, 0.0],
            color: 0xFFFFFFFF,
            visible: true,
            z_order: 0.0,
            vertex_buffer,
            vertex_count: 0,
            capacity_chars,
            world_space: false,
            uniforms_buffer,
            uniforms_bind_group,
        }
    }

    pub fn write_uniforms(&self, ctx: &GpuContext) {
        let u = TextUniforms {
            world_space: if self.world_space { 1.0 } else { 0.0 },
            _pad: [0.0; 3],
        };
        ctx.queue.write_buffer(&self.uniforms_buffer, 0, bytemuck::bytes_of(&u));
    }

    /// Re-tessellate the text into the vertex buffer. Call after `content`,
    /// `position`, or `color` change.
    pub fn update(&mut self, ctx: &GpuContext, atlas: &GlyphAtlas) {
        let mut verts: Vec<TextVertex> = Vec::with_capacity(self.content.len() * 6);
        let mut pen_x = self.position[0];
        let pen_y = self.position[1];
        let r = ((self.color >> 24) & 0xff) as f32 / 255.0;
        let g = ((self.color >> 16) & 0xff) as f32 / 255.0;
        let b = ((self.color >> 8) & 0xff) as f32 / 255.0;
        let a = (self.color & 0xff) as f32 / 255.0;

        // pen_y is the glyph top-left baseline-offset reference (screen y-down).
        // fontdue's `ymin` is the pixel offset up from the baseline, so for
        // a y-down screen with the baseline at pen_y + px_size, the glyph top
        // starts at (baseline - ymin - height).
        let baseline = pen_y + atlas.px_size;
        for ch in self.content.chars() {
            let Some(glyph) = atlas.glyphs.get(&ch) else { pen_x += atlas.px_size * 0.5; continue; };
            let x0 = pen_x + glyph.quad_offset[0];
            let y0 = baseline - glyph.quad_offset[1] - glyph.quad_size[1];
            let x1 = x0 + glyph.quad_size[0];
            let y1 = y0 + glyph.quad_size[1];
            let [u0, v0, uw, vh] = glyph.uv;
            let u1 = u0 + uw;
            let v1 = v0 + vh;
            // 2 triangles
            let tl = TextVertex { pos: [x0, y0], uv: [u0, v0], color: [r, g, b, a] };
            let tr = TextVertex { pos: [x1, y0], uv: [u1, v0], color: [r, g, b, a] };
            let br = TextVertex { pos: [x1, y1], uv: [u1, v1], color: [r, g, b, a] };
            let bl = TextVertex { pos: [x0, y1], uv: [u0, v1], color: [r, g, b, a] };
            verts.push(tl); verts.push(tr); verts.push(br);
            verts.push(tl); verts.push(br); verts.push(bl);
            pen_x += glyph.advance;
        }

        // Clamp to capacity — if label exceeds, truncate. Writing beyond
        // buffer would be UB; skipping the write while setting vertex_count
        // would render stale data. Always clamp both the slice and the count.
        let max_verts = self.capacity_chars * 6;
        let write_len = verts.len().min(max_verts);
        let truncated = verts.len() > max_verts;
        self.vertex_count = write_len as u32;
        if write_len > 0 {
            ctx.queue.write_buffer(
                &self.vertex_buffer,
                0,
                bytemuck::cast_slice(&verts[..write_len]),
            );
        }
        if truncated {
            log::warn!(
                "TextNode truncated: {} chars requested, {} chars capacity. \
                 Increase capacity_chars in create_text call.",
                self.content.chars().count(),
                self.capacity_chars,
            );
        }
    }

    /// True se o último `update()` truncou o conteúdo — caller pode reagir
    /// (re-criar text com capacity maior) ou ignorar (aceitar truncamento).
    pub fn was_truncated(&self) -> bool {
        // Approx: reconta chars do content e compara com capacity
        self.content.chars().count() > self.capacity_chars
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct TextVertex {
    pub pos: [f32; 2],
    pub uv: [f32; 2],
    pub color: [f32; 4],
}

pub struct TextRegistry {
    pub atlases: Vec<GlyphAtlas>,
    pub nodes: SlotMap<TextNode>,
    /// Bind group 1 layout (TextUniforms) — same for all nodes
    pub uniforms_layout: wgpu::BindGroupLayout,
    /// Bind group 2 layout (atlas texture + sampler) — same for all atlases
    pub atlas_layout: wgpu::BindGroupLayout,
    /// One bind group 2 per atlas, indexed by atlas index
    pub atlas_bind_groups: Vec<wgpu::BindGroup>,
    pub pipeline: Option<wgpu::RenderPipeline>,
}

impl TextRegistry {
    pub fn new(ctx: &GpuContext) -> Self {
        let uniforms_layout = ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("text uniforms layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<TextUniforms>() as u64),
                },
                count: None,
            }],
        });
        let atlas_layout = ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("text atlas layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        Self {
            atlases: Vec::new(),
            nodes: SlotMap::new(),
            uniforms_layout,
            atlas_layout,
            atlas_bind_groups: Vec::new(),
            pipeline: None,
        }
    }

    /// Build the text pipeline once all 3 bind group layouts are defined.
    /// Called during Renderer::new after bake_atlas runs for each atlas.
    pub fn build_pipeline(
        &mut self,
        ctx: &GpuContext,
        shader_module: &wgpu::ShaderModule,
        engine_layout: &wgpu::BindGroupLayout,
        surface_format: wgpu::TextureFormat,
    ) {
        let pipeline_layout = ctx.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("text pipeline layout"),
            bind_group_layouts: &[engine_layout, &self.uniforms_layout, &self.atlas_layout],
            push_constant_ranges: &[],
        });

        let vertex_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<TextVertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 0,  shader_location: 0 },
                wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 8,  shader_location: 1 },
                wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 16, shader_location: 2 },
            ],
        };

        let pipeline = ctx.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("text pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: shader_module, entry_point: Some("vs_main"),
                buffers: &[vertex_layout], compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: shader_module, entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleList, ..Default::default() },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        self.pipeline = Some(pipeline);
    }

    /// After each atlas is baked, build its bind group 2 (texture + sampler).
    pub fn register_atlas_bind_group(&mut self, ctx: &GpuContext, texture: &crate::texture::Texture) {
        let bg = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("text atlas bg"),
            layout: &self.atlas_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&texture.view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&texture.sampler) },
            ],
        });
        self.atlas_bind_groups.push(bg);
    }
}
```

- [ ] **Step 3: Add to lib.rs**

```rust
pub mod text;
pub use text::{TextRegistry, GlyphAtlas, TextNode, TextVertex, bake_atlas, DEFAULT_CHARSET};
```

- [ ] **Step 4: Commit**

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): fontdue glyph atlas + TextNode primitive"
```

---

### Task 3: Text shader

**Files:**
- Create: `weydra-renderer/core/shaders/text.wgsl`

- [ ] **Step 1: Write shader**

```wgsl
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32, _pad1: f32, _pad2: f32,
};

struct TextUniforms {
    // world_space = 1.0: subtract camera before NDC transform (fog labels)
    // world_space = 0.0: raw screen-space (UI overlays)
    world_space: f32,
    _pad0: f32, _pad1: f32, _pad2: f32,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> text_uniforms: TextUniforms;
@group(2) @binding(0) var atlas_tex: texture_2d<f32>;
@group(2) @binding(1) var atlas_samp: sampler;

struct VsIn {
    @location(0) pos: vec2<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
};

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    // Screen-space: pos is already in pixel coords from the top-left.
    // World-space: pos is in world units; subtract camera center to reach
    // a camera-relative offset, then scale to NDC via half-viewport.
    var screen_px = in.pos;
    if (text_uniforms.world_space > 0.5) {
        screen_px = (in.pos - engine_camera.camera) + engine_camera.viewport * 0.5;
    }
    let ndc = (screen_px / engine_camera.viewport * 2.0) - vec2<f32>(1.0, 1.0);
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = in.uv;
    out.color = in.color;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let sample = textureSample(atlas_tex, atlas_samp, in.uv);
    // Atlas is white glyph on alpha channel — multiply by color
    return vec4<f32>(in.color.rgb, in.color.a * sample.a);
}
```

- [ ] **Step 2: Commit**

```bash
git add weydra-renderer/core/shaders/text.wgsl
git commit -m "feat(shaders): text.wgsl — atlas-sampled text with color tint"
```

---

### Task 4: WASM adapter exports

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`

- [ ] **Step 1: Embed fonts**

At top of lib.rs:

```rust
const SILKSCREEN_TTF: &[u8] = include_bytes!("../../../core/src/fonts/silkscreen.ttf");
const VT323_TTF: &[u8] = include_bytes!("../../../core/src/fonts/vt323.ttf");
```

- [ ] **Step 2: Init text atlases + pipeline durante Renderer::new**

```rust
// In Renderer struct:
text_registry: TextRegistry,
// atlases indices: 0 = silkscreen 12px, 1 = silkscreen 16px, 2 = vt323 24px
```

At end of `new(canvas)`, após engine bindings e shader_registry criados:

```rust
let mut text_registry = TextRegistry::new(&ctx);

// Bake atlases. `wgpu::Texture/View/Sampler` NÃO implementam Clone em
// wgpu 25.x — passamos &Texture direto pro register, sem clonar.
for (ttf, px) in [(SILKSCREEN_TTF, 12.0), (SILKSCREEN_TTF, 16.0), (VT323_TTF, 24.0)] {
    let atlas = bake_atlas(&ctx, &mut textures, ttf, px, DEFAULT_CHARSET);
    let tex_ref = textures.get(atlas.texture).expect("atlas texture");
    text_registry.register_atlas_bind_group(&ctx, tex_ref);
    text_registry.atlases.push(atlas);
}

// Compile shader + pipeline
let text_shader = shader_registry.compile(&ctx, TEXT_WGSL, "text");
let text_module = &shader_registry.get(text_shader).unwrap().module;
text_registry.build_pipeline(&ctx, text_module, &engine.layout, surface.format);
```

onde `TEXT_WGSL` é `include_str!("../../../core/shaders/text.wgsl")`.

Observação: `wgpu::Texture`, `TextureView`, `Sampler` **não** implementam `Clone` em wgpu 25.x (ao contrário do que `Arc` interno sugeriria). Nossa `crate::texture::Texture` wrapper também não — e não precisa. `textures.get()` retorna `&Texture`; passamos essa ref direto pro `register_atlas_bind_group(&ctx, tex_ref)`.

- [ ] **Step 3: Add text API**

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn create_text(&mut self, atlas_idx: u32, capacity_chars: u32, world_space: bool) -> u64 {
        let mut node = TextNode::new(
            &self.ctx,
            atlas_idx as usize,
            capacity_chars as usize,
            &self.text_registry.uniforms_layout,
        );
        node.world_space = world_space;
        node.write_uniforms(&self.ctx);
        let h = self.text_registry.nodes.insert(node);
        self.mem_version = self.mem_version.wrapping_add(1);
        h.to_u64()
    }

    pub fn set_text_visible(&mut self, handle: u64, visible: bool) {
        if let Some(node) = self.text_registry.nodes.get_mut(Handle::from_u64(handle)) {
            node.visible = visible;
        }
    }

    pub fn set_text_z_order(&mut self, handle: u64, z: f32) {
        if let Some(node) = self.text_registry.nodes.get_mut(Handle::from_u64(handle)) {
            node.z_order = z;
        }
    }

    pub fn destroy_text(&mut self, handle: u64) {
        self.text_registry.nodes.remove(Handle::from_u64(handle));
    }

    pub fn set_text_content(&mut self, handle: u64, content: &str) {
        let h = Handle::from_u64(handle);
        let atlas_idx = self.text_registry.nodes.get(h).map(|n| n.atlas);
        if let (Some(idx), Some(node)) = (atlas_idx, self.text_registry.nodes.get_mut(h)) {
            if node.content != content {
                node.content = content.to_string();
                let atlas = &self.text_registry.atlases[idx];
                node.update(&self.ctx, atlas);
            }
        }
    }

    pub fn set_text_position(&mut self, handle: u64, x: f32, y: f32) {
        let h = Handle::from_u64(handle);
        let atlas_idx = self.text_registry.nodes.get(h).map(|n| n.atlas);
        if let (Some(idx), Some(node)) = (atlas_idx, self.text_registry.nodes.get_mut(h)) {
            if node.position[0] != x || node.position[1] != y {
                node.position = [x, y];
                let atlas = &self.text_registry.atlases[idx];
                node.update(&self.ctx, atlas);
            }
        }
    }

    pub fn set_text_color(&mut self, handle: u64, rgba: u32) {
        let h = Handle::from_u64(handle);
        let atlas_idx = self.text_registry.nodes.get(h).map(|n| n.atlas);
        if let (Some(idx), Some(node)) = (atlas_idx, self.text_registry.nodes.get_mut(h)) {
            if node.color != rgba {
                node.color = rgba;
                let atlas = &self.text_registry.atlases[idx];
                node.update(&self.ctx, atlas);
            }
        }
    }
}
```

- [ ] **Step 4: Update render() to draw text**

Após sprite pass, add text pass (z-order: UI overlay). Agrupar por atlas pra minimizar rebinds:

```rust
if let Some(pipeline) = &self.text_registry.pipeline {
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, &self.engine.bind_group, &[]);

    // Collect visible nodes grouped by atlas
    let mut by_atlas: Vec<Vec<Handle>> = vec![Vec::new(); self.text_registry.atlases.len()];
    for (h, node) in self.text_registry.nodes.iter() {
        if node.visible && node.vertex_count > 0 {
            by_atlas[node.atlas].push(h);
        }
    }

    for (atlas_idx, handles) in by_atlas.iter().enumerate() {
        if handles.is_empty() { continue; }
        pass.set_bind_group(2, &self.text_registry.atlas_bind_groups[atlas_idx], &[]);
        for h in handles {
            let node = self.text_registry.nodes.get(*h).unwrap();
            pass.set_bind_group(1, &node.uniforms_bind_group, &[]);
            pass.set_vertex_buffer(0, node.vertex_buffer.slice(..));
            pass.draw(0..node.vertex_count, 0..1);
        }
    }
}
```

Uma draw call por text node (não batched); 10-30 nodes visíveis em peak UI → trivial.

- [ ] **Step 5: Rebuild + commit**

```bash
cd weydra-renderer/adapters/wasm
wasm-pack build --target web --out-dir pkg
git add weydra-renderer/
git commit -m "feat(weydra-wasm): text API — atlas-based labels with dynamic content"
```

---

### Task 5: TS bridge — Text class

**Files:**
- Modify: `weydra-renderer/ts-bridge/index.ts`

- [ ] **Step 1: Add Text class**

```typescript
export const FONT_SMALL = 0;   // silkscreen 12px
export const FONT_MEDIUM = 1;  // silkscreen 16px
export const FONT_LARGE = 2;   // vt323 24px

export class Text {
  private _x = 0;
  private _y = 0;

  constructor(
    public readonly handle: bigint,
    private r: Renderer,
  ) {}

  private _text = '';
  private _visible = true;
  private _zOrder = 0;

  set text(v: string) { this._text = v; this.r.innerSetTextContent(this.handle, v); }
  get text(): string { return this._text; }
  set x(v: number) { this._x = v; this.r.innerSetTextPosition(this.handle, v, this._y); }
  get x(): number { return this._x; }
  set y(v: number) { this._y = v; this.r.innerSetTextPosition(this.handle, this._x, v); }
  get y(): number { return this._y; }
  set color(rgba: number) { this.r.innerSetTextColor(this.handle, rgba); }
  set visible(v: boolean) { this._visible = v; this.r.innerSetTextVisible(this.handle, v); }
  get visible(): boolean { return this._visible; }
  /// Higher z-order renders on top. UI overlays use Z.UI_* constants (50+).
  set zOrder(v: number) { this._zOrder = v; this.r.innerSetTextZOrder(this.handle, v); }
  get zOrder(): number { return this._zOrder; }
}

// In Renderer:
// worldSpace=false => screen coords (UI overlays)
// worldSpace=true  => world coords (fog memory labels, anything tied to camera)
createText(font: number = FONT_SMALL, capacityChars = 64, worldSpace = false): Text {
  const h = this.inner.create_text(font, capacityChars, worldSpace);
  this.revalidate();
  return new Text(BigInt(h), this);
}

destroyText(t: Text): void {
  this.inner.destroy_text(t.handle);
}

innerSetTextContent(h: bigint, s: string): void { this.inner.set_text_content(h, s); }
innerSetTextPosition(h: bigint, x: number, y: number): void { this.inner.set_text_position(h, x, y); }
innerSetTextColor(h: bigint, c: number): void { this.inner.set_text_color(h, c); }
innerSetTextVisible(h: bigint, v: boolean): void { this.inner.set_text_visible(h, v); }
innerSetTextZOrder(h: bigint, z: number): void { this.inner.set_text_z_order(h, z); }
```

- [ ] **Step 2: Commit**

```bash
git add weydra-renderer/ts-bridge/
git commit -m "feat(ts-bridge): Text class with font size constants"
```

---

### Task 6: Game integration — fog memory labels

**Files:**
- Modify: `src/world/nevoa.ts`

- [ ] **Step 1: Branch label creation**

Esses são labels no world-space que acompanham camera. Mais simples pra começar — padrão pro resto do jogo.

```typescript
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { Text as WeydraText, FONT_SMALL } from '@weydra/renderer';

function criarLabelMemoria(nome: string, owner: string, builds: number): any {
  if (getConfig().weydra.text) {
    const r = getWeydraRenderer();
    if (r) {
      // worldSpace=true — label follows planet world coords, camera applied in shader
      const t = r.createText(FONT_SMALL, 32, true);
      t.text = `${nome}\n${owner} · ${builds}`;
      return { _weydraText: t, isWeydra: true };
    }
  }
  // existing Pixi path
  return new Text({ text: `${nome}\n${owner} · ${builds}`, style: ESTILO_MEMORIA });
}
```

Update + destroy segue o pattern de M3/M7.

- [ ] **Step 2: Commit**

```bash
git add src/world/nevoa.ts
git commit -m "feat(orbital): fog memory labels via weydra text"
```

---

### Task 7: Game integration — painel + selecao + tutorial

**Files:**
- Modify: `src/ui/painel.ts`
- Modify: `src/ui/selecao.ts`
- Modify: `src/ui/tutorial.ts`

- [ ] **Step 1: Helper function**

Criar `src/ui/_text-helper.ts`:

```typescript
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { Text as WeydraText, FONT_SMALL, FONT_MEDIUM, FONT_LARGE } from '@weydra/renderer';
import { Text } from 'pixi.js';

export interface TextLike {
  text: string;
  x: number;
  y: number;
  visible: boolean;
  _weydra?: WeydraText;
  _pixi?: Text;
}

export function criarText(
  content: string,
  fontSize: number,
  color: number,
): TextLike {
  if (getConfig().weydra.text) {
    const r = getWeydraRenderer();
    if (r) {
      const fontIdx = fontSize <= 13 ? FONT_SMALL : fontSize <= 18 ? FONT_MEDIUM : FONT_LARGE;
      const t = r.createText(fontIdx, Math.max(64, content.length + 16), false);
      t.text = content;
      t.color = ((color & 0xFFFFFF) << 8) | 0xFF; // RGBA8
      // Delegate 100% to the underlying Text (which has its own getters/setters).
      // No shadow state — prevents get-returns-stale-value bug.
      return {
        get text() { return t.text; },
        set text(v: string) { t.text = v; },
        get x() { return t.x; },
        set x(v: number) { t.x = v; },
        get y() { return t.y; },
        set y(v: number) { t.y = v; },
        get visible() { return t.visible; },
        set visible(v: boolean) { t.visible = v; },
        _weydra: t,
      } as any;
    }
  }
  const pixiText = new Text({ text: content, style: { fontSize, fill: color, fontFamily: 'monospace' } });
  return {
    get text() { return pixiText.text; },
    set text(v: string) { pixiText.text = v; },
    get x() { return pixiText.x; },
    set x(v: number) { pixiText.x = v; },
    get y() { return pixiText.y; },
    set y(v: number) { pixiText.y = v; },
    get visible() { return pixiText.visible; },
    set visible(v: boolean) { pixiText.visible = v; },
    _pixi: pixiText,
  } as any;
}
```

- [ ] **Step 2: Replace `new Text(...)` in painel.ts**

Sub-task repetitivo. 24 ocorrências:

```typescript
// Antes:
const texto = new Text({ text: '', style: { fontSize: 13, fill: SP.statCyan, fontFamily: 'monospace' } });

// Depois:
const texto = criarText('', 13, 0x66ccff);
```

Para cada uso que era adicionado a Container via `.addChild`, o caminho Pixi preserva `_pixi` e adiciona direto. O caminho weydra só armazena o Text — posicionamento vira set no frame loop.

- [ ] **Step 3: Replace em selecao.ts e tutorial.ts**

Mesma substituição.

- [ ] **Step 4: Commit**

```bash
git add src/ui/ src/ui/_text-helper.ts
git commit -m "feat(orbital): painel/selecao/tutorial via weydra text (helper-based)"
```

---

### Task 8: Config flag + validation

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: Add flag**

```typescript
weydra: {
  // ... previous M flags
  text: boolean; // M8
}
```

Default `false`.

- [ ] **Step 2: Test enable**

```js
__setWeydra('text', true);
location.reload();
```

Verificar visualmente:
- Labels de painel legíveis, sem bordas borradas
- Acentos (á, ã, ç) renderizam corretamente
- Update dinâmico (construir edifício muda contador) reflete imediato
- Texto no fog (planeta memorizado) posicionado correto em world-space

- [ ] **Step 3: Perf**

Com flag Pixi, cada `Text.text = newStr` gera canvas draw + texture upload → 2-5ms spike. Com weydra, update é vertex buffer rewrite → sub-0.1ms. Validar via profiling quando abrir/fechar painel várias vezes.

- [ ] **Step 4: Mark complete**

```markdown
## M8 Status: Complete (YYYY-MM-DD)
Text via fontdue atlas. 4 arquivos migrados (painel, selecao, tutorial, nevoa).
Update dinâmico O(n chars) em vez de canvas+upload.
```

```bash
git add src/core/config.ts docs/superpowers/specs/
git commit -m "feat(orbital): weydra.text flag + M8 complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ fontdue bitmap font
- ✅ Glyph atlas único (ou 3 — por px size)
- ✅ Conteúdo dinâmico sem canvas upload
- ✅ Feature flag
- ✅ Helper pattern pra migrar 30+ Text instances

**Deferred:**
- Text alignment (left-align only; center/right no M9 se precisar)
- Multi-font-family em 1 atlas (bundleamos Silkscreen + VT323 como atlases separados, 3 total; OK)
- Text wrapping (hoje nenhum Text do Orbital usa auto-wrap; se surgir, adicionar explicitly)
- Rich text (color ranges within string) — nenhum uso atual

**Risks:**
- Charset incompleto — jogador tenta salvar com nome cirílico/CJK → retângulos. Mitigação: fallback char na hora de render (já implementado: `pen_x += atlas.px_size * 0.5` quando char ausente).
- Atlas muito grande — 3 atlases × 512×512 RGBA = 3MB. Aceitável.
- Silkscreen 12px pode ficar borrado em devicePixelRatio alto — considerar bake em 24px e scale down, ou baking per-DPR no boot.
- Text posicionamento em world-space (labels de fog) requer camera pass no shader que hoje está só em screen-space. Adicionar flag `worldSpace: true` que subtrai camera no vs_main (ou fazer dois pipelines).
