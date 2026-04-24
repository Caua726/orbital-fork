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

Regra mental: core recebe `wgpu::Surface` pronto como argumento. Quem criou o Surface (de onde ele veio) é problema do adapter.

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
- `winit` (feature `android-native-activity` em winit 0.31-beta)
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

`scripts/check-platform-guards.sh` roda grep em cada crate e falha se encontrar import proibido. `scripts/check-all-platforms.sh` faz `cargo check` por target + skip quando toolchain/linker não instalado. Rodar localmente antes de commit; eventualmente vira GitHub Actions job.
