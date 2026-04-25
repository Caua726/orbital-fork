//! Offscreen renderable texture.
//!
//! `COPY_SRC` is included alongside the usual attachment/binding flags so
//! the engine can `copy_texture_to_buffer` for readback without recreating
//! the texture (debug snapshots, determinism hashes).
//!
//! When constructed with an sRGB format the linear counterpart is added to
//! `view_formats`, so callers can spawn a non-srgb view off `self.texture`
//! for raw-byte reads. Without this, wgpu rejects the reinterpret view at
//! runtime.

use crate::device::GpuContext;

pub struct RenderTarget {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub format: wgpu::TextureFormat,
    pub width: u32,
    pub height: u32,
}

impl RenderTarget {
    pub fn new(ctx: &GpuContext, width: u32, height: u32, format: wgpu::TextureFormat) -> Self {
        assert!(
            width > 0 && height > 0,
            "RenderTarget: zero-sized ({width}x{height})"
        );
        // RENDER_ATTACHMENT rejects compressed formats in wgpu itself, but
        // the srgb-sibling branch below would also produce an invalid
        // view_formats entry for them (view reinterpret is uncompressed-only).
        // Fail fast here instead of letting wgpu surface a less-obvious error.
        assert!(
            !format.is_compressed(),
            "RenderTarget: compressed format {format:?} cannot be a render attachment",
        );

        // `remove_srgb_suffix` returns the input unchanged when it has no
        // srgb variant, so the linear slot stays empty for non-srgb inputs.
        // Skip the aliasing entirely on adapters without VIEW_FORMATS
        // (WebGL2) — wgpu-core rejects the descriptor otherwise.
        let supports_view_formats = ctx
            .adapter
            .get_downlevel_capabilities()
            .flags
            .contains(wgpu::DownlevelFlags::VIEW_FORMATS);
        let linear = format.remove_srgb_suffix();
        let linear_arr = [linear];
        let view_formats: &[wgpu::TextureFormat] = if supports_view_formats && linear != format {
            &linear_arr
        } else {
            &[]
        };

        let texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("weydra render target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats,
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Self {
            texture,
            view,
            format,
            width,
            height,
        }
    }
}
