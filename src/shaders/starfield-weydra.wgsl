// Starfield shader — weydra bind group convention.
//
// Bind group 0 = engine CameraUniforms (camera, viewport world units, time)
// Bind group 1 = starfield custom uniforms (density multiplier)
//
// Renders a full-screen quad via @builtin(vertex_index) — no vertex buffer.
// Fragment does PCG hash / pixel-snapped grid test for 2 parallax layers.
// Mirror of src/shaders/starfield.wgsl (Pixi path) minus the bright layer,
// which stays in Pixi as a TilingSprite until M3 migrates the sprite pool.

// WGSL std140: vec3<f32> em uniform buffer ocupa 16 bytes com 16-byte align
// (armadilha). Usamos 3 scalars f32 pra garantir 12 bytes contíguos sem
// padding extra — struct total = 32 bytes, match exato com Rust CameraUniforms.
struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

struct StarfieldUniforms {
    density: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> starfield: StarfieldUniforms;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
    // 2 triangles covering [0,1]² in UV; mapped to [-1,+1] in clip space.
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

fn pcg2d(v_in: vec2<u32>) -> u32 {
    var v = v_in;
    v = v * vec2<u32>(1664525u) + vec2<u32>(1013904223u);
    v.x = v.x + v.y * 1664525u;
    v.y = v.y + v.x * 1664525u;
    v = v ^ (v >> vec2<u32>(16u));
    v.x = v.x + v.y * 1664525u;
    v.y = v.y + v.x * 1664525u;
    v = v ^ (v >> vec2<u32>(16u));
    return v.x ^ v.y;
}

fn hash1(cell: vec2<i32>, salt: i32) -> f32 {
    let c = vec2<u32>(cell + vec2<i32>(salt + 32768));
    return f32(pcg2d(c)) * (1.0 / 4294967296.0);
}

fn hash2(cell: vec2<i32>, salt: i32) -> vec2<f32> {
    let c = vec2<u32>(cell + vec2<i32>(salt + 32768));
    let h = pcg2d(c);
    return vec2<f32>(f32(h & 0xFFFFu), f32(h >> 16u)) * (1.0 / 65536.0);
}

fn starLayer(
    worldPos: vec2<f32>,
    cam: vec2<f32>,
    cellSize: f32,
    parallax: f32,
    density: f32,
    sizePx: i32,
    maxBrightness: f32,
    salt: i32,
    t: f32,
    uDensidade: f32,
    driftMul: f32,
) -> vec3<f32> {
    let pp = worldPos - cam * (1.0 - parallax);

    var cellRaw = vec2<i32>(floor(pp / cellSize));
    cellRaw = ((cellRaw % vec2<i32>(32768)) + vec2<i32>(32768)) % vec2<i32>(32768);

    let lottery = hash1(cellRaw, salt);
    if (lottery > density * clamp(uDensidade, 0.0, 2.0)) { return vec3<f32>(0.0); }

    let velDir = hash2(cellRaw, salt + 23) - vec2<f32>(0.5);
    let speed = 0.003 + hash1(cellRaw, salt + 43) * 0.005;
    let drift = velDir * t * speed * driftMul;
    let starPosNorm = fract(hash2(cellRaw, salt + 13) + drift);

    let cellOrigin = vec2<f32>(cellRaw) * cellSize;
    let starWorldPx = floor(cellOrigin + starPosNorm * cellSize);
    let fragWorldPx = floor(pp);
    let delta = fragWorldPx - starWorldPx;
    let s = f32(sizePx);

    if (delta.x < 0.0 || delta.x >= s) { return vec3<f32>(0.0); }
    if (delta.y < 0.0 || delta.y >= s) { return vec3<f32>(0.0); }

    let bmod = 0.35 + 0.65 * hash1(cellRaw, salt + 97);
    return vec3<f32>(maxBrightness * bmod);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let worldPos = engine_camera.camera + (in.uv - vec2<f32>(0.5)) * engine_camera.viewport;
    let t = engine_camera.time;
    let dens = starfield.density;
    let cam = engine_camera.camera;

    var col = vec3<f32>(0.0);
    // near + mid: drift 1.0 (estrelas pequenas cintilam/flutuam como no
    // shader Pixi). far: drift 0.0 (baked TilingSprite do Pixi era
    // estático — só scroll por parallax, sem vida própria).
    col = col + starLayer(worldPos, cam, 24.0,  0.40, 0.75, 1, 0.80, 1, t, dens, 1.0); // near
    col = col + starLayer(worldPos, cam, 60.0,  0.25, 0.40, 1, 0.95, 2, t, dens, 1.0); // mid
    col = col + starLayer(worldPos, cam, 200.0, 0.12, 0.30, 2, 1.00, 3, t, dens, 0.0); // far/bright

    return vec4<f32>(col, 1.0);
}
