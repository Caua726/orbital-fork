#version 300 es
// Universal-compatibility starfield. PCG integer hash → bit-exact
// across Chrome/ANGLE, Firefox/native, and SwiftShader. Star size
// is expressed in WHOLE pixels (1 or 2) via integer delta check, so
// every star is as crisp as the static bitmap reference — no
// sub-pixel fringing, no aliasing along edges.
precision highp float;
precision highp int;

in vec2 vUV;
out vec4 finalColor;

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
 * One starfield layer. Everything is on an INTEGER pixel grid:
 *
 *   - Cells partition parallax-offset world space (so camera motion
 *     scrolls the lattice, never re-rolling cells).
 *   - Each live cell owns ONE star whose position is floored to the
 *     integer world grid — guarantees a crisp N×N pixel appearance.
 *   - Drift is applied BEFORE flooring, so a star still wanders one
 *     pixel at a time rather than smearing across two.
 *
 * sizePx: star size in world-pixels (1 for dim, 2 for bright 2×2).
 *   At zoom=1, 1 world unit = 1 screen pixel.
 */
vec3 starLayer(vec2 worldPos, float cellSize, float parallax,
               float density, int sizePx, float maxBrightness,
               int salt) {
    // Parallax by OFFSET, not scale — keeps star size constant
    // across layers. Layer at parallax=0 stays still relative to
    // the screen; parallax=1 moves 1:1 with the camera.
    vec2 pp = worldPos - uCamera * (1.0 - parallax);

    ivec2 cellID = ((ivec2(floor(pp / cellSize)) % 32768) + 32768) % 32768;
    vec2 inCell = fract(pp / cellSize);

    float lottery = hash1(cellID, salt);
    if (lottery > density * clamp(uDensidade, 0.0, 2.0)) return vec3(0.0);

    // Per-star velocity + speed from the hash → each star wanders
    // its own direction. Speed range 0.003..0.008 cell-units/sec
    // gives a subtle twinkle of motion without the field feeling
    // busy; roughly 5× slower than the first tuning.
    vec2 velDir = hash2(cellID, salt + 23) - 0.5;
    float speed = 0.003 + hash1(cellID, salt + 43) * 0.005;
    vec2 drift = velDir * uTime * speed;

    // Star position inside cell in [0, 1]² after drift.
    vec2 starPosNorm = fract(hash2(cellID, salt + 13) + drift);

    // Snap to integer world-pixel grid for crispness.
    vec2 cellOrigin = vec2(cellID) * cellSize;
    vec2 starWorldPx = floor(cellOrigin + starPosNorm * cellSize);

    // Fragment's parallax-space pixel coord.
    vec2 fragWorldPx = floor(pp);

    vec2 delta = fragWorldPx - starWorldPx;
    float s = float(sizePx);
    if (delta.x < 0.0 || delta.x >= s) return vec3(0.0);
    if (delta.y < 0.0 || delta.y >= s) return vec3(0.0);

    // Bitmap-matched brightness spread: 0.35..1.0 of maxBrightness.
    float bmod = 0.35 + 0.65 * hash1(cellID, salt + 97);
    return vec3(maxBrightness * bmod);
}

void main() {
    vec2 worldPos = uCamera + (vUV - 0.5) * uViewport;

    vec3 col = vec3(0.0);
    // Three layers — dense dim, medium, rare 2×2 brights. Counts
    // roughly match the static bitmap reference (~1500 visible).
    col += starLayer(worldPos, 24.0,  0.40, 0.75, 1, 0.80, 1);
    col += starLayer(worldPos, 60.0,  0.25, 0.40, 1, 0.95, 2);
    col += starLayer(worldPos, 200.0, 0.12, 0.30, 2, 1.00, 3);

    finalColor = vec4(col, 1.0);
}
