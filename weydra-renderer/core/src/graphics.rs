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

/// Per-Graphics uniform passed via bind group 1. 16 B (std140 — one
/// 16-byte row). `world_space = 1.0` → world coords; `world_space = 0.0`
/// → screen pixels. `translation` is added to every vertex position in the
/// shader BEFORE the world/screen transform, so it mirrors a Pixi
/// container's `x`/`y`: game code can draw a ring at (0,0)-relative and set
/// `translation = (ship.x, ship.y)` instead of baking the world position
/// into every tessellated vertex. `translation` is a `vec2` at byte offset
/// 8 (std140 8-byte alignment) — `_pad0` fills the gap after `world_space`.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GraphicsUniforms {
    pub world_space: f32,
    pub _pad0: f32,
    pub translation: [f32; 2],
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
    /// When false the render loop skips this Graphics entirely (mirrors a
    /// Pixi DisplayObject's `visible`). O(1) hide/show — no re-tessellation,
    /// unlike clearing the command list. Default true.
    pub visible: bool,

    pub fill_vertex_buffer: Option<wgpu::Buffer>,
    pub fill_index_buffer: Option<wgpu::Buffer>,
    pub fill_index_count: u32,

    pub stroke_vertex_buffer: Option<wgpu::Buffer>,
    pub stroke_index_buffer: Option<wgpu::Buffer>,
    pub stroke_index_count: u32,

    // Allocated byte capacity of each buffer above. tessellate() reuses the
    // buffer (queue.write_buffer) when the new geometry fits, and only
    // reallocates when it grows — so an animated Graphics that re-tessellates
    // every frame (survey pulses, combat beams, decision rings) stops
    // churning GPU buffer allocations once its size stabilises.
    fill_vertex_cap: u64,
    fill_index_cap: u64,
    stroke_vertex_cap: u64,
    stroke_index_cap: u64,

    /// World-space (or screen-space, when `world_space == false`) offset
    /// added to every vertex in the shader. Mirrors a Pixi container's
    /// position. Mutated via `set_translation`.
    pub translation: [f32; 2],

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
            _pad0: 0.0,
            translation: [0.0, 0.0],
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
            visible: true,
            fill_vertex_buffer: None,
            fill_index_buffer: None,
            fill_index_count: 0,
            stroke_vertex_buffer: None,
            stroke_index_buffer: None,
            stroke_index_count: 0,
            fill_vertex_cap: 0,
            fill_index_cap: 0,
            stroke_vertex_cap: 0,
            stroke_index_cap: 0,
            translation: [0.0, 0.0],
            uniforms_buffer,
            uniforms_bind_group,
        }
    }

    /// Update the per-instance translation (mirrors Pixi container x/y).
    /// Rewrites only the 16-byte uniform buffer — no re-tessellation, so
    /// this is cheap enough to call every frame for moving objects (ship
    /// rings, fog-memory ghosts).
    pub fn set_translation(&mut self, ctx: &GpuContext, x: f32, y: f32) {
        if self.translation[0] == x && self.translation[1] == y {
            return;
        }
        self.translation = [x, y];
        let uniforms = GraphicsUniforms {
            world_space: if self.world_space { 1.0 } else { 0.0 },
            _pad0: 0.0,
            translation: self.translation,
        };
        ctx.queue
            .write_buffer(&self.uniforms_buffer, 0, bytemuck::bytes_of(&uniforms));
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

        let mut fill_geometry: VertexBuffers<GraphicsVertex, u32> = VertexBuffers::new();
        let mut stroke_geometry: VertexBuffers<GraphicsVertex, u32> = VertexBuffers::new();
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
                    // `add_arc` (gated behind the Svg attribute builder).
                    // Approximate the arc as a chain of cubic Béziers.
                    // Slice into segments of at most π/2; control-point
                    // distance per slice is `r * tan(half_angle/2) * (4/3)`,
                    // the exact formula for a circular-arc Bézier (not the
                    // fixed 0.5523·r which is only correct for a full
                    // 90° segment — short segments would bulge).
                    let mut builder = Path::builder();
                    let mut a = *start;
                    let b = *end;
                    let p0 = (*cx + *r * a.cos(), *cy + *r * a.sin());
                    builder.begin(lyon::geom::point(p0.0, p0.1));
                    let step_sign = if b >= a { 1.0_f32 } else { -1.0_f32 };
                    while (a - b).abs() > 1e-4 {
                        let remaining = (b - a).abs();
                        let slice = (std::f32::consts::PI / 2.0).min(remaining);
                        let a_end = a + step_sign * slice;
                        // h = tan(slice/2) * (4/3) — exact Bézier handle
                        // length for a circular arc of `slice` radians.
                        let h = (slice * 0.5).tan() * (4.0 / 3.0) * *r;
                        let (ca, sa) = (a.cos(), a.sin());
                        let (cb, sb) = (a_end.cos(), a_end.sin());
                        // Tangent vectors perpendicular to radii.
                        let t1x = -sa;
                        let t1y = ca;
                        let t2x = -sb;
                        let t2y = cb;
                        let c1x = *cx + *r * ca + h * step_sign * t1x;
                        let c1y = *cy + *r * sa + h * step_sign * t1y;
                        let c2x = *cx + *r * cb - h * step_sign * t2x;
                        let c2y = *cy + *r * sb - h * step_sign * t2y;
                        let p3x = *cx + *r * cb;
                        let p3y = *cy + *r * sb;
                        builder.cubic_bezier_to(
                            lyon::geom::point(c1x, c1y),
                            lyon::geom::point(c2x, c2y),
                            lyon::geom::point(p3x, p3y),
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

        upload_or_reuse(
            ctx,
            &mut self.fill_vertex_buffer,
            &mut self.fill_vertex_cap,
            bytemuck::cast_slice(&fill_geometry.vertices),
            wgpu::BufferUsages::VERTEX,
            "graphics fill verts",
        );
        upload_or_reuse(
            ctx,
            &mut self.fill_index_buffer,
            &mut self.fill_index_cap,
            bytemuck::cast_slice(&fill_geometry.indices),
            wgpu::BufferUsages::INDEX,
            "graphics fill indices",
        );
        self.fill_index_count = fill_geometry.indices.len() as u32;

        upload_or_reuse(
            ctx,
            &mut self.stroke_vertex_buffer,
            &mut self.stroke_vertex_cap,
            bytemuck::cast_slice(&stroke_geometry.vertices),
            wgpu::BufferUsages::VERTEX,
            "graphics stroke verts",
        );
        upload_or_reuse(
            ctx,
            &mut self.stroke_index_buffer,
            &mut self.stroke_index_cap,
            bytemuck::cast_slice(&stroke_geometry.indices),
            wgpu::BufferUsages::INDEX,
            "graphics stroke indices",
        );
        self.stroke_index_count = stroke_geometry.indices.len() as u32;

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

        // Buffers persist across re-tessellation for reuse, so guard on the
        // index COUNT (0 = nothing to draw this frame) rather than buffer
        // presence — a cleared fill/stroke keeps its buffer but draws nothing.
        if self.fill_index_count > 0 {
            if let (Some(vb), Some(ib)) = (&self.fill_vertex_buffer, &self.fill_index_buffer) {
                pass.set_vertex_buffer(0, vb.slice(..));
                pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.fill_index_count, 0, 0..1);
            }
        }
        if self.stroke_index_count > 0 {
            if let (Some(vb), Some(ib)) = (&self.stroke_vertex_buffer, &self.stroke_index_buffer) {
                pass.set_vertex_buffer(0, vb.slice(..));
                pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.stroke_index_count, 0, 0..1);
            }
        }
    }
}

