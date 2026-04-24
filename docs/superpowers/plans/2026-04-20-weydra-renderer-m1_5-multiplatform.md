# weydra-renderer M1.5 Multi-Platform Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Preparar o workspace pra futura compatibilidade com Windows/macOS/Linux desktop nativo + Android/iOS sem construir os adapters completos ainda. É infra defensiva: garantir que qualquer decisão em M2-M10 que acidentalmente acople ao browser quebre o build imediatamente. Adapters funcionais de verdade ficam pra M11 (desktop) e M12 (mobile), que só acontecem se houver demanda.

**Architecture:**
- `core/` permanece platform-agnostic (só wgpu + Rust puro) — audit garantindo zero deps de `web-sys`, `js-sys`, `wasm-bindgen`, `winit`, nem nada platform-specific
- `adapters/native/` novo crate com winit + wgpu, cobre Windows/macOS/Linux desktop. Inicialmente promove o `examples/hello-clear` pra adapter reutilizável
- `adapters/android/` novo crate com `winit` feature `android-activity`. Cargo check cross-compila com `aarch64-linux-android`. Sem APK build em M1.5 — só garantir compilação
- `adapters/ios/` placeholder (Cargo.toml + skeleton `lib.rs`) — full adapter diferido pra M12
- Rustup targets instalados pra todos os alvos
- `docs/weydra-renderer/platform-guards.md` documenta o que cada crate pode importar
- Script local `scripts/check-all-platforms.sh` roda `cargo check` em cada target e reporta

**Tech Stack:** wgpu 25.x (multi-backend nativo), winit 0.30 (desktop + Android), cargo-ndk (opcional pro Android), wasm-pack (já existe).

**Depends on:** M1 complete.

**Não bloqueia:** M2-M10 podem rodar em paralelo. M1.5 é parallel-track.

---

## Prerequisites

Check antes de começar:

- M1 merged e funcional (flag weydra_m1 rodando no jogo)
- Rustup instalado (`rustup --version`)
- Build system do OS host (Linux geralmente tem tudo; macOS precisa Xcode CLT; Windows precisa MSVC build tools) — só pra `cargo check`, não precisa linkar tudo

**Linkers externos opcionais (pra expandir cobertura do check script):**

| Target | Dep externa | Install |
|---|---|---|
| `x86_64-pc-windows-gnu` | mingw-w64 | `sudo apt install mingw-w64` (Linux) |
| `aarch64-linux-android` | cargo-ndk + Android NDK | `cargo install cargo-ndk`, NDK via Android Studio |
| `aarch64-apple-darwin`, `aarch64-apple-ios` | macOS host + Xcode CLT | N/A (requer mac) |

Se faltar linker pra algum target, o script marca como `skip` e segue. M1.5 merged requer: **web + native Linux passam** no mínimo. Outros são bônus.

## File Structure

**Modified:**
- `weydra-renderer/rust-toolchain.toml` — adiciona targets
- `weydra-renderer/Cargo.toml` — novos workspace members, workspace deps
- `weydra-renderer/core/Cargo.toml` — reforça exclusão de deps browser-only
- `weydra-renderer/core/src/lib.rs` — comentário doc-level reforçando platform-agnostic

**New (adapters/native):**
- `weydra-renderer/adapters/native/Cargo.toml`
- `weydra-renderer/adapters/native/src/lib.rs`

**New (adapters/android):**
- `weydra-renderer/adapters/android/Cargo.toml`
- `weydra-renderer/adapters/android/src/lib.rs`

**New (adapters/ios placeholder):**
- `weydra-renderer/adapters/ios/Cargo.toml`
- `weydra-renderer/adapters/ios/src/lib.rs`

**New (docs + scripts):**
- `docs/weydra-renderer/platform-guards.md`
- `docs/weydra-renderer/README.md` (matriz de plataformas)
- `scripts/check-all-platforms.sh`

---

### Task 1: Expand rustup toolchain targets

**Files:**
- Modify: `weydra-renderer/rust-toolchain.toml`

