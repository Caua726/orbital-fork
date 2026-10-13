use crate::device::GpuContext;
use crate::shader::{ShaderHandle, ShaderRegistry};

/// A full-screen quad mesh driven by a custom WGSL shader.
///
/// Used for backgrounds (starfield), procedural effects (planet surface),
/// and post-processing. The mesh itself is a shared virtual quad — the
/// vertex shader synthesizes 6 vertices from `@builtin(vertex_index)`, so
/// no vertex buffer is bound. Instances differ in their bind group 1
/// (which uniform slot they read).
pub struct Mesh {
    pub pipeline: wgpu::RenderPipeline,
    pub shader: ShaderHandle,
}

impl Mesh {
    #[allow(clippy::too_many_arguments)] // pipeline construction needs each GPU contract explicitly
    pub fn new(
        ctx: &GpuContext,
        registry: &ShaderRegistry,
        shader: ShaderHandle,
        surface_format: wgpu::TextureFormat,
        engine_bind_group_layout: &wgpu::BindGroupLayout,
        blend: wgpu::BlendState,
        custom_uniform_layout: Option<&wgpu::BindGroupLayout>,
        label: &str,
    ) -> Self {
        let shader_module = &registry.get(shader).expect("shader not found").module;

        // wgpu 29: bind_group_layouts is &[Option<&BindGroupLayout>].
        let mut layouts: Vec<Option<&wgpu::BindGroupLayout>> = vec![Some(engine_bind_group_layout)];
        if let Some(custom) = custom_uniform_layout {
            layouts.push(Some(custom));
        }

        let pipeline_layout_label = format!("{label} layout");
        let pipeline_layout = ctx
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(&pipeline_layout_label),
                bind_group_layouts: &layouts,
                immediate_size: 0,
            });

        let pipeline = ctx
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: shader_module,
                    entry_point: Some("vs_main"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: shader_module,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: surface_format,
                        // Caller picks REPLACE for opaque fullscreen quads
                        // (starfield) or PREMULTIPLIED_ALPHA_BLENDING for
                        // shaders whose fragments emit a transparent disc
                        // edge (planet) — REPLACE there would erase the
                        // background in the planet's bounding box.
                        blend: Some(blend),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleList,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });

        Self { pipeline, shader }
    }

    /// Record draw commands for this mesh into the given render pass.
    /// Engine bind group 0 must already be set by the caller.
    pub fn draw<'a>(
        &'a self,
        pass: &mut wgpu::RenderPass<'a>,
        custom_bind_group: Option<&'a wgpu::BindGroup>,
    ) {
        pass.set_pipeline(&self.pipeline);
        if let Some(bg) = custom_bind_group {
            pass.set_bind_group(1, bg, &[]);
        }
        // 2 triangles = 6 vertices; generated in vertex shader via @builtin(vertex_index).
        pass.draw(0..6, 0..1);
    }
}
