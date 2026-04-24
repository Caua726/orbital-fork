# weydra-renderer M2 Starfield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Port the starfield (both the procedural shader layer and the baked TilingSprite bright layer) to weydra-renderer. First custom shader running, first uniform buffer system, first bind group convention in practice.

**Architecture:** Add `Mesh` primitive to core (custom-shader fullscreen quad). Add `ShaderRegistry` for compiling WGSL modules. Add per-shader uniform pool (homogeneous Vec<T>) — starfield has exactly 1 instance. Extend Vite plugin to reflect uniforms via naga. Port `starfield.wgsl` to bind group 0 (engine camera) + bind group 1 (custom uniforms). Game flips flag `useWeydraStarfield` and renders via weydra instead of Pixi.

**Tech Stack:** M1 foundation + naga reflection + wgpu mesh/pipeline APIs.

**Depends on:** M1 complete.

## Convenção de views sobre WASM memory (válida de M2 em diante)

`WebAssembly.Memory.buffer` detacha e realoca silenciosamente a cada `memory.grow()`. Views tipadas cached sobre o buffer antigo viram no-op. Regra do projeto:

1. **Nunca cache o `_wasm.memory.buffer` por mais de 1 chamada síncrona.** Qualquer função que escreve em typed array views **re-lê** `_wasm.memory.buffer` na hora (`new Float32Array(_wasm.memory.buffer, ptr, len)`).
2. **O Rust bump `mem_version` após TODA operação que pode crescer memory.** Não só texture upload — qualquer `create_*`, `upload_*`, `resize_*`.
3. **TS `revalidate()` compara `mem_version` + `_wasm.memory.buffer` identity.** Se qualquer um mudou, recria todas as views.

```typescript
// Pattern canônico:
private lastBuffer: ArrayBuffer | null = null;
private lastVersion = 0;
private revalidate() {
  const ver = this.inner.mem_version();
  const buf = _wasm.memory.buffer;
  if (ver === this.lastVersion && buf === this.lastBuffer) return;
  this.lastVersion = ver;
  this.lastBuffer = buf;
  // rebuild all typed-array views from fresh buf + current ptrs
  this.rebuildViews();
}
```

Cada `FogLayer`, `PlanetInstance`, `Sprite`, etc. chama `revalidate()` via seu Renderer parent antes de setter ops ou usa getters que internamente rebuildam se detached. Ver M3 para exemplo completo.

## Convenção de CameraUniforms (decidida em M2, válida de M2 em diante)

`CameraUniforms.viewport` é **world units visíveis**, não pixels de tela. O caller (camera.ts) computa `viewport = [screenW / zoom, screenH / zoom]` uma vez por frame e escreve no UBO. Shaders ficam zoom-agnostic — nunca multiplicam/dividem por zoom manualmente.

Motivação: bind group 0 é compartilhado por todos os shaders (starfield, planet, fog). Se o contrato for "viewport em pixels + zoom separado", cada shader precisa aplicar zoom certo (fácil de esquecer). Com world-units, o shader só faz `camera + (uv - 0.5) * viewport` e já está correto em qualquer zoom.

Todas as amostras de shader abaixo assumem essa convenção.

## Escopo do M2 — bright star layer

Bright star layer (TilingSprite com texture baked) **fica em Pixi até M3**. M2 scope cobre apenas o procedural starfield (fragment shader) — o único que precisa Mesh + UniformPool. TilingSprite de textura requer texture bind group 2, que M3 provê via sprite pool infra. Critério de merge relaxado: "starfield procedural parity via weydra; bright layer continua em Pixi até M3".

Remover Task 7 (TilingSprite) deste plano — ela reaparece em M3 como sub-task do sprite pool.

---

## File Structure

**New in core:**
- `core/src/mesh.rs` — Mesh primitive: custom shader + unit quad + uniform buffer slot
- `core/src/shader.rs` — ShaderRegistry with WGSL module compilation
- `core/src/uniform_pool.rs` — per-shader-type uniform Vec + GPU buffer mirror
- `core/src/bind_groups.rs` — standard bind group 0 (CameraUniforms) layout + helper
- `core/src/tiling_sprite.rs` — TilingSprite primitive (texture + UV repeat quad)
- `core/shaders/sprite.wgsl` — tiling sprite shader (simple textured quad with tilePosition offset)

**Modified in core:**
- `core/src/lib.rs` — re-exports
- `core/src/frame.rs` — render_clear gets companion `begin_frame`/`submit_mesh`/`end_frame`
- `core/src/device.rs` — GpuContext gains camera uniform buffer

