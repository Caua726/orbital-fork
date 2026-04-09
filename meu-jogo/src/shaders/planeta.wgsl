// Group 0: Global uniforms (auto-assigned by PixiJS)
struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

// Group 1: Local uniforms (auto-assigned by PixiJS)
struct LocalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uColor: vec4<f32>,
    uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

// Group 2: Planet uniforms (our custom data)
struct PlanetUniforms {
    uPixels: f32,
    uTime: f32,
    uSeed: f32,
    uRotation: f32,
    uLightOrigin: vec2<f32>,
    uTimeSpeed: f32,
    uDitherSize: f32,
    uLightBorder1: f32,
    uLightBorder2: f32,
    uSize: f32,
    uOctaves: i32,
    uPlanetType: i32,
    uRiverCutoff: f32,
    uLandCutoff: f32,
    uCloudCover: f32,
    uStretch: f32,
    uCloudCurve: f32,
    uColors0: vec4<f32>,
    uColors1: vec4<f32>,
    uColors2: vec4<f32>,
    uColors3: vec4<f32>,
    uColors4: vec4<f32>,
    uColors5: vec4<f32>,
    uTiles: f32,
    uCloudAlpha: f32,
};
@group(2) @binding(0) var<uniform> planetUniforms : PlanetUniforms;

// === Vertex ===
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

// === Fragment helpers ===
fn rand(coord_in: vec2<f32>) -> f32 {
    var m: vec2<f32>;
    if (planetUniforms.uPlanetType == 0 || planetUniforms.uPlanetType == 1) {
        m = vec2<f32>(2.0, 1.0) * floor(planetUniforms.uSize + 0.5);
    } else {
        m = vec2<f32>(1.0, 1.0) * floor(planetUniforms.uSize + 0.5);
    }
    let c = ((coord_in % m) + m) % m;
    return fract(sin(dot(c, vec2<f32>(12.9898, 78.233))) * 15.5453 * planetUniforms.uSeed);
}

fn noise(coord: vec2<f32>) -> f32 {
    let i = floor(coord);
    let f = fract(coord);
    let a = rand(i);
    let b = rand(i + vec2<f32>(1.0, 0.0));
    let c = rand(i + vec2<f32>(0.0, 1.0));
    let d = rand(i + vec2<f32>(1.0, 1.0));
    let cubic = f * f * (3.0 - 2.0 * f);
    return mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;
}

fn fbm(coord_in: vec2<f32>) -> f32 {
    var value = 0.0;
    var scale = 0.5;
    var coord = coord_in;
    for (var i = 0; i < 6; i++) {
        if (i >= planetUniforms.uOctaves) { break; }
        value += noise(coord) * scale;
        coord *= 2.0;
        scale *= 0.5;
    }
    return value;
}

fn spherify(uv: vec2<f32>) -> vec2<f32> {
    let centered = uv * 2.0 - 1.0;
    let z = sqrt(max(0.0, 1.0 - dot(centered, centered)));
    let sphere = centered / (z + 1.0);
    return sphere * 0.5 + 0.5;
}

