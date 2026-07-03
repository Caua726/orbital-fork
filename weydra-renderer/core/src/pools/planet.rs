//! Procedural planet uniforms + GPU pool.
//!
//! `PlanetUniforms` mirrors `struct PlanetUniforms` in
//! `src/shaders/planeta-weydra.wgsl` byte-for-byte (192 bytes, std140-aligned).
//! Any reorder, insert, or type change here MUST be matched in the WGSL or the
//! GPU reads garbage. The compile-time `assert!(size_of == 192)` is the
//! single most important guard: the cargo build itself fails on drift.
//!
//! `PlanetPool` owns one shared `wgpu::Buffer` sized for `capacity` planets
//! at the device's `min_uniform_buffer_offset_alignment` stride, plus a
//! single `BindGroup` configured with `has_dynamic_offset: true` so the
//! engine sets the group once per frame and indexes per-instance via
//! `set_bind_group(1, &bg, &[offset_for(slot)])` — far cheaper than
//! N bind groups.

use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};
use bytemuck::{Pod, Zeroable};

/// Byte size of a single `PlanetUniforms` instance — also the WGSL struct
/// size. Exposed as a public constant so the wasm adapter / TS bridge can
/// validate handshake sizing without `mem::size_of` round-trips.
pub const PLANET_UNIFORMS_SIZE: usize = 192;

/// Per-instance uniforms for the procedural planet shader.
///
/// Field order is **load-bearing**: it must match the WGSL `PlanetUniforms`
/// struct in `src/shaders/planeta-weydra.wgsl` exactly. The 6 prefix rows
/// (96 B) pack scalars + vec2s into 16-byte std140 rows; the trailing
/// `u_colors` array is 6 × vec4 = 96 B. Total = 192 B.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct PlanetUniforms {
    // Row 1 (16 B)
    pub u_time: f32,
    pub u_seed: f32,
    pub u_rotation: f32,
    pub u_pixels: f32,

    // Row 2 (16 B)
    pub u_light_origin: [f32; 2],
    pub u_time_speed: f32,
    pub u_dither_size: f32,

    // Row 3 (16 B)
    pub u_light_border1: f32,
    pub u_light_border2: f32,
    pub u_size: f32,
    pub u_octaves: i32,

    // Row 4 (16 B)
    pub u_planet_type: i32,
    pub u_river_cutoff: f32,
    pub u_land_cutoff: f32,
    pub u_cloud_cover: f32,

    // Row 5 (16 B)
    pub u_stretch: f32,
    pub u_cloud_curve: f32,
    pub u_tiles: f32,
    pub u_cloud_alpha: f32,

    // Row 6 (16 B)
    pub u_world_pos: [f32; 2],
    pub u_world_size: [f32; 2],

    // 6 × vec4 = 96 B
    pub u_colors: [[f32; 4]; 6],
}

// Compile-time guard: any field-order or type drift away from the WGSL
// struct fails the build before a GPU ever sees it.
const _: () = assert!(std::mem::size_of::<PlanetUniforms>() == PLANET_UNIFORMS_SIZE);
const _: () = assert!(std::mem::align_of::<PlanetUniforms>() == 4);

