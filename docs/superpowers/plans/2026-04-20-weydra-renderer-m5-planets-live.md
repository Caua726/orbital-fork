# weydra-renderer M5 Planets (Live Shader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Port do `planeta.wgsl` pra weydra-renderer com todas as uniforms (FBM, cloud layer, palette, etc). Planetas grandes rodam shader live via weydra em vez de Pixi. **O milestone mais complexo do projeto** — shader denso (6 octaves FBM + cloud circles + PCG hash), muitas uniforms (24 campos), parity visual bit-a-bit exigida.

**Architecture:** `PlanetPool` homogeneous (Vec<PlanetUniforms> contíguo, todos os planetas ativos num array). Instance index aponta pro slot próprio no buffer. Per-instance draw (instancing opcional depois). Bake pipeline também migra pra weydra completo — bakePlanetaWeydra vira render do mesh pra RenderTarget, zero dependência de Pixi. Test de shader determinism via hash do framebuffer.

**Tech Stack:** M4 foundation + custom shader registration from M2 + RenderTarget from M4.

**Depends on:** M4 complete (RenderTarget disponível, sprite pool, texture upload). M2 também (mesh primitive + uniform pool pattern).

---

## File Structure

**New in core:**
- `core/src/pools/planet.rs` — PlanetPool with PlanetUniforms struct (24 fields)

**Modified in core:**
- `core/src/mesh.rs` — supports texture bind groups (group 2) for meshes that sample textures (planet doesn't, but future custom shaders may)
- `core/src/lib.rs` — exports

**Modified in adapters/wasm:**
- `adapters/wasm/src/lib.rs` — `create_planet_shader`, `create_planet_instance`, `planet_uniforms_ptr`, `bake_planet_to_texture`

**Modified in ts-bridge:**
- `ts-bridge/index.ts` — Renderer gains `createPlanetShader`, `createPlanetInstance`, `bakePlanet`

**Game:**
- Move: `src/shaders/planeta.wgsl` → updated to weydra bind group convention
- Delete: `src/shaders/planeta.frag` (GLSL version, if exists)
- Modify: `src/world/planeta-procedural.ts` — full weydra path (bake + live)
- Modify: `src/core/config.ts` — `weydra.planetsLive` flag

---

### Task 1: Port planeta.wgsl to bind group convention

**Files:**
- Modify: `src/shaders/planeta.wgsl`

- [ ] **Step 1: Rewrite bind groups**

Current `planeta.wgsl` uses Pixi's auto transform bindings. Rewrite header:

```wgsl
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad: vec3<f32>,
};

struct PlanetUniforms {
    u_time: f32,
    u_seed: f32,
    u_rotation: f32,
    u_pixels: f32,
    u_light_origin: vec2<f32>,
    u_time_speed: f32,
    u_dither_size: f32,
    u_light_border1: f32,
    u_light_border2: f32,
    u_size: f32,
    u_octaves: i32,
    u_planet_type: i32,
    u_river_cutoff: f32,
    u_land_cutoff: f32,
    u_cloud_cover: f32,
    u_stretch: f32,
    u_cloud_curve: f32,
    u_tiles: f32,
    u_cloud_alpha: f32,
    // Position + size of the quad in world space:
    u_world_pos: vec2<f32>,
    u_world_size: vec2<f32>,
    // Palette:
    u_colors: array<vec4<f32>, 6>,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> planet: PlanetUniforms;
```

Update `vs_main` to produce world-to-NDC using `engine_camera.camera` + `engine_camera.viewport` + `planet.u_world_pos` + `planet.u_world_size`:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, 0.5),
    );
    let c = corners[vid];
    let world = planet.u_world_pos + c * planet.u_world_size;
    let ndc = (world - engine_camera.camera) / (engine_camera.viewport * 0.5);
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = c + 0.5;
    return out;
}
```

Keep `fs_main` body intact (all the FBM/cloud/PCG code) — only replace the uniform access to use the new `planet.X` struct.

- [ ] **Step 2: Delete GLSL duplicate if exists**

```bash
rm -f src/shaders/planeta.frag src/shaders/planeta.vert
```

- [ ] **Step 3: Commit**

```bash
git add src/shaders/
git commit -m "chore(shaders): port planeta.wgsl to weydra bind group convention"
```

---

### Task 2: PlanetUniforms struct + PlanetPool

**Files:**
- Create: `weydra-renderer/core/src/pools/mod.rs`
- Create: `weydra-renderer/core/src/pools/planet.rs`

- [ ] **Step 1: Write pools module root**

Create `weydra-renderer/core/src/pools/mod.rs`:

```rust
pub mod planet;
pub use planet::{PlanetUniforms, PlanetPool};
```

- [ ] **Step 2: Write PlanetPool**

Create `weydra-renderer/core/src/pools/planet.rs`:

```rust
use crate::device::GpuContext;
use crate::slotmap::{Handle, SlotMap};

