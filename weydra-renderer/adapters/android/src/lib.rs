//! Android adapter for weydra-renderer.
//!
//! M1.5 scope: skeleton que cross-compila via cargo check com
//! `aarch64-linux-android`. Full adapter (activity lifecycle, touch,
//! APK build, audio etc) fica pra M12.
//!
//! Spawn é via winit's android-activity feature; detalhes do entry point
//! (#[no_mangle] pub extern fn ANativeActivity_onCreate) ficam pro M12.

use std::sync::Arc;
use weydra_renderer::{GpuContext, RenderSurface, Result, WeydraError, render_clear};
use winit::window::Window;

/// Android renderer bound to a winit Window.
///
/// Field order matters for drop safety: `surface` must drop before `ctx`
/// (wgpu issue #5781), `_window` must drop last.
pub struct AndroidRenderer {
    pub(crate) surface: RenderSurface<'static>,
    pub(crate) ctx: GpuContext,
    _window: Arc<dyn Window>,
}

impl AndroidRenderer {
    pub async fn new(window: Arc<dyn Window>) -> Result<Self> {
        let size = window.surface_size();

        // Android: force Vulkan+GL backends (no DX12/Metal on Android).
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN | wgpu::Backends::GL,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });

        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| WeydraError::SurfaceCreationFailed(e.to_string()))?;

        // LowPower picks the efficiency GPU — mobile battery matters.
        let ctx =
            GpuContext::new_with_surface_pref(instance, &surface, wgpu::PowerPreference::LowPower)
                .await?;
        let surface = RenderSurface::configure(&ctx, surface, size.width, size.height)?;

        Ok(Self {
            surface,
            ctx,
            _window: window,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.surface.resize(&self.ctx, width, height);
    }

    pub fn render(&mut self, clear_color: [f64; 4]) -> Result<()> {
        render_clear(&self.ctx, &mut self.surface, clear_color)
    }
}