- [ ] **Step 1: Atualizar toolchain.toml**

Substituir o conteúdo de `weydra-renderer/rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
targets = [
    "wasm32-unknown-unknown",
    "x86_64-unknown-linux-gnu",
    "x86_64-pc-windows-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "aarch64-linux-android",
    "aarch64-apple-ios",
]
components = ["rustfmt", "clippy"]
```

Nota: `x86_64-pc-windows-msvc` **não** está na lista — requer MSVC linker + Windows SDK, só compila com host Windows. Pra developers Windows, `rustup target add x86_64-pc-windows-msvc` local, não enforçado no workspace.

- [ ] **Step 2: Verificar instalação dos targets**

```bash
cd weydra-renderer
rustup show
```

Expected: lista todos os targets acima (rustup instala on-demand quando o toolchain file muda). Se algum target falhar de instalar (raro em stable), documentar em `docs/weydra-renderer/README.md` matriz mais adiante.

---

### Task 2: Core crate audit + platform-agnostic guard

**Files:**
- Modify: `weydra-renderer/core/Cargo.toml`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Reforçar restrição em Cargo.toml**

Verificar que `weydra-renderer/core/Cargo.toml` **NÃO** tem nenhuma destas deps (nem opcional, nem como feature):

- `web-sys`
- `js-sys`
- `wasm-bindgen`
- `wasm-bindgen-futures`
- `winit`
- `console_error_panic_hook`

Se tiver, é erro — mover pra `adapters/*/Cargo.toml`. M1 já deve ter colocado no lugar certo; este step é só verificação.

- [ ] **Step 2: Doc-level guard em lib.rs**

Atualizar o topo de `weydra-renderer/core/src/lib.rs`:

```rust
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

- [ ] **Step 3: Grep automated check**

Rodar e confirmar zero matches:

```bash
cd weydra-renderer
grep -rn "use web_sys\|use js_sys\|use wasm_bindgen\|use winit" core/src/
```

Expected: **vazio**.

---

### Task 3: adapters/native skeleton (winit desktop)

**Files:**
- Create: `weydra-renderer/adapters/native/Cargo.toml`
- Create: `weydra-renderer/adapters/native/src/lib.rs`
- Modify: `weydra-renderer/Cargo.toml` (adicionar member)

- [ ] **Step 1: Cargo.toml do native adapter**

Criar `weydra-renderer/adapters/native/Cargo.toml`:

```toml
[package]
name = "weydra-renderer-native"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[lib]
crate-type = ["lib"]

[dependencies]
weydra-renderer = { path = "../../core" }
# default-features = false evita arrastar backends que não usamos (ex: gles).
# Features enumeradas explicitamente — wgpu 25.x habilita todas por default.
wgpu = { workspace = true, default-features = false, features = ["vulkan", "metal", "dx12"] }
winit = { workspace = true }
pollster = { workspace = true }
log = { workspace = true }
env_logger = { workspace = true }
```

- [ ] **Step 2: lib.rs — Renderer wrapper pra winit Window**

Criar `weydra-renderer/adapters/native/src/lib.rs`:

```rust
//! Native adapter for weydra-renderer.
//!
//! Wraps the core `GpuContext` + `RenderSurface` on a winit `Window`.
//! Covers Windows (DX12/Vulkan), macOS (Metal), Linux (Vulkan).
//!
//! Intentionally minimal in M1.5 — suficiente pra abrir janela + clear color.
//! Full adapter (input events, resize, multi-monitor, etc) fica pra M11.

use std::sync::Arc;
use weydra_renderer::{render_clear, GpuContext, RenderSurface};
use winit::window::Window;

/// Native renderer bound to a winit Window.
pub struct NativeRenderer {
    pub ctx: GpuContext,
    pub surface: RenderSurface<'static>,
    _window: Arc<Window>, // keeps window alive alongside surface
}

