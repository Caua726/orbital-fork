# weydra-renderer M3 Ships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Render all ships (colonizadora, cargueira, batedora, fragata, torreta — com tier variants + tints + trails) via weydra-renderer. Primeiro sistema com muitas entidades, nasce aqui o sistema de shared memory com SlotMap + per-pool ponteiros expostos pro TS.

**Architecture:** Sprite batcher — N quads com a mesma textura viram 1 draw call. SlotMap com generational indices pra handles opacos. SoA pools (transform, color, flags, texture_id) em contíguo Rust Vec, ponteiros expostos via wasm-bindgen → TS escreve direto via typed array views. Revalidation via mem_version counter. Spritesheet loading via bytes upload. Re-wire do ship select pra DOM event.

**Tech Stack:** M1+M2 foundation + slotmap crate + wgpu instance buffers.

**Depends on:** M2 complete.

## Scope extensions absorved into M3

**A. WebGL2 fallback path (obrigatório pro merge):**

Spec lista Firefox/Safari iOS 17+/PowerVR como Phase A targets. Todos rodam wgpu via WebGL2 backend, que **não suporta storage buffers**. `sprite_batch.wgsl` com `var<storage, read>` trava nesses browsers. Soluções:

- **Path WebGPU:** storage buffer + `instance_index` (já descrito neste plano).
- **Path WebGL2:** vertex buffer com per-instance attributes via `VertexStepMode::Instance`. Mesmo shader lógico, binding diferente.

Implementar ambas em M3. Detecção no boot via `adapter.get_info().backend`:
```rust
let use_storage = matches!(adapter.get_info().backend, wgpu::Backend::BrowserWebGpu | wgpu::Backend::Vulkan | wgpu::Backend::Metal | wgpu::Backend::Dx12);
```
→ Seleciona `sprite_batch_storage.wgsl` ou `sprite_batch_instanced.wgsl`. Mesma API pública (`create_sprite`, `render`).

**B. Bright star layer TilingSprite (diferido de M2):**

O bright layer do starfield usa TilingSprite em Pixi hoje. M2 decidiu deixar em Pixi até M3 — agora que sprite pool + texture registry existem, migrar:
- Adicionar 1 `sprite.wgsl` simples (já no scope original do M2 arquivado).
- TilingSprite é só um sprite com UV repeat: shader aceita `tile_offset`, `tile_scale` como uniforms extras.
- Flag `weydra.starfield` em M3 já cobre — ao migrar starfield bright, liga junto.

---

## File Structure

**New in core:**
- `core/src/slotmap.rs` — simple generational-index SlotMap
- `core/src/sprite.rs` — Sprite pool + batcher
- `core/src/texture.rs` — TextureRegistry (upload bytes, get handle, sub-frame support)
- `core/shaders/sprite_batch.wgsl` — textured quad shader with per-instance attributes

**Modified in core:**
- `core/src/lib.rs` — exports
- `core/src/uniform_pool.rs` — generalize pointer export pattern

**Modified in adapters/wasm:**
- `adapters/wasm/src/lib.rs` — Renderer gains `upload_texture`, `create_sprite`, `destroy_sprite`, pool pointers, `mem_version`

**Modified in ts-bridge:**
- `ts-bridge/index.ts` — Sprite class with typed-view setters, pool revalidation logic

**Game:**
- Modify: `src/core/config.ts` — `weydra.ships` flag
- Modify: `src/world/naves.ts` — branch for weydra rendering
- Modify: `src/world/spritesheets.ts` — load ships.png bytes for weydra upload
- Modify: `src/core/player.ts` — ship select via DOM event (se ainda não for)

---

### Task 1: Generational SlotMap

**Files:**
- Create: `weydra-renderer/core/src/slotmap.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write SlotMap**

Create `weydra-renderer/core/src/slotmap.rs`:

```rust
/// Handle = (slot, generation). Generation invalidates stale references
/// when a slot is recycled.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Handle {
    pub slot: u32,
    pub generation: u32,
}

impl Handle {
    pub fn to_u64(self) -> u64 {
        (self.generation as u64) << 32 | (self.slot as u64)
    }
    pub fn from_u64(v: u64) -> Self {
        Self { slot: v as u32, generation: (v >> 32) as u32 }
    }
}

pub struct SlotMap<T> {
    slots: Vec<Option<T>>,
    generations: Vec<u32>,
    free: Vec<u32>,
}

