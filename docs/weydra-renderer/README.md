# weydra-renderer

Custom 2D GPU renderer em Rust + wgpu. Substitui Pixi.js no jogo Orbital e roda em múltiplas plataformas via adapters.

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

## Web backends — o que difere entre WebGL2 e WebGPU

Ambos são exercitados pelo `bun run test:determinism` (Pixi/WebGL como referência,
Weydra/WebGL2 e Weydra/WebGPU; o passe de WebGPU é pulado, não falhado, quando o
navegador não oferece adapter — veja `ORBITAL_WEBGPU_ARGS`).

- **Limite de tamanho do canvas.** O device é criado com
  `Limits::downlevel_webgl2_defaults().using_resolution(adapter)` (`core/src/device.rs`):
  as dimensões de textura vêm do adapter, o resto fica no mínimo portátil. O jogo
  lê `Renderer.maxTextureDimension2d` e clampa o backing store — sem isso, uma tela
  1440p/4K (ou `renderScale > 1` numa janela larga) estourava o limite de 2048 px
  do conjunto downlevel, e `Surface::configure` falhava.
- **sRGB.** Canvas WebGPU só oferece formatos lineares (`rgba8unorm`/`bgra8unorm`).
  Como os shaders escrevem valores já codificados em sRGB, o renderer desenha
  através da *view* sRGB (`SurfaceConfiguration::view_formats`, ver
  `choose_formats` em `core/src/surface.rs`). Sem ela a cena inteira sai ~2,4×
  mais escura que no Pixi/WebGL2.
- **Perda de contexto.** Weydra não recria buffers/pipelines/texturas de um contexto
  perdido, então o jogo trata `webglcontextlost` como fatal e troca a sessão para o
  Pixi (`src/main.ts` + `src/weydra-loader.ts`), em vez de deixar um quadro congelado.

## Build

- **Web:** `npm run build:renderer` na raiz do Orbital (usa wasm-pack)
- **Native desktop:** `cargo check --package weydra-renderer-native` ou `cargo run --package hello-clear` pro example
- **Android cross-check:** `cargo check --package weydra-renderer-android --target aarch64-linux-android` (precisa NDK)
- **All platforms:** `./scripts/check-all-platforms.sh`
- **Platform guards audit:** `./scripts/check-platform-guards.sh`

## Platform Guards

Ver [platform-guards.md](./platform-guards.md) pra invariantes de dependência por crate. Regra de ouro: `core/` só depende de `wgpu` + Rust puro; adapters têm todas as platform deps.
