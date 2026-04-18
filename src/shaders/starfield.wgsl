// Group 0: Pixi globals
struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

// Group 1: Pixi locals
struct LocalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uColor: vec4<f32>,
    uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

// Group 2: Starfield custom uniforms
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

fn hash12(p_in: vec2<f32>) -> f32 {
    var p = fract(p_in * vec2<f32>(443.897, 441.423));
    p = p + vec2<f32>(dot(p, p + 37.73));
    return fract(p.x * p.y);
}

fn hash22(p_in: vec2<f32>) -> vec2<f32> {
    var p3 = fract(vec3<f32>(p_in.x, p_in.y, p_in.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 = p3 + vec3<f32>(dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33));
    return fract((vec2<f32>(p3.x, p3.x) + vec2<f32>(p3.y, p3.z)) * vec2<f32>(p3.z, p3.y));
}

fn starLayer(
    worldPos: vec2<f32>,
    cellSize: f32,
    parallax: f32,
    baseRadius: f32,
    densityThreshold: f32,
    uTime: f32,
    uDensidade: f32,
) -> vec3<f32> {
    let pp = worldPos * parallax;
    let cellID = floor(pp / cellSize);
    let inCell = fract(pp / cellSize);

    let lottery = hash12(cellID);
    if (lottery > densityThreshold * uDensidade) { return vec3<f32>(0.0); }

    let velDir = hash22(cellID + vec2<f32>(23.0)) - vec2<f32>(0.5);
    let speed = 0.015 + hash12(cellID + vec2<f32>(43.0)) * 0.025;
    let drift = velDir * uTime * speed;

    let starPos = fract(hash22(cellID + vec2<f32>(13.0)) + drift);
    let d = inCell - starPos;
    let dist = length(d);

    let sizeRand = hash12(cellID + vec2<f32>(97.0));
    let radius = baseRadius * (0.6 + 0.4 * sizeRand);

    // Pixel-perfect hard edge. step(dist, radius) = 1.0 if dist <= radius.
    let intensity = step(dist, radius);
    return vec3<f32>(1.0) * intensity;
}

@fragment
fn mainFragment(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
    let worldPos = starUniforms.uCamera + (vUV - vec2<f32>(0.5)) * starUniforms.uViewport;
    let t = starUniforms.uTime;
    let dens = starUniforms.uDensidade;

    var col = vec3<f32>(0.0);

    col = col + starLayer(worldPos, 260.0, 0.15, 0.025, 0.55, t, dens);
    col = col + starLayer(worldPos, 180.0, 0.45, 0.035, 0.40, t, dens);
    col = col + starLayer(worldPos, 140.0, 0.90, 0.050, 0.22, t, dens);

    return vec4<f32>(col, 1.0);
}
