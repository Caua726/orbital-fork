//! WASM adapter for weydra-renderer.
//!
//! Exposes a wasm-bindgen Renderer that wraps the core pipeline and binds
//! to an HtmlCanvasElement. Hot-path per-frame ops (uniform updates, sprite
//! pool writes) go through shared WASM memory — `*_ptr()` exposes the pool's
//! backing storage so TS builds typed-array views and writes without
//! crossing the wasm-bindgen call boundary.
//!
//! Compiles as an empty crate on non-wasm32 targets so `cargo build --workspace`
//! works on native toolchains. wgpu's `SurfaceTarget::Canvas` only exists
//! under `cfg(target_arch = "wasm32")`.
#![cfg(target_arch = "wasm32")]

use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use weydra_renderer::{
    bake_atlas, CameraUniforms, EngineBindings, FogPool, GpuContext, Graphics, GraphicsPool,
    GraphicsVertex, Handle, Mesh, PlanetPool, RenderSurface, RenderTarget, ShaderRegistry,
    SpritePool, TextNode, TextRegistry, Texture, TextureRegistry, UniformPool, DEFAULT_CHARSET,
    FLAG_VISIBLE, FOG_MAX_SOURCES, FOG_UNIFORMS_SIZE,
};

const SILKSCREEN_TTF: &[u8] = include_bytes!("../../../core/src/fonts/silkscreen.ttf");
const VT323_TTF: &[u8] = include_bytes!("../../../core/src/fonts/vt323.ttf");
const TEXT_WGSL: &str = include_str!("../../../core/shaders/text.wgsl");

/// Max sprites across all textures. Backing SoA Vecs are sized once at boot
/// and never reallocated — growth would detach the TS-side typed-array views
/// silently. Spec line 286: 10,000 sprites is the generous default.
const SPRITE_CAPACITY: usize = 10_000;

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Uniforms for the starfield shader (bind group 1). Layout must match
/// `src/shaders/starfield-weydra.wgsl::StarfieldUniforms` exactly.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct StarfieldUniforms {
    pub density: f32,
    pub _pad: [f32; 3],
}

/// 48-byte AoS packed for the sprite shader.
/// MUST match `struct SpriteData` in `sprite_batch.wgsl` *and* the vertex
/// buffer layout used by `sprite_batch_instanced.wgsl` (same offsets).
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct SpriteData {
    transform: [f32; 4], // x, y, scale_x, scale_y
    uv_rect: [f32; 4],   // u, v, w, h
    color: u32,          // 0xRRGGBBAA packed
    _pad0: u32,          // bumps `display` to 8-byte alignment
    display: [f32; 2],   // display_w, display_h
}
const _: () = assert!(std::mem::size_of::<SpriteData>() == 48);

/// Which path the sprite pipeline was compiled for. Chosen at boot from
/// `adapter.get_info().backend` and frozen for the Renderer's lifetime.
enum SpritePath {
    /// WebGPU / Vulkan / Metal / DX12 — storage buffer + instance_index.
    Storage {
        pipeline: wgpu::RenderPipeline,
        storage_buffer: wgpu::Buffer,
        sprite_bind_group: wgpu::BindGroup,
        /// Shared by the storage buffer bind group. Stored so bind groups
        /// can be rebuilt if the buffer ever needs resizing (currently
        /// fixed-size at SPRITE_CAPACITY).
        #[allow(dead_code)]
        sprite_bind_group_layout: wgpu::BindGroupLayout,
    },
    /// WebGL2 / GLES — per-instance vertex attributes.
    Instanced {
        pipeline: wgpu::RenderPipeline,
        instance_buffer: wgpu::Buffer,
    },
}

/// The weydra renderer instance, bound to a specific canvas.
#[wasm_bindgen]
pub struct Renderer {
    surface: RenderSurface<'static>,
    ctx: GpuContext,
    engine: EngineBindings,
    shader_registry: ShaderRegistry,
    camera_uniforms: CameraUniforms,

    // M2 starfield
    starfield_pool: Option<UniformPool<StarfieldUniforms>>,
    starfield_mesh: Option<Mesh>,

    // M5 planets (live shader)
    planet_pool: Option<PlanetPool>,
    planet_mesh: Option<Mesh>,

    // M6 fog-of-war (singleton)
    fog_pool: Option<FogPool>,
    fog_mesh: Option<Mesh>,

    // M3 sprite batcher
    textures: TextureRegistry,
    sprites: SpritePool,
    sprite_path: Option<SpritePath>,
    sprite_texture_layout: Option<wgpu::BindGroupLayout>,
    /// Cached texture bind groups keyed by `Handle::to_u64()`. Removed when
    /// the texture is destroyed; generational slot reuse gives a fresh key
    /// so stale cache entries can't alias.
    texture_bind_groups: HashMap<u64, wgpu::BindGroup>,
    /// Scratch buffer reused each frame to pack visible sprites into AoS.
    /// Preallocated to SPRITE_CAPACITY so the hot path never reallocates.
    sprite_scratch: Vec<SpriteData>,

    // M7 vector graphics primitives (lyon tessellation)
    graphics_pool: Option<GraphicsPool>,
    graphics_pipeline: Option<wgpu::RenderPipeline>,

    // M8 text labels (fontdue bitmap font)
    text_registry: TextRegistry,

    /// Bumps after every op that may have grown the WASM linear memory
    /// (texture upload, lazy bind-group construction, etc.). TS pairs this
    /// with `_wasm.memory.buffer` identity to decide when to rebuild views.
    mem_version: u32,
}

