// Procedural planet shader (5 body types + cloud + dither).
// Output must match the WebGL2 reference fragment bit-for-bit so the same
// world (same seed, same uniforms) renders identically on every backend.

struct CameraUniforms {
    camera: vec2<f32>,
    viewport: vec2<f32>,
    time: f32,
    _pad0: f32, _pad1: f32, _pad2: f32,
};

// 24 fields, 192 bytes total (6 prefix rows × 16B + 6 vec4 colors × 16B).
// Layout MUST match the Rust `PlanetUniforms` struct that Task 2 will
// create — any reorder breaks std140 alignment and the GPU reads garbage.
struct PlanetUniforms {
    // 16 bytes
    u_time: f32,
    u_seed: f32,
    u_rotation: f32,
    u_pixels: f32,
    // 16 bytes
    u_light_origin: vec2<f32>,
    u_time_speed: f32,
    u_dither_size: f32,
    // 16 bytes
    u_light_border1: f32,
    u_light_border2: f32,
    u_size: f32,
    u_octaves: i32,
    // 16 bytes
    u_planet_type: i32,
    u_river_cutoff: f32,
    u_land_cutoff: f32,
    u_cloud_cover: f32,
    // 16 bytes
    u_stretch: f32,
    u_cloud_curve: f32,
    u_tiles: f32,
    u_cloud_alpha: f32,
    // 16 bytes
    u_world_pos: vec2<f32>,
    u_world_size: vec2<f32>,
    // 6 × 16 = 96 bytes
    u_colors: array<vec4<f32>, 6>,
};

@group(0) @binding(0) var<uniform> engine_camera: CameraUniforms;
@group(1) @binding(0) var<uniform> planet: PlanetUniforms;

struct VsOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5,  0.5),
    );
    let corner = corners[vid];
    let world = planet.u_world_pos + corner * planet.u_world_size;
    let ndc = (world - engine_camera.camera) / (engine_camera.viewport * 0.5);
    var out: VsOut;
    out.clip_pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
    out.uv = corner + vec2<f32>(0.5);
    return out;
}

// PCG 2D → u32 hash; bit-exact WGSL mirror of the WebGL2 path so
// WebGPU renders identical planets to WebGL2.
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

fn rand(coord_in: vec2<f32>) -> f32 {
    var m: vec2<f32>;
    if (planet.u_planet_type == 0 || planet.u_planet_type == 1) {
        m = vec2<f32>(2.0, 1.0) * floor(planet.u_size + 0.5);
    } else {
        m = vec2<f32>(1.0, 1.0) * floor(planet.u_size + 0.5);
    }
    let c = ((coord_in % m) + m) % m;
    let ic = vec2<i32>(floor(c));
    // Cast via i32 then bitcast<u32> — direct u32(negative_float) is
    // undefined in WGSL, which would silently diverge from the GLSL
    // and JS paths if a negative uSeed ever landed here.
    let seed32 = bitcast<u32>(i32(planet.u_seed * 65537.0));
    let seedY = seed32 * 1664525u + 1013904223u;
    let uc = vec2<u32>(ic + vec2<i32>(32768));
    return f32(pcg2d(uc + vec2<u32>(seed32, seedY))) * (1.0 / 4294967296.0);
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
        if (i >= planet.u_octaves) { break; }
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
    return ((uv1.x + uv2.y) % (2.0 / planet.u_pixels)) <= 1.0 / planet.u_pixels;
}

// by Leukbaars
fn circleNoise(uv_in: vec2<f32>) -> f32 {
    let uv_y = floor(uv_in.y);
    var uv = uv_in;
    uv.x = uv.x + uv_y * 0.31;
    let f = fract(uv);
    let h = rand(vec2<f32>(floor(uv.x), floor(uv_y)));
    let m = length(f - vec2<f32>(0.25) - vec2<f32>(h * 0.5));
    let r = h * 0.25;
    return smoothstep(0.0, r, m * 0.75);
}

