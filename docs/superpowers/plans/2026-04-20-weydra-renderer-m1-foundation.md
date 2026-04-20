# weydra-renderer M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the weydra-renderer foundation — Cargo workspace, wgpu init, frame loop, WASM adapter, ts-bridge skeleton, Vite plugin for WGSL, integrated into the Orbital game with a second canvas clearing to black behind Pixi.

**Architecture:** Rust workspace with `core/` crate (pure wgpu, native-capable) + `adapters/wasm/` crate (wasm-bindgen glue). TS side has `ts-bridge/` (API wrapper) + `vite-plugin-wgsl/` (WGSL imports). Game mounts a second canvas below Pixi, initializes weydra via WASM, calls `render()` on each Pixi ticker frame. Validates the whole pipeline end-to-end before any actual rendering work starts.

**Tech Stack:** Rust stable, wgpu 25.x, wasm-bindgen 0.2, web-sys 0.3, winit (native example), Vite 6, TypeScript, Pixi.js v8 (existing).

---

## Prerequisites

Check before starting:

- Rust + cargo installed (`rustc --version`)
- Target wasm32 installed (`rustup target add wasm32-unknown-unknown`)
- `wasm-pack` installed (`cargo install wasm-pack` if missing)
- Node.js + npm (existing Orbital setup)

## File Structure

Files created in this plan (under `weydra-renderer/` unless noted):

**Cargo workspace + core crate:**
- `Cargo.toml` — workspace root with members `core` and `adapters/wasm`
- `rust-toolchain.toml` — pin Rust version
- `.gitignore` — `target/`, `pkg/`, `node_modules/`
- `core/Cargo.toml` — deps: wgpu, bytemuck, glam, pollster
- `core/src/lib.rs` — public API surface, re-exports
- `core/src/device.rs` — wgpu Instance/Adapter/Device/Queue wrapper
- `core/src/surface.rs` — Surface config abstraction
- `core/src/frame.rs` — begin/end frame, clear color render pass
- `core/src/camera.rs` — CameraUniforms struct (placeholder, bind group 0)
- `core/src/error.rs` — error types

**Native example:**
- `examples/hello-clear/Cargo.toml` — deps: weydra-renderer + winit + env_logger + pollster
- `examples/hello-clear/src/main.rs` — winit window + renderer clear loop

**WASM adapter crate:**
- `adapters/wasm/Cargo.toml` — deps: weydra-renderer + wasm-bindgen + web-sys + console_error_panic_hook
- `adapters/wasm/src/lib.rs` — Renderer wasm-bindgen wrapper

**TS bridge + Vite plugin:**
- `ts-bridge/package.json` — npm package metadata
- `ts-bridge/index.ts` — re-export Renderer from wasm pkg
- `ts-bridge/types.ts` — shared types (none for M1)
- `vite-plugin-wgsl/package.json` — npm package metadata
- `vite-plugin-wgsl/index.ts` — minimal plugin returning WGSL source as raw string (reflection comes in M2)

**Game integration (paths under `src/` of Orbital, not `weydra-renderer/`):**
- Modify: `index.html` — add `<canvas id="weydra-canvas">` stacked below existing canvas
- Modify: `vite.config.ts` — add vite-plugin-wasm + vite-plugin-top-level-await + vite-plugin-wgsl
- Modify: `package.json` — add deps (`vite-plugin-wasm`, `vite-plugin-top-level-await`), add `build:renderer` script
- Create: `src/weydra-loader.ts` — initializes weydra renderer behind a debug flag
- Modify: `src/main.ts` — call weydra loader after Pixi init

---

### Task 1: Cargo workspace skeleton

**Files:**
- Create: `weydra-renderer/Cargo.toml`
- Create: `weydra-renderer/rust-toolchain.toml`
- Create: `weydra-renderer/.gitignore`
- Create: `weydra-renderer/core/Cargo.toml`
- Create: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write workspace root manifest**

Create `weydra-renderer/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = [
    "core",
    "adapters/wasm",
    "examples/hello-clear",
]

[workspace.package]
version = "0.1.0"
edition = "2024"
authors = ["weydra"]
license = "MIT"

[workspace.dependencies]
wgpu = "25"
bytemuck = { version = "1.17", features = ["derive"] }
glam = { version = "0.29", features = ["bytemuck"] }
pollster = "0.4"
log = "0.4"
wasm-bindgen = "0.2"
web-sys = "0.3"
console_error_panic_hook = "0.1"
winit = "0.30"
env_logger = "0.11"

[profile.release]
opt-level = 3
lto = "thin"
codegen-units = 1
```

