//! Graphics primitives — circles, rects, roundRects, lines, arcs.
//!
//! Mirrors `Pixi.Graphics` API surface at the game level. Each `Graphics`
//! object owns its own command list (CPU-only, no GPU impact until
//! `tessellate()` runs). Tessellation happens lazily in `Renderer::render()`
//! before `begin_render_pass`, gated by the `dirty` flag — every mutator
//! (`circle`, `rect`, etc.) sets `dirty = true`.
//!
//! Per the M7 plan decision C6: trails use sprite pool (M3), NOT Graphics.
//! Per the `worldSpace` decision: every Graphics has immutable `world_space`
//! set at creation. The shader branches via uniform — orbits/routes/beams/
//! rings = `worldSpace: true`, UI overlays = `worldSpace: false`.
//!
//! Tessellation is split into two passes per Graphics object:
//!   1. Fill pass — triangle-list of the interior, `vec4(rgb, alpha)` color
//!   2. Stroke pass — triangle-list of the outline at the given width
//!
//! Two passes avoid the index-aliasing hazard of mixing fill and stroke
//! triangles in the same VertexBuffers. Draw order is fill first, stroke
//! on top — fill never paints over a stroke, stroke never paints under a
//! fill.

use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};
use bytemuck::{Pod, Zeroable};
use lyon::path::Path;
use lyon::tessellation::{
    BuffersBuilder, FillOptions, FillTessellator, FillVertex, StrokeOptions,
    StrokeTessellator, StrokeVertex, VertexBuffers,
};

/// Single vertex. 24 B total — `vec2 position` (world units or screen pixels
/// depending on `world_space`) + `vec4 color` (straight RGBA). The shader
/// does NOT premultiply; this matches `wgpu::BlendState::ALPHA_BLENDING`.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GraphicsVertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<GraphicsVertex>() == 24);
const _: () = assert!(std::mem::align_of::<GraphicsVertex>() == 4);

/// Per-Graphics uniform passed via bind group 1. 16 B (std140 — single
/// f32 padded out to a 16-byte row). `world_space = 1.0` → world coords;
/// `world_space = 0.0` → screen pixels. Immutable after `Graphics::new`.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GraphicsUniforms {
    pub world_space: f32,
    pub _pad: [f32; 3],
}

const _: () = assert!(std::mem::size_of::<GraphicsUniforms>() == 16);
// align_of == 4 because the field types are f32 and [f32; 3]. std140 alignment
// is enforced at the bind group level (min_binding_size=16), not at the
// Rust struct level — wgpu uses the buffer's `min_binding_size` for UBO
// alignment validation.

/// One tessellation command. Encoded by the wasm adapter from the TS
/// `Graphics` fluent chain. Stored CPU-side only — tessellation produces
/// the actual triangles that the GPU draws.
#[derive(Clone, Debug)]
pub enum GraphicsCmd {
    Circle {
        x: f32,
        y: f32,
        r: f32,
        fill: Option<[f32; 4]>,
        stroke: Option<(f32, [f32; 4])>,
    },
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        fill: Option<[f32; 4]>,
        stroke: Option<(f32, [f32; 4])>,
    },
    RoundRect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        fill: Option<[f32; 4]>,
        stroke: Option<(f32, [f32; 4])>,
    },
    Line {
        from: [f32; 2],
        to: [f32; 2],
        width: f32,
        color: [f32; 4],
    },
    Arc {
        cx: f32,
        cy: f32,
        r: f32,
        start: f32,
        end: f32,
        width: f32,
        color: [f32; 4],
    },
}

