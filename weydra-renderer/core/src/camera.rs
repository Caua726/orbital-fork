use bytemuck::{Pod, Zeroable};

/// Engine-provided uniforms for bind group 0 — shared by every custom shader.
///
/// Layout: 32 bytes total, aligned to 16 bytes per wgpu rules.
///
/// Fields:
/// - `camera`: world-space center of the viewport
/// - `viewport`: width/height in world units
/// - `time`: seconds since world start (for animation)
/// - `_pad`: padding to maintain 16-byte alignment
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct CameraUniforms {
    pub camera: [f32; 2],
    pub viewport: [f32; 2],
    pub time: f32,
    pub(crate) _pad: [f32; 3],
}

impl Default for CameraUniforms {
    fn default() -> Self {
        Self {
            camera: [0.0, 0.0],
            viewport: [1.0, 1.0],
            time: 0.0,
            _pad: [0.0; 3],
        }
    }
}

impl CameraUniforms {
    /// Size in bytes as `wgpu::BufferAddress` — for use in buffer descriptors
    /// and bind group layout `min_binding_size`.
    pub const BYTE_SIZE: wgpu::BufferAddress = std::mem::size_of::<Self>() as wgpu::BufferAddress;

    /// Build a fresh instance. Padding is always zero — exists only to keep
    /// the struct at 32 bytes for the uniform buffer layout.
    pub fn new(camera: [f32; 2], viewport: [f32; 2], time: f32) -> Self {
        Self { camera, viewport, time, _pad: [0.0; 3] }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_uniforms_is_32_bytes() {
        assert_eq!(std::mem::size_of::<CameraUniforms>(), 32);
        assert_eq!(std::mem::align_of::<CameraUniforms>(), 4);
    }

    #[test]
    fn camera_uniforms_is_pod() {
        let c: CameraUniforms = bytemuck::Zeroable::zeroed();
        let bytes = bytemuck::bytes_of(&c);
        assert_eq!(bytes.len(), 32);
        assert!(bytes.iter().all(|&b| b == 0));
    }
}