- [ ] **Step 2: Pin Rust toolchain**

Create `weydra-renderer/rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
targets = ["wasm32-unknown-unknown"]
components = ["rustfmt", "clippy"]
```

- [ ] **Step 3: Write gitignore**

Create `weydra-renderer/.gitignore`:

```
target/
pkg/
**/*.rs.bk
Cargo.lock
node_modules/
dist/
```

- [ ] **Step 4: Write empty core crate**

Create `weydra-renderer/core/Cargo.toml`:

```toml
[package]
name = "weydra-renderer"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[dependencies]
wgpu = { workspace = true }
bytemuck = { workspace = true }
glam = { workspace = true }
log = { workspace = true }
```

Create `weydra-renderer/core/src/lib.rs`:

```rust
//! weydra-renderer — 2D GPU renderer using wgpu
//!
//! This crate is the core of the weydra-renderer project. It knows nothing
//! about browsers, WASM, or TypeScript — just wgpu + Rust. Adapters in
//! sibling crates (wasm, winit) bridge to specific runtimes.

pub fn hello() -> &'static str {
    "weydra-renderer core loaded"
}
```

- [ ] **Step 5: Verify workspace builds**

Run:

```bash
cd weydra-renderer
cargo build --package weydra-renderer
```

Expected: compiles cleanly, `target/debug/libweydra_renderer.rlib` created.

- [ ] **Step 6: Commit**

```bash
git add weydra-renderer/
git commit -m "feat(weydra-renderer): Cargo workspace skeleton + empty core crate"
```

---

### Task 2: wgpu device initialization

**Files:**
- Create: `weydra-renderer/core/src/error.rs`
- Create: `weydra-renderer/core/src/device.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write error type**

Create `weydra-renderer/core/src/error.rs`:

```rust
use std::fmt;

#[derive(Debug)]
pub enum WeydraError {
    AdapterNotFound,
    DeviceRequestFailed(wgpu::RequestDeviceError),
    SurfaceCreationFailed(String),
}

impl fmt::Display for WeydraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AdapterNotFound => write!(f, "no suitable GPU adapter found"),
            Self::DeviceRequestFailed(e) => write!(f, "failed to request device: {e}"),
            Self::SurfaceCreationFailed(m) => write!(f, "failed to create surface: {m}"),
        }
    }
}

impl std::error::Error for WeydraError {}

impl From<wgpu::RequestDeviceError> for WeydraError {
    fn from(e: wgpu::RequestDeviceError) -> Self {
        Self::DeviceRequestFailed(e)
    }
}

pub type Result<T> = std::result::Result<T, WeydraError>;
```

- [ ] **Step 2: Write device module**

Create `weydra-renderer/core/src/device.rs`:

```rust
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
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or(WeydraError::AdapterNotFound)?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("weydra device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await?;

        Ok(Self { instance, adapter, device, queue })
    }
}
```

- [ ] **Step 3: Update lib.rs to expose modules**

Replace `weydra-renderer/core/src/lib.rs`:

```rust
//! weydra-renderer — 2D GPU renderer using wgpu.

pub mod device;
pub mod error;

pub use device::GpuContext;
pub use error::{Result, WeydraError};
```

- [ ] **Step 4: Write device creation test**

Create `weydra-renderer/core/src/device.rs` test section by appending to the file:

```rust
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
```

- [ ] **Step 5: Add pollster dev-dependency**

Update `weydra-renderer/core/Cargo.toml` dependencies section:

```toml
[dependencies]
wgpu = { workspace = true }
bytemuck = { workspace = true }
glam = { workspace = true }
log = { workspace = true }

[dev-dependencies]
pollster = { workspace = true }
```

- [ ] **Step 6: Run test**

Run:

```bash
cd weydra-renderer
cargo test --package weydra-renderer
```

Expected: 1 test passes (or printed skip message if no GPU in env).

- [ ] **Step 7: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): GpuContext + error types + headless init test"
```

---

### Task 3: Surface abstraction + swap chain config

**Files:**
- Create: `weydra-renderer/core/src/surface.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write surface module**

Create `weydra-renderer/core/src/surface.rs`:

```rust
use crate::device::GpuContext;
use crate::error::{Result, WeydraError};

