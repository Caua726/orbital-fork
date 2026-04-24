//! WASM adapter for weydra-renderer.
//!
//! Exposes a wasm-bindgen Renderer that wraps the core pipeline and binds
//! to an HtmlCanvasElement. Hot-path per-frame ops (uniform updates) go
//! through shared WASM memory — `*_uniforms_ptr()` exposes the pool's Vec
//! backing storage so TS can construct typed-array views and write without
//! crossing the wasm-bindgen call boundary.
//!
//! Compiles as an empty crate on non-wasm32 targets so `cargo build --workspace`
//! works on native toolchains. wgpu's `SurfaceTarget::Canvas` variant only
//! exists under `cfg(target_arch = "wasm32")`.
#![cfg(target_arch = "wasm32")]

use bytemuck::{Pod, Zeroable};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use weydra_renderer::{
    CameraUniforms, EngineBindings, GpuContext, Mesh, RenderSurface, ShaderRegistry, UniformPool,
};

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

/// The weydra renderer instance, bound to a specific canvas.
#[wasm_bindgen]
pub struct Renderer {
    surface: RenderSurface<'static>,
    ctx: GpuContext,
    engine: EngineBindings,
    shader_registry: ShaderRegistry,
    camera_uniforms: CameraUniforms,
    starfield_pool: Option<UniformPool<StarfieldUniforms>>,
    starfield_mesh: Option<Mesh>,
    // Bumps whenever an op may have grown wasm memory (texture uploads,
    // large buffer allocations). TS revalidates cached views on mismatch.
    mem_version: u32,
}

#[wasm_bindgen]
impl Renderer {
    pub async fn create(canvas: HtmlCanvasElement) -> Result<Renderer, JsValue> {
        let width = canvas.width();
        let height = canvas.height();

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());

        let surface_target = wgpu::SurfaceTarget::Canvas(canvas);
        let surface = instance
            .create_surface(surface_target)
            .map_err(|e| JsValue::from_str(&format!("surface: {e}")))?;

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
            mem_version: 0,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.surface.resize(&self.ctx, width, height);
    }

    /// Set camera uniforms. `vw`/`vh` are world units (screen / zoom per
    /// M2 convention — shaders are zoom-agnostic).
    pub fn set_camera(&mut self, x: f32, y: f32, vw: f32, vh: f32, time: f32) {
        self.camera_uniforms = CameraUniforms::new([x, y], [vw, vh], time);
    }

    /// Register the starfield shader + create its uniform pool. Call once
    /// during setup. Bumps `mem_version` because pool allocation can grow
    /// the wasm linear memory.
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

    /// Pointer to the starfield uniform pool's contiguous storage. Returns 0
    /// when the pool is absent (caller must check before constructing views).
    pub fn starfield_uniforms_ptr(&self) -> u32 {
        self.starfield_pool
            .as_ref()
            .map(|p| p.instances_ptr() as u32)
            .unwrap_or(0)
    }

    /// Monotonic counter bumped after every op that may have grown WASM
    /// memory. TS pairs this with `_wasm.memory.buffer` identity checks
    /// to decide when typed-array views need rebuilding.
    pub fn mem_version(&self) -> u32 {
        self.mem_version
    }

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
        }
        self.ctx.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}