/// Must match the `PlanetUniforms` struct in planeta.wgsl exactly.
/// Total size: 256 bytes (aligned to 16). 6 vec4 palette colors = 96 bytes
/// + 24 scalar fields (~= 96 bytes with padding) + 2 vec2 world pos/size.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct PlanetUniforms {
    pub u_time: f32,
    pub u_seed: f32,
    pub u_rotation: f32,
    pub u_pixels: f32,

    pub u_light_origin: [f32; 2],
    pub u_time_speed: f32,
    pub u_dither_size: f32,

    pub u_light_border1: f32,
    pub u_light_border2: f32,
    pub u_size: f32,
    pub u_octaves: i32,

    pub u_planet_type: i32,
    pub u_river_cutoff: f32,
    pub u_land_cutoff: f32,
    pub u_cloud_cover: f32,

    pub u_stretch: f32,
    pub u_cloud_curve: f32,
    pub u_tiles: f32,
    pub u_cloud_alpha: f32,

    pub u_world_pos: [f32; 2],
    pub u_world_size: [f32; 2],

    pub u_colors: [[f32; 4]; 6], // 96 bytes
}

impl Default for PlanetUniforms {
    fn default() -> Self {
        Self {
            u_time: 0.0, u_seed: 1.0, u_rotation: 0.0, u_pixels: 64.0,
            u_light_origin: [0.5, 0.5], u_time_speed: 0.1, u_dither_size: 2.0,
            u_light_border1: 0.3, u_light_border2: 0.5, u_size: 4.0, u_octaves: 4,
            u_planet_type: 0, u_river_cutoff: 0.0, u_land_cutoff: 0.0, u_cloud_cover: 0.0,
            u_stretch: 2.0, u_cloud_curve: 1.3, u_tiles: 1.0, u_cloud_alpha: 0.0,
            u_world_pos: [0.0, 0.0], u_world_size: [100.0, 100.0],
            u_colors: [[0.0; 4]; 6],
        }
    }
}

/// Size check at compile time. See WGSL struct in planeta.wgsl for ground truth.
const _: () = assert!(std::mem::size_of::<PlanetUniforms>() <= 256);

pub struct PlanetPool {
    pub instances: Vec<PlanetUniforms>,
    pub gpu_buffer: wgpu::Buffer,
    pub bind_group_layout: wgpu::BindGroupLayout,
    /// UM bind group compartilhado (não 256). Dynamic offset é passado no
    /// `set_bind_group` call em tempo de draw. Layout tem
    /// `has_dynamic_offset: true` e `size = stride` (min_binding_size).
    pub bind_group: wgpu::BindGroup,
    pub slotmap: SlotMap<()>,
    capacity: usize,
    stride: u64,
}