// === Terran planet ===
fn terranPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let dith = dither(uv_in, uvRaw);
    let a = step(length(uv_in - vec2<f32>(0.5)), 0.49999);
    var uv = spherify(uv_in);
    let d_light = distance(uv, planet.u_light_origin);
    uv = rotate2d(uv, planet.u_rotation);

    let base_uv = uv * planet.u_size + vec2<f32>(planet.u_time * planet.u_time_speed, 0.0);
    let fbm1 = fbm(base_uv);
    var fbm2 = fbm(base_uv - planet.u_light_origin * fbm1);
    var fbm3 = fbm(base_uv - planet.u_light_origin * 1.5 * fbm1);
    var fbm4 = fbm(base_uv - planet.u_light_origin * 2.0 * fbm1);

    let dither_border = (1.0 / planet.u_pixels) * planet.u_dither_size;
    if (d_light < planet.u_light_border1) { fbm4 *= 0.9; }
    if (d_light > planet.u_light_border1) { fbm2 *= 1.05; fbm3 *= 1.05; fbm4 *= 1.05; }
    if (d_light > planet.u_light_border2) {
        fbm2 *= 1.3; fbm3 *= 1.4; fbm4 *= 1.8;
        if (d_light < planet.u_light_border2 + dither_border && dith) { fbm4 *= 0.5; }
    }

    var dl = pow(d_light, 2.0) * 0.4;
    var col = planet.u_colors[3];
    if (fbm4 + dl < fbm1 * 1.5) { col = planet.u_colors[2]; }
    if (fbm3 + dl < fbm1 * 1.0) { col = planet.u_colors[1]; }
    if (fbm2 + dl < fbm1) { col = planet.u_colors[0]; }

    let river_fbm = step(planet.u_river_cutoff, fbm(base_uv + fbm1 * 6.0));
    if (river_fbm < fbm1 * 0.5) {
        col = planet.u_colors[5];
        if (fbm4 + dl < fbm1 * 1.5) { col = planet.u_colors[4]; }
    }

    // u_cloud_alpha (NOT u_cloud_cover) is the terran cloud threshold —
    // u_cloud_cover is the gas-giant uniform and would misfire here.
    if (planet.u_cloud_alpha > 0.0 && a > 0.0) {
        var cloudUV = uv;
        cloudUV.y = cloudUV.y + smoothstep(0.0, 1.3, abs(cloudUV.x - 0.4));
        let cTime = planet.u_time * planet.u_time_speed * 0.5;
        var c_noise = 0.0;
        for (var ci = 0; ci < 9; ci++) {
            c_noise = c_noise + circleNoise(
                (cloudUV * planet.u_size * 0.3)
                + vec2<f32>(f32(ci + 1) + 10.0)
                + vec2<f32>(cTime, 0.0)
            );
        }
        let cloudFbm = fbm(cloudUV * planet.u_size + vec2<f32>(c_noise) + vec2<f32>(cTime, 0.0));
        let cloudMask = step(planet.u_cloud_alpha, cloudFbm);
        if (cloudMask > 0.0) {
            let spherified_raw = spherify(floor(uvRaw * planet.u_pixels) / planet.u_pixels);
            let d_cloud_light = distance(spherified_raw, planet.u_light_origin);
            var cloudCol = vec4<f32>(0.96, 1.0, 0.91, 1.0);
            if (cloudFbm < planet.u_cloud_alpha + 0.03) {
                cloudCol = vec4<f32>(0.87, 0.88, 0.91, 1.0);
            }
            if (d_cloud_light + cloudFbm * 0.2 > 0.52) {
                cloudCol = vec4<f32>(0.41, 0.44, 0.60, 1.0);
            }
            if (d_cloud_light + cloudFbm * 0.2 > 0.62) {
                cloudCol = vec4<f32>(0.25, 0.29, 0.45, 1.0);
            }
            col = cloudCol;
        }
    }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Dry planet ===
fn dryPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let d_circle = distance(uv_in, vec2<f32>(0.5));
    var d_light = distance(uv_in, planet.u_light_origin);
    let a = step(d_circle, 0.49999);
    let dith = dither(uv_in, uvRaw);
    let uv = rotate2d(uv_in, planet.u_rotation);

    let fbm1 = fbm(uv);
    d_light += fbm(uv * planet.u_size + fbm1 + vec2<f32>(planet.u_time * planet.u_time_speed, 0.0)) * 0.3;

    let dither_border = (1.0 / planet.u_pixels) * planet.u_dither_size;
    var col = planet.u_colors[0];
    if (d_light > planet.u_light_border1) {
        col = planet.u_colors[1];
        if (d_light < planet.u_light_border1 + dither_border && dith) { col = planet.u_colors[0]; }
    }
    if (d_light > planet.u_light_border2) {
        col = planet.u_colors[2];
        if (d_light < planet.u_light_border2 + dither_border && dith) { col = planet.u_colors[1]; }
    }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Islands planet ===
