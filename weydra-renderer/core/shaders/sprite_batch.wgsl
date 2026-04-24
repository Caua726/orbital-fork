// Batched textured sprite shader — WebGPU / Vulkan / Metal / DX12 path.
//
// Reads per-sprite data from a read-only storage buffer indexed by
// @builtin(instance_index). One draw call per texture issues
// (6 vertices × N instances). The WebGL2 fallback
// (`sprite_batch_instanced.wgsl`) expresses the same logic via per-instance
// vertex attributes because WebGL2 has no storage buffers.

struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    // Three scalar f32s — NOT vec3<f32>. WGSL would pad a vec3 to 16 bytes,
    // breaking the 32-byte total expected by CameraUniforms on the Rust side.
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

// Storage layout (std430-like): vec4 needs 16-align, vec2 needs 8-align.
//   transform: vec4   offset  0
//   uv_rect:   vec4   offset 16
//   color:     u32    offset 32
//   _pad0:     u32    offset 36   bumps `display` to 40 (8-aligned)
//   display:   vec2   offset 40
// Total 48 bytes; struct alignment 16.  MUST match Rust `SpriteData`.
struct SpriteData {
    transform: vec4<f32>,
    uv_rect: vec4<f32>,
    color: u32,
    _pad0: u32,
    display: vec2<f32>,
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
    let s = sprites[iid];

    // Two triangles centered on (0, 0), unit-size so display*scale gives
    // the real quad size. Winding picked so neither is culled by default
    // (CullMode::None in the pipeline — both orientations are accepted).
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5,  0.5),
    );
    let c = corners[vid];

    // scale_x/scale_y (transform.zw) can be negative — that flips the quad
    // on the respective axis. Ships face-left uses scale_x = -1.
    let local = vec2<f32>(
        c.x * s.display.x * s.transform.z,
        c.y * s.display.y * s.transform.w,
    );
    let world = vec2<f32>(s.transform.x, s.transform.y) + local;

    // viewport is in WORLD UNITS per M2 convention (screen / zoom),
    // so this NDC mapping is zoom-agnostic.
    let ndc = (world - engine_camera.camera) / (engine_camera.viewport * 0.5);

    // 0xRRGGBBAA: R in the most-significant byte, A in the least.
    let r = f32((s.color >> 24u) & 0xffu) / 255.0;
    let g = f32((s.color >> 16u) & 0xffu) / 255.0;
    let b = f32((s.color >>  8u) & 0xffu) / 255.0;
    let a = f32( s.color         & 0xffu) / 255.0;

    var out: VsOut;
    // Y flipped: world Y grows downward (screen-space); NDC Y grows upward.
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = s.uv_rect.xy + (c + vec2<f32>(0.5, 0.5)) * s.uv_rect.zw;
    out.color = vec4<f32>(r, g, b, a);
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let texel = textureSample(tex, samp, in.uv);
    return texel * in.color;
}