impl PlanetPool {
    pub fn new(ctx: &GpuContext, capacity: usize) -> Self {
        let stride = std::mem::size_of::<PlanetUniforms>() as u64;
        let byte_size = stride * capacity as u64;

        let gpu_buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("planet uniforms"),
            size: byte_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group_layout = ctx.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("planet uniforms layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(stride),
                },
                count: None,
            }],
        });

        // Um único bind group, com size = stride (não byte_size) — o
        // dynamic offset no set_bind_group seleciona a slot em tempo de draw.
        let bind_group = ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("planet uniforms bg (dynamic)"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &gpu_buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(stride),
                }),
            }],
        });

        Self {
            instances: vec![PlanetUniforms::default(); capacity],
            gpu_buffer,
            bind_group_layout,
            bind_group,
            slotmap: SlotMap::with_capacity(capacity),
            capacity,
            stride,
        }
    }

    pub fn offset_for(&self, slot: u32) -> u32 {
        slot * self.stride as u32
    }

    pub fn upload(&self, ctx: &GpuContext) {
        ctx.queue.write_buffer(&self.gpu_buffer, 0, bytemuck::cast_slice(&self.instances));
    }

    pub fn instances_ptr(&self) -> *const PlanetUniforms {
        self.instances.as_ptr()
    }

    pub fn capacity(&self) -> usize { self.capacity }
}
```

- [ ] **Step 3: Add to lib.rs + commit**

```rust
pub mod pools;
pub use pools::{PlanetUniforms, PlanetPool};
```

```bash
cargo build --package weydra-renderer
git add weydra-renderer/core/
git commit -m "feat(weydra-renderer): PlanetUniforms + PlanetPool with per-instance bind groups"
```

---

### Task 3: WASM adapter — planet shader + pool

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`

- [ ] **Step 1: Add planet API**

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn create_planet_shader(&mut self, wgsl_source: &str) {
        let shader = self.shader_registry.compile(&self.ctx, wgsl_source, "planet");
        let pool = PlanetPool::new(&self.ctx, 256); // cap: 256 live planets
        let mesh = Mesh::new(
            &self.ctx,
            &self.shader_registry,
            shader,
            self.surface.format,
            &self.engine.layout,
            Some(&pool.bind_group_layout),
            "planet",
        );
        self.planet_pool = Some(pool);
        self.planet_mesh = Some(mesh);
    }

    pub fn create_planet_instance(&mut self) -> u64 {
        let pool = self.planet_pool.as_mut().expect("create_planet_shader first");
        pool.slotmap.insert(()).to_u64()
    }

    pub fn destroy_planet_instance(&mut self, handle: u64) {
        if let Some(pool) = self.planet_pool.as_mut() {
            pool.slotmap.remove(Handle::from_u64(handle));
        }
    }

    pub fn planet_uniforms_ptr(&self) -> u32 {
        self.planet_pool
            .as_ref()
            .map(|p| p.instances_ptr() as u32)
            .unwrap_or(0)
    }

    pub fn planet_uniforms_stride(&self) -> u32 {
        std::mem::size_of::<PlanetUniforms>() as u32
    }

    pub fn planet_uniforms_capacity(&self) -> u32 {
        self.planet_pool.as_ref().map(|p| p.capacity() as u32).unwrap_or(0)
    }
}
```

- [ ] **Step 2: Update render() to draw planets**

In `render()`, after starfield pass, before sprite batch, iterate planet_pool.slotmap and draw each instance with its dynamic offset bind group:

```rust
if let (Some(pool), Some(mesh)) = (&self.planet_pool, &self.planet_mesh) {
    pool.upload(&self.ctx);
    pass.set_pipeline(&mesh.pipeline);
    pass.set_bind_group(0, &self.engine.bind_group, &[]);
    for (h, _) in pool.slotmap.iter() {
        // Dynamic offset seleciona o slot dentro do buffer compartilhado.
        pass.set_bind_group(1, &pool.bind_group, &[pool.offset_for(h.slot)]);
        pass.draw(0..6, 0..1);
    }
}
```

- [ ] **Step 3: Rebuild + commit**

```bash
cd weydra-renderer/adapters/wasm
wasm-pack build --target web --out-dir pkg
git add weydra-renderer/adapters/wasm/
git commit -m "feat(weydra-wasm): planet shader + PlanetPool integration"
```

---

### Task 4: TS bridge — PlanetInstance class

**Files:**
- Modify: `weydra-renderer/ts-bridge/index.ts`

- [ ] **Step 1: Add PlanetInstance**

```typescript
export class PlanetInstance {
  private base: number; // offset in f32s