**New in adapters/wasm:**
- `adapters/wasm/src/mesh.rs` — wasm exports for Mesh create/destroy/set-uniform-ptr

**Modified in adapters/wasm:**
- `adapters/wasm/src/lib.rs` — Renderer gains `create_mesh`, `create_tiling_sprite`, `set_camera`

**New in vite-plugin-wgsl:**
- `vite-plugin-wgsl/reflect.ts` — calls naga (via `@wgsl_reflect/wgsl_reflect` npm package) to extract uniform layouts
- `vite-plugin-wgsl/codegen.ts` — emits typed TS module from layout

**Modified in vite-plugin-wgsl:**
- `vite-plugin-wgsl/index.ts` — uses reflect + codegen instead of raw source

**Game:**
- Modify: `src/shaders/starfield.wgsl` — move from Orbital's current location, update bindings
- Delete: `src/shaders/starfield.frag` (if GLSL version exists)
- Modify: `src/world/fundo.ts` — branch on `useWeydraStarfield`
- Modify: `src/core/config.ts` — add `weydraFlags.starfield` boolean (default false)

---

### Task 1: Shader registry with WGSL compilation

**Files:**
- Create: `weydra-renderer/core/src/shader.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write ShaderRegistry**

Create `weydra-renderer/core/src/shader.rs`:

```rust
use crate::device::GpuContext;
use std::collections::HashMap;

pub struct ShaderHandle(pub u32);

pub struct CompiledShader {
    pub module: wgpu::ShaderModule,
    pub source_hash: u64,
}

pub struct ShaderRegistry {
    shaders: Vec<CompiledShader>,
    by_hash: HashMap<u64, u32>,
}

impl ShaderRegistry {
    pub fn new() -> Self {
        Self { shaders: Vec::new(), by_hash: HashMap::new() }
    }

    /// Compile a WGSL source string into a shader module. Cached by source hash —
    /// repeated calls with identical source return the same handle.
    pub fn compile(&mut self, ctx: &GpuContext, source: &str, label: &str) -> ShaderHandle {
        let hash = fxhash(source);
        if let Some(&idx) = self.by_hash.get(&hash) {
            return ShaderHandle(idx);
        }

        let module = ctx.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(label),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });

        let idx = self.shaders.len() as u32;
        self.shaders.push(CompiledShader { module, source_hash: hash });
        self.by_hash.insert(hash, idx);
        ShaderHandle(idx)
    }

    pub fn get(&self, h: ShaderHandle) -> Option<&CompiledShader> {
        self.shaders.get(h.0 as usize)
    }
}

impl Default for ShaderRegistry {
    fn default() -> Self { Self::new() }
}

/// Deterministic hash so cache hits on repeated compile calls. `RandomState`
/// would seed each hasher differently — `ShaderRegistry` cache would never hit.
fn fxhash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    // DefaultHasher uses SipHash-1-3 with a fixed internal key. Deterministic
    // across calls within the same process; good enough for cache dedup.
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
```

- [ ] **Step 2: Add to lib.rs**

Update exports in `weydra-renderer/core/src/lib.rs` to include `pub mod shader;` and `pub use shader::{ShaderRegistry, ShaderHandle};`.

- [ ] **Step 3: Verify compiles**

```bash
cd weydra-renderer && cargo build --package weydra-renderer
```

- [ ] **Step 4: Commit**

```bash
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): ShaderRegistry with WGSL compilation + caching"
```

---

### Task 2: CameraUniforms GPU buffer + bind group 0 layout

**Files:**
- Create: `weydra-renderer/core/src/bind_groups.rs`
- Modify: `weydra-renderer/core/src/camera.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write bind groups module**

Create `weydra-renderer/core/src/bind_groups.rs`:

```rust
use crate::camera::CameraUniforms;
use crate::device::GpuContext;

/// Engine-owned bind group 0, shared by all custom shaders.
/// Layout: uniform buffer at binding 0 = CameraUniforms struct.
pub struct EngineBindings {
    pub camera_buffer: wgpu::Buffer,
    pub layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
}

impl EngineBindings {
    pub fn new(ctx: &GpuContext) -> Self {
        let camera_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("weydra engine camera uniforms"),
            size: CameraUniforms::BYTE_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let layout = ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("weydra engine bind group layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: wgpu::BufferSize::new(CameraUniforms::BYTE_SIZE),
                },
                count: None,
            }],
        });

        let bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("weydra engine bind group"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buffer.as_entire_binding(),
            }],
        });

        Self { camera_buffer, layout, bind_group }
    }

    /// Write camera uniforms to GPU. Call once per frame before any mesh draw.
    pub fn update(&self, ctx: &GpuContext, uniforms: &CameraUniforms) {
        ctx.queue.write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(uniforms));
    }
}
```