/// Single retained-mode Graphics object.
///
/// `commands` is the canonical source of truth. `dirty` is set by every
/// mutator and cleared by `tessellate()`. `fill_*`/`stroke_*` buffers hold
/// the latest tessellation result; they are dropped and recreated on the
/// next `tessellate()` call when the command list changed.
pub struct Graphics {
    pub commands: Vec<GraphicsCmd>,
    pub dirty: bool,
    pub world_space: bool,
    pub z_order: f32,

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
    pub fn new(
        ctx: &GpuContext,
        world_space: bool,
    ) -> Self {
        let uniforms = GraphicsUniforms {
            world_space: if world_space { 1.0 } else { 0.0 },
            _pad: [0.0; 3],
        };

        let uniforms_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("graphics uniforms"),
            size: std::mem::size_of::<GraphicsUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let uniforms_bind_group_layout =
            ctx.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("graphics uniforms layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: wgpu::BufferSize::new(
                                std::mem::size_of::<GraphicsUniforms>() as u64,
                            ),
                        },
                        count: None,
                    }],
                });

        let uniforms_bind_group =
            ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("graphics uniforms bind group"),
                layout: &uniforms_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniforms_buffer.as_entire_binding(),
                }],
            });

        ctx.queue
            .write_buffer(&uniforms_buffer, 0, bytemuck::bytes_of(&uniforms));

        Self {
            commands: Vec::new(),
            dirty: true,
            world_space,
            z_order: 0.0,
            fill_vertex_buffer: None,
            fill_index_buffer: None,
            fill_index_count: 0,
            stroke_vertex_buffer: None,
            stroke_index_buffer: None,
            stroke_index_count: 0,
            uniforms_buffer,
            uniforms_bind_group,
        }
    }

    pub fn clear(&mut self) {
        self.commands.clear();
        self.dirty = true;
    }

    pub fn circle(
        &mut self,
        x: f32,
        y: f32,
        r: f32,
        fill: Option<[f32; 4]>,
        stroke: Option<(f32, [f32; 4])>,
    ) {
        self.commands.push(GraphicsCmd::Circle {
            x,
            y,
            r,
            fill,
            stroke,
        });
        self.dirty = true;
    }

    pub fn rect(
        &mut self,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        fill: Option<[f32; 4]>,
        stroke: Option<(f32, [f32; 4])>,
    ) {
        self.commands.push(GraphicsCmd::Rect {
            x,
            y,
            w,
            h,
            fill,
            stroke,
        });
        self.dirty = true;
    }

    pub fn round_rect(
        &mut self,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        fill: Option<[f32; 4]>,
        stroke: Option<(f32, [f32; 4])>,
    ) {
        self.commands.push(GraphicsCmd::RoundRect {
            x,
            y,
            w,
            h,
            radius,
            fill,
            stroke,
        });
        self.dirty = true;
    }

    pub fn line(
        &mut self,
        from: [f32; 2],
        to: [f32; 2],
        width: f32,
        color: [f32; 4],
    ) {
        self.commands.push(GraphicsCmd::Line {
            from,
            to,
            width,
            color,
        });
        self.dirty = true;
    }

    pub fn arc(
        &mut self,
        cx: f32,
        cy: f32,
        r: f32,
        start: f32,
        end: f32,
        width: f32,
        color: [f32; 4],
    ) {
        self.commands.push(GraphicsCmd::Arc {
            cx,
            cy,
            r,
            start,
            end,
            width,
            color,
        });
        self.dirty = true;
    }

    /// Re-tessellate commands into vertex/index buffers.
    ///
    /// **Critical invariant:** MUST be called before `Renderer::render()`
    /// opens the render pass. Replacing `fill_vertex_buffer` drops the
    /// previous `wgpu::Buffer`; if a render pass is open, the command
    /// encoder holds a reference and we use-after-free in the GPU command
    /// stream.
    ///
    /// Fast path: returns immediately when `dirty == false`.
    pub fn tessellate(&mut self, ctx: &GpuContext) {
        if !self.dirty {
            return;
        }

        let mut fill_geometry: VertexBuffers<GraphicsVertex, u16> = VertexBuffers::new();
        let mut stroke_geometry: VertexBuffers<GraphicsVertex, u16> = VertexBuffers::new();
        let mut fill_tess = FillTessellator::new();
        let mut stroke_tess = StrokeTessellator::new();

        for cmd in &self.commands {
            match cmd {
                GraphicsCmd::Circle {
                    x,
                    y,
                    r,
                    fill,
                    stroke,
                } => {
                    let mut builder = Path::builder();
                    builder.add_circle(
                        lyon::geom::point(*x, *y),
                        *r,
                        lyon::path::Winding::Positive,
                    );
                    let path = builder.build();
                    tessellate_path(
                        &path,
                        *fill,
                        *stroke,
                        &mut fill_tess,
                        &mut stroke_tess,
                        &mut fill_geometry,
                        &mut stroke_geometry,
                    );
                }
                GraphicsCmd::Rect {
                    x,
                    y,
                    w,
                    h,
                    fill,
                    stroke,
                } => {
                    let mut builder = Path::builder();
                    let rect = lyon::geom::Box2D::new(
                        lyon::geom::point(*x, *y),
                        lyon::geom::point(*x + *w, *y + *h),
                    );
                    builder.add_rectangle(&rect, lyon::path::Winding::Positive);
                    let path = builder.build();
                    tessellate_path(
                        &path,
                        *fill,
                        *stroke,
                        &mut fill_tess,
                        &mut stroke_tess,
                        &mut fill_geometry,
                        &mut stroke_geometry,
                    );
                }
                GraphicsCmd::RoundRect {
                    x,
                    y,
                    w,
                    h,
                    radius,
                    fill,
                    stroke,
                } => {
                    let mut builder = Path::builder();
                    let rect = lyon::geom::Box2D::new(
                        lyon::geom::point(*x, *y),
                        lyon::geom::point(*x + *w, *y + *h),
                    );
                    let radii = lyon::path::builder::BorderRadii::new((*radius).into());
                    builder.add_rounded_rectangle(&rect, &radii, lyon::path::Winding::Positive);
                    let path = builder.build();
                    tessellate_path(
                        &path,
                        *fill,
                        *stroke,
                        &mut fill_tess,
                        &mut stroke_tess,
                        &mut fill_geometry,
                        &mut stroke_geometry,
                    );
                }
                GraphicsCmd::Line {
                    from,
                    to,
                    width,
                    color,
                } => {
                    let mut builder = Path::builder();
                    builder.add_line_segment(&lyon::geom::LineSegment {
                        from: lyon::geom::point(from[0], from[1]),
                        to: lyon::geom::point(to[0], to[1]),
                    });
                    let path = builder.build();
                    let opts = StrokeOptions::default().with_line_width(*width);
                    stroke_tess
                        .tessellate_path(
                            &path,
                            &opts,
                            &mut BuffersBuilder::new(&mut stroke_geometry, |v: StrokeVertex| {
                                GraphicsVertex {
                                    position: v.position().to_array(),
                                    color: *color,
                                }
                            }),
                        )
                        .expect("lyon stroke tessellation");
                }
                GraphicsCmd::Arc {
                    cx,
                    cy,
                    r,
                    start,
                    end,
                    width,
                    color,
                } => {
                    // lyon's NoAttributes<BuilderImpl> doesn't expose
                    // `add_arc` (that's gated behind the Svg attribute
                    // builder). Approximate the arc as a chain of cubic
                    // Béziers — one per quadrant, control-point offset
                    // `r * 0.5523` is the standard "magic number" for a
                    // 90° circular-arc Bézier (4·(√2 − 1)/3). Sufficient
                    // precision for strokes; matches SVG arc rendering.
                    let mut builder = Path::builder();
                    let mut a = *start;
                    let b = *end;
                    // First endpoint.
                    let p0 = (
                        *cx + *r * a.cos(),
                        *cy + *r * a.sin(),
                    );
                    builder.begin(lyon::geom::point(p0.0, p0.1));
                    let k = *r * 0.5523;
                    let step_sign = if b >= a { 1.0_f32 } else { -1.0_f32 };
                    while (a - b).abs() > 1e-4 {
                        let next = a + step_sign * (std::f32::consts::PI / 2.0).min((b - a).abs());
                        let a_end = if step_sign > 0.0 {
                            next.min(b)
                        } else {
                            next.max(b)
                        };
                        let p1 = (
                            *cx + *r * a.cos(),
                            *cy + *r * a.sin(),
                        );
                        let p2 = (
                            *cx + *r * a_end.cos(),
                            *cy + *r * a_end.sin(),
                        );
                        let p3 = (
                            *cx + *r * a_end.cos(),
                            *cy + *r * a_end.sin(),
                        );
                        // Tangent at p1 is perpendicular to the radius
                        // at angle a; tangent at p2 is perpendicular at
                        // angle a_end.
                        let t1 = (-a.sin(), a.cos());
                        let t2 = (-a_end.sin(), a_end.cos());
                        let c1 = (p1.0 + k * step_sign * t1.0, p1.1 + k * step_sign * t1.1);
                        let c2 = (p2.0 - k * step_sign * t2.0, p2.1 - k * step_sign * t2.1);
                        builder.cubic_bezier_to(
                            lyon::geom::point(c1.0, c1.1),
                            lyon::geom::point(c2.0, c2.1),
                            lyon::geom::point(p3.0, p3.1),
                        );
                        a = a_end;
                    }
                    builder.end(true);
                    let path = builder.build();
                    let opts = StrokeOptions::default().with_line_width(*width);
                    stroke_tess
                        .tessellate_path(
                            &path,
                            &opts,
                            &mut BuffersBuilder::new(&mut stroke_geometry, |v: StrokeVertex| {
                                GraphicsVertex {
                                    position: v.position().to_array(),
                                    color: *color,
                                }
                            }),
                        )
                        .expect("lyon stroke tessellation");
                }
            }
        }

        use wgpu::util::DeviceExt;
        if !fill_geometry.vertices.is_empty() {
            self.fill_vertex_buffer = Some(
                ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("graphics fill verts"),
                    contents: bytemuck::cast_slice(&fill_geometry.vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
            );
            self.fill_index_buffer = Some(
                ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("graphics fill indices"),
                    contents: bytemuck::cast_slice(&fill_geometry.indices),
                    usage: wgpu::BufferUsages::INDEX,
                }),
            );
            self.fill_index_count = fill_geometry.indices.len() as u32;
        } else {
            self.fill_vertex_buffer = None;
            self.fill_index_buffer = None;
            self.fill_index_count = 0;
        }

        if !stroke_geometry.vertices.is_empty() {
            self.stroke_vertex_buffer = Some(
                ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("graphics stroke verts"),
                    contents: bytemuck::cast_slice(&stroke_geometry.vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
            );
            self.stroke_index_buffer = Some(
                ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("graphics stroke indices"),
                    contents: bytemuck::cast_slice(&stroke_geometry.indices),
                    usage: wgpu::BufferUsages::INDEX,
                }),
            );
            self.stroke_index_count = stroke_geometry.indices.len() as u32;
        } else {
            self.stroke_vertex_buffer = None;
            self.stroke_index_buffer = None;
            self.stroke_index_count = 0;
        }

        self.dirty = false;
    }

    /// Record draw commands for this Graphics into the given render pass.
    /// Caller must have already set bind group 0 (engine camera) and the
    /// pipeline. Issues 0-2 draws (fill pass, stroke pass) — `set_pipeline`
    /// and `set_bind_group(1, …)` happen once per call because the pipeline
    /// and GraphicsUniforms are identical across both passes for a single
    /// Graphics object.
    pub fn draw<'a>(
        &'a self,
        pass: &mut wgpu::RenderPass<'a>,
        pipeline: &'a wgpu::RenderPipeline,
    ) {
        pass.set_pipeline(pipeline);
        pass.set_bind_group(1, &self.uniforms_bind_group, &[]);

        if let (Some(vb), Some(ib)) = (&self.fill_vertex_buffer, &self.fill_index_buffer) {
            pass.set_vertex_buffer(0, vb.slice(..));
            pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint16);
            pass.draw_indexed(0..self.fill_index_count, 0, 0..1);
        }
        if let (Some(vb), Some(ib)) = (&self.stroke_vertex_buffer, &self.stroke_index_buffer) {
            pass.set_vertex_buffer(0, vb.slice(..));
            pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint16);
            pass.draw_indexed(0..self.stroke_index_count, 0, 0..1);
        }
    }
}

