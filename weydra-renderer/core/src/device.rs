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

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
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

        Ok(Self { instance, adapter, device, queue })
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