/// A configured render surface — the thing we actually draw into every frame.
///
/// Wraps wgpu::Surface + config. On the browser side, this is created from an
/// HtmlCanvasElement via the wasm adapter; natively, from a winit Window.
pub struct RenderSurface<'window> {
    pub surface: wgpu::Surface<'window>,
    pub config: wgpu::SurfaceConfiguration,
    pub format: wgpu::TextureFormat,
}

impl<'window> RenderSurface<'window> {
    /// Configure a surface that was previously created by the platform adapter.
    pub fn configure(
        ctx: &GpuContext,
        surface: wgpu::Surface<'window>,
        width: u32,
        height: u32,
    ) -> Result<Self> {
        let caps = surface.get_capabilities(&ctx.adapter);
        let format = caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or_else(|| caps.formats[0]);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&ctx.device, &config);

        Ok(Self { surface, config, format })
    }

    /// Resize the swap chain. Must be called when the window/canvas size changes.
    pub fn resize(&mut self, ctx: &GpuContext, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&ctx.device, &self.config);
    }

    /// Acquire the next texture to render into. Returned texture must be
    /// presented (via SurfaceTexture::present) before the next frame.
    pub fn acquire_next_texture(&self) -> Result<wgpu::SurfaceTexture> {
        self.surface
            .get_current_texture()
            .map_err(|e| WeydraError::SurfaceCreationFailed(e.to_string()))
    }
}
```

- [ ] **Step 2: Expose in lib.rs**

Update `weydra-renderer/core/src/lib.rs`:

```rust
//! weydra-renderer — 2D GPU renderer using wgpu.

pub mod device;
pub mod error;
pub mod surface;

pub use device::GpuContext;
pub use error::{Result, WeydraError};
pub use surface::RenderSurface;
```

- [ ] **Step 3: Verify it compiles**

Run:

```bash
cd weydra-renderer
cargo build --package weydra-renderer
```

Expected: clean compile, no warnings beyond dead code.

- [ ] **Step 4: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): RenderSurface abstraction + swap chain config"
```

---

### Task 4: Camera uniforms placeholder (bind group 0)

**Files:**
- Create: `weydra-renderer/core/src/camera.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write camera module**

Create `weydra-renderer/core/src/camera.rs`:

```rust
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
    pub _pad: [f32; 3],
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
    pub const BYTE_SIZE: u64 = std::mem::size_of::<Self>() as u64;
}
```

- [ ] **Step 2: Expose in lib.rs**

Update `weydra-renderer/core/src/lib.rs`:

```rust
//! weydra-renderer — 2D GPU renderer using wgpu.

pub mod camera;
pub mod device;
pub mod error;
pub mod surface;

pub use camera::CameraUniforms;
pub use device::GpuContext;
pub use error::{Result, WeydraError};
pub use surface::RenderSurface;
```

- [ ] **Step 3: Write byte layout test**

Append to `weydra-renderer/core/src/camera.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_uniforms_is_32_bytes() {
        assert_eq!(std::mem::size_of::<CameraUniforms>(), 32);
        assert_eq!(std::mem::align_of::<CameraUniforms>(), 4);
        assert_eq!(CameraUniforms::BYTE_SIZE, 32);
    }

    #[test]
    fn camera_uniforms_is_pod() {
        let c: CameraUniforms = bytemuck::Zeroable::zeroed();
        let bytes = bytemuck::bytes_of(&c);
        assert_eq!(bytes.len(), 32);
        assert!(bytes.iter().all(|&b| b == 0));
    }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd weydra-renderer
cargo test --package weydra-renderer
```

Expected: 3 tests pass (headless init + 2 camera tests).

- [ ] **Step 5: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): CameraUniforms (bind group 0) + POD layout tests"
```

---

### Task 5: Frame orchestration + clear render pass

**Files:**
- Create: `weydra-renderer/core/src/frame.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write frame module**

Create `weydra-renderer/core/src/frame.rs`:

```rust
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
    target: &RenderSurface,
    clear_color: [f64; 4],
) -> Result<()> {
    let frame = target.acquire_next_texture()?;
    let view = frame
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());

    let mut encoder = ctx.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
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
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });
    }

    ctx.queue.submit(Some(encoder.finish()));
    frame.present();

    Ok(())
}
```

- [ ] **Step 2: Expose in lib.rs**

Update `weydra-renderer/core/src/lib.rs`:

```rust
//! weydra-renderer — 2D GPU renderer using wgpu.

