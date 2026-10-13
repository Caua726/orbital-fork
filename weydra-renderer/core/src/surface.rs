use crate::device::GpuContext;
use crate::error::{Result, WeydraError};

/// Consecutive `Lost` acquires tolerated before the surface is declared dead.
/// `Lost` (unlike `Outdated`/`Timeout`/`Occluded`) means the underlying
/// context/device is gone; a browser may still restore it, so we skip frames
/// for ~0.5 s at 60 Hz before reporting an error the caller can act on
/// (the game treats repeated render errors as fatal and switches back to Pixi).
const TOLERATED_LOST_FRAMES: u32 = 30;

/// Pick the canvas format and the format every pipeline/view renders with.
///
/// Browsers expose only non-sRGB formats for WebGPU canvases (`rgba8unorm` /
/// `bgra8unorm`), while the engine's shaders — like the Pixi path they replaced —
/// write sRGB-encoded values. Rendering into a linear surface therefore looks
/// much darker (measured: pixel (45,90,82) → (7,26,22) on the reference scene).
/// The remaining knob is the sRGB-ness of the view, so when the surface has no
/// sRGB format of its own we render through the sRGB *sibling* via
/// `view_formats` and let the fixed-function sRGB encode happen on write.
///
/// Returns `(canvas_format, render_format)`; both are equal whenever the
/// surface already advertises an sRGB format, and `render_format == canvas_format`
/// when no sRGB sibling exists (e.g. 10-bit or float formats) — in that case the
/// caller has nothing better to offer and the linear output stands.
fn choose_formats(
    formats: &[wgpu::TextureFormat],
) -> Option<(wgpu::TextureFormat, wgpu::TextureFormat)> {
    let canvas = formats
        .iter()
        .find(|f| f.is_srgb())
        .copied()
        .or_else(|| formats.first().copied())?;
    let srgb_sibling = canvas.add_srgb_suffix();
    let render = if canvas.is_srgb() || srgb_sibling == canvas {
        canvas
    } else {
        srgb_sibling
    };
    Some((canvas, render))
}

/// A configured render surface — the thing we actually draw into every frame.
///
/// Wraps wgpu::Surface + config. On the browser side, this is created from an
/// HtmlCanvasElement via the wasm adapter; natively, from a winit Window.
pub struct RenderSurface<'window> {
    pub surface: wgpu::Surface<'window>,
    pub config: wgpu::SurfaceConfiguration,
    /// Format every pipeline and every render-pass view uses. Equal to
    /// `config.format` unless the canvas only offers a linear format — see
    /// [`choose_formats`].
    pub format: wgpu::TextureFormat,
    lost_streak: u32,
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
        let (canvas_format, render_format) = choose_formats(&caps.formats).ok_or_else(|| {
            WeydraError::SurfaceCreationFailed("no supported surface formats".into())
        })?;

        // Only declare a view format when it differs: `VIEW_FORMATS` downlevel
        // flag isn't guaranteed on WebGL2, and an unneeded entry would make
        // wgpu-core reject the config there.
        let view_formats = if render_format == canvas_format {
            Vec::new()
        } else {
            vec![render_format]
        };

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: canvas_format,
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats,
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&ctx.device, &config);

        Ok(Self {
            surface,
            config,
            format: render_format,
            lost_streak: 0,
        })
    }

    /// Render-pass view for a texture acquired from this surface. Must be used
    /// instead of `texture.create_view(..)` so the sRGB render format picked in
    /// [`choose_formats`] is honored.
    pub fn view_for(&self, texture: &wgpu::Texture) -> wgpu::TextureView {
        texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(self.format),
            ..Default::default()
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
    /// outdated and has been reconfigured, or acquire timed out). Callers
    /// should silently drop the frame and try again next tick.
    ///
    /// A `Lost` surface (context/device gone) is tolerated for
    /// [`TOLERATED_LOST_FRAMES`] frames — a browser can restore the context on
    /// its own — and then reported as an error, because a silently skipped
    /// frame leaves a frozen canvas with no recovery path.
    pub fn acquire_next_texture(
        &mut self,
        ctx: &GpuContext,
    ) -> Result<Option<wgpu::SurfaceTexture>> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => {
                self.lost_streak = 0;
                Ok(Some(t))
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                // Transient (size/format change): reconfigure and skip.
                self.lost_streak = 0;
                self.surface.configure(&ctx.device, &self.config);
                Ok(None)
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.lost_streak += 1;
                if self.lost_streak > TOLERATED_LOST_FRAMES {
                    return Err(WeydraError::SurfaceAcquireFailed(
                        "surface lost (graphics context was destroyed)",
                    ));
                }
                self.surface.configure(&ctx.device, &self.config);
                Ok(None)
            }
            wgpu::CurrentSurfaceTexture::Timeout => {
                self.lost_streak = 0;
                Ok(None)
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                self.lost_streak = 0;
                Ok(None)
            }
            wgpu::CurrentSurfaceTexture::Validation => Err(WeydraError::SurfaceAcquireFailed(
                "surface validation failed",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::choose_formats;
    use wgpu::TextureFormat as F;

    #[test]
    fn keeps_srgb_canvas_format_when_available() {
        // WebGL2 / native: the sRGB format is advertised and used directly.
        let (canvas, render) = choose_formats(&[F::Rgba8UnormSrgb, F::Rgba8Unorm]).unwrap();
        assert_eq!(canvas, F::Rgba8UnormSrgb);
        assert_eq!(render, F::Rgba8UnormSrgb);
    }

    #[test]
    fn renders_through_srgb_view_when_canvas_is_linear() {
        // WebGPU canvases: only linear formats, so render through the sibling.
        let (canvas, render) = choose_formats(&[F::Rgba8Unorm]).unwrap();
        assert_eq!(canvas, F::Rgba8Unorm);
        assert_eq!(render, F::Rgba8UnormSrgb);

        let (canvas, render) = choose_formats(&[F::Bgra8Unorm]).unwrap();
        assert_eq!(canvas, F::Bgra8Unorm);
        assert_eq!(render, F::Bgra8UnormSrgb);
    }

    #[test]
    fn gives_up_quietly_when_no_srgb_sibling_exists() {
        // 10-bit / float formats have no sRGB variant: render linear rather
        // than invent a format the driver would reject.
        let (canvas, render) = choose_formats(&[F::Rgb10a2Unorm]).unwrap();
        assert_eq!(canvas, F::Rgb10a2Unorm);
        assert_eq!(render, F::Rgb10a2Unorm);
    }

    #[test]
    fn rejects_surfaces_without_formats() {
        assert!(choose_formats(&[]).is_none());
    }
}