/// Tessellate one path into fill + stroke VertexBuffers. Pulled out so the
/// Circle / Rect / RoundRect branches share the same tessellate/buffer-build
/// code path. Line and Arc only stroke, so they inline their own call.
#[allow(clippy::too_many_arguments)]
fn tessellate_path(
    path: &Path,
    fill: Option<[f32; 4]>,
    stroke: Option<(f32, [f32; 4])>,
    fill_tess: &mut FillTessellator,
    stroke_tess: &mut StrokeTessellator,
    fill_geometry: &mut VertexBuffers<GraphicsVertex, u16>,
    stroke_geometry: &mut VertexBuffers<GraphicsVertex, u16>,
) {
    if let Some(color) = fill {
        let opts = FillOptions::default();
        fill_tess
            .tessellate_path(
                path,
                &opts,
                &mut BuffersBuilder::new(fill_geometry, |v: FillVertex| GraphicsVertex {
                    position: v.position().to_array(),
                    color,
                }),
            )
            .expect("lyon fill tessellation");
    }
    if let Some((width, color)) = stroke {
        let opts = StrokeOptions::default().with_line_width(width);
        stroke_tess
            .tessellate_path(
                path,
                &opts,
                &mut BuffersBuilder::new(stroke_geometry, |v: StrokeVertex| GraphicsVertex {
                    position: v.position().to_array(),
                    color,
                }),
            )
            .expect("lyon stroke tessellation");
    }
}

