use crate::device::GpuContext;
use crate::error::{Result, WeydraError};

/// A configured render surface — the thing we actually draw into every frame.
///
/// Wraps wgpu::Surface + config. On the browser side, this is created from an
/// HtmlCanvasElement via the wasm adapter; natively, from a winit Window.
pub struct RenderSurface<'window> {
    pub surface: wgpu::Surface<'window>,
    pub config: wgpu::SurfaceConfiguration,
    pub format: wgpu::TextureFormat,
}

impl<'window> RenderSurface<'window> {
    /// Configure a surface that was previously created by the platform adapter.
    pub fn configure(
        ctx: &GpuContext,
        surface: wgpu::Surface<'window>,
        width: u32,
        height: u32,
    ) -> Result<Self> {
        let caps = surface.get_capabilities(&ctx.adapter);
        let format = caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .or_else(|| caps.formats.first().copied())
            .ok_or_else(|| {
                WeydraError::SurfaceCreationFailed("no supported surface formats".into())
            })?;

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&ctx.device, &config);

        Ok(Self {
            surface,
            config,
            format,
        })
    }

    /// Resize the swap chain. Must be called when the window/canvas size changes.
    pub fn resize(&mut self, ctx: &GpuContext, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&ctx.device, &self.config);
    }

    /// Acquire the next texture to render into. Returned texture (when `Some`)
    /// must be presented (via `SurfaceTexture::present`) before the next frame.
    ///
    /// Returns `Ok(None)` when the frame should be skipped (e.g. surface was
    /// outdated/lost and has been reconfigured, or acquire timed out). Callers
    /// should silently drop the frame and try again next tick.
    pub fn acquire_next_texture(
        &mut self,
        ctx: &GpuContext,
    ) -> Result<Option<wgpu::SurfaceTexture>> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => Ok(Some(t)),
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                // Transient: reconfigure and skip this frame.
                self.surface.configure(&ctx.device, &self.config);
                Ok(None)
            }
            wgpu::CurrentSurfaceTexture::Timeout => Ok(None),
            wgpu::CurrentSurfaceTexture::Occluded => Ok(None),
            wgpu::CurrentSurfaceTexture::Validation => Err(WeydraError::SurfaceAcquireFailed(
                "surface validation failed",
            )),
        }
    }
}
