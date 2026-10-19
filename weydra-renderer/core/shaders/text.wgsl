// Text labels — atlas-sampled glyph quads with per-vertex color tint.
//
// Bind group 0 = engine camera (camera center in world units + viewport).
// Bind group 1 = per-node TextUniforms (world_space flag).
// Bind group 2 = glyph atlas texture + sampler (one per font/size pair).
//
// Vertex shader branches by `world_space`:
//   0 → pos is screen pixels (UI overlays).
//   1 → pos is world units; subtract camera center, add half-viewport
//       to reach screen-relative, then convert to NDC.
//
// Fragment: atlas is white-on-alpha. Sample the alpha channel and
// multiply by per-vertex color.a. RGB comes from the per-vertex color
// (sRGB-encoded by the caller via the same `packColor` used for Graphics).

struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

struct TextUniforms {
    world_space: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> text_uniforms: TextUniforms;
@group(2) @binding(0) var atlas_tex: texture_2d<f32>;
@group(2) @binding(1) var atlas_samp: sampler;

struct VsIn {
    @location(0) pos: vec2<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
};

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    var screen_px = in.pos;
    if (text_uniforms.world_space > 0.5) {
        // World coords → screen-relative pixels: subtract camera, then
        // add half-viewport (camera is at the viewport center).
        screen_px = (in.pos - engine_camera.camera) + engine_camera.viewport * 0.5;
    }
    let ndc = (screen_px / engine_camera.viewport * 2.0) - vec2<f32>(1.0, 1.0);
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = in.uv;
    out.color = in.color;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let sample = textureSample(atlas_tex, atlas_samp, in.uv);
    // Atlas pixels are (255, 255, 255, glyph_alpha). Use the alpha as
    // coverage, RGB from the per-vertex tint; srgb_over premultiplies once
    // (PREMULTIPLIED_ALPHA_BLENDING pipeline).
    let a = in.color.a * sample.a;
    return srgb_over(in.color.rgb, a);
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
