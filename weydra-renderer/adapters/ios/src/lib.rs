//! iOS adapter for weydra-renderer.
//!
//! M1.5 scope: placeholder crate que cross-compila via cargo check com
//! `aarch64-apple-ios`. NÃO há renderer funcional aqui ainda — full
//! adapter (UIView integration, touch, audio session, etc) fica pra M12.
//!
//! O M1.5 apenas garante que o workspace suporta iOS como target sem
//! que outras crates precisem mudar. Metal HAL entra em M12 via
//! `wgpu` feature `metal` quando o adapter real rodar em macOS host.

pub fn ios_placeholder() -> &'static str {
    "weydra-renderer-ios placeholder — full adapter in M12"
}