- [ ] **Step 2: Add to lib.rs**

Add `pub mod bind_groups; pub use bind_groups::EngineBindings;` to `lib.rs`.

- [ ] **Step 3: Verify + commit**

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): EngineBindings — bind group 0 with CameraUniforms buffer"
```

---

### Task 3: Uniform pool for per-shader-type uniforms

**Files:**
- Create: `weydra-renderer/core/src/uniform_pool.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write uniform pool**

Create `weydra-renderer/core/src/uniform_pool.rs`:

```rust
use crate::device::GpuContext;
use std::marker::PhantomData;

/// Generic homogeneous pool of uniforms for one specific shader type.
///
/// Each shader with custom uniforms gets its own UniformPool<MyUniforms>.
/// The CPU-side Vec<T> is mirrored to a wgpu Buffer that shader instances
/// read via bind group 1. Pointer to the Vec is exposed to TS via wasm
/// so updates happen via direct memory writes in the hot path.
pub struct UniformPool<T: bytemuck::Pod + bytemuck::Zeroable> {
    pub instances: Vec<T>,
    pub gpu_buffer: wgpu::Buffer,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
    capacity: usize,
    _phantom: PhantomData<T>,
}

impl<T: bytemuck::Pod + bytemuck::Zeroable> UniformPool<T> {
    pub fn new(ctx: &GpuContext, label: &str, capacity: usize) -> Self {
        let byte_size = (std::mem::size_of::<T>() * capacity) as u64;

        let gpu_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: byte_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group_layout = ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(&format!("{label} layout")),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<T>() as u64),
                },
                count: None,
            }],
        });

        let bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&format!("{label} bind group")),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: gpu_buffer.as_entire_binding(),
            }],
        });

        let mut instances = Vec::with_capacity(capacity);
        instances.resize(capacity, T::zeroed());

        Self { instances, gpu_buffer, bind_group_layout, bind_group, capacity, _phantom: PhantomData }
    }

    /// Upload current CPU instances to GPU. Call once per frame before draw.
    pub fn upload(&self, ctx: &GpuContext) {
        ctx.queue.write_buffer(&self.gpu_buffer, 0, bytemuck::cast_slice(&self.instances));
    }

    /// Pointer to the contiguous instances Vec, exposed via wasm so TS can
    /// construct a typed array view for direct memory writes.
    pub fn instances_ptr(&self) -> *const T {
        self.instances.as_ptr()
    }

    pub fn capacity(&self) -> usize { self.capacity }
}
```

- [ ] **Step 2: Add to lib.rs + commit**

```rust
pub mod uniform_pool;
pub use uniform_pool::UniformPool;
```

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): UniformPool<T> — homogeneous uniform buffer with ptr export"
```

---

### Task 4: Mesh primitive (fullscreen quad + custom shader + uniforms)

**Files:**
- Create: `weydra-renderer/core/src/mesh.rs`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write Mesh**

Create `weydra-renderer/core/src/mesh.rs`:

```rust
use crate::bind_groups::EngineBindings;
use crate::device::GpuContext;
use crate::shader::{ShaderHandle, ShaderRegistry};

/// A full-screen quad mesh driven by a custom WGSL shader.
///
/// Used for backgrounds (starfield), procedural effects (planet surface),
/// and post-processing. The mesh itself is a shared unit quad — instances
/// differ only in their bind groups (which uniform slot they read).
pub struct Mesh {
    pub pipeline: wgpu::RenderPipeline,
    pub shader: ShaderHandle,
}

