use crate::camera::CameraUniforms;
use crate::device::GpuContext;

/// Engine-owned bind group 0, shared by all custom shaders.
/// Layout: uniform buffer at binding 0 = `CameraUniforms` struct.
pub struct EngineBindings {
    pub camera_buffer: wgpu::Buffer,
    pub layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
}

impl EngineBindings {
    pub fn new(ctx: &GpuContext) -> Self {
        let camera_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("weydra engine camera uniforms"),
            size: CameraUniforms::BYTE_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let layout = ctx
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("weydra engine bind group layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(CameraUniforms::BYTE_SIZE),
                    },
                    count: None,
                }],
            });

        let bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("weydra engine bind group"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buffer.as_entire_binding(),
            }],
        });

        Self {
            camera_buffer,
            layout,
            bind_group,
        }
    }

    /// Write camera uniforms to GPU. Call once per frame before any mesh draw.
    pub fn update(&self, ctx: &GpuContext, uniforms: &CameraUniforms) {
        ctx.queue
            .write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(uniforms));
    }
}