impl<T> SlotMap<T> {
    pub fn new() -> Self {
        Self { slots: Vec::new(), generations: Vec::new(), free: Vec::new() }
    }

    pub fn with_capacity(cap: usize) -> Self {
        Self {
            slots: Vec::with_capacity(cap),
            generations: Vec::with_capacity(cap),
            free: Vec::new(),
        }
    }

    pub fn insert(&mut self, value: T) -> Handle {
        if let Some(slot) = self.free.pop() {
            self.slots[slot as usize] = Some(value);
            let gen = self.generations[slot as usize];
            Handle { slot, generation: gen }
        } else {
            let slot = self.slots.len() as u32;
            self.slots.push(Some(value));
            self.generations.push(0);
            Handle { slot, generation: 0 }
        }
    }

    pub fn get(&self, h: Handle) -> Option<&T> {
        if (h.slot as usize) < self.slots.len() && self.generations[h.slot as usize] == h.generation {
            self.slots[h.slot as usize].as_ref()
        } else {
            None
        }
    }

    pub fn remove(&mut self, h: Handle) -> Option<T> {
        if (h.slot as usize) >= self.slots.len() || self.generations[h.slot as usize] != h.generation {
            return None;
        }
        let v = self.slots[h.slot as usize].take();
        if v.is_some() {
            self.generations[h.slot as usize] = self.generations[h.slot as usize].wrapping_add(1);
            self.free.push(h.slot);
        }
        v
    }

    pub fn iter(&self) -> impl Iterator<Item = (Handle, &T)> {
        self.slots.iter().enumerate().filter_map(move |(i, o)| {
            o.as_ref().map(|v| (Handle { slot: i as u32, generation: self.generations[i] }, v))
        })
    }

    pub fn len(&self) -> usize {
        self.slots.iter().filter(|s| s.is_some()).count()
    }
}

impl<T> Default for SlotMap<T> {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_get() {
        let mut s: SlotMap<i32> = SlotMap::new();
        let h = s.insert(42);
        assert_eq!(s.get(h), Some(&42));
    }

    #[test]
    fn remove_invalidates_handle() {
        let mut s: SlotMap<i32> = SlotMap::new();
        let h = s.insert(42);
        s.remove(h);
        assert_eq!(s.get(h), None);
    }

    #[test]
    fn reused_slot_different_generation() {
        let mut s: SlotMap<i32> = SlotMap::new();
        let h1 = s.insert(42);
        s.remove(h1);
        let h2 = s.insert(99);
        assert_eq!(h1.slot, h2.slot);
        assert_ne!(h1.generation, h2.generation);
        assert_eq!(s.get(h1), None);
        assert_eq!(s.get(h2), Some(&99));
    }
}
```

- [ ] **Step 2: Add to lib.rs + test**

```rust
pub mod slotmap;
pub use slotmap::{Handle, SlotMap};
```

```bash
cd weydra-renderer
cargo test --package weydra-renderer slotmap
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): generational SlotMap<T> with Handle opaque to TS"
```

---

### Task 2: Texture registry + upload

**Files:**
- Create: `weydra-renderer/core/src/texture.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write TextureRegistry**

Create `weydra-renderer/core/src/texture.rs`:

```rust
use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};

pub struct Texture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    pub width: u32,
    pub height: u32,
}

pub struct TextureRegistry {
    textures: SlotMap<Texture>,
}

impl TextureRegistry {
    pub fn new() -> Self {
        Self { textures: SlotMap::with_capacity(64) }
    }

    /// Upload RGBA8 bytes as a new texture. Bytes must be width*height*4 length.
    pub fn upload_rgba(&mut self, ctx: &GpuContext, bytes: &[u8], width: u32, height: u32) -> Handle {
        assert_eq!(bytes.len(), (width * height * 4) as usize, "bytes len mismatch");

        let texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("weydra texture"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        ctx.queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );

        let view = texture.create_view(&Default::default());
        let sampler = ctx.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("weydra sampler"),
            mag_filter: wgpu::FilterMode::Nearest, // matches game's pixel-art aesthetic
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        self.textures.insert(Texture { texture, view, sampler, width, height })
    }

    pub fn get(&self, h: Handle) -> Option<&Texture> {
        self.textures.get(h)
    }

    /// Insert a pre-built Texture (used by render-to-texture paths like M5 bake).
    /// Most callers use `upload_rgba`; this is the escape hatch for wgpu textures
    /// created elsewhere (e.g. RenderTarget texture).
    pub fn insert(&mut self, t: Texture) -> Handle {
        self.textures.insert(t)
    }
}

impl Default for TextureRegistry {
    fn default() -> Self { Self::new() }
}
```