impl Mesh {
    pub fn new(
        ctx: &GpuContext,
        registry: &ShaderRegistry,
        shader: ShaderHandle,
        surface_format: wgpu::TextureFormat,
        engine_bind_group_layout: &wgpu::BindGroupLayout,
        custom_uniform_layout: Option<&wgpu::BindGroupLayout>,
        label: &str,
    ) -> Self {
        let shader_module = &registry.get(shader).expect("shader not found").module;

        let mut layouts: Vec<&wgpu::BindGroupLayout> = vec![engine_bind_group_layout];
        if let Some(custom) = custom_uniform_layout {
            layouts.push(custom);
        }

        let pipeline_layout = ctx.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(&format!("{label} layout")),
            bind_group_layouts: &layouts,
            push_constant_ranges: &[],
        });

        let pipeline = ctx.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: shader_module,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: shader_module,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self { pipeline, shader }
    }

    /// Record draw commands for this mesh into the given render pass.
    /// Engine bind group 0 must already be set by the caller.
    pub fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, custom_bind_group: Option<&'a wgpu::BindGroup>) {
        pass.set_pipeline(&self.pipeline);
        if let Some(bg) = custom_bind_group {
            pass.set_bind_group(1, bg, &[]);
        }
        pass.draw(0..6, 0..1); // 2 triangles = 6 vertices; generated in vertex shader via @builtin(vertex_index)
    }
}
```

- [ ] **Step 2: Add to lib.rs + commit**

```rust
pub mod mesh;
pub use mesh::Mesh;
```

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): Mesh primitive — pipeline + draw fullscreen quad"
```

---

### Task 5: Port starfield.wgsl to new bind group convention

**Files:**
- Modify: `src/shaders/starfield.wgsl` (move from current location)

- [ ] **Step 1: Move the shader file**

```bash
# Current location per audit
mv src/shaders/starfield.wgsl src/shaders/starfield.wgsl.bak
# Game-owned location in the new structure
mkdir -p src/shaders
mv src/shaders/starfield.wgsl.bak src/shaders/starfield.wgsl
```

(Already in `src/shaders/` per spec update; if already moved, skip.)

- [ ] **Step 2: Rewrite bindings**

Open `src/shaders/starfield.wgsl` and update the struct bindings:

Before (Pixi-style with auto transform):
```wgsl
@group(0) @binding(0) var<uniform> pixi_transforms: ...;
@group(1) @binding(0) var<uniform> starUniforms: StarUniforms;
```

After (weydra convention):
```wgsl
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad: vec3<f32>,
};

struct StarfieldUniforms {
    density: f32,
    _pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> starfield: StarfieldUniforms;

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
    // Full-screen triangle strip via vertex_index trick (no vertex buffer needed):
    let x = f32(((idx << 1u) & 2u));
    let y = f32((idx & 2u));
    return vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) coord: vec4<f32>) -> @location(0) vec4<f32> {
    let world_pos = engine_camera.camera + (coord.xy / engine_camera.viewport - 0.5) * engine_camera.viewport;
    let t = engine_camera.time;
    let dens = starfield.density;

    // Existing star layer logic goes here, using world_pos/t/dens.
    // ... (preserve PCG hash, cell walks, etc.)
    return vec4<f32>(0.0, 0.0, 0.0, 1.0); // placeholder
}
```

