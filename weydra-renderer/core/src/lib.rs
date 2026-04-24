//! weydra-renderer — 2D GPU renderer using wgpu.

pub mod device;
pub mod error;

pub use device::GpuContext;
pub use error::{Result, WeydraError};
