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
// NOTE: bind group 1 is absent in this path — the wasm adapter's
// pipeline_layout passes `None` at index 1. Group 2 is still texture/sampler
// so the binding convention matches the storage path at the consumer level.
// Never call set_bind_group(1, ...) against this pipeline — wgpu validates.

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
    // Texel is linear (sRGB texture, decoded on sample); the tint is an sRGB
    // hex colour. Tint in sRGB space like Pixi, then blend-compensate.
    let texel = textureSample(tex, samp, in.uv);
    let c_srgb = linear_to_srgb3(texel.rgb) * in.color.rgb;
    return srgb_over(c_srgb, texel.a * in.color.a);
}

// ── Colour space (shared by the 2D shaders) ─────────────────────────────
// The surface is an sRGB view, so the GPU blends in LINEAR space and encodes
// on store; the Pixi reference blended raw sRGB bytes. Game colours (hex
// tints, strokes, text) are sRGB values. `srgb_over` returns the PREMULTIPLIED
// fragment that, with PREMULTIPLIED_ALPHA_BLENDING, reproduces Pixi's
// sRGB-space `c * a + dst * (1 - a)`: the source term decode(c * a) is exact,
// and alpha' = 1 - (1 - a)^2.2 darkens the destination by the linear-space
// equivalent of (1 - a) in encoded space. For a = 1 it is a plain decode.
// Same compensation as fog.wgsl.
fn srgb_to_linear3(c: vec3<f32>) -> vec3<f32> {
    let low = c / vec3<f32>(12.92);
    let high = pow((c + vec3<f32>(0.055)) / vec3<f32>(1.055), vec3<f32>(2.4));
    return select(low, high, c > vec3<f32>(0.04045));
}

fn linear_to_srgb3(c: vec3<f32>) -> vec3<f32> {
    let low = c * 12.92;
    let high = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(low, high, c > vec3<f32>(0.0031308));
}

fn srgb_over(c_srgb: vec3<f32>, a_in: f32) -> vec4<f32> {
    let a = clamp(a_in, 0.0, 1.0);
    return vec4<f32>(srgb_to_linear3(c_srgb * a), 1.0 - pow(1.0 - a, 2.2));
}
