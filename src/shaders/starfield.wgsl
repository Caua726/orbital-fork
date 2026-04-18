// WGSL mirror of starfield.frag. PCG integer hash → bit-exact
// with the WebGL2 path. Same per-star velocity motion model.

struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

struct LocalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uColor: vec4<f32>,
    uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

struct StarfieldUniforms {
    uCamera: vec2<f32>,
    uViewport: vec2<f32>,
    uTime: f32,
    uDensidade: f32,
};
@group(2) @binding(0) var<uniform> starUniforms : StarfieldUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vUV: vec2<f32>,
};

@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
) -> VSOutput {
    var output: VSOutput;
    output.vUV = aUV;
    let mvp = globalUniforms.uProjectionMatrix * localUniforms.uTransformMatrix;
    let pos = mvp * vec3<f32>(aPosition, 1.0);
    output.position = vec4<f32>(pos.xy, 0.0, 1.0);
    return output;
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
    cellSize: f32,
    parallax: f32,
    density: f32,
    radiusWorld: f32,
    brightness: f32,
    salt: i32,
    uTime: f32,
    uDensidade: f32,
) -> vec3<f32> {
    let pp = worldPos * parallax;
    var cellRaw = vec2<i32>(floor(pp / cellSize));
    cellRaw = ((cellRaw % vec2<i32>(32768)) + vec2<i32>(32768)) % vec2<i32>(32768);
    let inCell = fract(pp / cellSize);

    let lottery = hash1(cellRaw, salt);
    if (lottery > density * clamp(uDensidade, 0.0, 2.0)) { return vec3<f32>(0.0); }

    let velDir = hash2(cellRaw, salt + 23) - vec2<f32>(0.5);
    let speed = 0.015 + hash1(cellRaw, salt + 43) * 0.025;
    let drift = velDir * uTime * speed;

    let starPos = fract(hash2(cellRaw, salt + 13) + drift);
    let d = (inCell - starPos) * cellSize;
    let distInf = max(abs(d.x), abs(d.y));

    if (distInf > radiusWorld) { return vec3<f32>(0.0); }

    let bmod = 0.35 + 0.65 * hash1(cellRaw, salt + 97);
    return vec3<f32>(brightness * bmod);
}

@fragment
fn mainFragment(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
    let worldPos = starUniforms.uCamera + (vUV - vec2<f32>(0.5)) * starUniforms.uViewport;
    let t = starUniforms.uTime;
    let dens = starUniforms.uDensidade;

    var col = vec3<f32>(0.0);
    col = col + starLayer(worldPos, 24.0,  0.40, 0.75, 0.5, 0.55, 1, t, dens);
    col = col + starLayer(worldPos, 60.0,  0.25, 0.40, 0.5, 0.85, 2, t, dens);
    col = col + starLayer(worldPos, 200.0, 0.12, 0.30, 1.5, 1.00, 3, t, dens);

    return vec4<f32>(col, 1.0);
}
