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
// Blend contract: fragment returns straight alpha (`vec4(rgb, alpha)`).
// Pipeline must use `wgpu::BlendState::ALPHA_BLENDING` — NOT premultiplied
// (which would darken by alpha) and NOT replace (which would erase the
// layers behind).

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
    // Straight alpha (ALPHA_BLENDING contract): fold the per-instance alpha
    // into the colour's alpha. Do NOT premultiply rgb by alpha.
    return vec4<f32>(in.color.rgb, in.color.a * gfx.alpha);
}