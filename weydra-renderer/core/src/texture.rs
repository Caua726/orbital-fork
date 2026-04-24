//! Texture registry — upload RGBA8 bytes, hand back an opaque handle.
//!
//! Storage is a `SlotMap<Texture>` so destroy + reupload gives a handle with
//! a fresh generation, invalidating stale sprite references.

use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};

pub struct Texture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    pub width: u32,
    pub height: u32,
}

pub struct TextureRegistry {
    textures: SlotMap<Texture>,
}

impl TextureRegistry {
    pub fn new() -> Self {
        Self {
            textures: SlotMap::with_capacity(64),
        }
    }

    /// Upload RGBA8 bytes as a new texture. `bytes` must be exactly
    /// `width * height * 4` long.
    ///
    /// Uses `Rgba8UnormSrgb` + Nearest sampling to preserve the game's
    /// pixel-art look. Sprites colored by tint in the shader still get sRGB
    /// correctness on the texel sample.
    pub fn upload_rgba(
        &mut self,
        ctx: &GpuContext,
        bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Handle {
        assert_eq!(
            bytes.len(),
            (width as usize) * (height as usize) * 4,
            "TextureRegistry::upload_rgba: bytes length {} does not match width*height*4 ({}*{}*4 = {})",
            bytes.len(),
            width,
            height,
            (width as usize) * (height as usize) * 4,
        );
        assert!(width > 0 && height > 0, "zero-sized texture");

        let texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("weydra texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            // Allow a linear (non-srgb) view to be created later — M5 bake
            // and any future blit pass may want to read raw bytes without
            // the hardware sRGB→linear decode on sample.
            view_formats: &[wgpu::TextureFormat::Rgba8Unorm],
        });

        ctx.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let sampler = ctx.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("weydra sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        self.textures.insert(Texture {
            texture,
            view,
            sampler,
            width,
            height,
        })
    }

    pub fn get(&self, h: Handle) -> Option<&Texture> {
        self.textures.get(h)
    }

    /// Insert a pre-built `Texture`. Escape hatch for render-to-texture paths
    /// (M5 bake) where the wgpu::Texture is created elsewhere.
    pub fn insert(&mut self, t: Texture) -> Handle {
        self.textures.insert(t)
    }

    pub fn remove(&mut self, h: Handle) -> Option<Texture> {
        self.textures.remove(h)
    }
}

impl Default for TextureRegistry {
    fn default() -> Self {
        Self::new()
    }
}
