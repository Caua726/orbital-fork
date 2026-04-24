//! weydra-renderer — 2D GPU renderer using wgpu.
//!
//! **Platform-agnostic invariant (enforced by M1.5):**
//! This crate MUST NOT depend on:
//!   - `web-sys`, `js-sys`, `wasm-bindgen`, `wasm-bindgen-futures` (browser-only)
//!   - `winit` (desktop windowing — lives in adapters/native)
//!   - `android-activity`, `jni` (Android — lives in adapters/android)
//!   - Any `std::fs`, `std::net`, `std::process` usage (not available in WASM)
//!
//! Adapters (`adapters/wasm`, `adapters/native`, `adapters/android`, `adapters/ios`)
//! handle all platform-specific glue. Core sees only wgpu handles.

pub mod bind_groups;
pub mod camera;
pub mod device;
pub mod error;
pub mod frame;
pub mod mesh;
pub mod shader;
pub mod slotmap;
pub mod surface;
pub mod uniform_pool;

pub use bind_groups::EngineBindings;
pub use camera::CameraUniforms;
pub use device::GpuContext;
pub use error::{Result, WeydraError};
pub use frame::render_clear;
pub use mesh::Mesh;
pub use shader::{ShaderHandle, ShaderRegistry};
pub use slotmap::{Handle, SlotMap};
pub use surface::RenderSurface;
pub use uniform_pool::UniformPool;
