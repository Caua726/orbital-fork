use crate::device::GpuContext;
use std::marker::PhantomData;

/// Generic homogeneous pool of uniforms for one specific shader type.
///
/// Each shader with custom uniforms gets its own `UniformPool<MyUniforms>`.
/// The CPU-side `Vec<T>` is mirrored to a wgpu Buffer that shader instances
/// read via bind group 1. A pointer to the Vec is exposed (via wasm adapter)
/// so TS can construct a typed array view for direct memory writes in the
/// hot path — setter ops bypass the wasm-bindgen call boundary.
pub struct UniformPool<T: bytemuck::Pod + bytemuck::Zeroable> {
    pub instances: Vec<T>,
    pub gpu_buffer: wgpu::Buffer,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
    capacity: usize,
    _phantom: PhantomData<T>,
}

impl<T: bytemuck::Pod + bytemuck::Zeroable> UniformPool<T> {
    pub fn new(ctx: &GpuContext, label: &str, capacity: usize) -> Self {
        assert!(capacity > 0, "UniformPool capacity must be > 0");
        let element_size = std::mem::size_of::<T>() as u64;
        let byte_size = element_size * capacity as u64;

        let gpu_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: byte_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let layout_label = format!("{label} layout");
        let bind_group_layout =
            ctx.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some(&layout_label),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: wgpu::BufferSize::new(element_size),
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

        let mut instances = Vec::with_capacity(capacity);
        instances.resize(capacity, T::zeroed());

        Self {
            instances,
            gpu_buffer,
            bind_group_layout,
            bind_group,
            capacity,
            _phantom: PhantomData,
        }
    }

    /// Upload current CPU instances to GPU. Call once per frame before draw.
    pub fn upload(&self, ctx: &GpuContext) {
        ctx.queue
            .write_buffer(&self.gpu_buffer, 0, bytemuck::cast_slice(&self.instances));
    }

    /// Pointer to the contiguous instances Vec, exposed via wasm so TS can
    /// construct a typed array view for direct memory writes.
    pub fn instances_ptr(&self) -> *const T {
        self.instances.as_ptr()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}
