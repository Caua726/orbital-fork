# weydra-renderer M6 Fog-of-War Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Portar fog-of-war pro weydra. Hoje o Pixi usa canvas 2D pra desenhar círculos `destination-out` e upload o resultado como textura. No weydra, resolver via shader dedicado que sample visibilidade per-pixel e aplica a máscara direto.

**Architecture:** Duas opções (escolha no Task 1):

**A. Port direto do approach Pixi** — canvas 2D com destination-out continua desenhando o mask, upload via `upload_texture_from_image_data`, weydra renderiza como sprite fullscreen.

**B. Shader-based** — uniform array com N fontes de visão (x, y, raio), fullscreen fragment shader calcula alpha per-pixel via distance check. Zero canvas, zero upload per-frame. Melhor perf, mas requer capacidade fixa de fontes (ex: 64 max).

**Tech Stack:** Mesh primitive from M2 + TextureRegistry from M3 + UniformPool from M2.

**Depends on:** M3 complete (sprite infra, texture upload).

---

## Decisão (Task 1)

**Recomendação: B (shader-based)**. Orbital tem raramente > 32 fontes de visão simultâneas (jogador + naves com raio de visão + planetas colonizados). Fullscreen shader com 32 distance checks é trivialmente rápido (~0.1ms a 1080p). Elimina completamente o canvas draw + upload.

Se mais de 64 fontes virarem comum, volta pra A ou expande cap.

O plano abaixo assume B.

---

## File Structure

**New:**
- `src/shaders/fog.wgsl` — fullscreen fog shader com uniform array
- `weydra-renderer/core/src/pools/fog.rs` — FogUniforms com array de vision sources

**Modified:**
- `adapters/wasm/src/lib.rs` — expor `create_fog_shader`, `fog_sources_ptr`
- `ts-bridge/index.ts` — FogSources API
- `src/world/nevoa.ts` — branch flag + weydra path
- `src/core/config.ts` — `weydra.fog` flag

---

### Task 1: FogUniforms struct + pool

**Files:**
- Create: `weydra-renderer/core/src/pools/fog.rs`

- [ ] **Step 1: Write FogUniforms**

```rust
pub const FOG_MAX_SOURCES: usize = 64;

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct VisionSource {
    pub position: [f32; 2],
    pub radius: f32,
    pub _pad: f32,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct FogUniforms {
    pub base_alpha: f32,
    pub active_count: u32,
    pub _pad: [f32; 2],
    pub sources: [VisionSource; FOG_MAX_SOURCES],
}

impl Default for FogUniforms {
    fn default() -> Self {
        Self {
            base_alpha: 0.75,
            active_count: 0,
            _pad: [0.0; 2],
            sources: [VisionSource { position: [0.0, 0.0], radius: 0.0, _pad: 0.0 }; FOG_MAX_SOURCES],
        }
    }
}
```

