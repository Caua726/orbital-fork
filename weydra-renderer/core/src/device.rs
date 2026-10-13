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
                required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
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

#[cfg(test)]
mod tests {
    use super::*;

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