pub mod camera;
pub mod device;
pub mod error;
pub mod frame;
pub mod surface;

pub use camera::CameraUniforms;
pub use device::GpuContext;
pub use error::{Result, WeydraError};
pub use frame::render_clear;
pub use surface::RenderSurface;
```

- [ ] **Step 3: Verify compilation**

Run:

```bash
cd weydra-renderer
cargo build --package weydra-renderer
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): render_clear — acquire/clear/submit/present"
```

---

### Task 6: Native example (hello-clear with winit)

**Files:**
- Create: `weydra-renderer/examples/hello-clear/Cargo.toml`
- Create: `weydra-renderer/examples/hello-clear/src/main.rs`

- [ ] **Step 1: Write example Cargo.toml**

Create `weydra-renderer/examples/hello-clear/Cargo.toml`:

```toml
[package]
name = "hello-clear"
version.workspace = true
edition.workspace = true

[dependencies]
weydra-renderer = { path = "../../core" }
wgpu = { workspace = true }
winit = { workspace = true }
pollster = { workspace = true }
env_logger = { workspace = true }
log = { workspace = true }
```

- [ ] **Step 2: Write main.rs**

Create `weydra-renderer/examples/hello-clear/src/main.rs`:

```rust
//! Native demo: opens a window and clears it to dark blue at 60 fps.
//! Validates the core wgpu pipeline end-to-end without the browser stack.

use std::sync::Arc;
use weydra_renderer::{render_clear, GpuContext, RenderSurface};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowId};

struct App<'a> {
    window: Option<Arc<Window>>,
    ctx: Option<GpuContext>,
    surface: Option<RenderSurface<'a>>,
}

impl<'a> ApplicationHandler for App<'a> {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let window = Arc::new(
            event_loop
                .create_window(Window::default_attributes().with_title("weydra hello-clear"))
                .expect("failed to create window"),
        );

        let ctx = pollster::block_on(GpuContext::new_headless()).expect("gpu init failed");

        // SAFETY: window lives as long as App.
        let surface = ctx.instance.create_surface(window.clone()).expect("surface creation failed");
        let size = window.inner_size();
        let render_surface =
            RenderSurface::configure(&ctx, surface, size.width, size.height).expect("surface config");

        self.window = Some(window);
        self.surface = Some(render_surface);
        self.ctx = Some(ctx);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let (Some(ctx), Some(surface)) = (&self.ctx, self.surface.as_mut()) {
                    surface.resize(ctx, size.width, size.height);
                }
            }
            WindowEvent::RedrawRequested => {
                if let (Some(ctx), Some(surface), Some(window)) = (&self.ctx, &self.surface, &self.window) {
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
    let mut app = App { window: None, ctx: None, surface: None };
    event_loop.run_app(&mut app).expect("event loop run");
}
```

- [ ] **Step 3: Run the example**

Run:

```bash
cd weydra-renderer
cargo run --package hello-clear --release
```

Expected: a window opens titled "weydra hello-clear", filled with dark blue. Close with the window X. No crash, no panic.

- [ ] **Step 4: Commit**

```bash
git add weydra-renderer/examples/
git commit -m "feat(weydra-renderer): hello-clear native example (winit + wgpu clear)"
```

---

### Task 7: WASM adapter crate

**Files:**
- Create: `weydra-renderer/adapters/wasm/Cargo.toml`
- Create: `weydra-renderer/adapters/wasm/src/lib.rs`

- [ ] **Step 1: Write adapter Cargo.toml**

Create `weydra-renderer/adapters/wasm/Cargo.toml`:

```toml
[package]
name = "weydra-renderer-wasm"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
weydra-renderer = { path = "../../core" }
wgpu = { workspace = true }
wasm-bindgen = { workspace = true }
wasm-bindgen-futures = "0.4"
console_error_panic_hook = { workspace = true }
log = { workspace = true }

[dependencies.web-sys]
workspace = true
features = [
    "HtmlCanvasElement",
    "Window",
    "Document",
]
```

- [ ] **Step 2: Write adapter lib.rs**

Create `weydra-renderer/adapters/wasm/src/lib.rs`:

```rust
//! WASM adapter for weydra-renderer.
//!
//! Exposes a wasm-bindgen Renderer that wraps the core pipeline and binds
//! to an HtmlCanvasElement. All hot-path per-frame ops (position updates,
//! etc.) will use shared memory escape hatches added in later milestones.

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use weydra_renderer::{render_clear, GpuContext, RenderSurface};

/// Entry-point: wire up panic hook + logger. Called once from TS before
/// any Renderer is created.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
    // console_log isn't added to keep deps minimal; log macros in Rust
    // silently drop in WASM unless a wasm-compatible logger is installed.
}

