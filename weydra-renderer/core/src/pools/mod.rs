//! Specialized GPU instance pools.
//!
//! Two patterns coexist here, picked per shader:
//!
//! - **Multi-instance with dynamic offset** (`PlanetPool`): one shared GPU
//!   buffer holds N instances; one shared bind group declared with
//!   `has_dynamic_offset: true`. Each draw indexes per-instance via
//!   `set_bind_group(group, &bg, &[offset_for(slot)])` — far cheaper than
//!   building N bind groups.
//!
//! - **Singleton** (`FogPool`): exactly one instance, drawn at most once
//!   per frame as a fullscreen pass. No dynamic offset
//!   (`has_dynamic_offset: false`); the bind group exposes the entire
//!   buffer via `as_entire_binding()`.

pub mod fog;
pub mod planet;

pub use fog::{FogPool, FogUniforms, VisionSource, FOG_MAX_SOURCES, FOG_UNIFORMS_SIZE};
pub use planet::{PlanetPool, PlanetUniforms, PLANET_UNIFORMS_SIZE};
