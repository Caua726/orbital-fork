use crate::error::{Result, WeydraError};

/// Handles to the wgpu GPU pipeline: Instance → Adapter → Device + Queue.
///
/// Device owns the GPU state; Queue submits commands. Both are cloned/shared
/// cheaply (Arc internally), but this wrapper is moved once and held by the
/// Renderer.
pub struct GpuContext {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl GpuContext {
    /// Initialize a headless GpuContext (no surface). Used for tests and
    /// for the warmup phase before binding to a canvas/window.
    pub async fn new_headless() -> Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        Self::from_instance(instance, None, wgpu::PowerPreference::HighPerformance).await
    }

    /// Initialize a GpuContext with a pre-created surface, so the adapter is
    /// chosen to be compatible with that surface. Used on wasm (canvas surface)
    /// and on winit examples. Defaults to `HighPerformance` — use
    /// `new_with_surface_pref` on battery-powered targets.
    pub async fn new_with_surface(
        instance: wgpu::Instance,
        compatible_surface: &wgpu::Surface<'_>,
    ) -> Result<Self> {
        Self::new_with_surface_pref(
            instance,
            compatible_surface,
            wgpu::PowerPreference::HighPerformance,
        )
        .await
    }

    /// Like `new_with_surface`, but lets the caller pick the adapter's
    /// `PowerPreference`. Mobile adapters should pass `LowPower` to favour
    /// the efficiency GPU / battery life.
    pub async fn new_with_surface_pref(
        instance: wgpu::Instance,
        compatible_surface: &wgpu::Surface<'_>,
        power_preference: wgpu::PowerPreference,
    ) -> Result<Self> {
        Self::from_instance(instance, Some(compatible_surface), power_preference).await
    }

    async fn from_instance(
        instance: wgpu::Instance,
        compatible_surface: Option<&wgpu::Surface<'_>>,
        power_preference: wgpu::PowerPreference,
    ) -> Result<Self> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference,
                compatible_surface,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|_| WeydraError::AdapterNotFound)?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("weydra device"),
                required_features: wgpu::Features::empty(),
                required_limits: requested_limits(&adapter.limits()),
                memory_hints: wgpu::MemoryHints::Performance,
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                trace: wgpu::Trace::Off,
            })
            .await?;

        Ok(Self {
            instance,
            adapter,
            device,
            queue,
        })
    }
}

/// Limits to request when creating the device.
///
/// [`wgpu::Limits::downlevel_webgl2_defaults`] keeps the renderer inside what
/// every backend can do (no storage buffers, small uniform blocks, …), but its
/// texture-dimension limits are 2048 px — smaller than a swap chain needs on a
/// 1440p/4K display or whenever `renderScale > 1` widens the canvas. wgpu
/// validates `Surface::configure` against the *requested* limits, so the canvas
/// would fail with `ConfigureSurfaceError::TooLarge` and panic the wasm module
/// (`wgpu` treats uncaptured validation errors as fatal) on a 2560×1440 screen.
///
/// The swap chain is the one resource allowed to be as large as the adapter
/// supports, so take the resolution limits from the adapter and keep everything
/// else downlevel. `using_resolution` touches only `max_texture_dimension_1d/2d/3d`.
fn requested_limits(adapter: &wgpu::Limits) -> wgpu::Limits {
    wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 2048 px resolution cap of `downlevel_webgl2_defaults` is smaller than
    /// a swap chain on a 1440p/4K display, and wgpu validates `Surface::configure`
    /// against the requested limits — so the requested resolution must come from
    /// the adapter or weydra cannot configure a canvas wider than 2048.
    #[test]
    fn requested_limits_take_resolution_from_adapter() {
        let adapter = wgpu::Limits {
            max_texture_dimension_1d: 16384,
            max_texture_dimension_2d: 16384,
            max_texture_dimension_3d: 2048,
            ..wgpu::Limits::default()
        };
        let limits = requested_limits(&adapter);

        assert_eq!(limits.max_texture_dimension_1d, 16384);
        assert_eq!(limits.max_texture_dimension_2d, 16384);
        assert_eq!(limits.max_texture_dimension_3d, 2048);

        // Everything else stays downlevel-WebGL2: storage buffers out, 16 KiB
        // uniform blocks, 256 B dynamic-offset alignment.
        let downlevel = wgpu::Limits::downlevel_webgl2_defaults();
        assert_eq!(limits.max_storage_buffers_per_shader_stage, 0);
        assert_eq!(limits.max_storage_textures_per_shader_stage, 0);
        assert_eq!(
            limits.max_uniform_buffer_binding_size,
            downlevel.max_uniform_buffer_binding_size
        );
        assert_eq!(
            limits.min_uniform_buffer_offset_alignment,
            downlevel.min_uniform_buffer_offset_alignment
        );
        assert_eq!(limits.max_vertex_buffers, downlevel.max_vertex_buffers);
    }

    #[test]
    fn creates_headless_context() {
        // CI without GPU may fail here — mark ignored in those envs.
        let result = pollster::block_on(GpuContext::new_headless());
        match result {
            Ok(_) => {}
            Err(WeydraError::AdapterNotFound) => {
                eprintln!("skipping: no GPU adapter available");
            }
            Err(e) => panic!("unexpected error: {e}"),
        }
    }
}