The actual `fs_main` body should preserve the existing 2-layer star logic (after M2's TilingSprite replaces layer 3). The structural change is only the bind group redeclaration.

- [ ] **Step 3: Delete GLSL version if exists**

```bash
rm -f src/shaders/starfield.frag src/shaders/starfield.vert
```

- [ ] **Step 4: Commit**

```bash
git add src/shaders/
git commit -m "chore(shaders): port starfield.wgsl to weydra bind group convention"
```

---

### Task 6: Extend Vite plugin with naga reflection

**Files:**
- Create: `weydra-renderer/vite-plugin-wgsl/reflect.ts`
- Create: `weydra-renderer/vite-plugin-wgsl/codegen.ts`
- Modify: `weydra-renderer/vite-plugin-wgsl/index.ts`
- Modify: `weydra-renderer/vite-plugin-wgsl/package.json`

- [ ] **Step 1: Install wgsl_reflect**

```bash
cd weydra-renderer/vite-plugin-wgsl
npm install wgsl_reflect
```

This is a pure-JS WGSL parser/reflector. Simpler than bundling naga-wasm.

- [ ] **Step 2: Write reflection module**

Create `weydra-renderer/vite-plugin-wgsl/reflect.ts`:

```typescript
import { WgslReflect } from 'wgsl_reflect';

export interface UniformField {
  name: string;
  offset: number;
  byteSize: number;
  typeName: string;
}

export interface UniformStruct {
  structName: string;
  byteSize: number;
  fields: UniformField[];
  bindGroup: number;
  binding: number;
}

/**
 * wgsl_reflect (greggman) exposes uniforms as VariableInfo with TypeInfo.
 * Pin the version in package.json (`"wgsl_reflect": "1.3.x"`) and treat
 * fields defensively — scalar `m.type` may lack `.name`, or the struct may
 * be encoded differently across versions. Fall back to raw WGSL-type string.
 */
export function reflectWgsl(source: string): UniformStruct[] {
  const reflect = new WgslReflect(source);
  const result: UniformStruct[] = [];

  for (const u of (reflect.uniforms ?? [])) {
    const group = (u as any).group ?? 0;
    if (group === 0) continue; // engine bind group, not ours
    const struct: any = (u as any).type;
    const members = struct?.members;
    if (!Array.isArray(members)) continue;

    result.push({
      structName: String(struct.name ?? `Uniforms_${group}_${(u as any).binding}`),
      byteSize: Number(struct.size ?? 0),
      bindGroup: Number(group),
      binding: Number((u as any).binding ?? 0),
      fields: members.map((m: any) => ({
        name: String(m.name),
        offset: Number(m.offset ?? 0),
        byteSize: Number(m.size ?? 0),
        typeName: resolveTypeName(m),
      })),
    });
  }

  return result;
}

function resolveTypeName(m: any): string {
  // Handle wgsl_reflect variations — some versions put name on m.type.name,
  // others use m.type.format, others emit raw `f32`/`vec2<f32>` strings.
  if (typeof m.type === 'string') return m.type;
  const n = m.type?.name ?? m.type?.format?.name ?? m.type?.format;
  if (typeof n === 'string') return n;
  return 'unknown';
}
```

- [ ] **Step 3: Write codegen module**

Create `weydra-renderer/vite-plugin-wgsl/codegen.ts`:

```typescript
import type { UniformStruct, UniformField } from './reflect';

export function generateTsModule(
  wgslSource: string,
  structs: UniformStruct[],
  moduleName: string,
): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated from ${moduleName}.wgsl — do not edit.`);
  lines.push(`export const wgslSource = ${JSON.stringify(wgslSource)};`);
  lines.push('');

  for (const s of structs) {
    lines.push(`export const ${s.structName}_LAYOUT = {`);
    lines.push(`  byteSize: ${s.byteSize},`);
    lines.push(`  bindGroup: ${s.bindGroup},`);
    lines.push(`  binding: ${s.binding},`);
    lines.push(`  fields: {`);
    for (const f of s.fields) {
      lines.push(`    ${f.name}: { offset: ${f.offset}, byteSize: ${f.byteSize}, type: ${JSON.stringify(f.typeName)} },`);
    }
    lines.push(`  },`);
    lines.push(`} as const;`);
    lines.push('');

    // Typed accessor class. Integer fields (i32/u32) need a separate
    // Int32/Uint32 view over the SAME ArrayBuffer, or writing an integer
    // via Float32Array would store it as IEEE-754 float bits.
    lines.push(`export class ${s.structName} {`);
    lines.push(`  private readonly i32: Int32Array;`);
    lines.push(`  private readonly u32: Uint32Array;`);
    lines.push(`  constructor(private buffer: Float32Array, private base: number) {`);
    lines.push(`    this.i32 = new Int32Array(buffer.buffer, buffer.byteOffset, buffer.length);`);
    lines.push(`    this.u32 = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length);`);
    lines.push(`  }`);
    for (const f of s.fields) {
      const setterCode = generateSetter(f);
      lines.push(`  ${setterCode}`);
    }
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateSetter(f: UniformField): string {
  const offsetF32 = f.offset / 4;
  switch (f.typeName) {
    case 'f32':
      return `set ${f.name}(v: number) { this.buffer[this.base + ${offsetF32}] = v; }`;
    case 'i32':
      return `set ${f.name}(v: number) { this.i32[this.base + ${offsetF32}] = v; }`;
    case 'u32':
      return `set ${f.name}(v: number) { this.u32[this.base + ${offsetF32}] = v; }`;
    case 'vec2<f32>':
    case 'vec2f':
      return `set ${f.name}(v: [number, number]) { this.buffer[this.base + ${offsetF32}] = v[0]; this.buffer[this.base + ${offsetF32 + 1}] = v[1]; }`;
    case 'vec3<f32>':
    case 'vec3f':
      return `set ${f.name}(v: [number, number, number]) { for (let i=0;i<3;i++) this.buffer[this.base + ${offsetF32} + i] = v[i]; }`;
    case 'vec4<f32>':
    case 'vec4f':
      return `set ${f.name}(v: [number, number, number, number]) { for (let i=0;i<4;i++) this.buffer[this.base + ${offsetF32} + i] = v[i]; }`;
    default:
      // Unsupported → no-op setter, com warn em dev pra pegar no review.
      return `set ${f.name}(_v: unknown) { /* unsupported WGSL type ${f.typeName} — edit codegen.ts */ }`;
  }
}
```

- [ ] **Step 4: Update plugin index**

Replace `weydra-renderer/vite-plugin-wgsl/index.ts`:

```typescript
import type { Plugin } from 'vite';
import { basename, extname } from 'node:path';
import { reflectWgsl } from './reflect';
import { generateTsModule } from './codegen';

export default function wgslPlugin(): Plugin {
  return {
    name: 'weydra-vite-plugin-wgsl',
    // Usa `code` (Vite já leu + cacheou) em vez de readFile — disco bypassa
    // o module graph do Vite e quebra HMR.
    transform(code, id) {
      if (!id.endsWith('.wgsl')) return null;
      const moduleName = basename(id, extname(id));
      const structs = reflectWgsl(code);
      const tsModule = generateTsModule(code, structs, moduleName);
      return { code: tsModule, map: null };
    },
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add weydra-renderer/vite-plugin-wgsl/
git commit -m "feat(vite-plugin-wgsl): naga-style reflection via wgsl_reflect + typed codegen"
```

---

### ~~Task 7: TilingSprite primitive for bright star layer~~ — **REMOVIDO DO M2**

Movido pro M3 (precisa texture bind group 2 + sprite pool infra). Bright layer continua em Pixi durante M2. Pula este task.

<details>
<summary>Conteúdo arquivado (referência pra implementar em M3)</summary>

### Task 7 (archived): TilingSprite primitive for bright star layer

**Files:**
- Create: `weydra-renderer/core/src/tiling_sprite.rs`
- Create: `weydra-renderer/core/shaders/sprite.wgsl`
- Modify: `weydra-renderer/core/src/lib.rs`

- [ ] **Step 1: Write sprite shader**

Create `weydra-renderer/core/shaders/sprite.wgsl`:

```wgsl
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad: vec3<f32>,
};

struct SpriteUniforms {
    position: vec2<f32>,
    size: vec2<f32>,
    tile_offset: vec2<f32>,
    tile_scale: vec2<f32>,
    tint: vec4<f32>,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> sprite: SpriteUniforms;
@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var samp: sampler;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
    // 2 triangles covering sprite rect in world space
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let c = corners[idx];
    let world = sprite.position + c * sprite.size;
    let ndc = (world - engine_camera.camera) / (engine_camera.viewport * 0.5);
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = c * sprite.tile_scale + sprite.tile_offset;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let c = textureSample(tex, samp, in.uv);
    return c * sprite.tint;
}
```

- [ ] **Step 2: Write TilingSprite module**

Create `weydra-renderer/core/src/tiling_sprite.rs`:

```rust
use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct TilingSpriteUniforms {
    pub position: [f32; 2],
    pub size: [f32; 2],
    pub tile_offset: [f32; 2],
    pub tile_scale: [f32; 2],
    pub tint: [f32; 4],
}

impl Default for TilingSpriteUniforms {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0],
            size: [1.0, 1.0],
            tile_offset: [0.0, 0.0],
            tile_scale: [1.0, 1.0],
            tint: [1.0, 1.0, 1.0, 1.0],
        }
    }
}
```

(Full render pipeline integration — texture bind group 2, etc. — comes with the sprite batcher in M3. For M2, TilingSprite is drawn as a special one-off Mesh using this uniform struct.)

- [ ] **Step 3: Expose + commit**

Update `lib.rs`: `pub mod tiling_sprite; pub use tiling_sprite::TilingSpriteUniforms;`

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): sprite.wgsl + TilingSpriteUniforms for bright layer"
```

