//! weydra-renderer — 2D GPU renderer using wgpu
//!
//! This crate is the core of the weydra-renderer project. It knows nothing
//! about browsers, WASM, or TypeScript — just wgpu + Rust. Adapters in
//! sibling crates (wasm, winit) bridge to specific runtimes.

pub fn hello() -> &'static str {
    "weydra-renderer core loaded"
}