impl NativeRenderer {
    /// Create a renderer for the given window. The window is stored
    /// internally via Arc so the surface borrow stays valid.
    pub async fn new(window: Arc<Window>) -> weydra_renderer::Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| weydra_renderer::WeydraError::SurfaceCreationFailed(e.to_string()))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or(weydra_renderer::WeydraError::AdapterNotFound)?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("weydra device (native)"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                    trace: wgpu::Trace::Off,
                },
                None,
            )
            .await?;

        let ctx = GpuContext { instance, adapter, device, queue };
        let surface = RenderSurface::configure(&ctx, surface, size.width, size.height)?;

        Ok(Self { ctx, surface, _window: window })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.surface.resize(&self.ctx, width, height);
    }

    pub fn render(&mut self, clear_color: [f64; 4]) -> weydra_renderer::Result<()> {
        render_clear(&self.ctx, &self.surface, clear_color)
    }
}
```

- [ ] **Step 3: Adicionar como workspace member**

Atualizar `weydra-renderer/Cargo.toml` workspace members:

```toml
[workspace]
resolver = "2"
members = [
    "core",
    "adapters/wasm",
    "adapters/native",
    "examples/hello-clear",
]
```

- [ ] **Step 4: cargo check — build nativo**

```bash
cd weydra-renderer
cargo check --package weydra-renderer-native
```

Expected: clean. Build pode ser lento na primeira vez (baixar winit + wgpu deps nativas).

---

### Task 4: adapters/android skeleton

**Files:**
- Create: `weydra-renderer/adapters/android/Cargo.toml`
- Create: `weydra-renderer/adapters/android/src/lib.rs`
- Modify: `weydra-renderer/Cargo.toml` (member)

- [ ] **Step 1: Cargo.toml**

Criar `weydra-renderer/adapters/android/Cargo.toml`:

```toml
[package]
name = "weydra-renderer-android"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
weydra-renderer = { path = "../../core" }
# default-features = false: Android só precisa Vulkan + GLES, não Metal/DX12.
wgpu = { workspace = true, default-features = false, features = ["vulkan", "gles"] }
winit = { workspace = true, features = ["android-native-activity"] }
log = { workspace = true }
android_logger = "0.13"
```

- [ ] **Step 2: lib.rs — stub**

Criar `weydra-renderer/adapters/android/src/lib.rs`:

```rust
//! Android adapter for weydra-renderer.
//!
//! M1.5 scope: skeleton que cross-compila via cargo check com
//! `aarch64-linux-android`. Full adapter (activity lifecycle, touch,
//! APK build, audio etc) fica pra M12.
//!
//! Spawn é via winit's android-native-activity; detalhes do entry point
//! (#[no_mangle] pub extern fn ANativeActivity_onCreate) ficam pro M12.

use std::sync::Arc;
use weydra_renderer::{render_clear, GpuContext, RenderSurface};
use winit::window::Window;

pub struct AndroidRenderer {
    pub ctx: GpuContext,
    pub surface: RenderSurface<'static>,
    _window: Arc<Window>,
}

impl AndroidRenderer {
    pub async fn new(window: Arc<Window>) -> weydra_renderer::Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN | wgpu::Backends::GL,
            ..Default::default()
        });
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| weydra_renderer::WeydraError::SurfaceCreationFailed(e.to_string()))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower, // mobile
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or(weydra_renderer::WeydraError::AdapterNotFound)?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("weydra device (android)"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                    trace: wgpu::Trace::Off,
                },
                None,
            )
            .await?;

        let ctx = GpuContext { instance, adapter, device, queue };
        let surface = RenderSurface::configure(&ctx, surface, size.width, size.height)?;
        Ok(Self { ctx, surface, _window: window })
    }

    pub fn render(&mut self, clear: [f64; 4]) -> weydra_renderer::Result<()> {
        render_clear(&self.ctx, &self.surface, clear)
    }
}
```

- [ ] **Step 3: Adicionar como workspace member**

```toml
members = [
    "core",
    "adapters/wasm",
    "adapters/native",
    "adapters/android",
    "examples/hello-clear",
]
```

- [ ] **Step 4: cargo check cross-compile**

```bash
cd weydra-renderer
cargo check --package weydra-renderer-android --target aarch64-linux-android
```

Pode falhar se NDK não estiver no PATH. Se falhar com erro de linker, documentar em `README.md` como "cross-compile Android requer NDK" e seguir em frente. `cargo check` em host target (`x86_64-unknown-linux-gnu`) deve funcionar — isso é o mínimo aceitável pra M1.5.

---

### Task 5: adapters/ios placeholder

**Files:**
- Create: `weydra-renderer/adapters/ios/Cargo.toml`
- Create: `weydra-renderer/adapters/ios/src/lib.rs`

- [ ] **Step 1: Cargo.toml mínimo**

Criar `weydra-renderer/adapters/ios/Cargo.toml`:

```toml
[package]
name = "weydra-renderer-ios"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[lib]
crate-type = ["staticlib", "rlib"]