</details>

---

### Task 8: WASM adapter — expose create_mesh, set_camera, uniform pointers

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`

- [ ] **Step 1: Extend Renderer with mesh API**

Update `weydra-renderer/adapters/wasm/src/lib.rs`. After the existing Renderer struct, add:

```rust
use weydra_renderer::{
    bind_groups::EngineBindings,
    camera::CameraUniforms,
    mesh::Mesh,
    shader::{ShaderHandle, ShaderRegistry},
    uniform_pool::UniformPool,
};

// Add fields to Renderer struct:
pub struct Renderer {
    ctx: GpuContext,
    surface: RenderSurface<'static>,
    engine: EngineBindings,
    shader_registry: ShaderRegistry,
    camera_uniforms: CameraUniforms,
    // Dynamic storage of pools created on demand:
    starfield_pool: Option<UniformPool<StarfieldUniforms>>,
    starfield_mesh: Option<Mesh>,
    // ...
}

// StarfieldUniforms matches the layout in starfield.wgsl:
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct StarfieldUniforms {
    pub density: f32,
    pub _pad: [f32; 3],
}
```

Update `new(canvas)` to initialize `engine`, `shader_registry`, `camera_uniforms`.

Add methods:

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn set_camera(&mut self, x: f32, y: f32, viewport_w: f32, viewport_h: f32, time: f32) {
        self.camera_uniforms = CameraUniforms {
            camera: [x, y],
            viewport: [viewport_w, viewport_h],
            time,
            _pad: [0.0; 3],
        };
    }

    /// Register starfield shader + create its uniform pool. Call once during setup.
    pub fn create_starfield(&mut self, wgsl_source: &str) {
        let shader = self.shader_registry.compile(&self.ctx, wgsl_source, "starfield");
        let pool = UniformPool::<StarfieldUniforms>::new(&self.ctx, "starfield uniforms", 1);
        let mesh = Mesh::new(
            &self.ctx,
            &self.shader_registry,
            shader,
            self.surface.format,
            &self.engine.layout,
            Some(&pool.bind_group_layout),
            "starfield",
        );
        self.starfield_pool = Some(pool);
        self.starfield_mesh = Some(mesh);
    }

    pub fn starfield_uniforms_ptr(&self) -> u32 {
        self.starfield_pool
            .as_ref()
            .map(|p| p.instances_ptr() as u32)
            .unwrap_or(0)
    }

    pub fn render(&mut self) -> Result<(), JsValue> {
        self.engine.update(&self.ctx, &self.camera_uniforms);
        if let Some(pool) = &self.starfield_pool {
            pool.upload(&self.ctx);
        }

        let frame = self.surface.acquire_next_texture()
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self.ctx.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("weydra frame"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            pass.set_bind_group(0, &self.engine.bind_group, &[]);
            if let (Some(mesh), Some(pool)) = (&self.starfield_mesh, &self.starfield_pool) {
                mesh.draw(&mut pass, Some(&pool.bind_group));
            }
        }
        self.ctx.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}
```