  constructor(public readonly handle: bigint, private r: Renderer) {
    const slot = Number(handle & 0xFFFFFFFFn);
    this.base = slot * (r.planetUniformsStride / 4);
  }

  // Views são cacheadas no Renderer (revalidate() recria quando memory grows).
  // NUNCA reconstruir views aqui — perde sincronia com Float32Array/Int32Array
  // se memory crescer entre uma chamada e outra.
  private get view(): Float32Array { return this.r.planetUniformsView; }
  private get iview(): Int32Array { return this.r.planetUniformsIView; }

  // Offsets abaixo são computados a partir do layout exato de `PlanetUniforms`
  // em Rust (alinhamento vec4). Idealmente gerados pelo `vite-plugin-wgsl`
  // via reflection — tabela abaixo é fallback manual que DEVE ser validado
  // por teste contra `std::mem::offset_of!(PlanetUniforms, field)`.
  set uTime(v: number) { this.view[this.base + 0] = v; }
  set uSeed(v: number) { this.view[this.base + 1] = v; }
  set uRotation(v: number) { this.view[this.base + 2] = v; }
  setLightOrigin(x: number, y: number) { this.view[this.base + 4] = x; this.view[this.base + 5] = y; }
  set uOctaves(v: number) { this.iview[this.base + 10] = v; }
  set uPlanetType(v: number) { this.iview[this.base + 11] = v; }
  setWorldPos(x: number, y: number) { this.view[this.base + 19] = x; this.view[this.base + 20] = y; }
  setWorldSize(w: number, h: number) { this.view[this.base + 21] = w; this.view[this.base + 22] = h; }
  setColor(idx: number, r: number, g: number, b: number, a: number) {
    const off = this.base + 24 + idx * 4; // palette começa logo após u_world_size (offset 23 é pad)
    this.view[off + 0] = r; this.view[off + 1] = g; this.view[off + 2] = b; this.view[off + 3] = a;
  }
  // ... setters for remaining ~15 uniforms
}

// No Renderer (M3 + extensão M5):
// - planetUniformsView: Float32Array cacheada em revalidate()
// - planetUniformsIView: Int32Array cacheada em revalidate(), mesmo buffer
// - planetUniformsStride / Ptr / Capacity: readonly getters do wasm

// Add to Renderer:
createPlanetShader(wgslSource: string): void {
  this.inner.create_planet_shader(wgslSource);
  this.revalidate();
}

createPlanetInstance(): PlanetInstance {
  const h = this.inner.create_planet_instance();
  this.revalidate();
  return new PlanetInstance(BigInt(h), this);
}

get planetUniformsView(): Float32Array {
  const buf = _wasm.memory.buffer;
  return new Float32Array(
    buf,
    this.inner.planet_uniforms_ptr(),
    (this.inner.planet_uniforms_capacity() * this.inner.planet_uniforms_stride()) / 4,
  );
}

