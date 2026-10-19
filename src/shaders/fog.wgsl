// Fog-of-war shader — weydra bind group convention.
//
// Bind group 0 = engine CameraUniforms (camera, viewport in WORLD UNITS, time)
// Bind group 1 = fog uniforms (base alpha + vision sources, up to 64)
//
// Renders a fullscreen quad. Each fragment recomposes its world coordinate
// from the engine camera, then walks `active_count` vision sources and
// multiplies the current alpha by `smoothstep(radius * 0.75, radius, d)`.
// Inside the radius, coverage→0 so alpha→0 (fog cleared). Outside,
// coverage=1 so alpha stays at base_alpha (fog opaque).
//
// Replaces the `destination-out` canvas-2D path in src/world/nevoa.ts when
// `config.weydra.fog` is on. Visual parity with the canvas mask comes from
// the smoothstep edges (inner = 0.75 × radius); tightening or loosening
// here is the only knob if the soft edge ever drifts vs. the Pixi look.
//
// Blend-mode contract (read before wiring the pipeline): the fragment
// returns PREMULTIPLIED colour with an sRGB-emulating alpha (see fs_main), so
// the pipeline must use `wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING`
// (not REPLACE, which would erase the layers behind it).

// CameraUniforms layout: 32 bytes total. vec3 in std140 is forbidden
// (16-byte align trap) — use 3 scalar pads instead, matching the Rust
// CameraUniforms in weydra-renderer/core/src/camera.rs byte-for-byte.
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

// VisionSource and FogUniforms layouts mirror
// weydra-renderer/core/src/pools/fog.rs byte-for-byte. VisionSource is
// exactly one std140 row (16 B): vec2 position + f32 radius + f32 _pad.
// FogUniforms header (16 B) + 64 × 16 B sources = 1040 B total.
struct VisionSource {
    position: vec2<f32>,
    radius: f32,
    _pad: f32,
};

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
    // 2 triangles covering [0,1]² in UV → [-1,+1] in clip space. Same
    // pattern as starfield-weydra.wgsl; explicit corners are clearer
    // than the (idx<<1)&2 bit trick and naga emits the same code.
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let c = corners[idx];
    var out: VsOut;
    out.clip_pos = vec4<f32>(c * 2.0 - 1.0, 0.0, 1.0);
    // Clip y points up, world y points down (planeta-weydra.wgsl negates
    // ndc.y the same way): flip so uv.y = 0 is the TOP of the screen.
    // Without it every vision source was mirrored about the screen centre.
    out.uv = vec2<f32>(c.x, 1.0 - c.y);
    return out;
}

/// sRGB → linear (IEC 61966-2-1). Inverse of what the sRGB surface does on
/// write, which is what lets this pass predict the *displayed* value.
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // Engine viewport is in world units (camera.ts writes screen / zoom),
    // so this single line is zoom-agnostic — fog stays anchored to world
    // coords as the camera pans/zooms.
    let world = engine_camera.camera + (in.uv - vec2<f32>(0.5)) * engine_camera.viewport;

    var alpha = fog.base_alpha;
    // Loop bounded by `active_count` (≤ 64 enforced on TS side via
    // Math.min before the upload). Within bounds, sources past
    // active_count keep their stale values but are not visited.
    for (var i: u32 = 0u; i < fog.active_count; i = i + 1u) {
        let src = fog.sources[i];
        let d = distance(world, src.position);
        // edge0 < edge1 (radius*0.94 < radius) → coverage=0 inside the
        // vision, coverage=1 outside; alpha→0 inside (fog cleared).
        //
        // The 0.94 inner edge = a ~6%-radius soft rim. The old 0.75 gave
        // a 25%-radius gradient — a mushy vignette nothing like the
        // pre-weydra canvas-2D fog, whose vision circle was a HARD white
        // ellipse (cleared to the full radius) with only the thin soft
        // edge that a low-res (480×270) canvas bilinearly upscaled to the
        // viewport produces (~3-6% of the radius in world units). This
        // tight rim restores that defined-circle look.
        //
        // Swapping edge0/edge1 silently inverts the mask (fog opaque
        // inside, clear outside) — no other code change required.
        let coverage = smoothstep(src.radius * 0.94, src.radius, d);
        alpha = alpha * coverage;
    }

    // Same RGB as the Pixi canvas path (`rgba(2, 5, 16, alpha)`).
    //
    // The canvas-2D path composites the fog in sRGB space, so over the black of
    // space it lands on exactly `navy * alpha` (measured: (1,5,16) at alpha
    // 0.749 → (0,3,10) on screen). This pass blends in LINEAR space (the
    // surface is an sRGB view), so writing decoded navy would come out ~2.5x
    // darker than the canvas — the two engines disagreed on the whole fogged
    // area. Pre-multiplying by the inverse transfer curve reproduces the canvas
    // result over black, and stays well behaved as alpha→0 (the curve is linear
    // near zero, so the rim of the vision circle still fades to nothing).
    //
    // Over *bright* content, sRGB-space compositing darkens the destination
    // by (1 - a) in encoded space, i.e. ~(1 - a)^2.2 in linear space — far more
    // than the linear blend's (1 - a) (a sun behind 75% fog read (55,46,44) on
    // Pixi and ~(120,108,94) here, and stars stayed visible through the fog).
    // Emitting alpha' = 1 - (1 - a)^2.2 with PREMULTIPLIED blending applies
    // that factor to the destination; the navy term stays exact over black.
    let navy = vec3<f32>(0.008, 0.02, 0.0627);
    let keep = pow(1.0 - alpha, 2.2);
    return vec4<f32>(srgb_to_linear(navy * alpha), 1.0 - keep);
}
