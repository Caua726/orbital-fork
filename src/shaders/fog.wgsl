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
// returns STRAIGHT alpha — `vec4(rgb, alpha)`, NOT `vec4(rgb*alpha, alpha)`.
// The pipeline must therefore be configured with
// `wgpu::BlendState::ALPHA_BLENDING`, not `PREMULTIPLIED_ALPHA_BLENDING`
// (which would darken the fog by alpha) and not `REPLACE` (which would
// erase the layers behind it).

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
    out.uv = c;
    return out;
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
        // edge0 < edge1 (radius*0.75 < radius) → coverage=0 inside the
        // vision, coverage=1 outside; alpha→0 inside (fog cleared).
        // Swapping edge0/edge1 silently inverts the mask (fog opaque
        // inside, clear outside) — no other code change required.
        let coverage = smoothstep(src.radius * 0.75, src.radius, d);
        alpha = alpha * coverage;
    }

    // Same RGB as the Pixi canvas path (`rgba(2, 5, 16, alpha)`). 8-bit
    // round-trip: 0.008→2, 0.02→5, 0.0627→16. Plain 0.06 would land on
    // 15 (15.3 rounds to 15) and shift the blue channel one LSB darker
    // than Pixi.
    return vec4<f32>(0.008, 0.02, 0.0627, alpha);
}