- [ ] **Step 2: Register in lib.rs + commit**

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): FogUniforms with up to 64 vision sources"
```

---

### Task 2: fog.wgsl shader

**Files:**
- Create: `src/shaders/fog.wgsl`

- [ ] **Step 1: Write shader**

```wgsl
// engine_camera.viewport está em WORLD UNITS (convenção M2, decidida em C5).
// Caller passa screenW/zoom, screenH/zoom — shader é zoom-agnostic.
struct CameraUniforms { camera: vec2<f32>, viewport: vec2<f32>, time: f32, _pad: vec3<f32> };
struct VisionSource { position: vec2<f32>, radius: f32, _pad: f32 };
struct FogUniforms {
    base_alpha: f32,
    active_count: u32,
    _pad: vec2<f32>,
    sources: array<VisionSource, 64>,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> fog: FogUniforms;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
    let x = f32((idx << 1u) & 2u);
    let y = f32(idx & 2u);
    var out: VsOut;
    out.clip_pos = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(x * 0.5, y * 0.5); // 0..1
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // viewport em world units → world = camera + (uv - 0.5) * viewport
    let world = engine_camera.camera + (in.uv - 0.5) * engine_camera.viewport;
    var alpha = fog.base_alpha;
    for (var i: u32 = 0u; i < fog.active_count; i = i + 1u) {
        let src = fog.sources[i];
        let d = distance(world, src.position);
        // smoothstep(edge0, edge1, x): 0 em edge0, 1 em edge1.
        // Queremos coverage=0 (fog transparent) DENTRO da vision radius*0.75,
        // coverage=1 (fog opaque) FORA do radius. edge0 < edge1 (inner→outer).
        // alpha *= coverage → fog cleared dentro, opaque fora.
        let coverage = smoothstep(src.radius * 0.75, src.radius, d);
        alpha = alpha * coverage;
    }
    return vec4<f32>(0.008, 0.02, 0.06, alpha);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shaders/fog.wgsl
git commit -m "feat(shaders): fog.wgsl — per-pixel visibility via uniform array"
```

---

### Task 3: WASM adapter + TS bridge

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`
- Modify: `weydra-renderer/ts-bridge/index.ts`

- [ ] **Step 1: Add fog API in wasm**

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn create_fog_shader(&mut self, wgsl: &str) { /* compile + mesh + pool */ }
    pub fn fog_ptr(&self) -> u32 { /* ... */ }
    pub fn fog_max_sources(&self) -> u32 { FOG_MAX_SOURCES as u32 }
}
```

- [ ] **Step 2: Add TS wrapper**

```typescript
createFogShader(wgsl: string): FogLayer {
  this.inner.create_fog_shader(wgsl);
  this.revalidate();
  const ptr = this.inner.fog_ptr();
  const max = this.inner.fog_max_sources();
  // Ambos views começam no MESMO offset (ptr) do mesmo ArrayBuffer.
  // Layout FogUniforms: [base_alpha:f32, active_count:u32, pad:f32×2, sources: VisionSource×max]
  // VisionSource: [position:vec2, radius:f32, pad:f32] = 16 bytes = 4 f32
  const totalF32 = 4 + max * 4; // header(4 floats equivalent) + sources
  const buf = _wasm.memory.buffer;
  return new FogLayer(
    new Float32Array(buf, ptr, totalF32),
    new Uint32Array(buf, ptr, totalF32),
    max,
  );
}

class FogLayer {
  constructor(
    private f32: Float32Array,
    private u32: Uint32Array,
    public readonly maxSources: number,
  ) {}
  setBaseAlpha(v: number): void { this.f32[0] = v; }
  setActiveCount(n: number): void { this.u32[1] = n; }
  setSource(idx: number, x: number, y: number, radius: number): void {
    const base = 4 + idx * 4; // header = 4 f32, then sources stride 4 f32
    this.f32[base + 0] = x;
    this.f32[base + 1] = y;
    this.f32[base + 2] = radius;
    // [base+3] é pad
  }
}
```

- [ ] **Step 3: Rebuild + commit**

```bash
wasm-pack build --target web --out-dir weydra-renderer/adapters/wasm/pkg
git add weydra-renderer/
git commit -m "feat(weydra): fog shader API (wasm + ts-bridge)"
```

---

### Task 4: Game integration

**Files:**
- Modify: `src/world/nevoa.ts`
- Modify: `src/core/config.ts`

- [ ] **Step 1: Branch desenharNeblinaVisao**

```typescript
export function desenharNeblinaVisao(mundo, fontesVisao, camera, screenW, screenH, zoom): void {
  if (getConfig().weydra.fog) {
    const r = getWeydraRenderer();
    if (r && r.fog) {
      r.fog.setBaseAlpha(config.fogAlpha);
      const count = Math.min(fontesVisao.length, r.fogMaxSources);
      for (let i = 0; i < count; i++) {
        const f = fontesVisao[i];
        r.fog.setSource(i, f.x, f.y, f.raio);
      }
      r.fog.setActiveCount(count);
      return; // skip canvas path
    }
  }
  // existing Pixi canvas path
}
```

- [ ] **Step 2: Add flag + test**

```typescript
weydra.fog: boolean; // M6
```

Enable flag, verify fog renders correctly with soft edges, follows camera, covers viewport.

- [ ] **Step 3: Mark complete**

```markdown
## M6 Status: Complete (YYYY-MM-DD)
Fog via shader-based vision source array. Zero canvas draw, zero upload.
```

```bash
git add src/ docs/
git commit -m "feat(orbital): fog via weydra shader + M6 complete"
```

---

## Self-Review

- ✅ Shader-based vision calc (B)
- ✅ Uniform array com cap 64
- ✅ Feature flag + rollback

**Risks:**
- Hard-coded 64 sources — validar que Orbital raramente passa. Stress test com 50 naves do jogador + 20 naves inimigas visíveis.
- `destination-out` do Pixi tinha bordas soft via smoothstep natural do canvas. Shader precisa replicar — ajustar `smoothstep(radius, radius * 0.75, d)` até parity visual.
- Loop em fragment shader (64 iter × fullscreen) — validar perf em PowerVR mobile.