- [ ] **Step 2: Rebuild + commit**

```bash
cd weydra-renderer/adapters/wasm
wasm-pack build --target web --out-dir pkg
git add weydra-renderer/adapters/wasm/
git commit -m "feat(weydra-wasm): create_starfield + uniform ptr export + render with mesh"
```

---

### Task 9: TS bridge — Renderer extensions

**Files:**
- Modify: `weydra-renderer/ts-bridge/index.ts`

- [ ] **Step 1: Add mesh API to Renderer**

Update `weydra-renderer/ts-bridge/index.ts`:

```typescript
import init, { Renderer as WasmRenderer } from 'weydra-renderer-wasm';

let _initialized = false;
let _wasm: any = null;

export async function initWeydra(): Promise<void> {
  if (_initialized) return;
  _wasm = await init();
  _initialized = true;
}

export class Renderer {
  private readonly inner: WasmRenderer;
  private _starfieldUniforms: Float32Array | null = null;

  private constructor(inner: WasmRenderer) {
    this.inner = inner;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!_initialized) throw new Error('initWeydra() must be called first');
    const inner = await new WasmRenderer(canvas);
    return new Renderer(inner);
  }

  setCamera(x: number, y: number, vw: number, vh: number, time: number): void {
    this.inner.set_camera(x, y, vw, vh, time);
  }

  createStarfield(wgslSource: string): void {
    this.inner.create_starfield(wgslSource);
    const ptr = this.inner.starfield_uniforms_ptr();
    if (ptr !== 0) {
      // Create a typed view over the uniform pool slot 0
      this._starfieldUniforms = new Float32Array(_wasm.memory.buffer, ptr, 4);
    }
  }

  setStarfieldDensity(v: number): void {
    if (this._starfieldUniforms) this._starfieldUniforms[0] = v;
  }

  resize(width: number, height: number): void { this.inner.resize(width, height); }
  render(): void { this.inner.render(); }
}
```

- [ ] **Step 2: Commit**

```bash
git add weydra-renderer/ts-bridge/
git commit -m "feat(ts-bridge): Renderer.createStarfield + typed uniform view"
```

---

