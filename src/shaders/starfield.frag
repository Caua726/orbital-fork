in vec2 vUV;
out vec4 finalColor;

// Camera in world units (center of viewport).
uniform vec2 uCamera;
// Viewport size in world units (screenW/zoom, screenH/zoom).
uniform vec2 uViewport;
// Time in seconds for twinkle + drift animation.
uniform float uTime;
// Density multiplier (0..2, 1 = default).
uniform float uDensidade;

// Hash a 2D integer-like coord into [0, 1).
float hash12(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 37.73);
    return fract(p.x * p.y);
}

// Hash to [-1, 1] vec2
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

/**
 * One starfield layer. Each layer partitions its (parallax-adjusted)
 * world space into a grid of CELL_SIZE square cells. Per cell, a
 * deterministic hash decides whether a star exists, its subcell
 * position, radius, and twinkle phase.
 *
 * Layers differ in: cell size (bigger cell = sparser), parallax
 * factor (0 = infinitely far, 1 = same as camera), drift speed, star
 * radius range, and tint. Combining 3 layers produces depth.
 */
vec3 starLayer(vec2 worldPos, float cellSize, float parallax, float drift,
               float baseRadius, vec3 tint, float densityThreshold) {
    // Apply parallax: far layers see a "scaled-down" camera movement.
    // Also add slow drift in world space so stars move even when the
    // camera is still.
    vec2 pp = worldPos * parallax + vec2(uTime * drift, uTime * drift * 0.6);
    vec2 cellID = floor(pp / cellSize);
    vec2 inCell = fract(pp / cellSize);

    // Density gate: only roughly densityThreshold% of cells contain a
    // star. Uses the cell id as the lottery seed.
    float lottery = hash12(cellID);
    if (lottery > densityThreshold * uDensidade) return vec3(0.0);

    // Star position inside the cell (random but stable per cellID).
    vec2 starPos = hash22(cellID + 13.0);

    // Distance from this pixel to the star center (in cell-local units).
    vec2 d = inCell - starPos;
    float dist = length(d);

    // Star size varies — some stars are big, most small. Cube curve to
    // make big stars rare.
    float sizeRand = hash12(cellID + 97.0);
    float radius = baseRadius * (0.35 + 0.65 * sizeRand * sizeRand * sizeRand);

    // Hard-ish disc, no halo/glow. Narrow edge fade for anti-aliasing.
    float intensity = smoothstep(radius, radius * 0.6, dist);

    // Twinkle: sinusoidal brightness per-star with random phase.
    float twinklePhase = hash12(cellID + 5.0) * 6.2831853;
    float twinkleFreq = 0.5 + hash12(cellID + 11.0) * 1.5;
    float twinkle = 0.65 + 0.35 * sin(uTime * twinkleFreq + twinklePhase);
    intensity *= twinkle;

    // Slight color variation — most stars white, some tinted.
    float colorRand = hash12(cellID + 31.0);
    vec3 color = mix(vec3(1.0), tint, colorRand * 0.6);

    return color * intensity;
}

void main() {
    // Pixel world position: camera + UV offset across viewport.
    // vUV is 0..1 over the quad; we want -0.5..0.5 so (0,0) is screen center.
    vec2 worldPos = uCamera + (vUV - 0.5) * uViewport;

    vec3 col = vec3(0.0);

    // ── Far layer: tiny, sparse, slowest parallax, almost white.
    col += starLayer(
        worldPos,
        /*cellSize*/     260.0,
        /*parallax*/     0.15,
        /*drift*/        1.2,
        /*baseRadius*/   0.025,
        /*tint*/         vec3(0.85, 0.92, 1.0),
        /*threshold*/    0.55
    );

    // ── Mid layer: medium density + size, blue-ish tint.
    col += starLayer(
        worldPos,
        180.0,
        0.45,
        3.5,
        0.035,
        vec3(0.85, 0.9, 1.0),
        0.40
    ) * 0.9;

    // ── Near layer: sparser but bigger, warm tint, fastest drift.
    col += starLayer(
        worldPos,
        140.0,
        0.9,
        7.0,
        0.05,
        vec3(1.0, 0.85, 0.75),
        0.22
    ) * 0.85;

    // Subtle background tint (deep-space blue) so it's not pure black.
    col += vec3(0.012, 0.014, 0.028);

    finalColor = vec4(col, 1.0);
}