get planetUniformsStride(): number { return this.inner.planet_uniforms_stride(); }
get planetUniformsPtr(): number { return this.inner.planet_uniforms_ptr(); }
get planetUniformsCapacity(): number { return this.inner.planet_uniforms_capacity(); }
```

Note: for robustness, use auto-generated accessors from `vite-plugin-wgsl` instead of hand-written — that's the whole point of the plugin. In this plan's simplified form, we write them manually. In actual execution, the plugin generates them.

- [ ] **Step 2: Commit**

```bash
git add weydra-renderer/ts-bridge/
git commit -m "feat(ts-bridge): PlanetInstance class with typed uniform setters"
```

---

### Task 5: Game integration — live planet shader path

**Files:**
- Modify: `src/world/planeta-procedural.ts`

- [ ] **Step 1: Create planet shader on boot**

In the init path (after weydra renderer created):

```typescript
import planetWgsl from '../shaders/planet.wgsl?raw';

// During weydra init:
r.createPlanetShader(planetWgsl);
```

- [ ] **Step 2: criarPlanetaProceduralSprite weydra path**

```typescript
export function criarPlanetaProceduralSprite(
  x: number, y: number, tamanho: number, tipoPlaneta: string,
  seed?: number, rng: Rng = Math.random,
): any {
  if (getConfig().weydra.planetsLive) {
    const r = getWeydraRenderer();
    if (r) {
      const paleta = gerarPaletaAleatoria(tipoPlaneta, rng);
      const planetSeed = seed ?? (1.0 + rng() * 9.0);
      const instance = r.createPlanetInstance();
      instance.uSeed = planetSeed;
      instance.uPlanetType = paleta.planetType;
      instance.uOctaves = paleta.octaves;
      instance.uRiverCutoff = paleta.riverCutoff;
      instance.uLandCutoff = paleta.landCutoff;
      instance.uCloudCover = paleta.cloudCover;
      instance.uStretch = paleta.stretch;
      instance.uCloudCurve = paleta.cloudCurve;
      instance.uTiles = paleta.tiles;
      instance.uCloudAlpha = paleta.cloudAlpha;
      instance.uSize = paleta.size;
      instance.uTimeSpeed = paleta.timeSpeed;
      instance.uDitherSize = paleta.ditherSize;
      instance.uLightBorder1 = paleta.lightBorder1;
      instance.uLightBorder2 = paleta.lightBorder2;
      for (let i = 0; i < 6; i++) {
        const c = paleta.colors[i];
        instance.setColor(i, c[0], c[1], c[2], c[3]);
      }
      instance.setWorldPos(x, y);
      instance.setWorldSize(tamanho, tamanho);

      const fake = { x, y, scale: { set: () => {} }, visible: true, _weydraPlanet: instance, _planetaTipo: tipoPlaneta };
      return fake as any;
    }
  }
  // ... existing Pixi path
}
```

- [ ] **Step 3: Update atualizarTempoPlanetas**

For planets with `_weydraPlanet`:
```typescript
if ((planeta as any)._weydraPlanet) {
  const u = (planeta as any)._weydraPlanet;
  u.uTime += deltaSec;
  u.uRotation += (planeta as any)._rotSpeed * deltaSec;
  u.setWorldPos(planeta.x, planeta.y);
  continue;
}
```

atualizarLuzPlaneta similar — update `setLightOrigin` via weydra.

- [ ] **Step 4: Commit**

```bash
git add src/world/
git commit -m "feat(orbital): planetas live shader via weydra behind weydra.planetsLive"
```

---

### Task 6: Visual determinism test

**Files:**
- Create: `weydra-renderer/tests/shader-determinism.test.ts` (or similar integration test)

- [ ] **Step 1: Reference scene**

Set up fixed scene:
- 1 planet, tipo comum, visualSeed = 3.14, position (0,0), size 200
- Camera (0,0), zoom 1, time 0
- Render 1 frame

- [ ] **Step 2: Hash framebuffer**

Extract pixels via canvas.toDataURL or glReadPixels equivalent. Hash with SHA-256.

- [ ] **Step 3: Compare Pixi vs weydra hashes**

Run same scene in Pixi path, get hash. Compare.

Acceptable: identical hash (bit-exact). If different, investigate:
- WGSL→GLSL translation changed PCG `u32` ops
- Precision differences between highp float in Pixi vs default in wgpu

- [ ] **Step 4: Commit test**

```bash
git add weydra-renderer/tests/
git commit -m "test(weydra-renderer): shader determinism hash comparison Pixi vs weydra"
```

---

### Task 7: Full-weydra bake (replaces M4's Pixi-based bake)

**Files:**
- Modify: `weydra-renderer/adapters/wasm/src/lib.rs`
- Modify: `src/world/planeta-procedural.ts`

- [ ] **Step 1: Add bake_planet method**

```rust
#[wasm_bindgen]
impl Renderer {
    pub fn bake_planet(&mut self, instance_handle: u64, size: u32) -> u64 {
        let h = Handle::from_u64(instance_handle);
        let pool = self.planet_pool.as_ref().expect("no pool");
        let mesh = self.planet_mesh.as_ref().expect("no mesh");

        // Create a RenderTarget
        let rt = RenderTarget::new(&self.ctx, size, size, self.surface.format);

        // Upload current uniforms
        pool.upload(&self.ctx);

        // Render to RT (same pipeline, different target)
        let mut encoder = self.ctx.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("planet bake"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &rt.view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&mesh.pipeline);
            pass.set_bind_group(0, &self.engine.bind_group, &[]);
            pass.set_bind_group(1, &pool.bind_groups[h.slot as usize], &[]);
            pass.draw(0..6, 0..1);
        }
        self.ctx.queue.submit(Some(encoder.finish()));