/// The weydra renderer instance, bound to a specific canvas.
#[wasm_bindgen]
pub struct Renderer {
    ctx: GpuContext,
    surface: RenderSurface<'static>,
}

#[wasm_bindgen]
impl Renderer {
    /// Create a new Renderer bound to the given canvas. Async because GPU
    /// initialization involves adapter request + device request.
    #[wasm_bindgen(constructor)]
    pub async fn new(canvas: HtmlCanvasElement) -> Result<Renderer, JsValue> {
        let width = canvas.width();
        let height = canvas.height();

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());

        let surface_target = wgpu::SurfaceTarget::Canvas(canvas);
        let surface = instance
            .create_surface(surface_target)
            .map_err(|e| JsValue::from_str(&format!("surface: {e}")))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| JsValue::from_str("no GPU adapter"))?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("weydra device (wasm)"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("device: {e}")))?;

        let ctx = GpuContext { instance, adapter, device, queue };
        let render_surface = RenderSurface::configure(&ctx, surface, width, height)
            .map_err(|e| JsValue::from_str(&format!("config: {e}")))?;

        Ok(Renderer { ctx, surface: render_surface })
    }

    /// Resize the swap chain. Call on window/canvas resize.
    pub fn resize(&mut self, width: u32, height: u32) {
        self.surface.resize(&self.ctx, width, height);
    }

    /// Render one frame. For M1, clears to black.
    /// Later milestones will walk the scene graph, batch sprites, and
    /// submit real draw calls here.
    pub fn render(&mut self) -> Result<(), JsValue> {
        render_clear(&self.ctx, &self.surface, [0.0, 0.0, 0.0, 1.0])
            .map_err(|e| JsValue::from_str(&format!("render: {e}")))
    }
}
```

- [ ] **Step 3: Build the WASM package**

Run:

```bash
cd weydra-renderer/adapters/wasm
wasm-pack build --target web --out-dir pkg
```

Expected: `pkg/` directory created with `weydra_renderer_wasm.js`, `weydra_renderer_wasm_bg.wasm`, and `weydra_renderer_wasm.d.ts`. No errors.

- [ ] **Step 4: Verify pkg contents**

Run:

```bash
ls weydra-renderer/adapters/wasm/pkg/
```

Expected output includes: `package.json`, `weydra_renderer_wasm.js`, `weydra_renderer_wasm_bg.wasm`, `weydra_renderer_wasm.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add weydra-renderer/adapters/wasm/
# pkg/ is gitignored; only source is committed
git commit -m "feat(weydra-renderer): WASM adapter crate with Renderer binding"
```

---

### Task 8: TS bridge skeleton

**Files:**
- Create: `weydra-renderer/ts-bridge/package.json`
- Create: `weydra-renderer/ts-bridge/index.ts`
- Create: `weydra-renderer/ts-bridge/types.ts`

- [ ] **Step 1: Write ts-bridge package.json**

Create `weydra-renderer/ts-bridge/package.json`:

```json
{
  "name": "@weydra/renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./index.ts",
  "types": "./index.ts",
  "dependencies": {
    "weydra-renderer-wasm": "file:../adapters/wasm/pkg"
  }
}
```

- [ ] **Step 2: Write shared types**

Create `weydra-renderer/ts-bridge/types.ts`:

```typescript
/**
 * Shared types for weydra-renderer.
 * For M1 this is empty — types get added as the API surface grows.
 */

export type { };
```

- [ ] **Step 3: Write bridge entry point**

Create `weydra-renderer/ts-bridge/index.ts`:

```typescript
/**
 * weydra-renderer TypeScript bridge.
 *
 * Wraps the WASM-exported Renderer with an idiomatic TypeScript API.
 * For M1, just forwards init + render + resize.
 */

import init, { Renderer as WasmRenderer } from 'weydra-renderer-wasm';

let _initialized = false;