- [ ] **Step 2: Add to lib.rs + commit**

```rust
pub mod texture;
pub use texture::{Texture, TextureRegistry};
```

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): TextureRegistry with RGBA upload + nearest sampler"
```

---

### Task 3: Sprite pool with SoA layout + pointer exports

**Files:**
- Create: `weydra-renderer/core/src/sprite.rs`

- [ ] **Step 1: Write Sprite pool**

Create `weydra-renderer/core/src/sprite.rs`:

```rust
use crate::slotmap::{Handle, SlotMap};

/// Per-sprite transform. TS writes to these directly via typed array views.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct SpriteTransform {
    pub x: f32,
    pub y: f32,
    pub scale_x: f32, // negative = horizontally flipped
    pub scale_y: f32,
}

impl Default for SpriteTransform {
    fn default() -> Self { Self { x: 0.0, y: 0.0, scale_x: 1.0, scale_y: 1.0 } }
}

/// Per-sprite UV sub-frame (for spritesheets). Coords in 0..1 of parent texture.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct SpriteUv {
    pub u: f32,
    pub v: f32,
    pub w: f32,
    pub h: f32,
}

impl Default for SpriteUv {
    fn default() -> Self { Self { u: 0.0, v: 0.0, w: 1.0, h: 1.0 } }
}

/// Sprite metadata — texture + display size. Less frequently updated than transform.
pub struct SpriteMeta {
    pub texture: Handle,
    pub display_w: f32,
    pub display_h: f32,
}

/// SoA pool: arrays are contiguous per-attribute, indexed by sprite handle slot.
/// All f32/u32 arrays have their pointers exposed via wasm so TS can write directly.
pub struct SpritePool {
    pub transforms: Vec<SpriteTransform>, // N × 16 bytes
    pub uvs: Vec<SpriteUv>,               // N × 16 bytes
    pub colors: Vec<u32>,                 // N × 4 bytes (RGBA8 packed tint)
    pub flags: Vec<u8>,                   // N × 1 byte (bit 0 = visible)
    pub z_order: Vec<f32>,                // N × 4 bytes

    pub meta: SlotMap<SpriteMeta>,
    capacity: usize,
}

pub const FLAG_VISIBLE: u8 = 0b0000_0001;

impl SpritePool {
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            transforms: vec![SpriteTransform::default(); cap],
            uvs: vec![SpriteUv::default(); cap],
            colors: vec![0xFFFFFFFF; cap],
            flags: vec![0; cap],
            z_order: vec![0.0; cap],
            meta: SlotMap::with_capacity(cap),
            capacity: cap,
        }
    }

    pub fn is_full(&self) -> bool {
        // Full quando slotmap ocupou todos os slots que SoA pools pre-alocaram.
        // SlotMap::insert faz Vec::push quando `free` vazio — mas nossos arrays
        // SoA são fixed-size, então qualquer insert acima de `capacity` seria OOB.
        self.meta.len() >= self.capacity
    }

    pub fn insert(&mut self, texture: Handle, display_w: f32, display_h: f32) -> Handle {
        assert!(
            !self.is_full(),
            "SpritePool full (cap={}). SlotMap::insert would grow beyond SoA array bounds. \
             Increase capacity or destroy unused sprites first.",
            self.capacity,
        );
        let h = self.meta.insert(SpriteMeta { texture, display_w, display_h });
        debug_assert!((h.slot as usize) < self.capacity);
        self.transforms[h.slot as usize] = SpriteTransform::default();
        self.uvs[h.slot as usize] = SpriteUv::default();
        self.colors[h.slot as usize] = 0xFFFFFFFF;
        self.flags[h.slot as usize] = FLAG_VISIBLE;
        self.z_order[h.slot as usize] = 0.0;
        h
    }

    pub fn remove(&mut self, h: Handle) {
        self.meta.remove(h);
        self.flags[h.slot as usize] = 0;
    }

    pub fn capacity(&self) -> usize { self.capacity }
}
```

- [ ] **Step 2: Add to lib.rs + commit**

```rust
pub mod sprite;
pub use sprite::{SpritePool, SpriteTransform, SpriteUv, SpriteMeta, FLAG_VISIBLE};
```

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): SpritePool SoA with per-attribute pointer-ready Vecs"
```