/// Graphics pool — owns N Graphics objects, exposes handle-based API.
/// `SlotMap<Graphics>` gives generational handles so `destroy_graphics`
/// followed by `create_graphics` cannot alias a stale handle from a prior
/// tenant.
pub struct GraphicsPool {
    pub graphics: SlotMap<Graphics>,
}

impl GraphicsPool {
    pub fn new() -> Self {
        Self {
            graphics: SlotMap::new(),
        }
    }

    pub fn insert(&mut self, g: Graphics) -> Handle {
        self.graphics.insert(g)
    }

    pub fn get(&self, h: Handle) -> Option<&Graphics> {
        self.graphics.get(h)
    }

    pub fn get_mut(&mut self, h: Handle) -> Option<&mut Graphics> {
        self.graphics.get_mut(h)
    }

    pub fn remove(&mut self, h: Handle) -> bool {
        self.graphics.remove(h).is_some()
    }

    /// Snapshot of all (z_order, slot) pairs — used by the render loop to
    /// sort Graphics before drawing. Cheap (no GPU work).
    pub fn draw_order(&self) -> Vec<(f32, Handle)> {
        self.graphics
            .iter()
            .map(|(h, g)| (g.z_order, h))
            .collect()
    }

    /// Re-tessellate all dirty Graphics. Called once per frame before
    /// `begin_render_pass`. The `dirty` fast-path skips every clean
    /// Graphics — the typical steady-state cost is zero for static rings.
    pub fn tessellate_all(&mut self, ctx: &GpuContext) {
        // Collect handles first to avoid holding a borrow on `self.graphics`
        // while tessellating (tessellate mutates the Graphics inside, but
        // we need a stable iteration order).
        let handles: Vec<Handle> = self.graphics.iter().map(|(h, _)| h).collect();
        for h in handles {
            if let Some(g) = self.graphics.get_mut(h) {
                g.tessellate(ctx);
            }
        }
    }
}

