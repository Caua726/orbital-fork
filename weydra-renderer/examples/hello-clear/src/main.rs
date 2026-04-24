//! Native demo: opens a window and clears it to dark blue at 60 fps.
//! Validates the core wgpu pipeline end-to-end without the browser stack.

use std::sync::Arc;
use weydra_renderer::{render_clear, GpuContext, RenderSurface};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowAttributes, WindowId};

struct App {
    window: Option<Arc<dyn Window>>,
    ctx: Option<GpuContext>,
    surface: Option<RenderSurface<'static>>,
}

impl ApplicationHandler for App {
    fn can_create_surfaces(&mut self, event_loop: &dyn ActiveEventLoop) {
        let window: Arc<dyn Window> = Arc::from(
            event_loop
                .create_window(WindowAttributes::default().with_title("weydra hello-clear"))
                .expect("failed to create window"),
        );

        let ctx = pollster::block_on(GpuContext::new_headless()).expect("gpu init failed");

        let surface = ctx
            .instance
            .create_surface(window.clone())
            .expect("surface creation failed");
        let size = window.surface_size();
        let render_surface =
            RenderSurface::configure(&ctx, surface, size.width, size.height).expect("surface config");

        self.window = Some(window);
        self.surface = Some(render_surface);
        self.ctx = Some(ctx);
    }

    fn window_event(
        &mut self,
        event_loop: &dyn ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::SurfaceResized(size) => {
                if let (Some(ctx), Some(surface)) = (&self.ctx, self.surface.as_mut()) {
                    surface.resize(ctx, size.width, size.height);
                }
            }
            WindowEvent::RedrawRequested => {
                if let (Some(ctx), Some(surface), Some(window)) =
                    (&self.ctx, &self.surface, &self.window)
                {
                    if let Err(e) = render_clear(ctx, surface, [0.0, 0.05, 0.15, 1.0]) {
                        log::error!("render_clear failed: {e}");
                    }
                    window.request_redraw();
                }
            }
            _ => {}
        }
    }
}

fn main() {
    env_logger::init();
    let event_loop = EventLoop::new().expect("event loop");
    event_loop.set_control_flow(ControlFlow::Poll);
    let app = App {
        window: None,
        ctx: None,
        surface: None,
    };
    event_loop.run_app(app).expect("event loop run");
}