---

### Task 4: Sprite batch shader + pipeline

**Files:**
- Create: `weydra-renderer/core/shaders/sprite_batch.wgsl`

- [ ] **Step 1: Write batched sprite shader**

Create `weydra-renderer/core/shaders/sprite_batch.wgsl`:

```wgsl
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad: vec3<f32>,
};

// WGSL std140 alignment: vec2<f32> precisa 8-byte align, vec4 precisa 16-byte.
// Layout total 48 bytes (múltiplo de 16):
//   transform: vec4    offset  0 (16 bytes, 16-align ✓)
//   uv_rect:   vec4    offset 16 (16 bytes, 16-align ✓)
//   color:     u32     offset 32 ( 4 bytes,  4-align ✓)
//   _pad0:     u32     offset 36 (pad pra trazer `display` pra 8-align)
//   display:   vec2    offset 40 ( 8 bytes,  8-align ✓)
// Struct alignment = 16 (vec4). Total 48 = 3×16 ✓, sem trailing pad.
struct SpriteData {
    transform: vec4<f32>, // offset 0
    uv_rect: vec4<f32>,   // offset 16
    color: u32,           // offset 32
    _pad0: u32,           // offset 36 — força `display` pra offset 40 (8-align)
    display: vec2<f32>,   // offset 40
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> sprites: array<SpriteData>;
@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var samp: sampler;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
    let sprite = sprites[iid];

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5, -0.5), vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5,  0.5), vec2<f32>(-0.5,  0.5),
    );
    let c = corners[vid];
    let local = vec2<f32>(c.x * sprite.display.x * sprite.transform.z,
                          c.y * sprite.display.y * sprite.transform.w);
    let world = vec2<f32>(sprite.transform.x, sprite.transform.y) + local;
    let ndc = (world - engine_camera.camera) / (engine_camera.viewport * 0.5);

    let r = f32((sprite.color >> 24u) & 0xffu) / 255.0;
    let g = f32((sprite.color >> 16u) & 0xffu) / 255.0;
    let b = f32((sprite.color >> 8u)  & 0xffu) / 255.0;
    let a = f32(sprite.color         & 0xffu) / 255.0;

    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = sprite.uv_rect.xy + (c + 0.5) * sprite.uv_rect.zw;
    out.color = vec4<f32>(r, g, b, a);
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let texel = textureSample(tex, samp, in.uv);
    return texel * in.color;
}
```

- [ ] **Step 2: Escrever variant WebGL2 instanced**

Este milestone **tem** que prover ambos paths (WebGPU storage buffer + WebGL2 vertex-attribute) — ver "Scope extensions absorved into M3" no topo do plano. Criar `core/shaders/sprite_batch_instanced.wgsl` com per-instance vertex attributes:

```wgsl
struct CameraUniforms { camera: vec2<f32>, viewport: vec2<f32>, time: f32, _pad: vec3<f32> };
@group(0) @binding(0) var<uniform> cam: CameraUniforms;
@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var samp: sampler;

// Per-instance attributes (VertexStepMode::Instance)
struct InstanceIn {
  @location(0) transform: vec4<f32>,  // x, y, scale_x, scale_y
  @location(1) uv_rect: vec4<f32>,    // u, v, w, h
  @location(2) color_rgba: u32,       // RGBA8
  @location(3) display: vec2<f32>,
  // vertex_index usado pra pegar corner (0..6)
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, inst: InstanceIn) -> VsOut {
  // mesma lógica de corners do shader storage, só lendo de inst.* em vez de sprites[iid]
}
```

Detecção de backend no boot + selecionar pipeline: ver "Scope extensions" no topo. Ambas variants expõem a mesma API TS (`create_sprite`, etc).

- [ ] **Step 3: Commit**

```bash
git add weydra-renderer/core/shaders/sprite_batch.wgsl
git commit -m "feat(weydra-renderer): sprite_batch.wgsl — instanced textured quad shader"
```

---