fn rotate2d(coord_in: vec2<f32>, angle: f32) -> vec2<f32> {
    var c = coord_in - 0.5;
    let ca = cos(angle);
    let sa = sin(angle);
    c = vec2<f32>(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
    return c + 0.5;
}

fn dither(uv1: vec2<f32>, uv2: vec2<f32>) -> bool {
    return ((uv1.x + uv2.y) % (2.0 / planetUniforms.uPixels)) <= 1.0 / planetUniforms.uPixels;
}

// === Terran planet ===
fn terranPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let dith = dither(uv_in, uvRaw);
    let a = step(length(uv_in - vec2<f32>(0.5)), 0.49999);
    var uv = spherify(uv_in);
    let d_light = distance(uv, planetUniforms.uLightOrigin);
    uv = rotate2d(uv, planetUniforms.uRotation);

    let base_uv = uv * planetUniforms.uSize + vec2<f32>(planetUniforms.uTime * planetUniforms.uTimeSpeed, 0.0);
    let fbm1 = fbm(base_uv);
    var fbm2 = fbm(base_uv - planetUniforms.uLightOrigin * fbm1);
    var fbm3 = fbm(base_uv - planetUniforms.uLightOrigin * 1.5 * fbm1);
    var fbm4 = fbm(base_uv - planetUniforms.uLightOrigin * 2.0 * fbm1);

    let dither_border = (1.0 / planetUniforms.uPixels) * planetUniforms.uDitherSize;
    if (d_light < planetUniforms.uLightBorder1) { fbm4 *= 0.9; }
    if (d_light > planetUniforms.uLightBorder1) { fbm2 *= 1.05; fbm3 *= 1.05; fbm4 *= 1.05; }
    if (d_light > planetUniforms.uLightBorder2) {
        fbm2 *= 1.3; fbm3 *= 1.4; fbm4 *= 1.8;
        if (d_light < planetUniforms.uLightBorder2 + dither_border && dith) { fbm4 *= 0.5; }
    }

    var dl = pow(d_light, 2.0) * 0.4;
    var col = planetUniforms.uColors3;
    if (fbm4 + dl < fbm1 * 1.5) { col = planetUniforms.uColors2; }
    if (fbm3 + dl < fbm1 * 1.0) { col = planetUniforms.uColors1; }
    if (fbm2 + dl < fbm1) { col = planetUniforms.uColors0; }

    let river_fbm = step(planetUniforms.uRiverCutoff, fbm(base_uv + fbm1 * 6.0));
    if (river_fbm < fbm1 * 0.5) {
        col = planetUniforms.uColors5;
        if (fbm4 + dl < fbm1 * 1.5) { col = planetUniforms.uColors4; }
    }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Dry planet ===
fn dryPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let d_circle = distance(uv_in, vec2<f32>(0.5));
    var d_light = distance(uv_in, planetUniforms.uLightOrigin);
    let a = step(d_circle, 0.49999);
    let dith = dither(uv_in, uvRaw);
    let uv = rotate2d(uv_in, planetUniforms.uRotation);

    let fbm1 = fbm(uv);
    d_light += fbm(uv * planetUniforms.uSize + fbm1 + vec2<f32>(planetUniforms.uTime * planetUniforms.uTimeSpeed, 0.0)) * 0.3;

    let dither_border = (1.0 / planetUniforms.uPixels) * planetUniforms.uDitherSize;
    var col = planetUniforms.uColors0;
    if (d_light > planetUniforms.uLightBorder1) {
        col = planetUniforms.uColors1;
        if (d_light < planetUniforms.uLightBorder1 + dither_border && dith) { col = planetUniforms.uColors0; }
    }
    if (d_light > planetUniforms.uLightBorder2) {
        col = planetUniforms.uColors2;
        if (d_light < planetUniforms.uLightBorder2 + dither_border && dith) { col = planetUniforms.uColors1; }
    }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Gas Giant (simplified) ===
fn gasPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let d_light = distance(uv_in, planetUniforms.uLightOrigin);
    let d_circle = distance(uv_in, vec2<f32>(0.5));
    let a = step(d_circle, 0.49999);

    var uv = rotate2d(uv_in, planetUniforms.uRotation);
    uv = spherify(uv);

    var col = planetUniforms.uColors3;
    let n = fbm(uv * planetUniforms.uSize + vec2<f32>(planetUniforms.uTime * planetUniforms.uTimeSpeed, 0.0));
    if (n > 0.4) { col = planetUniforms.uColors2; }
    if (n > 0.5) { col = planetUniforms.uColors1; }
    if (n > 0.6) { col = planetUniforms.uColors0; }
    if (d_light > planetUniforms.uLightBorder1) { col = mix(col, planetUniforms.uColors2, 0.3); }
    if (d_light > planetUniforms.uLightBorder2) { col = mix(col, planetUniforms.uColors3, 0.5); }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Star (body only for WGSL) ===
fn Hash2(p: vec2<f32>) -> vec2<f32> {
    let r = 523.0 * sin(dot(p, vec2<f32>(53.3158, 43.6143))) * planetUniforms.uSeed;
    return vec2<f32>(fract(15.32354 * r), fract(17.25865 * r));
}

fn Cells(p_in: vec2<f32>, numCells: f32) -> f32 {
    var p = p_in * numCells;
    var d = 1.0e10;
    for (var xo = -1; xo <= 1; xo++) {
        for (var yo = -1; yo <= 1; yo++) {
            var tp = floor(p) + vec2<f32>(f32(xo), f32(yo));
            tp = p - tp - Hash2(((tp % (numCells / planetUniforms.uTiles)) + (numCells / planetUniforms.uTiles)) % (numCells / planetUniforms.uTiles));
            d = min(d, dot(tp, tp));
        }
    }
    return sqrt(d);
}

fn starPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let d = distance(uv_in, vec2<f32>(0.5));
    let a = step(d, 0.49999);
    let dith = dither(uvRaw, uv_in);

    let ruv = rotate2d(uv_in, planetUniforms.uRotation);
    let suv = spherify(ruv);

    let bodyTime = planetUniforms.uTime * 0.5;
    var n = Cells(suv - vec2<f32>(bodyTime * planetUniforms.uTimeSpeed * 2.0, 0.0), 10.0);
    n *= Cells(suv - vec2<f32>(bodyTime * planetUniforms.uTimeSpeed, 0.0), 20.0);
    n = clamp(n * 2.0, 0.0, 1.0);
    if (dith) { n *= 1.3; }

    let idx = i32(floor(n * 3.0));
    var col = planetUniforms.uColors0;
    if (idx == 1) { col = planetUniforms.uColors1; }
    if (idx == 2) { col = planetUniforms.uColors2; }
    if (idx >= 3) { col = planetUniforms.uColors3; }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Main fragment ===
@fragment
fn mainFragment(input: VSOutput) -> @location(0) vec4<f32> {
    let uv = input.vUV;
    let uvPix = floor(uv * planetUniforms.uPixels) / planetUniforms.uPixels;

    var col: vec4<f32>;
    if (planetUniforms.uPlanetType == 0) {
        col = terranPlanet(uvPix, uv);
    } else if (planetUniforms.uPlanetType == 1) {
        col = dryPlanet(uvPix, uv);
    } else if (planetUniforms.uPlanetType == 3) {
        col = gasPlanet(uvPix, uv);
    } else {
        col = starPlanet(uvPix, uv);
    }

    // Premultiplied alpha
    return vec4<f32>(col.rgb * col.a, col.a);
}