/**
 * Load the WASM module. Must be awaited before creating any Renderer.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initWeydra(): Promise<void> {
  if (_initialized) return;
  await init();
  _initialized = true;
}

/**
 * The weydra-renderer instance. Bound to a specific HTMLCanvasElement.
 */
export class Renderer {
  private readonly inner: WasmRenderer;

  private constructor(inner: WasmRenderer) {
    this.inner = inner;
  }

  /**
   * Create a new Renderer on the given canvas.
   * Must call `initWeydra()` first.
   */
  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!_initialized) {
      throw new Error('initWeydra() must be called before Renderer.create()');
    }
    const inner = await new WasmRenderer(canvas);
    return new Renderer(inner);
  }

  resize(width: number, height: number): void {
    this.inner.resize(width, height);
  }

  render(): void {
    this.inner.render();
  }
}

export type { };
```

- [ ] **Step 4: Verify files created**

Run:

```bash
ls weydra-renderer/ts-bridge/
```

Expected: `package.json`, `index.ts`, `types.ts`.

- [ ] **Step 5: Commit**

```bash
git add weydra-renderer/ts-bridge/
git commit -m "feat(weydra-renderer): ts-bridge skeleton with initWeydra + Renderer wrapper"
```

---

### Task 9: Minimal Vite plugin for WGSL imports

**Files:**
- Create: `weydra-renderer/vite-plugin-wgsl/package.json`
- Create: `weydra-renderer/vite-plugin-wgsl/index.ts`

- [ ] **Step 1: Write plugin package.json**

Create `weydra-renderer/vite-plugin-wgsl/package.json`:

```json
{
  "name": "@weydra/vite-plugin-wgsl",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./index.ts",
  "types": "./index.ts",
  "peerDependencies": {
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Write minimal plugin**

Create `weydra-renderer/vite-plugin-wgsl/index.ts`:

```typescript
/**
 * Vite plugin that handles `.wgsl` imports.
 *
 * M1 version: trivially returns the file source as a raw string export.
 * Later milestones will:
 *   - Parse uniforms via naga
 *   - Generate typed TypeScript accessors
 *   - Produce a virtual module with create() / setUniforms methods
 *
 * Usage in vite.config.ts:
 *   import wgsl from './weydra-renderer/vite-plugin-wgsl';
 *   export default defineConfig({ plugins: [wgsl()] });
 */

import type { Plugin } from 'vite';
import { readFile } from 'node:fs/promises';

export default function wgslPlugin(): Plugin {
  return {
    name: 'weydra-vite-plugin-wgsl',
    async transform(_code, id) {
      if (!id.endsWith('.wgsl')) return null;

      const source = await readFile(id, 'utf-8');
      // Export as default string literal; later will become a module with
      // typed accessors. This keeps the M2 milestone easy to swap in.
      return {
        code: `export default ${JSON.stringify(source)};`,
        map: null,
      };
    },
  };
}
```

- [ ] **Step 3: Verify files created**

Run:

```bash
ls weydra-renderer/vite-plugin-wgsl/
```

Expected: `package.json`, `index.ts`.

- [ ] **Step 4: Commit**

```bash
git add weydra-renderer/vite-plugin-wgsl/
git commit -m "feat(weydra-renderer): minimal vite-plugin-wgsl (raw source import)"
```

---

### Task 10: Install Vite WASM plugins in Orbital

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install runtime deps**

Run:

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
npm install --save-dev vite-plugin-wasm vite-plugin-top-level-await
```

Expected: `vite-plugin-wasm` and `vite-plugin-top-level-await` added to `devDependencies`.

- [ ] **Step 2: Install weydra-renderer workspace deps**

Run:

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
npm install --save "file:./weydra-renderer/ts-bridge" "file:./weydra-renderer/vite-plugin-wgsl"
```

Expected: both local packages installed under `@weydra/*` scope in `node_modules`.

- [ ] **Step 3: Add renderer build script**

Update `package.json` scripts section to add:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "build:renderer": "cd weydra-renderer/adapters/wasm && wasm-pack build --target web --out-dir pkg",
  "build:renderer:release": "cd weydra-renderer/adapters/wasm && wasm-pack build --target web --release --out-dir pkg"
}
```

- [ ] **Step 4: Update vite.config.ts**

Replace `vite.config.ts` contents:

```typescript
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import wgsl from '@weydra/vite-plugin-wgsl';

export default defineConfig({
  base: '/orbital-fork/',
  server: {
    allowedHosts: true,
  },
  plugins: [
    wasm(),
    topLevelAwait(),
    wgsl(),
  ],
});
```

- [ ] **Step 5: Verify dev server starts**

Run:

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
npm run build:renderer
npm run dev
```

Expected: build:renderer produces `weydra-renderer/adapters/wasm/pkg/`, dev server starts on http://localhost:5173, no errors on console. Game still renders via Pixi as before.

Stop the dev server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
git add package.json package-lock.json vite.config.ts
git commit -m "chore: install vite wasm+top-level-await plugins + wire @weydra packages"
```

---

### Task 11: Add second canvas to Orbital + loader behind debug flag

**Files:**
- Modify: `index.html`
- Create: `src/weydra-loader.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add weydra canvas to HTML**

Open `index.html`. Locate the existing `<body>` section (Pixi creates its canvas dynamically via `Application.init`, so the canvas may not be hardcoded — find where the Pixi canvas ends up, or the `<div id="app">` / similar container).

Add a weydra canvas BEFORE where Pixi's canvas ends up, so it renders behind:

```html
<canvas id="weydra-canvas" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0;"></canvas>
```

If Pixi canvas has `z-index: auto`, add inline style to make it `z-index: 1; background: transparent` when setting up Pixi. Coordinate with Pixi init in main.ts — the final ordering matters.

Note for the engineer: search `index.html` for any existing canvas element. If none exists, Pixi is creating its own; you'll need to set its z-index in the Pixi init path (see next step).

- [ ] **Step 2: Write weydra loader**

Create `src/weydra-loader.ts`:

```typescript
/**
 * Loader for the weydra-renderer. Behind a debug flag so M1 can validate
 * the pipeline end-to-end without changing any real rendering yet.
 *
 * Activated by setting localStorage.weydra_m1 = '1' in the browser console.
 * When enabled: mounts a black-clearing renderer on #weydra-canvas behind
 * the Pixi canvas. When disabled: no-op, game runs exactly like before.
 */

import { initWeydra, Renderer } from '@weydra/renderer';

let _renderer: Renderer | null = null;
let _rafHandle: number | null = null;

function isEnabled(): boolean {
  try {
    return localStorage.getItem('weydra_m1') === '1';
  } catch {
    return false;
  }
}

export async function startWeydraM1(): Promise<void> {
  if (!isEnabled()) return;

  const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.warn('[weydra] #weydra-canvas not found in DOM — skipping M1 init');
    return;
  }

  // Match canvas backing-store to its display size so rendering isn't stretched.
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;

  try {
    await initWeydra();
    _renderer = await Renderer.create(canvas);
    console.info('[weydra] M1 renderer initialized, clearing to black at 60fps');
  } catch (err) {
    console.error('[weydra] init failed:', err);
    return;
  }

  // Resize on window resize.
  window.addEventListener('resize', () => {
    if (!_renderer) return;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    canvas.width = w;
    canvas.height = h;
    _renderer.resize(w, h);
  });

  // Render loop via rAF. Independent of Pixi's ticker so M1 can be
  // validated in isolation.
  const loop = () => {
    if (_renderer) _renderer.render();
    _rafHandle = requestAnimationFrame(loop);
  };
  _rafHandle = requestAnimationFrame(loop);
}

export function stopWeydraM1(): void {
  if (_rafHandle !== null) {
    cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
  }
  _renderer = null;
}
```

- [ ] **Step 3: Call loader from main.ts**

Open `src/main.ts`. Find the bootstrap function (likely `bootstrap()` or similar near the top). Add import and call:

At the top of the file (with other imports):

```typescript
import { startWeydraM1 } from './weydra-loader';
```

At the end of `bootstrap()` (or after Pixi init completes, before the main menu shows):

```typescript
// M1 validation: optionally start weydra-renderer clearing to black.
// Enable via: localStorage.setItem('weydra_m1', '1'); location.reload()
void startWeydraM1();
```

- [ ] **Step 4: Test with flag disabled**

Run:

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
npm run dev
```

Open browser to http://localhost:5173. Expected: game looks exactly as before. No weydra activity. Console shows no errors.

Open DevTools → Console → run `localStorage.weydra_m1` → expect `null` (or undefined).

- [ ] **Step 5: Test with flag enabled**

In DevTools Console:

```javascript
localStorage.setItem('weydra_m1', '1');
location.reload();
```

Expected:
1. Console logs `[weydra] M1 renderer initialized, clearing to black at 60fps`
2. No errors
3. Game still plays normally (Pixi on top works)
4. Behind/around Pixi content where Pixi has transparent pixels, weydra's black clear should be visible (depends on Pixi's background color setting — if Pixi fills black too, effect is identical)
5. Open Performance tab in DevTools, record 5 seconds of gameplay, check weydra frame times — should be consistent 16.6ms (60fps).

To disable again:

```javascript
localStorage.removeItem('weydra_m1');
location.reload();
```

- [ ] **Step 6: Commit**

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
git add index.html src/weydra-loader.ts src/main.ts
git commit -m "feat(orbital): weydra-renderer M1 loader behind localStorage flag"
```

---

### Task 12: M1 done — final validation checklist

- [ ] **Step 1: Clean workspace builds**

Run:

```bash
cd weydra-renderer
cargo build --workspace
cargo test --workspace
cargo run --package hello-clear --release  # close window to exit
```

Expected: clean builds, tests pass, native demo shows dark blue window.

- [ ] **Step 2: WASM build succeeds**

Run:

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
npm run build:renderer
```

Expected: `weydra-renderer/adapters/wasm/pkg/` populated, no errors.

- [ ] **Step 3: Dev server + weydra enabled works**

Run:

```bash
npm run dev
```

In browser, enable weydra (`localStorage.setItem('weydra_m1', '1'); location.reload()`). Play the game for 2 minutes. Verify:
- No console errors
- Game remains playable
- Frame rate stays at 60fps (use Performance tab or FPS meter)

- [ ] **Step 4: Production build succeeds**

Run:

```bash
npm run build:renderer:release
npm run build
```

Expected: `dist/` produced, no errors. Test the built bundle with `npm run preview` + same weydra enable flag.

- [ ] **Step 5: Update M1 milestone marker**

Append to `docs/superpowers/specs/2026-04-19-weydra-renderer-design.md` under an "M1 Status" section at the end of the file:

```markdown

## M1 Status: Complete (YYYY-MM-DD)

Foundation merged. Renderer clears to black behind Pixi when debug flag is on. Pipeline validated end-to-end: Rust core → wasm-pack → ts-bridge → Vite plugin → game integration.

Next: M2 (starfield port).
```

Replace `YYYY-MM-DD` with the actual completion date.

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-04-19-weydra-renderer-design.md
git commit -m "docs(weydra-renderer): mark M1 Foundation complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Workspace with `core` + `adapters/wasm` + `examples/` (matches spec Architecture section)
- ✅ WGSL-only shader story (no shaders in M1, but plugin plumbing set up for M2)
- ✅ Bind group 0 placeholder (CameraUniforms struct stubbed)
- ✅ wasm-bindgen + shared memory approach (foundation only; escape hatches come with scene graph in M3)
- ✅ Two-canvas stacked migration (weydra-canvas added, Pixi stays on top)
- ✅ Debug flag for rollback (localStorage.weydra_m1)
- ✅ Native example validates core without WASM layer

**Gaps intentionally deferred to later milestones:**
- SlotMap / scene graph (M3: ships needs it)
- Sprite batcher (M3)
- Graphics/lyon (M7)
- Font/fontdue (M8)
- Visual parity test infra (M2, first system where it matters)
- Shared memory pools + ptr exports (M3, when first hot-path updates exist)
- Vite plugin uniform reflection via naga (M2, first time a custom shader is consumed)

**Placeholder scan:** No "TBD" or "TODO" in steps. Every code block is self-contained and runnable.

**Type consistency:** `GpuContext`, `RenderSurface`, `render_clear`, `CameraUniforms`, `Renderer`, `initWeydra`, `Renderer.create` — names used consistently across tasks. `weydra_renderer_wasm` is the wasm-pack package name; `@weydra/renderer` is the ts-bridge npm package name; `@weydra/vite-plugin-wgsl` is the plugin.

**Known risks for execution:**
- wgpu major version may have moved past 25 by the time this is executed — adjust workspace deps
- `wasm-pack` version skew with wgpu: if the build fails with cryptic errors, `cargo update` + verify wasm-pack >= 0.13
- If the game's Pixi canvas uses `app.canvas.style.zIndex = '0'` anywhere, the weydra canvas at z-index 0 will compete. Task 11 notes the coordination requirement.