/// Upload geometry into `buffer`, reusing it (queue.write_buffer) when the
/// new data fits the existing capacity and only reallocating when it grows.
/// Empty data keeps the buffer for reuse — the caller's index count gates
/// the draw. Buffers carry COPY_DST so write_buffer is valid. This stops an
/// animated Graphics (re-tessellated every frame) from churning GPU buffer
/// allocations once its vertex count stabilises.
fn upload_or_reuse(
    ctx: &GpuContext,
    buffer: &mut Option<wgpu::Buffer>,
    capacity: &mut u64,
    data: &[u8],
    usage: wgpu::BufferUsages,
    label: &str,
) {
    let size = data.len() as u64;
    if size == 0 {
        return;
    }
    if let Some(buf) = buffer.as_ref() {
        if size <= *capacity {
            ctx.queue.write_buffer(buf, 0, data);
            return;
        }
    }
    use wgpu::util::DeviceExt;
    let buf = ctx
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents: data,
            usage: usage | wgpu::BufferUsages::COPY_DST,
        });
    *capacity = size;
    *buffer = Some(buf);
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
    fill_geometry: &mut VertexBuffers<GraphicsVertex, u32>,
    stroke_geometry: &mut VertexBuffers<GraphicsVertex, u32>,
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
        assert_eq!(core::mem::offset_of!(GraphicsUniforms, _pad0), 4);
        // vec2 translation lands at byte 8 — std140 8-byte alignment for a
        // vec2, and the shader reads it from the same offset.
        assert_eq!(core::mem::offset_of!(GraphicsUniforms, translation), 8);
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