### Task 5: Wire sprite pool, texture, shader into pipeline in wasm adapter

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`

- [ ] **Step 1: Extend Renderer**

Add fields:
```rust
sprites: SpritePool,
textures: TextureRegistry,
sprite_pipeline: Option<wgpu::RenderPipeline>,
sprite_storage_buffer: wgpu::Buffer,
sprite_storage_bind_group: wgpu::BindGroup,
mem_version: u32,
```

Add methods:

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn upload_texture(&mut self, bytes: &[u8], width: u32, height: u32) -> u64 {
        let h = self.textures.upload_rgba(&self.ctx, bytes, width, height);
        self.mem_version = self.mem_version.wrapping_add(1);
        h.to_u64()
    }

    pub fn create_sprite(&mut self, texture: u64, display_w: f32, display_h: f32) -> u64 {
        let tex = Handle::from_u64(texture);
        // Panic if exceeding pre-allocated capacity: Vec::push would realloc
        // and invalidate typed array views on the TS side silently.
        assert!(
            self.sprites.meta.len() < self.sprites.capacity(),
            "SpritePool overflow: increase SPRITE_CAPACITY. Silent memory growth would invalidate TS typed views."
        );
        let h = self.sprites.insert(tex, display_w, display_h);
        h.to_u64()
    }

    pub fn destroy_sprite(&mut self, handle: u64) {
        self.sprites.remove(Handle::from_u64(handle));
    }

    pub fn sprite_transforms_ptr(&self) -> u32 { self.sprites.transforms.as_ptr() as u32 }
    pub fn sprite_uvs_ptr(&self) -> u32 { self.sprites.uvs.as_ptr() as u32 }
    pub fn sprite_colors_ptr(&self) -> u32 { self.sprites.colors.as_ptr() as u32 }
    pub fn sprite_flags_ptr(&self) -> u32 { self.sprites.flags.as_ptr() as u32 }
    pub fn sprite_z_ptr(&self) -> u32 { self.sprites.z_order.as_ptr() as u32 }
    pub fn sprite_capacity(&self) -> u32 { self.sprites.capacity() as u32 }
    pub fn mem_version(&self) -> u32 { self.mem_version }
}
```

Definir o layout AoS que casa com `sprite_batch.wgsl` `SpriteData` struct (48 bytes, alinhado):

```rust
// MATCH EXATO do WGSL struct SpriteData em sprite_batch.wgsl.
// Qualquer change aqui precisa sync com o WGSL.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct SpriteData {
    pub transform: [f32; 4],  // offset 0  — x, y, scale_x, scale_y
    pub uv_rect: [f32; 4],    // offset 16 — u, v, w, h
    pub color: u32,           // offset 32
    pub _pad0: u32,           // offset 36 — força display pra 8-align
    pub display: [f32; 2],    // offset 40 — display_w, display_h
}
const _: () = assert!(std::mem::size_of::<SpriteData>() == 48);
```

Update `render()` to:
1. Build sprite SoA → AoS into storage buffer (one `SpriteData` per visible sprite)
2. Group sprites by texture, issue one draw call per texture with instance_count = N
3. Set bind group 0 (engine), 1 (sprite storage), 2 (texture)
4. Draw 6 vertices × N instances

Exact implementation is substantial — likely 200 lines of pipeline/encoder code. Key points:
- Filter + sort sprites by (texture_id, z_order) into temporary Vec per frame
- For each visible sprite, pack `SpriteData { transform: [x,y,sx,sy], uv_rect: [u,v,w,h], color, _pad0: 0, display: [dw,dh] }`
- memcpy `bytemuck::cast_slice(&sprites_data)` into `staging_buffer`
- `queue.write_buffer(&storage_buffer, 0, ...)` upload
- 1 draw call per contiguous run with same texture (6 verts × N instances)

- [ ] **Step 2: Rebuild WASM + commit**

```bash
cd weydra-renderer/adapters/wasm
wasm-pack build --target web --out-dir pkg
git add weydra-renderer/adapters/wasm/
git commit -m "feat(weydra-wasm): sprite pool API + render batching"
```

---

### Task 6: TS bridge — Sprite class with shared memory setters

**Files:**
- Modify: `weydra-renderer/ts-bridge/index.ts`

- [ ] **Step 1: Add Sprite class and view management**

