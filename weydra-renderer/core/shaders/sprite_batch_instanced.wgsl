// Batched textured sprite shader — WebGL2 fallback path.
//
// WebGL2 has no storage buffers; wgpu would reject
// `var<storage, read>` on that backend. Instead, each per-instance field
// becomes a vertex attribute fed from a VertexStepMode::Instance buffer. The
// Rust pipeline (Task 5) packs the same SpriteData layout into that buffer so
// game-side API stays identical between paths.

struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var samp: sampler;
// NOTE: bind group 1 slot unused in this path — storage buffer slot is a
// no-op binding here. The wasm adapter still creates a dummy layout so
// pipeline_layouts match across paths (simpler than branching bind groups).

struct VsIn {
    @builtin(vertex_index) vid: u32,
    // Per-instance attributes — `step_mode: VertexStepMode::Instance` on
    // the vertex buffer in the Rust pipeline. Offsets match the
    // `SpriteData` struct used by the storage-buffer path so the same
    // packed AoS upload feeds both pipelines.
    @location(0) transform: vec4<f32>,   // offset 0,  VertexFormat::Float32x4
    @location(1) uv_rect: vec4<f32>,     // offset 16, VertexFormat::Float32x4
    @location(2) color_rgba: u32,        // offset 32, VertexFormat::Uint32 (NOT Float32 — bit-exact packed RGBA8)
    @location(3) display: vec2<f32>,     // offset 40, VertexFormat::Float32x2 (skip `_pad0: u32` at offset 36)
};

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5,  0.5),
    );
    let c = corners[in.vid];

    let local = vec2<f32>(
        c.x * in.display.x * in.transform.z,
        c.y * in.display.y * in.transform.w,
    );
    let world = vec2<f32>(in.transform.x, in.transform.y) + local;
    let ndc = (world - engine_camera.camera) / (engine_camera.viewport * 0.5);

    let r = f32((in.color_rgba >> 24u) & 0xffu) / 255.0;
    let g = f32((in.color_rgba >> 16u) & 0xffu) / 255.0;
    let b = f32((in.color_rgba >>  8u) & 0xffu) / 255.0;
    let a = f32( in.color_rgba         & 0xffu) / 255.0;

    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = in.uv_rect.xy + (c + vec2<f32>(0.5, 0.5)) * in.uv_rect.zw;
    out.color = vec4<f32>(r, g, b, a);
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let texel = textureSample(tex, samp, in.uv);
    return texel * in.color;
}