impl Default for PlanetUniforms {
    fn default() -> Self {
        Self {
            u_time: 0.0,
            u_seed: 1.0,
            u_rotation: 0.0,
            u_pixels: 100.0,
            u_light_origin: [0.39, 0.39],
            u_time_speed: 0.1,
            u_dither_size: 2.0,
            u_light_border1: 0.4,
            u_light_border2: 0.5,
            u_size: 8.0,
            u_octaves: 4,
            u_planet_type: 0,
            u_river_cutoff: 0.5,
            u_land_cutoff: 0.5,
            u_cloud_cover: 0.5,
            u_stretch: 1.0,
            u_cloud_curve: 1.3,
            u_tiles: 1.0,
            u_cloud_alpha: 0.5,
            u_world_pos: [0.0, 0.0],
            u_world_size: [128.0, 128.0],
            u_colors: [
                [1.0, 1.0, 1.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
            ],
        }
    }
}

/// GPU-backed pool of N planet instances sharing one buffer + one bind group.
///
/// Per-instance draw uses `set_bind_group(group, &bind_group, &[offset_for(slot)])`
/// where `offset_for` returns the slot's byte offset into the shared buffer
/// (stride-aligned to the device's `min_uniform_buffer_offset_alignment`).
pub struct PlanetPool {
    /// CPU mirror of the GPU buffer: `capacity × stride` bytes laid out
    /// with the SAME aligned stride the GPU uses. The TS bridge writes
    /// uniforms straight into this memory at `slot * stride` (typed-array
    /// views over `instances_ptr`), and `offset_for` computes GPU offsets
    /// the same way — CPU, GPU, and TS all agree where each instance lives.
    ///
    /// Was previously `Vec<PlanetUniforms>` (packed at 192 B) while the TS
    /// views indexed at the ALIGNED stride (256 B on most adapters): every
    /// instance except slot 0 uploaded from the wrong bytes and silently
    /// rendered nothing (zero world_size), and high slots let the TS view
    /// write past the Vec allocation. Never reallocates — TS views stay
    /// valid across frames.
    pub instances: Vec<u8>,
    pub gpu_buffer: wgpu::Buffer,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
    pub slotmap: SlotMap<()>,
    capacity: usize,
    /// Byte stride between successive instances in `gpu_buffer`. Equal to
    /// `size_of::<PlanetUniforms>()` rounded up to the device's
    /// `min_uniform_buffer_offset_alignment`.
    stride: u64,
}

impl PlanetPool {
    pub fn new(ctx: &GpuContext, label: &str, capacity: usize) -> Self {
        assert!(capacity > 0, "PlanetPool capacity must be > 0");

        let element_size = std::mem::size_of::<PlanetUniforms>() as u64;
        let alignment = ctx.device.limits().min_uniform_buffer_offset_alignment as u64;
        // Round element_size up to alignment. WebGPU requires dynamic-offset
        // strides be a multiple of min_uniform_buffer_offset_alignment (256
        // on most desktop GPUs, sometimes 64 on mobile). 192 < 256 → most
        // hardware will pad to 256 and the per-slot upload loop kicks in.
        let stride = element_size.div_ceil(alignment) * alignment;
        let byte_size = stride * capacity as u64;

        let gpu_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: byte_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let layout_label = format!("{label} layout");
        // min_binding_size is the per-binding-instance size, NOT the stride.
        // Use the unpadded element_size so validation matches the WGSL
        // struct's actual size; the dynamic offset moves between instances.
        let min_binding_size = wgpu::BufferSize::new(element_size)
            .expect("PlanetUniforms is non-zero (compile-time asserted)");
        let bind_group_layout =
            ctx.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some(&layout_label),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: true,
                            min_binding_size: Some(min_binding_size),
                        },
                        count: None,
                    }],
                });

        let bg_label = format!("{label} bind group");
        // Single bind group: `size` is the per-draw window (one instance);
        // the dynamic offset slides this window across the shared buffer.
        let bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&bg_label),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &gpu_buffer,
                    offset: 0,
                    size: Some(min_binding_size),
                }),
            }],
        });

        // Stride-aligned byte mirror; seed every slot with the default
        // uniforms so a freshly-inserted instance renders sanely before the
        // TS side writes it.
        let mut instances = vec![0u8; (stride * capacity as u64) as usize];
        let default_bytes = PlanetUniforms::default();
        for slot in 0..capacity {
            let off = slot * stride as usize;
            instances[off..off + element_size as usize]
                .copy_from_slice(bytemuck::bytes_of(&default_bytes));
        }

        Self {
            instances,
            gpu_buffer,
            bind_group_layout,
            bind_group,
            slotmap: SlotMap::with_capacity(capacity),
            capacity,
            stride,
        }
    }

    /// Allocate a slot. Returns `None` when at capacity (the SoA Vec must
    /// not grow — TS-side typed-array views would detach silently).
    pub fn insert(&mut self) -> Option<Handle> {
        if self.slotmap.len() >= self.capacity {
            return None;
        }
        Some(self.slotmap.insert(()))
    }

    /// Free a slot. Generation bump invalidates stale handles.
    pub fn remove(&mut self, h: Handle) -> bool {
        self.slotmap.remove(h).is_some()
    }

    /// Byte offset into `gpu_buffer` for the given slot. Asserts the offset
    /// fits in `u32` (WebGPU's dynamic-offset slice type). With 256 capacity
    /// × 256 B stride = 65536 B, it always fits, but the assertion keeps
    /// future capacity bumps honest.
    pub fn offset_for(&self, slot: u32) -> u32 {
        let byte = slot as u64 * self.stride;
        assert!(
            byte <= u32::MAX as u64,
            "PlanetPool dynamic offset {byte} exceeds u32::MAX",
        );
        byte as u32
    }

    /// Upload current CPU instances to GPU.
    ///
    /// The CPU mirror shares the GPU buffer's exact stride-aligned layout,
    /// so a single bulk write covers every slot — no per-slot offset math
    /// and no per-active-slot write_buffer loop.
    pub fn upload(&self, ctx: &GpuContext) {
        ctx.queue.write_buffer(&self.gpu_buffer, 0, &self.instances);
    }

    /// Pointer to the stride-aligned CPU mirror, exposed via wasm so TS
    /// builds typed-array views for direct memory writes in the hot path
    /// (instance base = `slot * stride`). Backing Vec never reallocates
    /// (capacity fixed at construction), so the views stay valid.
    pub fn instances_ptr(&self) -> *const u8 {
        self.instances.as_ptr()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn stride(&self) -> u64 {
        self.stride
    }

    /// Number of currently allocated slots.
    pub fn len(&self) -> usize {
        self.slotmap.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slotmap.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin every offset that the WGSL std140 layout depends on. If anyone
    /// reorders, retypes, or pads `PlanetUniforms` we want the test to
    /// fail with a precise location, not a render glitch four layers down.
    #[test]
    fn planet_uniforms_layout() {
        // Total size + alignment.
        assert_eq!(std::mem::size_of::<PlanetUniforms>(), 192);
        // bytemuck::Pod allows any alignment; vec2/vec4 fields are [f32; N]
        // arrays which align to f32 (4). std140 rules are upheld by the
        // explicit field ORDER, not by Rust alignment — the WGSL side does
        // 16 B row alignment internally.
        assert_eq!(std::mem::align_of::<PlanetUniforms>(), 4);

        // Row offsets (each row starts on a 16 B boundary).
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_time), 0);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_light_origin), 16);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_light_border1), 32);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_planet_type), 48);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_stretch), 64);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_world_pos), 80);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_world_size), 88);
        assert_eq!(core::mem::offset_of!(PlanetUniforms, u_colors), 96);
    }

    #[test]
    fn default_is_zeroable_compatible() {
        // Default and Zeroed differ in values but both must be `Pod`-safe;
        // exercising the Default ctor catches drift if someone adds a
        // non-Pod field type without noticing.
        let d = PlanetUniforms::default();
        let bytes = bytemuck::bytes_of(&d);
        assert_eq!(bytes.len(), PLANET_UNIFORMS_SIZE);
    }
}