fn islandsPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    var d_light = distance(uv_in, planet.u_light_origin);
    let d_circle = distance(uv_in, vec2<f32>(0.5));
    let a = step(d_circle, 0.49999);

    var uv = rotate2d(uv_in, planet.u_rotation);
    uv = spherify(uv);

    let base_fbm_uv = uv * planet.u_size + vec2<f32>(planet.u_time * planet.u_time_speed, 0.0);
    let fbm1 = fbm(base_fbm_uv);
    var fbm2 = fbm(base_fbm_uv - planet.u_light_origin * fbm1);
    var fbm3 = fbm(base_fbm_uv - planet.u_light_origin * 1.5 * fbm1);
    var fbm4 = fbm(base_fbm_uv - planet.u_light_origin * 2.0 * fbm1);

    if (d_light < planet.u_light_border1) { fbm4 = fbm4 * 0.9; }
    if (d_light > planet.u_light_border1) {
        fbm2 = fbm2 * 1.05;
        fbm3 = fbm3 * 1.05;
        fbm4 = fbm4 * 1.05;
    }
    if (d_light > planet.u_light_border2) {
        fbm2 = fbm2 * 1.3;
        fbm3 = fbm3 * 1.4;
        fbm4 = fbm4 * 1.8;
    }

    let d_light_pow = pow(d_light, 2.0) * 0.1;
    var col = planet.u_colors[3];
    if (fbm4 + d_light_pow < fbm1) { col = planet.u_colors[2]; }
    if (fbm3 + d_light_pow < fbm1) { col = planet.u_colors[1]; }
    if (fbm2 + d_light_pow < fbm1) { col = planet.u_colors[0]; }

    return vec4<f32>(col.rgb, step(planet.u_land_cutoff, fbm1) * a * col.a);
}

// === Gas Giant (simplified) ===
fn gasPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let d_light = distance(uv_in, planet.u_light_origin);
    let d_circle = distance(uv_in, vec2<f32>(0.5));
    let a = step(d_circle, 0.49999);

    var uv = rotate2d(uv_in, planet.u_rotation);
    uv = spherify(uv);

    var col = planet.u_colors[3];
    let n = fbm(uv * planet.u_size + vec2<f32>(planet.u_time * planet.u_time_speed, 0.0));
    if (n > 0.4) { col = planet.u_colors[2]; }
    if (n > 0.5) { col = planet.u_colors[1]; }
    if (n > 0.6) { col = planet.u_colors[0]; }
    if (d_light > planet.u_light_border1) { col = mix(col, planet.u_colors[2], 0.3); }
    if (d_light > planet.u_light_border2) { col = mix(col, planet.u_colors[3], 0.5); }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Star (body only for WGSL) ===
fn Hash2(p: vec2<f32>) -> vec2<f32> {
    let r = 523.0 * sin(dot(p, vec2<f32>(53.3158, 43.6143))) * planet.u_seed;
    return vec2<f32>(fract(15.32354 * r), fract(17.25865 * r));
}

fn Cells(p_in: vec2<f32>, numCells: f32) -> f32 {
    var p = p_in * numCells;
    var d = 1.0e10;
    for (var xo = -1; xo <= 1; xo++) {
        for (var yo = -1; yo <= 1; yo++) {
            var tp = floor(p) + vec2<f32>(f32(xo), f32(yo));
            tp = p - tp - Hash2(((tp % (numCells / planet.u_tiles)) + (numCells / planet.u_tiles)) % (numCells / planet.u_tiles));
            d = min(d, dot(tp, tp));
        }
    }
    return sqrt(d);
}

fn starPlanet(uv_in: vec2<f32>, uvRaw: vec2<f32>) -> vec4<f32> {
    let d = distance(uv_in, vec2<f32>(0.5));
    let a = step(d, 0.49999);
    let dith = dither(uvRaw, uv_in);

    let ruv = rotate2d(uv_in, planet.u_rotation);
    let suv = spherify(ruv);

    let bodyTime = planet.u_time * 0.5;
    var n = Cells(suv - vec2<f32>(bodyTime * planet.u_time_speed * 2.0, 0.0), 10.0);
    n *= Cells(suv - vec2<f32>(bodyTime * planet.u_time_speed, 0.0), 20.0);
    n = clamp(n * 2.0, 0.0, 1.0);
    if (dith) { n *= 1.3; }

    let idx = i32(floor(n * 3.0));
    var col = planet.u_colors[0];
    if (idx == 1) { col = planet.u_colors[1]; }
    if (idx == 2) { col = planet.u_colors[2]; }
    if (idx >= 3) { col = planet.u_colors[3]; }

    return vec4<f32>(col.rgb, a * col.a);
}

// === Main fragment ===
@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    let uv = input.uv;
    let uvPix = floor(uv * planet.u_pixels) / planet.u_pixels;

    var col: vec4<f32>;
    if (planet.u_planet_type == 0) {
        col = terranPlanet(uvPix, uv);
    } else if (planet.u_planet_type == 1) {
        col = dryPlanet(uvPix, uv);
    } else if (planet.u_planet_type == 2) {
        col = islandsPlanet(uvPix, uv);
    } else if (planet.u_planet_type == 3) {
        col = gasPlanet(uvPix, uv);
    } else {
        col = starPlanet(uvPix, uv);
    }

    // Premultiplied alpha
    return vec4<f32>(col.rgb * col.a, col.a);
}