        // Register as texture handle. Sampler é criado fresh aqui —
        // evitar dep em `TextureRegistry::get_default_sampler()` que M3
        // não expõe publicamente. wgpu::Sampler internamente é Arc, criar
        // novo é trivial.
        let sampler = self.ctx.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("planet bake sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        let tex_handle = self.textures.insert_external(crate::texture::Texture {
            texture: rt.texture,
            view: rt.view,
            sampler,
            width: size,
            height: size,
        });
        self.mem_version = self.mem_version.wrapping_add(1);
        tex_handle.to_u64()
    }
}
```

- [ ] **Step 2: Update bakePlanetaWeydra to use native bake**

Replace Pixi-extraction-based path in `src/world/planeta-procedural.ts` with `r.bakePlanet(planetInstance.handle, frameSize)`.

- [ ] **Step 3: Mark M5 complete**

```markdown
## M5 Status: Complete (YYYY-MM-DD)
Planetas live via weydra shader. Bake nativo (sem Pixi) funcionando.
```

```bash
git add weydra-renderer/ src/world/ docs/superpowers/specs/
git commit -m "feat(weydra-renderer): full-weydra planet bake + M5 complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Planet shader WGSL portado
- ✅ PlanetPool homogeneous com instances Vec
- ✅ Per-instance dynamic offset bind groups
- ✅ Typed uniform setters (manual; ideal é plugin-generated)
- ✅ Determinism test
- ✅ Bake pipeline full-weydra

**Deferred:**
- Instancing (1 draw per planet ok até virar gargalo; 256 planetas × 6 verts = fine)
- Plugin-generated PlanetInstance (M2 infra deveria já gerar isso; se não, essa task é candidata pra refactoring)

**Risks:**
- **Shader parity é o maior risco.** PCG hash bit-exactness depende de `u32` operations sobreviverem WGSL→GLSL translation. Test cedo, fix se drift.
- Palette indexing dinâmico (`u_colors[i]`) pode gerar GLSL inválido em alguns backends. Se precisar, substituir por switch/case explícito.
- PlanetUniforms struct size é apertado (alinhamento vec4 no WGSL força padding). Validar `size_of::<PlanetUniforms>` == size declarado em WGSL via teste.
- 256 bind groups por capacity é gordo. Alternativa: 1 bind group compartilhado com `has_dynamic_offset=true` e passando offset no `set_bind_group` call. Cleanly reduz de 256 → 1 allocation.