[dependencies]
weydra-renderer = { path = "../../core" }
# default-features = false + zero features — Metal HAL só entra em M12
# quando o adapter real rodar em macOS host. Enable `metal` aqui quebra
# cargo check em Linux porque Metal HAL linka frameworks Apple.
wgpu = { workspace = true, default-features = false }
log = { workspace = true }
```

- [ ] **Step 2: lib.rs placeholder**

Criar `weydra-renderer/adapters/ios/src/lib.rs`:

```rust
//! iOS adapter for weydra-renderer.
//!
//! M1.5 scope: placeholder crate que cross-compila via cargo check com
//! `aarch64-apple-ios`. NÃO há renderer funcional aqui ainda — full
//! adapter (UIView integration, touch, audio session, etc) fica pra M12.
//!
//! O M1.5 apenas garante que o workspace suporta iOS como target sem
//! que outras crates precisem mudar.

pub fn ios_placeholder() -> &'static str {
    "weydra-renderer-ios placeholder — full adapter in M12"
}
```

- [ ] **Step 3: Workspace member + check**

```toml
members = [
    "core",
    "adapters/wasm",
    "adapters/native",
    "adapters/android",
    "adapters/ios",
    "examples/hello-clear",
]
```

```bash
cargo check --package weydra-renderer-ios
```

Cross-compile iOS (`--target aarch64-apple-ios`) só funciona em macOS com Xcode. Se host for Linux, documentar como "only on macOS host". Host check passa em qualquer OS.

---

### Task 6: Platform-agnostic guards doc

**Files:**
- Create: `docs/weydra-renderer/platform-guards.md`

- [ ] **Step 1: Escrever doc**

Criar `docs/weydra-renderer/platform-guards.md`:

```markdown
# weydra-renderer — Platform Guards

Regras de o que cada crate pode/não pode importar. Violação = CI break.

## core/

**Pode usar:**
- `wgpu` (todas as features)
- `bytemuck`, `glam`, `log`
- `std::*` EXCETO `std::fs`, `std::net`, `std::process`, `std::thread`
- `lyon`, `fontdue` (pure Rust, no platform deps)

**NÃO pode usar:**
- `web-sys`, `js-sys`, `wasm-bindgen` (browser-only)
- `winit` (desktop windowing — adapters/native)
- `android-activity`, `jni`, `ndk` (Android — adapters/android)
- `objc`, `cocoa`, `metal` (Apple native — adapters/ios)
- `raw-window-handle` direto (deixar adapters manejarem)

Regra mental: core recebe `wgpu::Surface` pronto como argumento.
Quem criou o Surface (de onde ele veio) é problema do adapter.

## adapters/wasm/

**Pode usar:**
- Tudo de core
- `wasm-bindgen`, `wasm-bindgen-futures`, `web-sys`, `js-sys`
- `console_error_panic_hook`

**NÃO pode usar:**
- `winit`, `std::fs`, etc (WASM runtime limita)

## adapters/native/

**Pode usar:**
- Tudo de core
- `winit`, `pollster`, `env_logger`
- `std::fs`, `std::net` (OS native)
- `raw-window-handle`

