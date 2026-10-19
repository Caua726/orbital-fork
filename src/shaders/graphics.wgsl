// Graphics primitives — flat-shaded triangles for vector shapes
// (circles, rects, roundRects, lines, arcs).
//
// Bind group 0 = engine camera (camera position + viewport in world units).
// Bind group 1 = per-Graphics uniforms (world_space flag).
//
// Two coordinate spaces, branched by `world_space > 0.5`:
//   world_space = 1.0 → position is in world units; subtract camera and
//                       divide by half-viewport to reach NDC. Same path
//                       as the planet + fog shaders.
//   world_space = 0.0 → position is in screen pixels; convert directly.
//                       Used by UI overlays (minimap, tutorial, painel).
//
// Blend contract: fragment returns PREMULTIPLIED colour with an
// sRGB-emulating alpha (`srgb_over` below). Pipeline must use
// `wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING`.

struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

struct GraphicsUniforms {
    world_space: f32,
    // Per-instance alpha multiplier (byte offset 4) — mirrors a Pixi
    // container's `.alpha`. The fragment multiplies each colour's alpha by
    // it, so game code can fade a whole Graphics (orbit rings under fog,
    // fog-memory ghosts) without re-tessellating. Default 1.0.
    alpha: f32,
    // Per-instance offset added to every vertex BEFORE the world/screen
    // transform — mirrors a Pixi container's x/y. vec2 at byte offset 8
    // (std140 8-byte alignment). Game code draws shapes at (0,0)-relative
    // and sets translation = (object.x, object.y).
    translation: vec2<f32>,
};

@group(0) @binding(0) var<uniform> cam: CameraUniforms;
@group(1) @binding(0) var<uniform> gfx: GraphicsUniforms;

struct VsIn {
    @location(0) pos: vec2<f32>,
    @location(1) color: vec4<f32>,
};

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    // Apply the per-instance translation first so shapes authored at
    // (0,0)-relative land at the object's world (or screen) position.
    let p = in.pos + gfx.translation;
    var ndc: vec2<f32>;
    if (gfx.world_space > 0.5) {
        // World units: subtract camera, divide by half-viewport (matches
        // starfield-weydra.wgsl + planeta-weydra.wgsl + fog.wgsl).
        ndc = (p - cam.camera) / (cam.viewport * 0.5);
    } else {
        // Screen pixels: caller passes cam.viewport in CSS pixels and
        // cam.camera = (0, 0) for the UI overlay frame. The shader's
        // job is the same NDC transform, just no camera offset.
        ndc = (p / cam.viewport * 2.0) - vec2<f32>(1.0, 1.0);
    }
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.color = in.color;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // Fold the per-instance alpha into the colour's alpha; the colour is
    // sRGB and the output premultiplied (see srgb_over).
    return srgb_over(in.color.rgb, in.color.a * gfx.alpha);
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