```typescript
interface PoolViews {
  transforms: Float32Array;
  uvs: Float32Array;
  colors: Uint32Array;
  flags: Uint8Array;
  zOrder: Float32Array;
}

export class Renderer {
  // ... existing fields
  private _views: PoolViews | null = null;
  private _lastMemVersion: number = 0;

  private _lastBuffer: ArrayBuffer | null = null;

  private revalidate(): void {
    const v = this.inner.mem_version();
    const mem = _wasm.memory.buffer;
    // DUPLA checagem: mem_version E buffer identity. memory.grow() sem
    // mem_version bump (edge case ou bug em Rust) ainda deixa views detached.
    if (v === this._lastMemVersion && mem === this._lastBuffer && this._views) return;
    const cap = this.inner.sprite_capacity();
    this._views = {
      transforms: new Float32Array(mem, this.inner.sprite_transforms_ptr(), cap * 4),
      uvs: new Float32Array(mem, this.inner.sprite_uvs_ptr(), cap * 4),
      colors: new Uint32Array(mem, this.inner.sprite_colors_ptr(), cap),
      flags: new Uint8Array(mem, this.inner.sprite_flags_ptr(), cap),
      zOrder: new Float32Array(mem, this.inner.sprite_z_ptr(), cap),
    };
    this._lastMemVersion = v;
    this._lastBuffer = mem;
  }

  uploadTexture(bytes: Uint8Array, width: number, height: number): bigint {
    const h = this.inner.upload_texture(bytes, width, height);
    this.revalidate();
    return BigInt(h);
  }

  createSprite(texture: bigint, displayW: number, displayH: number): Sprite {
    const h = this.inner.create_sprite(texture, displayW, displayH);
    this.revalidate();
    return new Sprite(BigInt(h), this);
  }

  destroySprite(s: Sprite): void {
    this.inner.destroy_sprite(s.handle);
    this.revalidate();
  }

  get views(): PoolViews {
    this.revalidate();
    return this._views!;
  }
}

export class Sprite {
  constructor(public readonly handle: bigint, private readonly r: Renderer) {}

  private get slot(): number { return Number(this.handle & 0xFFFFFFFFn); }

  set x(v: number) { this.r.views.transforms[this.slot * 4 + 0] = v; }
  get x(): number { return this.r.views.transforms[this.slot * 4 + 0]; }
  set y(v: number) { this.r.views.transforms[this.slot * 4 + 1] = v; }
  get y(): number { return this.r.views.transforms[this.slot * 4 + 1]; }
  set scaleX(v: number) { this.r.views.transforms[this.slot * 4 + 2] = v; }
  set scaleY(v: number) { this.r.views.transforms[this.slot * 4 + 3] = v; }
  set tint(v: number) { this.r.views.colors[this.slot] = v; }
  set visible(v: boolean) { this.r.views.flags[this.slot] = v ? 1 : 0; }
  set zOrder(v: number) { this.r.views.zOrder[this.slot] = v; }
  setUv(u: number, v: number, w: number, h: number): void {
    const b = this.slot * 4;
    this.r.views.uvs[b+0]=u; this.r.views.uvs[b+1]=v; this.r.views.uvs[b+2]=w; this.r.views.uvs[b+3]=h;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add weydra-renderer/ts-bridge/
git commit -m "feat(ts-bridge): Sprite class with shared-memory setters + revalidation"
```

---

### Task 7: Game integration — ships via weydra

**Files:**
- Modify: `src/world/spritesheets.ts`
- Modify: `src/world/naves.ts`

- [ ] **Step 1: Expose spritesheet bytes for weydra upload**

In `spritesheets.ts`, when loading `ships.png`, also fetch it as ArrayBuffer:

```typescript
const response = await fetch('assets/ships.png');
const blob = await response.blob();
const bitmap = await createImageBitmap(blob);
const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
const ctx = canvas.getContext('2d')!;
ctx.drawImage(bitmap, 0, 0);
const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

// Keep both: Pixi Texture (current path) AND raw bytes + dimensions
sheet.rawBytes = new Uint8Array(imageData.data.buffer);
sheet.width = bitmap.width;
sheet.height = bitmap.height;
```

- [ ] **Step 2: Add ship weydra path in naves.ts**