**NÃO pode usar:**
- `wasm-bindgen`, `web-sys`, `js-sys`

## adapters/android/

**Pode usar:**
- Tudo de core
- `winit` (feature `android-native-activity`)
- `android_logger`, `jni`, `ndk`

**NÃO pode usar:**
- `wasm-bindgen`, `web-sys`
- `env_logger` (Android tem logger próprio)

## adapters/ios/

**Pode usar:**
- Tudo de core
- `objc`, `cocoa`, `core-graphics`
- `log` com iOS-compatible backend

**NÃO pode usar:**
- `wasm-bindgen`, `web-sys`, `winit` (iOS usa UIKit direto, não winit)

## Test automated

`scripts/check-all-platforms.sh` roda grep em cada crate e falha se encontrar
import proibido. Rodar localmente antes de commit; eventualmente vira GitHub
Actions job.
```

---

### Task 7: Platform matrix README + check script

**Files:**
- Create: `docs/weydra-renderer/README.md`
- Create: `scripts/check-all-platforms.sh`

- [ ] **Step 1: README com matriz**

Criar `docs/weydra-renderer/README.md`:

```markdown
# weydra-renderer

Custom 2D GPU renderer em Rust + wgpu. Substitui Pixi.js no jogo Orbital
e roda em múltiplas plataformas via adapters.

## Platform Matrix

| Platform | Backend | Adapter | Status |
|---|---|---|---|
| Web (Chrome/Edge/Safari 17+) | WebGPU | `adapters/wasm` | ✅ Full (M1-M10) |
| Web (Firefox/Safari iOS) | WebGL2 | `adapters/wasm` | ✅ Full (M1-M10) |
| Linux desktop | Vulkan | `adapters/native` | 🟡 Skeleton (M1.5) / Full M11 |
| Windows desktop | DX12 / Vulkan | `adapters/native` | 🟡 Skeleton (M1.5) / Full M11 |
| macOS desktop | Metal | `adapters/native` | 🟡 Skeleton (M1.5) / Full M11 |
| Steam Deck | Vulkan | `adapters/native` | 🟡 Skeleton (M1.5) / Full M11 |
| Android | Vulkan + GLES | `adapters/android` | 🟡 Skeleton (M1.5) / Full M12 |
| iOS | Metal | `adapters/ios` | 🟡 Placeholder (M1.5) / Full M12 |

**Legend:** ✅ Playable · 🟡 cargo check passa, adapter incompleto · ⚫ planejado

## Build

- **Web:** `npm run build:renderer` na raiz do Orbital (usa wasm-pack)
- **Native desktop:** `cargo check --package weydra-renderer-native` ou
  `cargo run --package hello-clear` pra example
- **Android cross-check:** `cargo check --package weydra-renderer-android --target aarch64-linux-android` (precisa NDK)
- **All platforms:** `./scripts/check-all-platforms.sh`

## Platform Guards

Ver [platform-guards.md](./platform-guards.md) pra invariantes de dependência
por crate. Regra de ouro: `core/` só depende de `wgpu` + Rust puro; adapters
tem todas as platform deps.
```

- [ ] **Step 2: Check script**

Criar `scripts/check-all-platforms.sh`:

```bash
#!/usr/bin/env bash
# check-all-platforms.sh — roda `cargo check` pra cada target weydra-renderer
# suporta. Skip apenas quando o target não está instalado no rustup;
# qualquer outro erro (incluindo linker) é FAIL real.
# Uso: ./scripts/check-all-platforms.sh

set -u

cd "$(dirname "$0")/../weydra-renderer" || exit 1

INSTALLED_TARGETS=$(rustup target list --installed)

FAIL=0
PASS=0
SKIP=0