#[wasm_bindgen]
impl Renderer {
    /// Create the renderer bound to a canvas.
    ///
    /// `backend` is a hint:
    /// * `0` (default) — Auto: try WebGPU, fall back to WebGL2.
    /// * `1` — Force WebGPU only. Fails if `navigator.gpu` is missing.
    /// * `2` — Force WebGL2 only. Skips the BROWSER_WEBGPU probe and goes
    ///   straight to wgpu-core's `cfg(webgl)` path; the surface fallback
    ///   below supplies the `WebDisplayHandle` marker the GL backend needs.
    ///
    /// Mismatched values fall back to Auto.
    pub async fn create(canvas: HtmlCanvasElement, backend: u32) -> Result<Renderer, JsValue> {
        let width = canvas.width();
        let height = canvas.height();

        let backends = match backend {
            1 => wgpu::Backends::BROWSER_WEBGPU,
            2 => wgpu::Backends::GL,
            _ => wgpu::Backends::all(),
        };
        let instance_desc = wgpu::InstanceDescriptor {
            backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        };
        // `util::new_instance_with_webgpu_detection` runs an async probe
        // that actually requests a WebGPU adapter, not just checking for
        // `navigator.gpu`. Browsers like Chrome on older AMD GPUs expose
        // navigator.gpu but the adapter request returns null. The probe
        // catches that and strips BROWSER_WEBGPU from the bitmask so the
        // subsequent surface + adapter request fall through to wgpu-core's
        // WebGL2 path (cfg(webgl)). Plain `Instance::new` is sync and
        // can't probe, so it leaves BROWSER_WEBGPU set and adapter
        // request later fails with no fallback.
        let instance = wgpu::util::new_instance_with_webgpu_detection(instance_desc).await;

        // Try the safe `SurfaceTarget::Canvas` path first. On
        // navigator.gpu-capable browsers wgpu dispatches straight to the
        // BROWSER_WEBGPU backend with no display-handle check, and the
        // safe path keeps the canvas's normal context lifecycle untouched
        // (the `unsafe` variant skips a couple of bookkeeping steps that
        // appear to interact badly with neighbour WebGL contexts under
        // SwiftShader, triggering CONTEXT_LOST on Pixi).
        //
        // Fall back to the unsafe path only when the safe call fails with
        // `MissingDisplayHandle` — that's the wgpu-core/GL fallback
        // route which needs a `WebDisplayHandle::new()` marker to clear
        // the validator. The marker is an empty struct from
        // raw-window-handle, accepted by wgpu-core's `(None, None)` guard
        // and ignored by the actual GL/web surface implementation.
        let canvas_for_unsafe = canvas.clone();
        let surface = match instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas)) {
            Ok(s) => s,
            Err(safe_err) => {
                let value: &wasm_bindgen::JsValue = canvas_for_unsafe.as_ref();
                let obj = core::ptr::NonNull::from(value).cast();
                let raw_window_handle: raw_window_handle::RawWindowHandle =
                    raw_window_handle::WebCanvasWindowHandle::new(obj).into();
                let raw_display_handle: raw_window_handle::RawDisplayHandle =
                    raw_window_handle::WebDisplayHandle::new().into();
                unsafe {
                    instance
                        .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                            raw_display_handle: Some(raw_display_handle),
                            raw_window_handle,
                        })
                        .map_err(|fallback_err| {
                            JsValue::from_str(&format!(
                                "surface: safe={safe_err}, fallback={fallback_err}"
                            ))
                        })?
                }
            }
        };

        let ctx = GpuContext::new_with_surface(instance, &surface)
            .await
            .map_err(|e| JsValue::from_str(&format!("gpu init: {e}")))?;

        let render_surface = RenderSurface::configure(&ctx, surface, width, height)
            .map_err(|e| JsValue::from_str(&format!("config: {e}")))?;

        let engine = EngineBindings::new(&ctx);

        // M8: bake text atlases at boot. 3 atlases for the common sizes:
        // silkscreen 12px (small labels), silkscreen 16px (medium), vt323
        // 24px (titles). All three share the same shader/pipeline.
        let mut text_registry = TextRegistry::new(&ctx);
        let mut shader_registry = ShaderRegistry::new();
        // Compile text.wgsl at boot so the pipeline module is cached
        // for the lazy build_pipeline() in render(). We don't use the
        // handle here; render() re-derives it.
        let _text_shader = shader_registry.compile(&ctx, TEXT_WGSL, "text");
        // We need textures from the Renderer's TextureRegistry, but the
        // Renderer is being constructed here. Build a temp one.
        let mut temp_textures = TextureRegistry::new();
        for (ttf, px) in [
            (SILKSCREEN_TTF, 12.0_f32),
            (SILKSCREEN_TTF, 16.0_f32),
            (VT323_TTF, 24.0_f32),
        ] {
            let atlas = bake_atlas(&ctx, &mut temp_textures, ttf, px, DEFAULT_CHARSET);
            let tex = temp_textures.get(atlas.texture).expect("atlas texture");
            text_registry.register_atlas_bind_group(&ctx, tex);
            text_registry.atlases.push(atlas);
        }
        // Surface format isn't known yet — defer build_pipeline to the
        // first call to render() (or, if Renderer::new had a surface
        // available, we could do it here; since we don't, the render()
        // path lazy-builds it).

        Ok(Renderer {
            surface: render_surface,
            ctx,
            engine,
            shader_registry,
            camera_uniforms: CameraUniforms::default(),
            starfield_pool: None,
            starfield_mesh: None,
            planet_pool: None,
            planet_mesh: None,
            fog_pool: None,
            fog_mesh: None,
            textures: TextureRegistry::new(),
            sprites: SpritePool::with_capacity(SPRITE_CAPACITY),
            sprite_path: None,
            sprite_texture_layout: None,
            texture_bind_groups: HashMap::new(),
            sprite_scratch: Vec::with_capacity(SPRITE_CAPACITY),
            graphics_pool: None,
            graphics_pipeline: None,
            text_registry,
            mem_version: 0,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.surface.resize(&self.ctx, width, height);
    }

    pub fn set_camera(&mut self, x: f32, y: f32, vw: f32, vh: f32, time: f32) {
        self.camera_uniforms = CameraUniforms::new([x, y], [vw, vh], time);
    }

    // ─── Starfield (M2) ──────────────────────────────────────────────────

    pub fn create_starfield(&mut self, wgsl_source: &str) {
        let shader = self
            .shader_registry
            .compile(&self.ctx, wgsl_source, "starfield");
        let pool = UniformPool::<StarfieldUniforms>::new(&self.ctx, "starfield uniforms", 1);
        let mesh = Mesh::new(
            &self.ctx,
            &self.shader_registry,
            shader,
            self.surface.format,
            &self.engine.layout,
            // Starfield is opaque (full-screen procedural background) —
            // REPLACE matches the pre-Task-2 behavior bit-for-bit.
            wgpu::BlendState::REPLACE,
            Some(&pool.bind_group_layout),
            "starfield",
        );
        self.starfield_pool = Some(pool);
        self.starfield_mesh = Some(mesh);
        self.mem_version = self.mem_version.wrapping_add(1);
    }

    pub fn starfield_uniforms_ptr(&self) -> u32 {
        self.starfield_pool
            .as_ref()
            .map(|p| p.instances_ptr() as u32)
            .unwrap_or(0)
    }

    // ─── Planets (M5) ────────────────────────────────────────────────────

    pub fn create_planet_shader(&mut self, wgsl_source: &str) {
        let shader = self
            .shader_registry
            .compile(&self.ctx, wgsl_source, "planet");
        let pool = PlanetPool::new(&self.ctx, "planet pool", 256);
        let mesh = Mesh::new(
            &self.ctx,
            &self.shader_registry,
            shader,
            self.surface.format,
            &self.engine.layout,
            // Planet shader emits premultiplied-alpha output; the disc-edge
            // pixels with alpha < 1 must blend over whatever's behind (the
            // starfield), not REPLACE it.
            wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING,
            Some(&pool.bind_group_layout),
            "planet",
        );
        self.planet_pool = Some(pool);
        self.planet_mesh = Some(mesh);
        self.mem_version = self.mem_version.wrapping_add(1);
    }

    pub fn create_planet_instance(&mut self) -> u64 {
        let pool = self
            .planet_pool
            .as_mut()
            .expect("create_planet_shader must be called before create_planet_instance");
        // Mirrors the SpritePool overflow guard: if the SlotMap insert ever
        // returns a slot beyond the pre-allocated `instances` Vec, a TS-side
        // typed-array view would be writing past the buffer. Fail loudly
        // rather than silently corrupt.
        assert!(
            pool.slotmap.len() < pool.capacity(),
            "PlanetPool overflow (cap={}). Raise PlanetPool capacity or destroy unused planets.",
            pool.capacity(),
        );
        pool.slotmap.insert(()).to_u64()
    }

    pub fn destroy_planet_instance(&mut self, handle: u64) {
        if let Some(pool) = self.planet_pool.as_mut() {
            pool.slotmap.remove(Handle::from_u64(handle));
        }
    }

    pub fn planet_uniforms_ptr(&self) -> u32 {
        self.planet_pool
            .as_ref()
            .map(|p| p.instances_ptr() as u32)
            .unwrap_or(0)
    }

    pub fn planet_uniforms_stride(&self) -> u32 {
        // Returns the ALIGNED stride (NOT size_of::<PlanetUniforms>()), so
        // TS can index into typed-array views matching the GPU layout.
        self.planet_pool
            .as_ref()
            .map(|p| p.stride() as u32)
            .unwrap_or(0)
    }

    pub fn planet_uniforms_capacity(&self) -> u32 {
        self.planet_pool
            .as_ref()
            .map(|p| p.capacity() as u32)
            .unwrap_or(0)
    }

    // ─── Fog (M6) ────────────────────────────────────────────────────────

    /// Compile the fog shader and allocate the singleton FogPool. Calling
    /// this twice is a usage error; the second call would drop the prior
    /// pool and invalidate any TS-side typed-array view that hadn't yet
    /// re-read `fog_uniforms_ptr`.
    pub fn create_fog_shader(&mut self, wgsl_source: &str) {
        assert!(
            self.fog_pool.is_none(),
            "create_fog_shader called twice — would invalidate the TS view over the previous pool",
        );
        let shader = self
            .shader_registry
            .compile(&self.ctx, wgsl_source, "fog");
        let pool = FogPool::new(&self.ctx, "fog pool");
        let mesh = Mesh::new(
            &self.ctx,
            &self.shader_registry,
            shader,
            self.surface.format,
            &self.engine.layout,
            // fog.wgsl returns straight alpha (`vec4(rgb, alpha)`) and is
            // explicit about the contract in its header. ALPHA_BLENDING is
            // the only correct choice — PREMULTIPLIED_ALPHA_BLENDING would
            // darken the fog by alpha and REPLACE would erase whatever the
            // fog should overlay (starfield, planets, ships).
            wgpu::BlendState::ALPHA_BLENDING,
            Some(&pool.bind_group_layout),
            "fog",
        );
        self.fog_pool = Some(pool);
        self.fog_mesh = Some(mesh);
        self.mem_version = self.mem_version.wrapping_add(1);
    }

    pub fn fog_uniforms_ptr(&self) -> u32 {
        self.fog_pool
            .as_ref()
            .map(|p| p.instances_ptr() as u32)
            .unwrap_or(0)
    }

    /// Total FogUniforms byte size (1040). TS uses this to size the
    /// typed-array view — `Float32Array(buffer, ptr, size/4)` covers
    /// header + every source slot in one shared view.
    pub fn fog_uniforms_size(&self) -> u32 {
        FOG_UNIFORMS_SIZE as u32
    }

    pub fn fog_max_sources(&self) -> u32 {
        FOG_MAX_SOURCES as u32
    }

    // ─── Graphics primitives (M7) ─────────────────────────────────────────

    /// Compile graphics.wgsl and create the graphics pipeline. Called once
    /// at boot when `weydra.graphics` is on. Single-call: a second call
    /// would invalidate the existing pipeline and orphan any in-flight
    /// render pass holding a reference.
    pub fn create_graphics_shader(&mut self, wgsl_source: &str) {
        assert!(
            self.graphics_pipeline.is_none(),
            "create_graphics_shader called twice — would invalidate the pipeline",
        );
        let shader = self
            .shader_registry
            .compile(&self.ctx, wgsl_source, "graphics");

        // Build the bind group layouts once now so all Graphics share them.
        // graphics.wgsl: group 0 = engine camera (already on engine.layout),
        // group 1 = per-Graphics uniforms. Pipeline uses &[engine_layout]
        // directly; the per-Graphics bind group is bound per draw.
        let graphics_uniform_layout = self
            .ctx
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("graphics uniform layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(
                            std::mem::size_of::<weydra_renderer::GraphicsUniforms>() as u64,
                        ),
                    },
                    count: None,
                }],
            });

        let mut layouts: Vec<Option<&wgpu::BindGroupLayout>> = vec![Some(&self.engine.layout)];
        layouts.push(Some(&graphics_uniform_layout));

        let pipeline_layout =
            self.ctx
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("graphics pipeline layout"),
                    bind_group_layouts: &layouts,
                    immediate_size: 0,
                });

        // Vertex buffer layout matches GraphicsVertex:
        //   @location(0) pos: vec2<f32>  → Float32x2, offset 0
        //   @location(1) color: vec4<f32> → Float32x4, offset 8
        const GRAPHICS_VERTEX_LAYOUT: wgpu::VertexBufferLayout<'static> =
            wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<GraphicsVertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![
                    0 => Float32x2,
                    1 => Float32x4,
                ],
            };

        let shader_module = &self
            .shader_registry
            .get(shader)
            .expect("shader just compiled")
            .module;

        let pipeline =
            self.ctx
                .device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("graphics"),
                    layout: Some(&pipeline_layout),
                    vertex: wgpu::VertexState {
                        module: shader_module,
                        entry_point: Some("vs_main"),
                        buffers: &[GRAPHICS_VERTEX_LAYOUT],
                        compilation_options: Default::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: shader_module,
                        entry_point: Some("fs_main"),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: self.surface.format,
                            // Pixi Graphics defaults to ALPHA_BLENDING;
                            // match exactly (graphics.wgsl header comment
                            // documents the contract).
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

        self.graphics_pipeline = Some(pipeline);
        self.graphics_pool = Some(GraphicsPool::new());
        // No mem_version bump — pool is empty, no TS-side view to rebuild.
    }

    /// Allocate a new Graphics object. Returns an opaque u64 handle.
    /// `world_space`: true for orbits/routes/beams/rings (world coords);
    /// false for UI overlays (screen pixels). Immutable after creation.
    pub fn create_graphics(&mut self, world_space: bool) -> u64 {
        let pool = self
            .graphics_pool
            .as_mut()
            .expect("create_graphics_shader must be called before create_graphics");
        let g = Graphics::new(&self.ctx, world_space);
        pool.insert(g).to_u64()
    }

    pub fn destroy_graphics(&mut self, h: u64) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            pool.remove(Handle::from_u64(h));
        }
    }

    pub fn graphics_clear(&mut self, h: u64) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.clear();
            }
        }
    }

    pub fn graphics_circle(
        &mut self,
        h: u64,
        x: f32,
        y: f32,
        r: f32,
        fill_rgba: u32,
        stroke_rgba: u32,
        stroke_width: f32,
    ) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.circle(x, y, r, unpack_rgba_opt(fill_rgba), unpack_stroke(stroke_rgba, stroke_width));
            }
        }
    }

    pub fn graphics_rect(
        &mut self,
        h: u64,
        x: f32,
        y: f32,
        w: f32,
        rect_h: f32,
        fill_rgba: u32,
        stroke_rgba: u32,
        stroke_width: f32,
    ) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.rect(
                    x,
                    y,
                    w,
                    rect_h,
                    unpack_rgba_opt(fill_rgba),
                    unpack_stroke(stroke_rgba, stroke_width),
                );
            }
        }
    }

    pub fn graphics_round_rect(
        &mut self,
        h: u64,
        x: f32,
        y: f32,
        w: f32,
        rect_h: f32,
        radius: f32,
        fill_rgba: u32,
        stroke_rgba: u32,
        stroke_width: f32,
    ) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.round_rect(
                    x,
                    y,
                    w,
                    rect_h,
                    radius,
                    unpack_rgba_opt(fill_rgba),
                    unpack_stroke(stroke_rgba, stroke_width),
                );
            }
        }
    }

    pub fn graphics_line(
        &mut self,
        h: u64,
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        width: f32,
        color: u32,
    ) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                let c = unpack_rgba_req(color);
                g.line([x1, y1], [x2, y2], width, c);
            }
        }
    }

    pub fn graphics_arc(
        &mut self,
        h: u64,
        cx: f32,
        cy: f32,
        r: f32,
        start: f32,
        end: f32,
        width: f32,
        color: u32,
    ) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                let c = unpack_rgba_req(color);
                g.arc(cx, cy, r, start, end, width, c);
            }
        }
    }

    pub fn graphics_set_z_order(&mut self, h: u64, z: f32) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.z_order = z;
            }
        }
    }

    /// Set the per-instance translation (mirrors a Pixi container's x/y).
    /// Shapes authored at (0,0)-relative render at `(x, y)` in world units
    /// (world_space=true) or screen pixels (world_space=false). Only writes
    /// the 16-byte uniform buffer — no re-tessellation — so it's safe to
    /// call every frame for moving objects.
    pub fn graphics_set_translation(&mut self, h: u64, x: f32, y: f32) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.set_translation(&self.ctx, x, y);
            }
        }
    }

    /// Set a Graphics' per-instance alpha (mirrors Pixi container `.alpha`).
    /// O(1) — rewrites the 16-byte uniform block, no re-tessellation.
    pub fn graphics_set_alpha(&mut self, h: u64, alpha: f32) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.set_alpha(&self.ctx, alpha);
            }
        }
    }

    /// Toggle a Graphics' visibility (mirrors Pixi `visible`). O(1) — the
    /// render loop skips invisible Graphics without dropping their
    /// tessellation, so re-showing is free (no re-tessellation).
    pub fn graphics_set_visible(&mut self, h: u64, visible: bool) {
        if let Some(pool) = self.graphics_pool.as_mut() {
            if let Some(g) = pool.get_mut(Handle::from_u64(h)) {
                g.visible = visible;
            }
        }
    }

    // ─── Text (M8) ───────────────────────────────────────────────────────

    /// Allocate a TextNode bound to a glyph atlas.
    /// `atlas_idx`: 0 = silkscreen 12px, 1 = silkscreen 16px, 2 = vt323 24px.
    /// `capacity_chars`: max glyphs the node can render without truncation.
    /// `world_space`: true → pos is in world units (fog memory labels);
    ///                false → pos is screen pixels (UI overlays).
    pub fn create_text(&mut self, atlas_idx: u32, capacity_chars: u32, world_space: bool) -> u64 {
        let node = TextNode::new(
            &self.ctx,
            atlas_idx as usize,
            capacity_chars as usize,
            &self.text_registry.uniforms_layout,
        );
        let h = self.text_registry.nodes.insert(node);
        if let Some(n) = self.text_registry.nodes.get_mut(h) {
            n.world_space = world_space;
            n.write_uniforms(&self.ctx);
        }
        self.mem_version = self.mem_version.wrapping_add(1);
        h.to_u64()
    }

    pub fn destroy_text(&mut self, h: u64) {
        self.text_registry.nodes.remove(Handle::from_u64(h));
    }

    pub fn set_text_visible(&mut self, h: u64, visible: bool) {
        if let Some(n) = self.text_registry.nodes.get_mut(Handle::from_u64(h)) {
            n.visible = visible;
        }
    }

    pub fn set_text_z_order(&mut self, h: u64, z: f32) {
        if let Some(n) = self.text_registry.nodes.get_mut(Handle::from_u64(h)) {
            n.z_order = z;
        }
    }

    /// Hot-path setter. Re-tessellates only if content changed.
    pub fn set_text_content(&mut self, h: u64, content: &str) {
        let handle = Handle::from_u64(h);
        let atlas_idx = match self.text_registry.nodes.get(handle) {
            Some(n) => n.atlas,
            None => return,
        };
        if let Some(n) = self.text_registry.nodes.get_mut(handle) {
            if n.content == content {
                return;
            }
            n.content.clear();
            n.content.push_str(content);
            let atlas = &self.text_registry.atlases[atlas_idx];
            n.update(&self.ctx, atlas);
        }
    }

    pub fn set_text_position(&mut self, h: u64, x: f32, y: f32) {
        let handle = Handle::from_u64(h);
        let atlas_idx = match self.text_registry.nodes.get(handle) {
            Some(n) => n.atlas,
            None => return,
        };
        if let Some(n) = self.text_registry.nodes.get_mut(handle) {
            if n.position[0] == x && n.position[1] == y {
                return;
            }
            n.position = [x, y];
            let atlas = &self.text_registry.atlases[atlas_idx];
            n.update(&self.ctx, atlas);
        }
    }

    /// Color is `0xRR_GG_BB_AA` (matches `packColor` from the TS bridge).
    pub fn set_text_color(&mut self, h: u64, rgba: u32) {
        let handle = Handle::from_u64(h);
        let atlas_idx = match self.text_registry.nodes.get(handle) {
            Some(n) => n.atlas,
            None => return,
        };
        if let Some(n) = self.text_registry.nodes.get_mut(handle) {
            if n.color == rgba {
                return;
            }
            n.color = rgba;
            let atlas = &self.text_registry.atlases[atlas_idx];
            n.update(&self.ctx, atlas);
        }
    }

    /// Apply a uniform pixel-scale to the glyph quads. Used by callers
    /// that want zoom behavior equivalent to Pixi's `text.scale.set(v)`.
    /// Re-tessellates the vertex buffer when scale changes.
    pub fn set_text_scale(&mut self, h: u64, scale: f32) {
        let handle = Handle::from_u64(h);
        let atlas_idx = match self.text_registry.nodes.get(handle) {
            Some(n) => n.atlas,
            None => return,
        };
        if let Some(n) = self.text_registry.nodes.get_mut(handle) {
            if (n.scale - scale).abs() < f32::EPSILON {
                return;
            }
            n.scale = scale;
            let atlas = &self.text_registry.atlases[atlas_idx];
            n.update(&self.ctx, atlas);
        }
    }

    /// Returns the rendered pixel width of the node's current content
    /// at its current scale. Used by TS-side layout code that sizes
    /// backgrounds / panels around the label. Sum of glyph advances ×
    /// scale; charset-miss chars use `px_size * 0.5` as a fallback.
    pub fn get_text_width(&self, h: u64) -> f32 {
        let handle = Handle::from_u64(h);
        let (atlas_idx, scale, content) = match self.text_registry.nodes.get(handle) {
            Some(n) => (n.atlas, n.scale, n.content.clone()),
            None => return 0.0,
        };
        let atlas = &self.text_registry.atlases[atlas_idx];
        let mut pen_x: f32 = 0.0;
        for ch in content.chars() {
            match atlas.glyphs.get(&ch) {
                Some(g) => pen_x += g.advance,
                None => pen_x += atlas.px_size * 0.5,
            }
        }
        pen_x * scale
    }

    /// Render a single planet instance into a freshly-allocated texture
    /// and return a TextureRegistry handle compatible with create_sprite.
    /// The same pipeline + uniforms used by the live-shader path are
    /// re-used, so the bake produces a frame visually identical to the
    /// live render at that uTime / uRotation snapshot.
    ///
    /// Replaces the M4 Pixi-extract round-trip — the bake never leaves
    /// the GPU.
    pub fn bake_planet(&mut self, instance_handle: u64, size: u32) -> u64 {
        let h = Handle::from_u64(instance_handle);

        // Sprite-path texture bind groups must exist before the resulting
        // tex handle can be sampled by `create_sprite`. The bind group is
        // built after the texture is registered below; ensure_sprite_pipeline
        // is called eagerly here so the layout exists for that build.
        // Done before taking the &pool borrow because it takes &mut self.
        self.ensure_sprite_pipeline();

        let pool = self
            .planet_pool
            .as_ref()
            .expect("create_planet_shader must be called before bake_planet");
        let mesh = self
            .planet_mesh
            .as_ref()
            .expect("create_planet_shader must be called before bake_planet");

        // RenderTarget with the same color format the swap chain uses so
        // the in-pass pipeline (compiled against surface.format) is valid
        // for this attachment.
        let rt = RenderTarget::new(&self.ctx, size, size, self.surface.format);

        // Push the latest pool state to GPU before drawing — same upload
        // path the per-frame render uses.
        pool.upload(&self.ctx);

        let mut encoder =
            self.ctx
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("planet bake"),
                });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("planet bake pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &rt.view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&mesh.pipeline);
            pass.set_bind_group(0, &self.engine.bind_group, &[]);
            pass.set_bind_group(1, &pool.bind_group, &[pool.offset_for(h.slot)]);
            pass.draw(0..6, 0..1);
        }
        self.ctx.queue.submit(Some(encoder.finish()));

        // Wrap the freshly-rendered texture in a Texture struct and hand
        // it to TextureRegistry. The sampler is created locally because
        // TextureRegistry's default sampler (in upload_with_address_mode)
        // is private — Nearest filter matches the pixel-art convention
        // used by the M3 sprite uploads.
        let sampler = self.ctx.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("planet bake sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        let tex = Texture {
            texture: rt.texture,
            view: rt.view,
            sampler,
            width: size,
            height: size,
        };
        let tex_handle = self.textures.insert(tex);
        self.build_texture_bind_group(tex_handle);
        self.mem_version = self.mem_version.wrapping_add(1);
        tex_handle.to_u64()
    }

    // ─── Sprite batcher (M3) ─────────────────────────────────────────────

    /// Upload RGBA8 bytes as a new texture (ClampToEdge sampling).
    /// `bytes` length must equal `width * height * 4`.
    pub fn upload_texture(&mut self, bytes: &[u8], width: u32, height: u32) -> u64 {
        let handle = self.textures.upload_rgba(&self.ctx, bytes, width, height);
        self.ensure_sprite_pipeline();
        self.build_texture_bind_group(handle);
        self.mem_version = self.mem_version.wrapping_add(1);
        handle.to_u64()
    }

    /// Upload RGBA8 bytes with Repeat sampling — used by fullscreen tiling
    /// sprites (bright star layer, parallax backdrops) that set uv_rect
    /// wider than 1.0 to wrap the texture across the quad.
    pub fn upload_texture_tiled(&mut self, bytes: &[u8], width: u32, height: u32) -> u64 {
        let handle = self
            .textures
            .upload_rgba_tiled(&self.ctx, bytes, width, height);
        self.ensure_sprite_pipeline();
        self.build_texture_bind_group(handle);
        self.mem_version = self.mem_version.wrapping_add(1);
        handle.to_u64()
    }

    /// Free a texture uploaded via upload_texture / upload_texture_tiled —
    /// drops the GPU texture (+ view) and its bind group. Safe to call with
    /// an unknown handle (no-op). The caller MUST ensure no live sprite
    /// still references this texture (a dangling bind group in a render run
    /// would point at a freed texture). Used to release baked-planet
    /// textures on unbake/teardown; without it every bake leaked VRAM.
    pub fn destroy_texture(&mut self, texture: u64) {
        self.texture_bind_groups.remove(&texture);
        self.textures.remove(Handle::from_u64(texture));
    }

    pub fn create_sprite(&mut self, texture: u64, display_w: f32, display_h: f32) -> u64 {
        let tex = Handle::from_u64(texture);
        // Adapter-level guard in addition to SpritePool::insert's own assert.
        // If we let the SoA Vecs ever grow past SPRITE_CAPACITY, the TS-side
        // typed-array views would point into detached memory — reads/writes
        // become no-ops with no error signal (spec §"Capacidade pré-alocada").
        assert!(
            self.sprites.len() < self.sprites.capacity(),
            "SpritePool overflow (cap={}): raise SPRITE_CAPACITY or destroy unused sprites. \
             Silent memory growth would invalidate the TS-side typed-array views.",
            self.sprites.capacity(),
        );
        self.sprites.insert(tex, display_w, display_h).to_u64()
    }

    pub fn destroy_sprite(&mut self, handle: u64) {
        self.sprites.remove(Handle::from_u64(handle));
    }

    pub fn sprite_transforms_ptr(&self) -> u32 {
        self.sprites.transforms.as_ptr() as u32
    }
    pub fn sprite_uvs_ptr(&self) -> u32 {
        self.sprites.uvs.as_ptr() as u32
    }
    pub fn sprite_colors_ptr(&self) -> u32 {
        self.sprites.colors.as_ptr() as u32
    }
    pub fn sprite_flags_ptr(&self) -> u32 {
        self.sprites.flags.as_ptr() as u32
    }
    pub fn sprite_z_ptr(&self) -> u32 {
        self.sprites.z_order.as_ptr() as u32
    }
    pub fn sprite_capacity(&self) -> u32 {
        self.sprites.capacity() as u32
    }

    pub fn mem_version(&self) -> u32 {
        self.mem_version
    }

    // ─── Frame ───────────────────────────────────────────────────────────

    pub fn render(&mut self) -> Result<(), JsValue> {
        self.engine.update(&self.ctx, &self.camera_uniforms);
        if let Some(pool) = &self.starfield_pool {
            pool.upload(&self.ctx);
        }
        if let Some(pool) = &self.fog_pool {
            pool.upload(&self.ctx);
        }

        // M7: tessellate dirty Graphics BEFORE opening the render pass.
        // Dropping `fill_vertex_buffer` while a pass is open would
        // use-after-free in the GPU command stream (graphics.rs:139-148
        // docstring). Each Graphics's `dirty` flag short-circuits the
        // tessellator when commands haven't changed — typical cost is
        // zero for static rings.
        if let Some(pool) = &mut self.graphics_pool {
            pool.tessellate_all(&self.ctx);
        }

        // M8: lazy-build the text pipeline on the first render (we
        // don't have surface_format at construction time because the
        // canvas surface isn't ready until create()).
        if self.text_registry.pipeline.is_none() {
            let text_shader = self.shader_registry.compile(&self.ctx, TEXT_WGSL, "text");
            let text_module = &self.shader_registry.get(text_shader).unwrap().module;
            self.text_registry.build_pipeline(
                &self.ctx,
                text_module,
                &self.engine.layout,
                self.surface.format,
            );
        }

        let maybe_frame = self
            .surface
            .acquire_next_texture(&self.ctx)
            .map_err(|e| JsValue::from_str(&format!("acquire: {e}")))?;
        let frame = match maybe_frame {
            Some(f) => f,
            None => return Ok(()),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        // Collect visible sprite slots ordered by (texture_id, z_order) so
        // the draw loop below emits one call per contiguous same-texture run.
        // Done before encoder setup to keep the pass body short.
        let runs = self.build_sprite_runs();

        // Upload the packed instance data to whichever sprite buffer the
        // pipeline expects. Both paths read the same 48-byte layout; the
        // only difference is usage (STORAGE vs VERTEX) and shader binding.
        if !self.sprite_scratch.is_empty() {
            if let Some(path) = &self.sprite_path {
                let bytes: &[u8] = bytemuck::cast_slice(&self.sprite_scratch);
                match path {
                    SpritePath::Storage { storage_buffer, .. } => {
                        self.ctx.queue.write_buffer(storage_buffer, 0, bytes);
                    }
                    SpritePath::Instanced {
                        instance_buffer, ..
                    } => {
                        self.ctx.queue.write_buffer(instance_buffer, 0, bytes);
                    }
                }
            }
        }

        let mut encoder = self
            .ctx
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("weydra frame"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("weydra frame pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, &self.engine.bind_group, &[]);

            if let (Some(mesh), Some(pool)) = (&self.starfield_mesh, &self.starfield_pool) {
                mesh.draw(&mut pass, Some(&pool.bind_group));
            }

            // Planets (M5): one draw call per live instance, dynamic offset
            // selects the slot in the shared uniform buffer. Drawn after
            // starfield + bright tile, before sprites — matches z-layer order
            // in src/core/render-order.ts (PLANET_LIVE = 11).
            if let (Some(pool), Some(mesh)) = (&self.planet_pool, &self.planet_mesh) {
                pool.upload(&self.ctx);
                pass.set_pipeline(&mesh.pipeline);
                pass.set_bind_group(0, &self.engine.bind_group, &[]);
                for (h, _) in pool.slotmap.iter() {
                    pass.set_bind_group(1, &pool.bind_group, &[pool.offset_for(h.slot)]);
                    pass.draw(0..6, 0..1);
                }
            }

            // Sprite batcher — one draw call per texture run. Only runs
            // BELOW the fog layer here; post-fog runs (Z >= FOG_Z, e.g.
            // fog-memory ghost silhouettes) draw after the fog pass below.
            if runs.iter().any(|r| !r.post_fog) {
                if let Some(path) = &self.sprite_path {
                    pass.set_pipeline(match path {
                        SpritePath::Storage { pipeline, .. } => pipeline,
                        SpritePath::Instanced { pipeline, .. } => pipeline,
                    });
                    match path {
                        SpritePath::Storage {
                            sprite_bind_group, ..
                        } => {
                            pass.set_bind_group(1, sprite_bind_group, &[]);
                        }
                        SpritePath::Instanced {
                            instance_buffer, ..
                        } => {
                            pass.set_vertex_buffer(0, instance_buffer.slice(..));
                        }
                    }
                    for run in runs.iter().filter(|r| !r.post_fog) {
                        if let Some(bg) = self.texture_bind_groups.get(&run.texture_key) {
                            pass.set_bind_group(2, bg, &[]);
                            pass.draw(0..6, run.start..run.end);
                        }
                    }
                }
            }

            // Fog (M6): single fullscreen draw on top of every previous
            // weydra layer (Z.FOG = 40 — above SHIPS=30, below the Pixi
            // UI canvas which composites over this surface). Skipped when
            // the shader hasn't been registered (fog flag off) and when
            // no vision sources are active — without that second guard,
            // the menu (where `desenharNeblinaVisao` never runs and
            // active_count stays 0) gets a fullscreen 75%-alpha navy
            // overlay covering the procedural planets, washing them out
            // into a uniform grey/blue cast that reads as "broken".
            if let (Some(mesh), Some(pool)) = (&self.fog_mesh, &self.fog_pool) {
                if pool.instances[0].active_count > 0 {
                    mesh.draw(&mut pass, Some(&pool.bind_group));
                }
            }

            // Post-fog sprites (Z >= FOG_Z): fog-memory ghost silhouettes
            // and any other sprite that must show THROUGH the fog. Same
            // pipeline + packed buffer as the pre-fog batch; only the run
            // filter differs.
            if runs.iter().any(|r| r.post_fog) {
                if let Some(path) = &self.sprite_path {
                    pass.set_pipeline(match path {
                        SpritePath::Storage { pipeline, .. } => pipeline,
                        SpritePath::Instanced { pipeline, .. } => pipeline,
                    });
                    match path {
                        SpritePath::Storage {
                            sprite_bind_group, ..
                        } => {
                            pass.set_bind_group(1, sprite_bind_group, &[]);
                        }
                        SpritePath::Instanced {
                            instance_buffer, ..
                        } => {
                            pass.set_vertex_buffer(0, instance_buffer.slice(..));
                        }
                    }
                    for run in runs.iter().filter(|r| r.post_fog) {
                        if let Some(bg) = self.texture_bind_groups.get(&run.texture_key) {
                            pass.set_bind_group(2, bg, &[]);
                            pass.draw(0..6, run.start..run.end);
                        }
                    }
                }
            }

            // Graphics (M7): draw all retained-mode Graphics after fog.
            // Sort by z_order so multiple Graphics layer correctly within
            // the Z.* bands (ORBITS=20, ROUTES=25, BEAMS=35,
            // UI_GRAPHICS=51). Each Graphics emits 0-2 draws (fill +
            // stroke); sort cost is O(N log N) with N typically < 50.
            if let (Some(pool), Some(pipeline)) = (
                self.graphics_pool.as_ref(),
                self.graphics_pipeline.as_ref(),
            ) {
                let draw_order = pool.draw_order();
                let mut ordered = draw_order;
                ordered.sort_by(|a, b| {
                    a.0.partial_cmp(&b.0)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                pass.set_bind_group(0, &self.engine.bind_group, &[]);
                for (_z, h) in ordered {
                    if let Some(g) = pool.get(h) {
                        // Gate on index COUNT, not buffer presence: buffers now
                        // persist across re-tessellation for reuse, so an empty
                        // (cleared) Graphics still has buffers but draws nothing.
                        if g.visible && (g.fill_index_count > 0 || g.stroke_index_count > 0) {
                            g.draw(&mut pass, pipeline);
                        }
                    }
                }
            }

            // Text (M8): one draw per TextNode, grouped by atlas so the
            // bind group 2 (atlas texture) only changes between
            // atlases. Within each atlas, the handles are drawn in
            // ascending z_order so UI overlays (z >= 50) draw after
            // world labels (z < 50) when they share an atlas.
            // M10 review bug: the previous version computed `by_z`
            // but iterated `by_atlas` directly, dropping the z-order
            // and risking a low-z label painting over a high-z UI label
            // that happened to share its atlas.
            if let Some(pipeline) = self.text_registry.pipeline.as_ref() {
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, &self.engine.bind_group, &[]);
                let n_atlases = self.text_registry.atlases.len();
                let mut by_atlas: Vec<Vec<(f32, Handle)>> = vec![Vec::new(); n_atlases];
                for (h, n) in self.text_registry.nodes.iter() {
                    if n.visible && n.vertex_count > 0 {
                        by_atlas[n.atlas].push((n.z_order, h));
                    }
                }
                for bucket in by_atlas.iter_mut() {
                    bucket.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                }
                for (atlas_idx, handles) in by_atlas.iter().enumerate() {
                    if handles.is_empty() { continue; }
                    if let Some(bg) = self.text_registry.atlas_bind_groups.get(atlas_idx) {
                        pass.set_bind_group(2, bg, &[]);
                        for (_z, h) in handles {
                            if let Some(n) = self.text_registry.nodes.get(*h) {
                                pass.set_bind_group(1, &n.uniforms_bind_group, &[]);
                                pass.set_vertex_buffer(0, n.vertex_buffer.slice(..));
                                pass.draw(0..n.vertex_count, 0..1);
                            }
                        }
                    }
                }
            }
        }
        self.ctx.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}

// ─── Sprite helpers (internal, not exposed to TS) ────────────────────────

/// Sprites with `z_order >= FOG_Z` draw AFTER the fog pass (e.g. fog-memory
/// ghost silhouettes at Z.FOG_MEMORY = 42). Mirrors the game's canonical
/// z-order convention (src/core/render-order.ts: Z.FOG = 40) — without the
/// split, every sprite rendered under the fog overlay regardless of its z.
const FOG_Z: f32 = 40.0;

#[derive(Debug)]
struct SpriteRun {
    /// Texture handle packed as u64 — same key used by `texture_bind_groups`.
    texture_key: u64,
    start: u32,
    end: u32,
    /// True when this run's sprites sit at or above FOG_Z and must be
    /// drawn after the fog pass.
    post_fog: bool,
}

impl Renderer {
    /// Build the sprite pipeline lazily on the first texture upload so the
    /// Renderer can boot even if the game never calls upload_texture.
    /// Backend is fixed at this point: storage buffer where supported,
    /// per-instance vertex attrs on WebGL2.
    fn ensure_sprite_pipeline(&mut self) {
        if self.sprite_path.is_some() {
            return;
        }
        let texture_layout = self.sprite_texture_layout_lazy().clone();

        let backend = self.ctx.adapter.get_info().backend;
        let use_storage = !matches!(backend, wgpu::Backend::Gl);

        if use_storage {
            self.sprite_path = Some(self.build_storage_path(&texture_layout));
        } else {
            self.sprite_path = Some(self.build_instanced_path(&texture_layout));
        }
        self.mem_version = self.mem_version.wrapping_add(1);
    }

    /// The bind group 2 layout is identical across paths (texture + sampler).
    /// Created on demand and reused for every texture upload.
    fn sprite_texture_layout_lazy(&mut self) -> &wgpu::BindGroupLayout {
        if self.sprite_texture_layout.is_none() {
            let layout = self
                .ctx
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("sprite texture bind group layout"),
                    entries: &[
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Texture {
                                multisampled: false,
                                view_dimension: wgpu::TextureViewDimension::D2,
                                sample_type: wgpu::TextureSampleType::Float { filterable: true },
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
            self.sprite_texture_layout = Some(layout);
        }
        self.sprite_texture_layout.as_ref().unwrap()
    }

    fn build_storage_path(&mut self, texture_layout: &wgpu::BindGroupLayout) -> SpritePath {
        let shader_src = include_str!("../../../core/shaders/sprite_batch.wgsl");
        let shader = self
            .ctx
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("sprite_batch.wgsl"),
                source: wgpu::ShaderSource::Wgsl(shader_src.into()),
            });

        let byte_size = (std::mem::size_of::<SpriteData>() * SPRITE_CAPACITY) as u64;
        let storage_buffer = self.ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sprite storage buffer"),
            size: byte_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sprite_bind_group_layout =
            self.ctx
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("sprite storage layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: wgpu::BufferSize::new(
                                std::mem::size_of::<SpriteData>() as u64,
                            ),
                        },
                        count: None,
                    }],
                });

        let sprite_bind_group = self
            .ctx
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("sprite storage bind group"),
                layout: &sprite_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: storage_buffer.as_entire_binding(),
                }],
            });

        let pipeline_layout = self
            .ctx
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("sprite storage pipeline layout"),
                bind_group_layouts: &[
                    Some(&self.engine.layout),
                    Some(&sprite_bind_group_layout),
                    Some(texture_layout),
                ],
                immediate_size: 0,
            });

        let pipeline = self.build_pipeline(&pipeline_layout, &shader, &[]);

        SpritePath::Storage {
            pipeline,
            storage_buffer,
            sprite_bind_group,
            sprite_bind_group_layout,
        }
    }

    fn build_instanced_path(&mut self, texture_layout: &wgpu::BindGroupLayout) -> SpritePath {
        let shader_src = include_str!("../../../core/shaders/sprite_batch_instanced.wgsl");
        let shader = self
            .ctx
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("sprite_batch_instanced.wgsl"),
                source: wgpu::ShaderSource::Wgsl(shader_src.into()),
            });

        let byte_size = (std::mem::size_of::<SpriteData>() * SPRITE_CAPACITY) as u64;
        let instance_buffer = self.ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sprite instance buffer"),
            size: byte_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Pipeline layout has no group 1 — shader doesn't declare one.
        // Groups 0 (engine camera) and 2 (texture) are sufficient.
        let pipeline_layout = self
            .ctx
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("sprite instanced pipeline layout"),
                bind_group_layouts: &[Some(&self.engine.layout), None, Some(texture_layout)],
                immediate_size: 0,
            });

        // Vertex buffer attribute offsets must match `SpriteData` AoS so
        // both paths share the same CPU upload. color_rgba at offset 32 is
        // VertexFormat::Uint32 (NOT Float32) — see sprite_batch_instanced.wgsl.
        let vb_attrs = [
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x4,
            },
            wgpu::VertexAttribute {
                offset: 16,
                shader_location: 1,
                format: wgpu::VertexFormat::Float32x4,
            },
            wgpu::VertexAttribute {
                offset: 32,
                shader_location: 2,
                format: wgpu::VertexFormat::Uint32,
            },
            wgpu::VertexAttribute {
                offset: 40,
                shader_location: 3,
                format: wgpu::VertexFormat::Float32x2,
            },
        ];
        let vb_layouts = [wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SpriteData>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &vb_attrs,
        }];

        let pipeline = self.build_pipeline(&pipeline_layout, &shader, &vb_layouts);

        SpritePath::Instanced {
            pipeline,
            instance_buffer,
        }
    }

    /// Shared pipeline configuration for both paths. Alpha-over-source blend
    /// so fade-out trails and translucent sprites composite correctly.
    fn build_pipeline(
        &self,
        layout: &wgpu::PipelineLayout,
        shader: &wgpu::ShaderModule,
        buffers: &[wgpu::VertexBufferLayout<'_>],
    ) -> wgpu::RenderPipeline {
        self.ctx
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("sprite pipeline"),
                layout: Some(layout),
                vertex: wgpu::VertexState {
                    module: shader,
                    entry_point: Some("vs_main"),
                    buffers,
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: shader,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: self.surface.format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleList,
                    // CullMode::None: sprites flip via negative scale, which
                    // reverses winding — we accept both so flipped ships
                    // don't disappear.
                    cull_mode: None,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            })
    }

    fn build_texture_bind_group(&mut self, handle: Handle) {
        let layout = match self.sprite_texture_layout.as_ref() {
            Some(l) => l,
            None => return,
        };
        let Some(tex) = self.textures.get(handle) else {
            return;
        };
        let bg = self
            .ctx
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("sprite texture bind group"),
                layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&tex.view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&tex.sampler),
                    },
                ],
            });
        self.texture_bind_groups.insert(handle.to_u64(), bg);
    }

    /// Pack visible sprites into `sprite_scratch` grouped by texture and
    /// return a `SpriteRun` per same-texture span so the render loop can
    /// issue one draw call per run. Sprites whose texture has no bind group
    /// yet are skipped (create_sprite running before upload_texture).
    fn build_sprite_runs(&mut self) -> Vec<SpriteRun> {
        self.sprite_scratch.clear();

        // One pass over the SlotMap — snapshot everything we need per
        // visible sprite so the sort + pack below doesn't touch the
        // SlotMap again.
        struct Entry {
            texture_key: u64,
            z: f32,
            data: SpriteData,
        }
        let mut entries: Vec<Entry> = Vec::with_capacity(self.sprites.len());
        for (h, meta) in self.sprites.meta.iter() {
            let slot = h.slot as usize;
            if self.sprites.flags[slot] & FLAG_VISIBLE == 0 {
                continue;
            }
            let tex_key = meta.texture.to_u64();
            if !self.texture_bind_groups.contains_key(&tex_key) {
                continue;
            }
            let t = self.sprites.transforms[slot];
            let uv = self.sprites.uvs[slot];
            entries.push(Entry {
                texture_key: tex_key,
                z: self.sprites.z_order[slot],
                data: SpriteData {
                    transform: [t.x, t.y, t.scale_x, t.scale_y],
                    uv_rect: [uv.u, uv.v, uv.w, uv.h],
                    color: self.sprites.colors[slot],
                    _pad0: 0,
                    display: [meta.display_w, meta.display_h],
                },
            });
        }

        // Sort by z_order first (spec §"Convenção de Z-order" — canonical),
        // then by texture to batch same-texture sprites within a layer.
        // Stable sort preserves insertion order as the final tie-break.
        entries.sort_by(|a, b| {
            a.z.partial_cmp(&b.z)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.texture_key.cmp(&b.texture_key))
        });

        let mut runs: Vec<SpriteRun> = Vec::new();
        for e in entries {
            let idx = self.sprite_scratch.len() as u32;
            let post_fog = e.z >= FOG_Z;
            self.sprite_scratch.push(e.data);
            match runs.last_mut() {
                // Never merge across the fog boundary — pre-fog and post-fog
                // sprites draw in different segments of the render pass.
                Some(run) if run.texture_key == e.texture_key && run.post_fog == post_fog => {
                    run.end = idx + 1;
                }
                _ => runs.push(SpriteRun {
                    texture_key: e.texture_key,
                    start: idx,
                    end: idx + 1,
                    post_fog,
                }),
            }
        }
        runs
    }
}