impl Default for GraphicsPool {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin `GraphicsVertex` byte layout. Drift here silently corrupts the
    /// GPU read; this assertion fails cargo build before a shader ever
    /// sees bad bytes.
    #[test]
    fn vertex_layout_pod() {
        assert_eq!(std::mem::size_of::<GraphicsVertex>(), 24);
        assert_eq!(std::mem::align_of::<GraphicsVertex>(), 4);
        assert_eq!(core::mem::offset_of!(GraphicsVertex, position), 0);
        assert_eq!(core::mem::offset_of!(GraphicsVertex, color), 8);
        let v = GraphicsVertex {
            position: [0.0, 0.0],
            color: [0.0; 4],
        };
        let bytes = bytemuck::bytes_of(&v);
        assert_eq!(bytes.len(), 24);
    }

    /// Pin `GraphicsUniforms` byte layout. The shader reads `world_space`
    /// from offset 0; `_pad` keeps the struct at 16 B (single std140 row).
    /// The Rust struct itself is `align(4)` because its fields are all
    /// `f32` — std140 alignment is enforced at the bind group level via
    /// `min_binding_size=16`, not at the Rust struct level.
    #[test]
    fn uniforms_layout_pod() {
        assert_eq!(std::mem::size_of::<GraphicsUniforms>(), 16);
        assert_eq!(std::mem::align_of::<GraphicsUniforms>(), 4);
        assert_eq!(core::mem::offset_of!(GraphicsUniforms, world_space), 0);
        assert_eq!(core::mem::offset_of!(GraphicsUniforms, _pad), 4);
    }

    /// Pin the default `GraphicsPool` shape. No `GpuContext` available in
    /// cargo test, but `SlotMap::new()` and `Vec::new()` empty-init can be
    /// validated structurally.
    #[test]
    fn graphics_pool_default_is_empty() {
        let pool = GraphicsPool::default();
        assert_eq!(pool.graphics.len(), 0);
        assert!(pool.graphics.is_empty());
    }
}