```typescript
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { Sprite as WeydraSprite } from '@weydra/renderer';

// In criarNave, branch:
if (getConfig().weydra.ships) {
  const r = getWeydraRenderer();
  if (r) {
    const sheet = getSpritesheet('ships');
    if (!sheet.weydraTexture) {
      sheet.weydraTexture = r.uploadTexture(sheet.rawBytes, sheet.width, sheet.height);
    }
    const displaySize = SHIP_DISPLAY_SIZE[tipo] ?? 32;
    const weydraSprite = r.createSprite(sheet.weydraTexture, displaySize, displaySize);
    // UV for sub-frame. Cells are 96×96 px. Sheet is 480×384 (5 cols × 4 rows).
    // Normalize per-axis: uWidth = 96 / sheet.width, vHeight = 96 / sheet.height.
    const row = SHIP_SHEET_ROW[tipo] ?? 0;
    const col = tipo === 'colonizadora' ? 0 : Math.max(0, Math.min(4, tier - 1));
    const CELL_PX = 96;
    const uW = CELL_PX / sheet.width;
    const vH = CELL_PX / sheet.height;
    weydraSprite.setUv(col * uW, row * vH, uW, vH);
    weydraSprite.tint = SHIP_TINT[tipo] ?? 0xFFFFFFFF;
    nave._weydraSprite = weydraSprite;
    return nave;
  }
}
// ... existing Pixi path
```

In `atualizarNaves`, branch the position update:

```typescript
if (nave._weydraSprite) {
  nave._weydraSprite.x = nave.x;
  nave._weydraSprite.y = nave.y;
  nave._weydraSprite.visible = nave.visivel;
  // scale.x negative when facing left, like existing Pixi logic
  nave._weydraSprite.scaleX = nave.flippedX ? -1 : 1;
} else {
  // existing Pixi sprite update
}
```

Destroy: when `removerNave` called, also destroy weydra sprite:
```typescript
if (nave._weydraSprite) {
  const r = getWeydraRenderer();
  if (r) r.destroySprite(nave._weydraSprite);
}
```

- [ ] **Step 3: Add flag + commit**

Update `config.ts` weydra flags: add `ships: boolean`.

```bash
git add src/world/ src/core/config.ts
git commit -m "feat(orbital): ships via weydra behind weydra.ships flag"
```

---

### Task 8: Re-wire ship select to DOM event

**Files:**
- Modify: `src/core/player.ts`

- [ ] **Step 1: Check if already DOM-based**

Per audit, ship select already uses DOM (`canvas.addEventListener`). Verify in `player.ts` the click path uses `encontrarNaveNoPonto(worldX, worldY)` and not Pixi eventMode.

If already DOM: no change needed — confirm.
If Pixi event path exists: replace with DOM listener on the Pixi canvas (which stays on top during migration).

- [ ] **Step 2: Commit (if changed)**

```bash
git add src/core/player.ts
git commit -m "chore(input): confirm ship select uses DOM event path"
```

---

### Task 9: Validation

- [ ] **Step 1: Performance comparison**

Enable flag, open game with 40 ships visible, profile 10s. Compare `naves` + `render_naves` buckets:
- Pixi baseline (hoje): ~0.056ms avg, 0.073ms p95 (naves) + 0.006ms render_naves
- weydra target: ≤ Pixi avg, ideally 30%+ melhor pelo batching

- [ ] **Step 2: Visual parity**

Screenshot comparison with same seed. Ships should render at same position, same scale, same tint. Flip direction working. Sub-frame UVs correct (fragata tier 3 = row 3 col 2, etc.).

- [ ] **Step 3: Stress test**

Spawn 300 ships (debug cheat). Frame time should stay sub-2ms for ship rendering — far below Pixi's linear growth.

- [ ] **Step 4: Mark complete**

```markdown
## M3 Status: Complete (YYYY-MM-DD)
Ships via weydra. Sprite pool + shared memory + batched rendering live.
```

```bash
git add docs/superpowers/specs/2026-04-19-weydra-renderer-design.md
git commit -m "docs(weydra-renderer): mark M3 Ships complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ SlotMap generational indices
- ✅ SoA pool with pointer exports
- ✅ Shared memory via typed array views
- ✅ mem_version revalidation
- ✅ Sprite batcher (instanced)
- ✅ Texture atlas + sub-frame UVs
- ✅ Tint support
- ✅ Feature flag

**Deferred:**
- Trails (M3 uses simple sprite-based particles; full graphics API for trails in M7)
- Z-ordering across sprite+mesh+graphics layers (resolved in M7 when unified scene-graph rendering hits)
- WebGL2 fallback for storage buffers (vertex attribute path — follow-up task)

**Risks:**
- Storage buffer absent in WebGL2 → fallback needed. Test early in M3.
- 300 sprites stress test may hit GPU memory bandwidth — if so, batch consolidation or tighter SoA packing.
- Revalidation after every setup op can thrash if texture uploads happen per-frame — document this in ts-bridge (upload textures once at boot, not per-frame).
