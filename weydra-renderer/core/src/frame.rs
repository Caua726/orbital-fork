use crate::device::GpuContext;
use crate::error::Result;
use crate::surface::RenderSurface;

/// One frame of rendering: acquire surface texture, record a render pass
/// that clears to the given color, submit, present.
///
/// For M1 this is all we do — no sprite drawing, no shaders, just clear.
/// Later milestones will extend the render pass to batch sprites, draw
/// graphics, and dispatch custom meshes.
pub fn render_clear(
    ctx: &GpuContext,
    target: &mut RenderSurface,
    clear_color: [f64; 4],
) -> Result<()> {
    let frame = match target.acquire_next_texture(ctx)? {
        Some(t) => t,
        None => return Ok(()),
    };
    let view = frame
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());

    let mut encoder = ctx
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("weydra clear encoder"),
        });

    {
        let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("weydra clear pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: clear_color[0],
                        g: clear_color[1],
                        b: clear_color[2],
                        a: clear_color[3],
                    }),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
            multiview_mask: None,
        });
    }

    ctx.queue.submit(Some(encoder.finish()));
    frame.present();

    Ok(())
}
