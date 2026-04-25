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
    CameraUniforms, EngineBindings, GpuContext, Handle, Mesh, RenderSurface, ShaderRegistry,
    SpritePool, TextureRegistry, UniformPool, FLAG_VISIBLE,
};

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

        Ok(Renderer {
            surface: render_surface,
            ctx,
            engine,
            shader_registry: ShaderRegistry::new(),
            camera_uniforms: CameraUniforms::default(),
            starfield_pool: None,
            starfield_mesh: None,
            textures: TextureRegistry::new(),
            sprites: SpritePool::with_capacity(SPRITE_CAPACITY),
            sprite_path: None,
            sprite_texture_layout: None,
            texture_bind_groups: HashMap::new(),
            sprite_scratch: Vec::with_capacity(SPRITE_CAPACITY),
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

            // Sprite batcher — one draw call per texture run.
            if !runs.is_empty() {
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
                    for run in &runs {
                        if let Some(bg) = self.texture_bind_groups.get(&run.texture_key) {
                            pass.set_bind_group(2, bg, &[]);
                            pass.draw(0..6, run.start..run.end);
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

#[derive(Debug)]
struct SpriteRun {
    /// Texture handle packed as u64 — same key used by `texture_bind_groups`.
    texture_key: u64,
    start: u32,
    end: u32,
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
            self.sprite_scratch.push(e.data);
            match runs.last_mut() {
                Some(run) if run.texture_key == e.texture_key => {
                    run.end = idx + 1;
                }
                _ => runs.push(SpriteRun {
                    texture_key: e.texture_key,
                    start: idx,
                    end: idx + 1,
                }),
            }
        }
        runs
    }
}