### Task 10: Game integration — flag + starfield switch

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/world/fundo.ts`

- [ ] **Step 1: Add weydra flags to config**

In `src/core/config.ts`, add to the config interface:

```typescript
weydra: {
  starfield: boolean;
  // more flags added in later milestones
};
```

Default: `{ starfield: false }`. Expose via `getConfig().weydra`.

- [ ] **Step 2: Update fundo.ts to branch**

In `src/world/fundo.ts`, add at top:

```typescript
import starfieldWgsl from '../shaders/starfield.wgsl';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
```

In the render function (that currently updates Pixi uniforms), branch:

```typescript
export function atualizarFundo(/* existing args */): void {
  if (getConfig().weydra.starfield) {
    const r = getWeydraRenderer();
    if (r) {
      r.setCamera(camX, camY, viewportW, viewportH, timeSeconds);
      r.setStarfieldDensity(getConfig().graphics.densidadeStarfield);
      // render() is called by weydra-loader on its own rAF
    }
    return; // skip Pixi path
  }
  // existing Pixi path
  // ...
}
```

- [ ] **Step 3: Update weydra-loader to expose renderer + register starfield**

In `src/weydra-loader.ts`, add:

```typescript
import starfieldWgsl from './shaders/starfield.wgsl';

export function getWeydraRenderer(): Renderer | null {
  return _renderer;
}

// In startWeydraM1 (now rename to startWeydra), after creating _renderer:
_renderer.createStarfield(starfieldWgsl);
```

Also: change the flag from `weydra_m1` to read `getConfig().weydra.starfield` (or any weydra flag) so activation uses the config system.

- [ ] **Step 4: Test**

```bash
npm run build:renderer
npm run dev
```

Enable via browser console:
```javascript
// temporarily force flag for testing
(window as any).__setWeydraStarfield = true;
location.reload();
```

Expected: starfield visible via weydra (after disabling Pixi starfield in same branch). Pan camera, zoom — starfield should parallax correctly.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts src/world/fundo.ts src/weydra-loader.ts
git commit -m "feat(orbital): starfield via weydra behind weydra.starfield flag"
```

---

### Task 11: Visual parity validation

- [ ] **Step 1: Capture Pixi baseline screenshot**

With weydra flag OFF, open the game at a controlled position (set seed, disable motion). Take a screenshot at 1920×1080 of the starfield only.

- [ ] **Step 2: Capture weydra screenshot**

With weydra flag ON, same seed + camera position. Screenshot.

- [ ] **Step 3: Compare**

Use a pixel diff tool:
```bash
# Assuming imagemagick installed
compare -metric AE pixi.png weydra.png diff.png
```

Expected: < 1% of pixels differ, differences < 3 RGB. Visual inspection: no structural differences (same star positions, same densities, same brightness).

If substantial drift: investigate WGSL→GLSL translation issues in WebGL2 backend (or adjust PCG hash if determinism broke).

- [ ] **Step 4: Performance comparison**

Record 10s of profiling with each flag state. Compare `fundo` bucket:
- Pixi: ~0.088ms avg, 0.117ms p95 (baseline)
- weydra: target ≤ 0.088ms avg

If regresses, profile GPU work — likely bind group setup overhead or redundant buffer upload.

- [ ] **Step 5: Commit M2 complete**

Add status section to spec:
```markdown
## M2 Status: Complete (YYYY-MM-DD)
Starfield running on weydra. Visual parity verified. Perf ≤ Pixi baseline.
```

```bash
git add docs/superpowers/specs/2026-04-19-weydra-renderer-design.md
git commit -m "docs(weydra-renderer): mark M2 Starfield complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Custom shader registration
- ✅ Bind group 0 engine convention applied
- ✅ WGSL single source of truth (Vite plugin does reflection)
- ✅ Uniform pool homogeneous per-shader-type
- ✅ Typed array views for TS access
- ✅ Feature flag for rollback
- ✅ Port of existing starfield.wgsl

**Deferred to later milestones:**
- TilingSprite full integration (texture bind group 2) — M3 with sprite batcher
- TilingSprite baking pipeline for bright layer — can be done as a setup-time `Texture.from(canvas)` equivalent in M3
- Full memory revalidation pattern — M3 when upload_texture exists

**Known risks:**
- `wgsl_reflect` npm package may not handle all WGSL features — fallback to manual hand-written TS if parser breaks
- `@builtin(vertex_index)` trick for fullscreen triangle may not work identically in WebGL2 backend via naga — validate early
- Starfield shader uses PCG hash which requires `u32` integer ops — validate these survive WGSL→GLSL translation
