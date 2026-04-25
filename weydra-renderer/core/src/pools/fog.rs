//! Fog-of-war uniforms + GPU pool.
//!
//! `FogUniforms` mirrors `struct FogUniforms` in `src/shaders/fog.wgsl`
//! byte-for-byte (1040 bytes, std140-aligned). The 16-byte header packs
//! `base_alpha` + `active_count` + 8 bytes of padding so the trailing
//! `sources` array starts on a 16-byte boundary, satisfying std140's
//! requirement that array-of-struct elements align to vec4 (16 B). Each
//! `VisionSource` is exactly one std140 row (16 B): vec2 position + f32
//! radius + f32 _pad.
//!
//! Unlike `PlanetPool`, fog is a singleton — there is at most one fog
//! state per frame. The bind group has `has_dynamic_offset: false` and
//! the GPU buffer holds exactly one `FogUniforms` instance.

use crate::device::GpuContext;
use bytemuck::{Pod, Zeroable};

/// Hard cap on simultaneous vision sources. Mirrored on the WGSL side as
/// `array<VisionSource, 64>`. Raising this requires updating both.
pub const FOG_MAX_SOURCES: usize = 64;

/// Byte size of `FogUniforms` — exposed so the wasm adapter / TS bridge
/// can build typed-array views without round-tripping through
/// `mem::size_of`. Header (16) + 64 × 16 = 1040 bytes.
pub const FOG_UNIFORMS_SIZE: usize = 16 + FOG_MAX_SOURCES * 16;

/// One vision source — circle at `position` with `radius`, both in world
/// units. `_pad` rounds the struct out to 16 bytes so successive entries
/// satisfy std140's vec4 alignment for array elements.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct VisionSource {
    pub position: [f32; 2],
    pub radius: f32,
    pub _pad: f32,
}

const _: () = assert!(std::mem::size_of::<VisionSource>() == 16);

/// Uniform block for `fog.wgsl`. Field order is **load-bearing** — must
/// match the WGSL `FogUniforms` struct exactly. `_pad` after
/// `active_count` keeps the trailing `sources` array on a 16-byte row.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct FogUniforms {
    pub base_alpha: f32,
    pub active_count: u32,
    pub _pad: [f32; 2],
    pub sources: [VisionSource; FOG_MAX_SOURCES],
}

// Compile-time guard: drift against the WGSL struct fails the build
// before a GPU ever sees it.
const _: () = assert!(std::mem::size_of::<FogUniforms>() == FOG_UNIFORMS_SIZE);
const _: () = assert!(std::mem::align_of::<FogUniforms>() == 4);

impl Default for FogUniforms {
    fn default() -> Self {
        Self {
            base_alpha: 0.75,
            active_count: 0,
            _pad: [0.0; 2],
            sources: [VisionSource {
                position: [0.0, 0.0],
                radius: 0.0,
                _pad: 0.0,
            }; FOG_MAX_SOURCES],
        }
    }
}

/// GPU-backed fog uniforms. Single instance — fog is drawn once per
/// frame as a fullscreen quad covering the viewport, so a dynamic
/// offset would buy nothing.
pub struct FogPool {
    /// CPU mirror, length 1. Never reallocates — TS-side typed-array
    /// views over the underlying memory remain valid across frames.
    pub instances: Vec<FogUniforms>,
    pub gpu_buffer: wgpu::Buffer,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
}

impl FogPool {
    pub fn new(ctx: &GpuContext, label: &str) -> Self {
        let byte_size = FOG_UNIFORMS_SIZE as u64;

        let gpu_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: byte_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let layout_label = format!("{label} layout");
        // `min_binding_size` is the full struct — 1040 B fits well under
        // the WebGPU 64 KiB UBO max. No dynamic offset: one fog instance
        // per frame.
        let min_binding_size =
            wgpu::BufferSize::new(byte_size).expect("FogUniforms is non-zero (compile-time asserted)");
        let bind_group_layout =
            ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(&layout_label),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: Some(min_binding_size),
                    },
                    count: None,
                }],
            });

        let bg_label = format!("{label} bind group");
        let bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&bg_label),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: gpu_buffer.as_entire_binding(),
            }],
        });

        let mut instances = Vec::with_capacity(1);
        instances.push(FogUniforms::default());

        Self {
            instances,
            gpu_buffer,
            bind_group_layout,
            bind_group,
        }
    }

    /// Upload current CPU instance to GPU.
    pub fn upload(&self, ctx: &GpuContext) {
        let inst = self
            .instances
            .first()
            .expect("FogPool::instances is constructed with exactly one element");
        ctx.queue
            .write_buffer(&self.gpu_buffer, 0, bytemuck::bytes_of(inst));
    }

    /// Pointer to the single CPU `FogUniforms` instance. Exposed via the
    /// wasm adapter so TS builds a typed-array view for direct memory
    /// writes — header at offset 0, sources at offset 16.
    pub fn instances_ptr(&self) -> *const FogUniforms {
        self.instances.as_ptr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin every offset that the WGSL std140 layout depends on.
    #[test]
    fn fog_uniforms_layout() {
        assert_eq!(std::mem::size_of::<FogUniforms>(), 1040);
        assert_eq!(std::mem::size_of::<VisionSource>(), 16);

        // Header offsets.
        assert_eq!(core::mem::offset_of!(FogUniforms, base_alpha), 0);
        assert_eq!(core::mem::offset_of!(FogUniforms, active_count), 4);
        assert_eq!(core::mem::offset_of!(FogUniforms, _pad), 8);
        // Sources start on the second 16 B row.
        assert_eq!(core::mem::offset_of!(FogUniforms, sources), 16);

        // VisionSource field offsets.
        assert_eq!(core::mem::offset_of!(VisionSource, position), 0);
        assert_eq!(core::mem::offset_of!(VisionSource, radius), 8);
        assert_eq!(core::mem::offset_of!(VisionSource, _pad), 12);
    }

    #[test]
    fn default_field_values() {
        let d = FogUniforms::default();
        // base_alpha is the only non-zero default; it controls the
        // fully-obscured fog opacity. Pin it so a regression to 0.0
        // (transparent — no fog) or 1.0 (opaque black) fails the build.
        assert_eq!(d.base_alpha, 0.75);
        assert_eq!(d.active_count, 0);
        for s in d.sources.iter() {
            assert_eq!(s.position, [0.0, 0.0]);
            assert_eq!(s.radius, 0.0);
        }
        // Bytemuck must accept the default — catches accidental non-Pod
        // field types.
        let bytes = bytemuck::bytes_of(&d);
        assert_eq!(bytes.len(), FOG_UNIFORMS_SIZE);
    }
}
