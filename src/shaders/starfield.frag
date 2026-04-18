// Universal-compatibility starfield. Hash is integer PCG so the
// star lattice is bit-exact across Chrome/ANGLE, Firefox/native,
// and SwiftShader. Animation model matches the original: each
// star has its OWN velocity vector derived from the cell hash, so
// stars drift linearly at their own speeds, never re-rolling when
// the camera moves. Aesthetic is the pixel-art bitmap look: lots
// of tiny 1-px dots + occasional 2×2 brights.
//
// IMPORTANT: in/out MUST be the first non-comment lines so Pixi's
// GLSL-version detector promotes us to `#version 300 es`. Otherwise
// uint/uvec2 fail to parse in GLSL 1.00 (the unchanged default).
in vec2 vUV;
out vec4 finalColor;

precision highp float;
precision highp int;

uniform vec2 uCamera;
uniform vec2 uViewport;
uniform float uTime;
uniform float uDensidade;

// ── Deterministic integer hash (WebGL2 guarantees u32) ─────────
uint pcg2d(uvec2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v ^= v >> 16u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v ^= v >> 16u;
    return v.x ^ v.y;
}
float hash1(ivec2 cell, int salt) {
    return float(pcg2d(uvec2(cell + ivec2(salt + 32768)))) * (1.0 / 4294967296.0);
}
vec2 hash2(ivec2 cell, int salt) {
    uint h = pcg2d(uvec2(cell + ivec2(salt + 32768)));
    return vec2(float(h & 0xFFFFu), float(h >> 16u)) * (1.0 / 65536.0);
}

/**
 * One starfield layer. Cells are partitioned in PARALLAX-adjusted
 * world space so camera motion just scrolls the lattice past the
 * viewport — every cell's content stays identical. Each star picks
 * its own velocity + speed from the hash, so they drift in
 * genuinely different directions (not as one scrolling field).
 */
vec3 starLayer(vec2 worldPos, float cellSize, float parallax,
               float density, float radiusWorld, float brightness,
               int salt) {
    vec2 pp = worldPos * parallax;
    ivec2 cellID = ((ivec2(floor(pp / cellSize)) % 32768) + 32768) % 32768;
    vec2 inCell = fract(pp / cellSize);

    float lottery = hash1(cellID, salt);
    if (lottery > density * clamp(uDensidade, 0.0, 2.0)) return vec3(0.0);

    // Per-star velocity vector in [-0.5, 0.5]² and speed 0.015..0.04
    // — mirrors the original shader's motion model so the star field
    // still feels alive (each star wandering its own direction) but
    // every random here goes through the integer PCG hash.
    vec2 velDir = hash2(cellID, salt + 23) - 0.5;
    float speed = 0.015 + hash1(cellID, salt + 43) * 0.025;
    vec2 drift = velDir * uTime * speed;

    // Home position + drift, then fract() to wrap the star around
    // inside its own cell. Invisible wrap because stars are sub-pixel
    // at the cell boundary.
    vec2 starPos = fract(hash2(cellID, salt + 13) + drift);

    vec2 d = (inCell - starPos) * cellSize;
    float distInf = max(abs(d.x), abs(d.y));

    if (distInf > radiusWorld) return vec3(0.0);
    return vec3(brightness);
}

void main() {
    vec2 worldPos = uCamera + (vUV - 0.5) * uViewport;

    vec3 col = vec3(0.0);
    // Low parallax → stars feel distant.
    // Three layers matching the static bitmap's density: dense dim
    // up front, sparser + brighter at depth.
    col += starLayer(worldPos, 22.0,  0.40, 0.85, 1.0, 0.45, 1);
    col += starLayer(worldPos, 34.0,  0.25, 0.60, 1.0, 0.70, 2);
    col += starLayer(worldPos, 160.0, 0.12, 0.45, 2.0, 1.00, 3);

    finalColor = vec4(col, 1.0);
}