// ─── Color unpack helpers (graphics.wgsl expects RGBA in [0,1]) ──────────

/// Sentinel for "no color requested". Use a high-bit-tagged value
/// (bit 31 set) so legitimate RGBA literals (which always have
/// bit 31 clear because alpha ≤ 0xFF) never collide.
const COLOR_NONE: u32 = 0x8000_0000;

/// Unpack a 0xRR_GG_BB_AA packed u32 into a [0,1] RGBA tuple. Sentinels:
/// `COLOR_NONE` → caller didn't request this color (used for
/// fill=none / stroke=none). Real RGBA values never collide because
/// they have bit 31 clear (alpha byte ≤ 0xFF).
fn unpack_rgba_opt(packed: u32) -> Option<[f32; 4]> {
    if packed == COLOR_NONE {
        None
    } else {
        Some(unpack_rgba(packed))
    }
}

/// Unpack `0xRR_GG_BB_AA` packed u32 into [0,1] RGBA. Required (Line/Arc
/// always have a stroke color; Pixi's `stroke()` without a color uses
/// `0xFFFFFF` so the caller never passes 0).
fn unpack_rgba_req(packed: u32) -> [f32; 4] {
    unpack_rgba(packed)
}

fn unpack_rgba(packed: u32) -> [f32; 4] {
    let r = ((packed >> 24) & 0xff) as f32 / 255.0;
    let g = ((packed >> 16) & 0xff) as f32 / 255.0;
    let b = ((packed >> 8) & 0xff) as f32 / 255.0;
    let a = (packed & 0xff) as f32 / 255.0;
    [r, g, b, a]
}

/// Unpack stroke (color + width) into the Option the Graphics API uses.
/// `color == COLOR_NONE` → caller didn't request a stroke (just fill).
/// `width <= 0` → caller passed a zero-width stroke, same effect.
fn unpack_stroke(color: u32, width: f32) -> Option<(f32, [f32; 4])> {
    if color == COLOR_NONE || width <= 0.0 {
        None
    } else {
        Some((width, unpack_rgba(color)))
    }
}
