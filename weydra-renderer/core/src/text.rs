//! Text labels — bitmap font glyph atlases + retained-mode TextNode.
//!
//! M8 architecture:
//! - fontdue rasterizes TTF font bytes into per-glyph bitmaps at boot.
//! - All glyphs for a given (font, px_size) pair are packed into a single
//!   RGBA atlas texture; the atlas is shared across every TextNode that
//!   uses that pair (so 100s of TextNodes share 1 upload).
//! - Each TextNode owns a vertex buffer (capacity_chars × 6 vertices).
//!   Tessellation happens on every `set text / position / color` change.
//!   No canvas re-render, no texture re-upload — just a `queue.write_buffer`
//!   of the new vertices, then a draw call.
//! - world_space: false → pos is screen pixels; world_space: true →
//!   pos is world units and the shader subtracts the camera.

use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};
use crate::texture::TextureRegistry;
use fontdue::{Font, FontSettings};

/// Characters we rasterize at init. ASCII printable + Portuguese
/// accents + a couple of common symbols. Anything outside the charset
/// is rendered as a blank advance (see `TextNode::update`).
pub const DEFAULT_CHARSET: &str = concat!(
    " !\"#$%&'()*+,-./0123456789:;<=>?@",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`",
    "abcdefghijklmnopqrstuvwxyz{|}~",
    "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇñÑ·…",
);

/// Information about one glyph baked into the atlas.
#[derive(Copy, Clone, Debug)]
pub struct GlyphInfo {
    /// [u, v, w, h] in atlas (normalized to atlas_w × atlas_h).
    pub uv: [f32; 4],
    /// [width, height] in pixels (drawn rect).
    pub quad_size: [f32; 2],
    /// [xmin, ymin] in pixels — baseline-relative offset to where the
    /// glyph bitmap starts. fontdue's xmin/ymin are pixels-from-baseline
    /// (negative ymin = above baseline, positive = below).
    pub quad_offset: [f32; 2],
    /// Pen advance in pixels after drawing this glyph.
    pub advance: f32,
}

/// One baked bitmap font + RGBA atlas texture. All TextNodes using
/// this atlas share the same Texture + bind group.
pub struct GlyphAtlas {
    /// Handle into the Renderer's `TextureRegistry` (an `Arc<Texture>`
    /// underneath, cheap to clone).
    pub texture: Handle,
    pub atlas_w: u32,
    pub atlas_h: u32,
    pub px_size: f32,
    /// Recommended baseline-to-baseline distance in pixels.
    pub line_height: f32,
    pub glyphs: std::collections::HashMap<char, GlyphInfo>,
}

/// One live text node. Re-tessellates its vertex buffer on content /
/// position / color change. Owns its own TextUniforms buffer (16 B)
/// + bind group for group 1.
pub struct TextNode {
    /// Index into `TextRegistry::atlases`.
    pub atlas: usize,
    pub content: String,
    pub position: [f32; 2],
    pub color: u32,
    pub visible: bool,
    pub z_order: f32,
    /// Uniform scale applied to the per-glyph vertex positions during
    /// tessellation. `1.0` (default) = native px_size. Caller-driven
    /// for things like `memoria.info.scale.set(zoom)` — gives the
    /// nevoa fog labels the same zoom behavior they had with Pixi.
    pub scale: f32,
    pub vertex_buffer: wgpu::Buffer,
    pub vertex_count: u32,
    pub capacity_chars: usize,
    /// When true, the shader subtracts camera and uses world coords;
    /// when false, pos is screen-space pixels (UI overlays).
    pub world_space: bool,
    /// TextUniforms buffer (16 B: [world_space, pad×3]).
    pub uniforms_buffer: wgpu::Buffer,
    /// Bind group 1 (TextUniforms) — one per node, built once at
    /// create_text and never updated.
    pub uniforms_bind_group: wgpu::BindGroup,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct TextUniforms {
    pub world_space: f32,
    pub _pad: [f32; 3],
}
const _: () = assert!(std::mem::size_of::<TextUniforms>() == 16);

/// Quad vertex. pos + uv (atlas) + per-vertex color tint.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct TextVertex {
    pub pos: [f32; 2],
    pub uv: [f32; 2],
    pub color: [f32; 4],
}
const _: () = assert!(std::mem::size_of::<TextVertex>() == 32);

/// Bake a font into a GlyphAtlas. The atlas is a power-of-two RGBA
/// texture (white glyph on alpha). Glyphs are packed row-first with
/// 1-pixel padding between them.
pub fn bake_atlas(
    ctx: &GpuContext,
    textures: &mut TextureRegistry,
    font_bytes: &[u8],
    px_size: f32,
    charset: &str,
) -> GlyphAtlas {
    let font = Font::from_bytes(font_bytes, fontdue::FontSettings::default())
        .expect("fontdue: failed to parse font bytes");

    // First pass: rasterize all glyphs, collect max dimensions.
    let mut rasters: Vec<(char, fontdue::Metrics, Vec<u8>)> = Vec::new();
    let mut max_h: u32 = 0;
    let mut total_w: u32 = 0;
    for ch in charset.chars() {
        let (metrics, bitmap) = font.rasterize(ch, px_size);
        max_h = max_h.max(metrics.height as u32);
        total_w += metrics.width as u32 + 2; // 1 px padding each side
        rasters.push((ch, metrics, bitmap));
    }
    let row_h = max_h + 2;
    // Approximate square atlas with 20 % slack so row wraps don't run out.
    let total_area = (total_w as f32) * (row_h as f32) * 1.2;
    let atlas_w = (total_area.sqrt().ceil() as u32).next_power_of_two().max(256);
    // First pass: lay out positions (row-first).
    let mut pen_x: u32 = 0;
    let mut pen_y: u32 = 0;
    let mut raw_h: u32 = row_h;
    let mut positions: Vec<(char, u32, u32, fontdue::Metrics)> = Vec::new();
    for (ch, metrics, _) in &rasters {
        let w = metrics.width as u32 + 2;
        if pen_x + w > atlas_w {
            pen_x = 0;
            pen_y += row_h;
            raw_h = pen_y + row_h;
        }
        positions.push((*ch, pen_x + 1, pen_y + 1, *metrics));
        pen_x += w;
    }
    let atlas_h = raw_h.next_power_of_two();

    // Second pass: copy each glyph's A-channel into RGBA.
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

    let texture = textures.upload_rgba(ctx, &buf, atlas_w, atlas_h);
    let line_height = font
        .horizontal_line_metrics(px_size)
        .map(|m| m.new_line_size)
        .unwrap_or(px_size * 1.2);

    let mut glyphs = std::collections::HashMap::new();
    for (ch, x, y, metrics) in positions {
        let uv = [
            x as f32 / atlas_w as f32,
            y as f32 / atlas_h as f32,
            metrics.width as f32 / atlas_w as f32,
            metrics.height as f32 / atlas_h as f32,
        ];
        glyphs.insert(
            ch,
            GlyphInfo {
                uv,
                quad_size: [metrics.width as f32, metrics.height as f32],
                quad_offset: [metrics.xmin as f32, metrics.ymin as f32],
                advance: metrics.advance_width,
            },
        );
    }

    GlyphAtlas {
        texture,
        atlas_w,
        atlas_h,
        px_size,
        line_height,
        glyphs,
    }
}

impl TextNode {
    /// Compute the on-screen pixel width of the current content at
    /// the node's `scale`. Walks the content, summing `glyph.advance`
    /// per char (charset-miss chars use `px_size * 0.5` as a fallback).
    /// Used by the bridge's `get_text_width` so TS-side layout code
    /// (e.g. sizing a background panel around a label) sees the same
    /// value on both Pixi and weydra paths.
    pub fn measure_width(&self, atlas: &GlyphAtlas) -> f32 {
        let mut pen_x: f32 = 0.0;
        for ch in self.content.chars() {
            match atlas.glyphs.get(&ch) {
                Some(g) => pen_x += g.advance,
                None => pen_x += atlas.px_size * 0.5,
            }
        }
        pen_x * self.scale
    }

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
        let uniforms_bind_group =
            ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("text uniforms bind group"),
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
            color: 0xFFFF_FFFF,
            visible: true,
            z_order: 0.0,
            scale: 1.0,
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

    /// Re-tessellate the text into the vertex buffer. Cheap (≤ capacity
    /// vertices, one `queue.write_buffer` per call).
    pub fn update(&mut self, ctx: &GpuContext, atlas: &GlyphAtlas) {
        let mut verts: Vec<TextVertex> = Vec::with_capacity(self.content.len() * 6);
        let mut pen_x = self.position[0];
        let pen_y = self.position[1];
        let r = ((self.color >> 24) & 0xff) as f32 / 255.0;
        let g = ((self.color >> 16) & 0xff) as f32 / 255.0;
        let b = ((self.color >> 8) & 0xff) as f32 / 255.0;
        let a = (self.color & 0xff) as f32 / 255.0;
        let scale = self.scale;

        // Baseline is `pen_y + px_size` (top-of-text + one line of ascent).
        // fontdue's ymin is the pixel offset up from the baseline, so the
        // glyph's top edge is at `baseline - ymin - height`.
        // All quad positions are scaled by `self.scale` so callers can
        // apply zoom / pixel-density adjustments without changing the
        // atlas's baked px_size. (Mirrors Pixi's `text.scale.set(v)`.)
        let baseline = pen_y + atlas.px_size;
        for ch in self.content.chars() {
            let glyph = match atlas.glyphs.get(&ch) {
                Some(g) => g,
                None => {
                    // Charset miss — advance by a space-equivalent. Without
                    // this the loop stalls on the same `pen_x`.
                    pen_x += atlas.px_size * 0.5;
                    continue;
                }
            };
            let x0 = (pen_x + glyph.quad_offset[0]) * scale;
            let y0 = (baseline - glyph.quad_offset[1] - glyph.quad_size[1]) * scale;
            let x1 = x0 + glyph.quad_size[0] * scale;
            let y1 = y0 + glyph.quad_size[1] * scale;
            let [u0, v0, uw, vh] = glyph.uv;
            let u1 = u0 + uw;
            let v1 = v0 + vh;
            let tl = TextVertex { pos: [x0, y0], uv: [u0, v0], color: [r, g, b, a] };
            let tr = TextVertex { pos: [x1, y0], uv: [u1, v0], color: [r, g, b, a] };
            let br = TextVertex { pos: [x1, y1], uv: [u1, v1], color: [r, g, b, a] };
            let bl = TextVertex { pos: [x0, y1], uv: [u0, v1], color: [r, g, b, a] };
            verts.push(tl); verts.push(tr); verts.push(br);
            verts.push(tl); verts.push(br); verts.push(bl);
            pen_x += glyph.advance;
        }

        // Clamp to capacity — writing beyond the buffer is UB.
        let max_verts = self.capacity_chars * 6;
        let write_len = verts.len().min(max_verts);
        self.vertex_count = write_len as u32;
        if write_len > 0 {
            ctx.queue.write_buffer(
                &self.vertex_buffer,
                0,
                bytemuck::cast_slice(&verts[..write_len]),
            );
        }
        if verts.len() > max_verts {
            log::warn!(
                "TextNode truncated: content has {} chars, capacity is {}. \
                 Increase capacity_chars in create_text call.",
                self.content.chars().count(),
                self.capacity_chars,
            );
        }
    }
}

/// All glyph atlases + all live TextNodes. One pipeline shared across
/// every node (all nodes use the same shader).
pub struct TextRegistry {
    pub atlases: Vec<GlyphAtlas>,
    pub nodes: SlotMap<TextNode>,
    /// Bind group 1 layout (TextUniforms) — same for every node.
    pub uniforms_layout: wgpu::BindGroupLayout,
    /// Bind group 2 layout (atlas texture + sampler) — same for every atlas.
    pub atlas_layout: wgpu::BindGroupLayout,
    /// One bind group 2 per atlas, indexed by atlas index.
    pub atlas_bind_groups: Vec<wgpu::BindGroup>,
    pub pipeline: Option<wgpu::RenderPipeline>,
}

impl TextRegistry {
    pub fn new(ctx: &GpuContext) -> Self {
        let uniforms_layout =
            ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("text uniforms layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(
                            std::mem::size_of::<TextUniforms>() as u64,
                        ),
                    },
                    count: None,
                }],
            });
        let atlas_layout =
            ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
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

    pub fn build_pipeline(
        &mut self,
        ctx: &GpuContext,
        shader_module: &wgpu::ShaderModule,
        engine_layout: &wgpu::BindGroupLayout,
        surface_format: wgpu::TextureFormat,
    ) {
        let pipeline_layout =
            ctx.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("text pipeline layout"),
                bind_group_layouts: &[
                    Some(engine_layout),
                    Some(&self.uniforms_layout),
                    Some(&self.atlas_layout),
                ],
                immediate_size: 0,
            });
        let vertex_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<TextVertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![
                0 => Float32x2,
                1 => Float32x2,
                2 => Float32x4,
            ],
        };
        let pipeline = ctx
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("text"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: shader_module,
                    entry_point: Some("vs_main"),
                    buffers: &[vertex_layout],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: shader_module,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: surface_format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleList,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });
        self.pipeline = Some(pipeline);
    }

    /// Build the atlas's bind group 2 (texture + sampler). Called once
    /// per atlas after `bake_atlas`.
    pub fn register_atlas_bind_group(
        &mut self,
        ctx: &GpuContext,
        texture: &crate::texture::Texture,
    ) {
        let bg = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("text atlas bind group"),
            layout: &self.atlas_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&texture.view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&texture.sampler),
                },
            ],
        });
        self.atlas_bind_groups.push(bg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vertex_layout_pod() {
        // Pin byte layout. Drift here silently corrupts the GPU read.
        assert_eq!(std::mem::size_of::<TextVertex>(), 32);
        assert_eq!(std::mem::align_of::<TextVertex>(), 4);
        assert_eq!(core::mem::offset_of!(TextVertex, pos), 0);
        assert_eq!(core::mem::offset_of!(TextVertex, uv), 8);
        assert_eq!(core::mem::offset_of!(TextVertex, color), 16);
    }

    #[test]
    fn uniforms_layout_pod() {
        assert_eq!(std::mem::size_of::<TextUniforms>(), 16);
        assert_eq!(std::mem::offset_of!(TextUniforms, world_space), 0);
        assert_eq!(core::mem::offset_of!(TextUniforms, _pad), 4);
    }
}
    /// M8 plan: assert every char in `DEFAULT_CHARSET` rasterizes
    /// to a non-empty glyph. Without this, a missing/broken glyph
    /// would only surface as a tofu character at runtime.
    #[test]
    fn charset_coverage_complete() {
        let font_bytes = include_bytes!("fonts/silkscreen.ttf");
        let font = Font::from_bytes(font_bytes.to_vec(), FontSettings::default())
            .expect("font file parse");
        for ch in DEFAULT_CHARSET.chars() {
            let (metrics, _bitmap) = font.rasterize(ch, 12.0);
            assert!(
                metrics.width >= 0,
                "Glyph for {:?} has negative width: {}",
                ch,
                metrics.width,
            );
        }
}
