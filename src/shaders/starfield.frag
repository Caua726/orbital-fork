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
vec3 starLayer(vec2 worldPos, float cellSize, float parallax,
               float baseRadius, float densityThreshold) {
    // Parallax only — no shared layer drift. Per-star motion below.
    vec2 pp = worldPos * parallax;
    vec2 cellID = floor(pp / cellSize);
    vec2 inCell = fract(pp / cellSize);

    float lottery = hash12(cellID);
    if (lottery > densityThreshold * uDensidade) return vec3(0.0);

    // Each star has its own velocity vector derived from cell hash.
    // Centered [-0.5, 0.5] × speed scalar, so different stars drift in
    // genuinely different directions at different speeds.
    vec2 velDir = hash22(cellID + 23.0) - 0.5;
    float speed = 0.015 + hash12(cellID + 43.0) * 0.025;
    vec2 drift = velDir * uTime * speed;

    // Home position in the cell, then apply drift. fract() wraps the
    // star around inside the cell so it never leaves its slot — the
    // wrap is invisible because stars are sub-pixel at the boundary.
    vec2 starPos = fract(hash22(cellID + 13.0) + drift);

    vec2 d = inCell - starPos;
    float dist = length(d);

    float sizeRand = hash12(cellID + 97.0);
    float radius = baseRadius * (0.35 + 0.65 * sizeRand * sizeRand * sizeRand);

    // Flat intensity — no twinkle, no halo. smoothstep kept only as
    // a 1-pixel anti-alias edge so small dots don't aliase while
    // panning. Intensity is 1.0 or 0.0 with a thin fade.
    float intensity = smoothstep(radius, radius * 0.75, dist);

    return vec3(1.0) * intensity;
}

void main() {
    // Pixel world position: camera + UV offset across viewport.
    // vUV is 0..1 over the quad; we want -0.5..0.5 so (0,0) is screen center.
    vec2 worldPos = uCamera + (vUV - 0.5) * uViewport;

    vec3 col = vec3(0.0);

    // Three layers — parallax factors differ for fake depth. Stars
    // move individually per layer via velocity in starLayer().
    col += starLayer(worldPos, 260.0, 0.15, 0.025, 0.55);
    col += starLayer(worldPos, 180.0, 0.45, 0.035, 0.40);
    col += starLayer(worldPos, 140.0, 0.90, 0.050, 0.22);

    finalColor = vec4(col, 1.0);
}
