//! Native adapter for weydra-renderer.
//!
//! Wraps the core `GpuContext` + `RenderSurface` on a winit `Window`.
//! Covers Windows (DX12/Vulkan), macOS (Metal), Linux (Vulkan).
//!
//! Intentionally minimal in M1.5 — enough to open a window + clear color.
//! Full adapter (input events, multi-monitor, etc) is deferred to M11.

use std::sync::Arc;
use weydra_renderer::{render_clear, GpuContext, RenderSurface, Result, WeydraError};
use winit::window::Window;

/// Native renderer bound to a winit Window.
///
/// Field order matters for drop safety: `surface` must drop before `ctx`
/// (wgpu issue #5781 — surface holds references into device/instance),
/// and `_window` must drop last so its raw handle outlives the surface.
pub struct NativeRenderer {
    pub(crate) surface: RenderSurface<'static>,
    pub(crate) ctx: GpuContext,
    _window: Arc<dyn Window>,
}

impl NativeRenderer {
    /// Create a renderer for the given window. The window is held via Arc
    /// so the surface borrow stays valid for the renderer's lifetime.
    pub async fn new(window: Arc<dyn Window>) -> Result<Self> {
        let size = window.surface_size();

        let instance =
            wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());

        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| WeydraError::SurfaceCreationFailed(e.to_string()))?;

        let ctx = GpuContext::new_with_surface(instance, &surface).await?;
        let surface = RenderSurface::configure(&ctx, surface, size.width, size.height)?;

        Ok(Self { surface, ctx, _window: window })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.surface.resize(&self.ctx, width, height);
    }

    pub fn render(&mut self, clear_color: [f64; 4]) -> Result<()> {
        render_clear(&self.ctx, &mut self.surface, clear_color)
    }
}
