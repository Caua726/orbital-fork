// Composites the half-resolution planet target onto the frame — the weydra
// equivalent of the Pixi half-res AlphaFilter (resolution 0.5) that the
// reference game applies to every live planet/star.
//
// The target holds sRGB-space premultiplied colour (exactly what the Pixi
// filter's render texture holds), so the bilinear upscale filters the same
// bytes Pixi filters. Only after filtering is the colour decoded to linear
// for the sRGB surface view.

@group(0) @binding(0) var planet_target: texture_2d<f32>;
@group(0) @binding(1) var planet_sampler: sampler;
// xy = full frame size in pixels (the target is ceil(frame / 2), so for odd
// sizes the texture is not exactly half the frame).
@group(0) @binding(2) var<uniform> frame_size: vec4<f32>;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
    // Fullscreen triangle.
    let x = f32((vid << 1u) & 2u);
    let y = f32(vid & 2u);
    var out: VsOut;
    out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return out;
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / vec3<f32>(12.92);
    let high = pow((c + vec3<f32>(0.055)) / vec3<f32>(1.055), vec3<f32>(2.4));
    return select(low, high, c > vec3<f32>(0.04045));
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    // The target spans the whole frame (same NDC mapping), so frame pixel p
    // samples at p / frame — exact for odd frame sizes too.
    let c = textureSample(planet_target, planet_sampler, input.pos.xy / frame_size.xy);
    if (c.a <= 0.0) {
        return vec4<f32>(0.0);
    }
    let linear_rgb = srgb_to_linear(c.rgb / c.a);
    return vec4<f32>(linear_rgb * c.a, c.a);
}