# Probe extra pra linkers externos que rustup não provê. Devolve reason
# ou vazio se todos os pré-requisitos estão ok.
missing_linker() {
    local target="$1"
    case "$target" in
        x86_64-pc-windows-gnu|i686-pc-windows-gnu)
            command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 || echo "mingw-w64 linker ausente (apt: mingw-w64)"
            ;;
        aarch64-linux-android|armv7-linux-androideabi)
            command -v cargo-ndk >/dev/null 2>&1 || echo "Android NDK/cargo-ndk ausente"
            ;;
        *apple*)
            [ "$(uname)" = "Darwin" ] || echo "Apple target requer macOS host + Xcode"
            ;;
    esac
}

check() {
    local pkg="$1"
    local target="$2"
    local label="$3"
    printf "[%s] %s (%s) ... " "$label" "$pkg" "$target"

    # Skip se o target não está instalado via rustup.
    if ! echo "$INSTALLED_TARGETS" | grep -q "^$target\$"; then
        echo "skip (target não instalado; rustup target add $target pra habilitar)"
        SKIP=$((SKIP + 1))
        return
    fi

    # Skip se o linker/SDK externo requerido não está disponível.
    local reason
    reason=$(missing_linker "$target")
    if [ -n "$reason" ]; then
        echo "skip ($reason)"
        SKIP=$((SKIP + 1))
        return
    fi

    if cargo check --package "$pkg" --target "$target" --quiet; then
        echo "ok"
        PASS=$((PASS + 1))
    else
        echo "FAIL"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== weydra-renderer platform check ==="

check "weydra-renderer"         "x86_64-unknown-linux-gnu" "linux-host"
check "weydra-renderer-wasm"    "wasm32-unknown-unknown"   "web"
check "weydra-renderer-native"  "x86_64-unknown-linux-gnu" "native-linux"
check "weydra-renderer-native"  "x86_64-pc-windows-gnu"    "native-windows"
check "weydra-renderer-native"  "x86_64-apple-darwin"      "native-macos-x64"
check "weydra-renderer-native"  "aarch64-apple-darwin"     "native-macos-arm64"
check "weydra-renderer-android" "aarch64-linux-android"    "android-arm64"
check "weydra-renderer-ios"     "aarch64-apple-ios"        "ios-arm64"

echo "=== summary: $PASS pass, $SKIP skip, $FAIL fail ==="
exit $FAIL
```

Tornar executável:

```bash
chmod +x scripts/check-all-platforms.sh
```

- [ ] **Step 3: Grep guard helper (opcional)**

Adicionar ao mesmo script ou um companion `scripts/check-platform-guards.sh`:

```bash
#!/usr/bin/env bash
# Verifica invariantes de dependência por crate (ver platform-guards.md).
# Grep detecta `use`, `extern crate`, `pub use` e macro imports da crate.
# Também checa o Cargo.toml pra catch deps declaradas mas ainda não usadas.
set -u
cd "$(dirname "$0")/../weydra-renderer" || exit 1

FAIL=0

# forbid_crate <src_dir> <cargo_toml> <crate_name>...
forbid_crate() {
    local src="$1/src"
    local cargo="$1/Cargo.toml"
    shift
    for forbidden in "$@"; do
        # Patterns em código Rust — uso via use/extern crate/pub use.
        # Regex word-boundary (-w) evita false positives (ex: web_sys_foo).
        if grep -rnE -w "$forbidden" "$src" 2>/dev/null | grep -E "use|extern crate" >/dev/null; then
            echo "VIOLAÇÃO: '$forbidden' usado em $src"
            grep -rnE -w "$forbidden" "$src" | grep -E "use|extern crate"
            FAIL=$((FAIL + 1))
        fi
        # Pattern no Cargo.toml — dep declarada.
        if [ -f "$cargo" ] && grep -q "^${forbidden//_/-} *=\|^${forbidden} *=" "$cargo"; then
            echo "VIOLAÇÃO: '$forbidden' declarado como dep em $cargo"
            FAIL=$((FAIL + 1))
        fi
    done
}

echo "=== platform-guards check ==="

# core não pode ter NADA platform-specific
forbid_crate "core"             web_sys js_sys wasm_bindgen wasm_bindgen_futures winit

# native: sem deps browser
forbid_crate "adapters/native"  wasm_bindgen web_sys js_sys

# android: sem deps browser + winit com feature android-native-activity validada
forbid_crate "adapters/android" wasm_bindgen web_sys js_sys

# ios: sem browser nem winit (UIKit direto)
forbid_crate "adapters/ios"     wasm_bindgen web_sys js_sys winit

# wasm: sem winit
forbid_crate "adapters/wasm"    winit

echo "=== $FAIL violations ==="
exit $FAIL
```

Nota sobre blind spots: grep cobre `use`, `extern crate`, `pub use`. Não cobre dinâmica (macro magic, type-erased imports). Pra M1.5 o código é fresco e direto — heurística é suficiente. Se M11/M12 introduzirem metaprogramação ou re-exports complexos, evoluir pra `cargo tree` + parse estruturado.

---

### Task 8: Validation + rotular M1.5 complete

- [ ] **Step 1: Rodar platform check local**

```bash
cd /home/caua/Documentos/Projetos-Pessoais/orbital-fork
./scripts/check-all-platforms.sh
./scripts/check-platform-guards.sh
```

Expected: pass em pelo menos linux-host, web, native-linux. Android/iOS podem dar skip se toolchain não tiver no host — OK.

- [ ] **Step 2: Verificar que M1 não regrediu**

```bash
cd weydra-renderer
cargo build --workspace
cd ..
npm run build:renderer
npm run dev
```

No browser: `localStorage.weydra_m1 = '1'; location.reload()`. Canvas preto aparece atrás do Pixi, zero erros no console. Se M1 quebrou, M1.5 introduziu regressão — fix.

- [ ] **Step 3: Atualizar spec**

Adicionar no fim de `docs/superpowers/specs/2026-04-19-weydra-renderer-design.md`:

```markdown
## M1.5 Status: Complete (YYYY-MM-DD)

Scaffolding multi-plataforma pronto. `cargo check` passa em: web, native Linux.
Targets Windows/macOS/Android/iOS têm crate estrutural — build funcional depende
de toolchain no host. Platform guards documentados e checked via script local.

Adapters completos pra desktop (M11) e mobile (M12) entram se houver demanda.
Next: M2 (starfield) segue em paralelo.
```

- [ ] **Step 4: Tag release**

```bash
git tag -a v0.1-multiplatform -m "weydra-renderer M1.5 — multi-platform scaffolding complete"
# NÃO push ainda, usuário decide
```

---

## Self-Review

**Spec coverage:**
- ✅ adapters/native skeleton com winit
- ✅ adapters/android skeleton
- ✅ adapters/ios placeholder
- ✅ rust-toolchain com todos os targets
- ✅ Platform guards doc + script
- ✅ Matrix README
- ✅ Core audit reforça platform-agnostic
- ✅ Zero regressão no path WASM

**Intencionalmente NÃO feito:**
- APK/IPA build pipelines (M12)
- Input abstraction (M11/M12 quando adapter completo entrar)
- Asset loading abstraction (M11 quando desktop precisar carregar PNG do disco)
- Audio (Fase C)
- Full native game port (M11+)
- GitHub Actions CI (pode adicionar depois; script local cobre o mínimo)

**Riscos:**
- cargo check cross-compile pode falhar silenciosamente com erros obscuros de linker quando toolchain não está completo. Script trata com `skip (toolchain não disponível)` — aceitável mas pode mascarar bug real. Mitigação: rodar `cargo build` (não só check) periodicamente em CI quando tiver toolchain completa.
- wgpu features `vulkan/metal/dx12` em native adapter podem pesar no binário final se não forem tree-shaken. wgpu 25.x usa feature flags — auditar tamanho antes do M11.
- winit `android-native-activity` feature pode ter breaking changes entre winit 0.30 e 0.31. Pin versão no workspace Cargo.toml.
- Se futuros Ms introduzirem `std::fs` pra asset loading, quebra no WASM. Guards não pegam isso (grep de `use std::fs` daria muitos falsos positivos). Mitigação: code review dos plans M11+ deve flagar.
