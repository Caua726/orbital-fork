in vec2 vUV;
out vec4 finalColor;

// shared uniforms
uniform float uPixels;
uniform float uTime;
uniform float uSeed;
uniform float uRotation;
uniform vec2 uLightOrigin;
uniform float uTimeSpeed;
uniform float uDitherSize;
uniform float uLightBorder1;
uniform float uLightBorder2;
uniform float uSize;
uniform int uOctaves;
uniform int uPlanetType; // 0=terran, 1=dry, 2=islands, 3=gas

// terran (rivers)
uniform float uRiverCutoff;
uniform vec4 uColors0;
uniform vec4 uColors1;
uniform vec4 uColors2;
uniform vec4 uColors3;
uniform vec4 uColors4;
uniform vec4 uColors5;

// gas planet
uniform float uCloudCover;
uniform float uStretch;
uniform float uCloudCurve;

// islands
uniform float uLandCutoff;

// clouds (terran)
uniform float uCloudAlpha; // 0=no clouds, >0=has clouds

// star
uniform float uTiles;

float rand(vec2 coord) {
    // Stars, gas, and islands use square tiling; terran/dry use 2:1 for wrap-around
    vec2 m = (uPlanetType == 0 || uPlanetType == 1)
        ? vec2(2.0, 1.0) * floor(uSize + 0.5)
        : vec2(1.0, 1.0) * floor(uSize + 0.5);
    coord = mod(coord, m);
    return fract(sin(dot(coord.xy, vec2(12.9898, 78.233))) * 15.5453 * uSeed);
}

float noise(vec2 coord) {
    vec2 i = floor(coord);
    vec2 f = fract(coord);
    float a = rand(i);
    float b = rand(i + vec2(1.0, 0.0));
    float c = rand(i + vec2(0.0, 1.0));
    float d = rand(i + vec2(1.0, 1.0));
    vec2 cubic = f * f * (3.0 - 2.0 * f);
    return mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;
}

float fbm(vec2 coord) {
    float value = 0.0;
    float scale = 0.5;
    for (int i = 0; i < 6; i++) {
        if (i >= uOctaves) break;
        value += noise(coord) * scale;
        coord *= 2.0;
        scale *= 0.5;
    }
    return value;
}

vec2 spherify(vec2 uv) {
    vec2 centered = uv * 2.0 - 1.0;
    float z = sqrt(1.0 - dot(centered.xy, centered.xy));
    vec2 sphere = centered / (z + 1.0);
    return sphere * 0.5 + 0.5;
}

vec2 rotate2d(vec2 coord, float angle) {
    coord -= 0.5;
    coord *= mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    return coord + 0.5;
}

bool dither(vec2 uv1, vec2 uv2) {
    return mod(uv1.x + uv2.y, 2.0 / uPixels) <= 1.0 / uPixels;
}

// Gas planet circle noise (by Leukbaars)
float circleNoise(vec2 uv) {
    float uv_y = floor(uv.y);
    uv.x += uv_y * 0.31;
    vec2 f = fract(uv);
    float h = rand(vec2(floor(uv.x), floor(uv_y)));
    float m = length(f - 0.25 - (h * 0.5));
    float r = h * 0.25;
    return smoothstep(0.0, r, m * 0.75);
}

float cloudAlpha(vec2 uv) {
    float c_noise = 0.0;
    for (int i = 0; i < 9; i++) {
        c_noise += circleNoise((uv * uSize * 0.3) + (float(i + 1) + 10.0) + vec2(uTime * uTimeSpeed, 0.0));
    }
    return fbm(uv * uSize + c_noise + vec2(uTime * uTimeSpeed, 0.0));
}

// === TERRAN (Rivers) ===
vec4 terranPlanet(vec2 uv, vec2 uvRaw) {
    bool dith = dither(uv, uvRaw);
    float a = step(length(uv - vec2(0.5)), 0.49999);
    uv = spherify(uv);
    float d_light = distance(uv, uLightOrigin);
    uv = rotate2d(uv, uRotation);

    vec2 base_fbm_uv = uv * uSize + vec2(uTime * uTimeSpeed, 0.0);
    float fbm1 = fbm(base_fbm_uv);
    float fbm2 = fbm(base_fbm_uv - uLightOrigin * fbm1);
    float fbm3 = fbm(base_fbm_uv - uLightOrigin * 1.5 * fbm1);
    float fbm4 = fbm(base_fbm_uv - uLightOrigin * 2.0 * fbm1);

    float river_fbm = fbm(base_fbm_uv + fbm1 * 6.0);
    river_fbm = step(uRiverCutoff, river_fbm);

    float dither_border = (1.0 / uPixels) * uDitherSize;
    if (d_light < uLightBorder1) {
        fbm4 *= 0.9;
    }
    if (d_light > uLightBorder1) {
        fbm2 *= 1.05;
        fbm3 *= 1.05;
        fbm4 *= 1.05;
    }
    if (d_light > uLightBorder2) {
        fbm2 *= 1.3;
        fbm3 *= 1.4;
        fbm4 *= 1.8;
        if (d_light < uLightBorder2 + dither_border) {
            if (dith) {
                fbm4 *= 0.5;
            }
        }
    }

    d_light = pow(d_light, 2.0) * 0.4;
    vec4 col = uColors3;
    if (fbm4 + d_light < fbm1 * 1.5) col = uColors2;
    if (fbm3 + d_light < fbm1 * 1.0) col = uColors1;
    if (fbm2 + d_light < fbm1) col = uColors0;
    if (river_fbm < fbm1 * 0.5) {
        col = uColors5;
        if (fbm4 + d_light < fbm1 * 1.5) col = uColors4;
    }

    // Cloud layer (only for terran planets with uCloudAlpha > 0).
    // Gated on `a > 0.0` so the 9-iteration circleNoise loop + fbm
    // don't run for pixels outside the planet disc. Saves roughly
    // 40-55% of the terran fragment cost on pixels the shader was
    // about to discard anyway.
    if (uCloudAlpha > 0.0 && a > 0.0) {
        // Clouds use different seed offset, slower speed, and stretched UVs
        vec2 cloudUV = uv; // already spherified and rotated
        cloudUV.y += smoothstep(0.0, 1.3, abs(cloudUV.x - 0.4));

        // Use cloudAlpha with slightly different params for cloud pattern
        float cTime = uTime * uTimeSpeed * 0.5; // clouds move slower
        float c_noise = 0.0;
        for (int ci = 0; ci < 9; ci++) {
            c_noise += circleNoise((cloudUV * uSize * 0.3) + (float(ci + 1) + 10.0) + vec2(cTime, 0.0));
        }
        float cloudFbm = fbm(cloudUV * uSize + c_noise + vec2(cTime, 0.0));

        float cloudMask = step(uCloudAlpha, cloudFbm);

        if (cloudMask > 0.0) {
            // Cloud colors: white in light, grey in shadow, dark in deep shadow
            // Based on Godot .tscn: (0.96,1,0.91), (0.87,0.88,0.91), (0.41,0.44,0.6), (0.25,0.29,0.45)
            float d_cloud_light = distance(spherify(floor(vUV * uPixels) / uPixels), uLightOrigin);
            vec4 cloudCol = vec4(0.96, 1.0, 0.91, 1.0);
            if (cloudFbm < uCloudAlpha + 0.03) cloudCol = vec4(0.87, 0.88, 0.91, 1.0);
            if (d_cloud_light + cloudFbm * 0.2 > 0.52) cloudCol = vec4(0.41, 0.44, 0.60, 1.0);
            if (d_cloud_light + cloudFbm * 0.2 > 0.62) cloudCol = vec4(0.25, 0.29, 0.45, 1.0);

            col = cloudCol;
        }
    }

    return vec4(col.rgb, a * col.a);
}

// === DRY (No Atmosphere) ===
vec4 dryPlanet(vec2 uv, vec2 uvRaw) {
    float d_circle = distance(uv, vec2(0.5));
    float d_light = distance(uv, uLightOrigin);
    float a = step(d_circle, 0.49999);
    bool dith = dither(uv, uvRaw);
    uv = rotate2d(uv, uRotation);

    float fbm1 = fbm(uv);
    d_light += fbm(uv * uSize + fbm1 + vec2(uTime * uTimeSpeed, 0.0)) * 0.3;

    float dither_border = (1.0 / uPixels) * uDitherSize;

    vec4 col = uColors0;
    if (d_light > uLightBorder1) {
        col = uColors1;
        if (d_light < uLightBorder1 + dither_border && dith) {
            col = uColors0;
        }
    }
    if (d_light > uLightBorder2) {
        col = uColors2;
        if (d_light < uLightBorder2 + dither_border && dith) {
            col = uColors1;
        }
    }

    return vec4(col.rgb, a * col.a);
}

// === ISLANDS (Land Masses) ===
vec4 islandsPlanet(vec2 uv, vec2 uvRaw) {
    float d_light = distance(uv, uLightOrigin);
    float d_circle = distance(uv, vec2(0.5));
    float a = step(d_circle, 0.49999);

    uv = rotate2d(uv, uRotation);
    uv = spherify(uv);

    vec2 base_fbm_uv = uv * uSize + vec2(uTime * uTimeSpeed, 0.0);
    float fbm1 = fbm(base_fbm_uv);
    float fbm2 = fbm(base_fbm_uv - uLightOrigin * fbm1);
    float fbm3 = fbm(base_fbm_uv - uLightOrigin * 1.5 * fbm1);
    float fbm4 = fbm(base_fbm_uv - uLightOrigin * 2.0 * fbm1);

    if (d_light < uLightBorder1) {
        fbm4 *= 0.9;
    }
    if (d_light > uLightBorder1) {
        fbm2 *= 1.05;
        fbm3 *= 1.05;
        fbm4 *= 1.05;
    }
    if (d_light > uLightBorder2) {
        fbm2 *= 1.3;
        fbm3 *= 1.4;
        fbm4 *= 1.8;
    }

    d_light = pow(d_light, 2.0) * 0.1;
    vec4 col = uColors3;
    if (fbm4 + d_light < fbm1) col = uColors2;
    if (fbm3 + d_light < fbm1) col = uColors1;
    if (fbm2 + d_light < fbm1) col = uColors0;

    return vec4(col.rgb, step(uLandCutoff, fbm1) * a * col.a);
}

// === GAS GIANT ===
// Godot uses two layers for gas planets. We merge them into one:
// - Background: dark base color filling the sphere
// - Foreground: cloud bands on top
vec4 gasPlanet(vec2 uv, vec2 uvRaw) {
    float d_light = distance(uv, uLightOrigin);
    float d_circle = distance(uv, vec2(0.5));
    float a = step(d_circle, 0.49999);

    uv = rotate2d(uv, uRotation);
    uv = spherify(uv);
    uv.y += smoothstep(0.0, uCloudCurve, abs(uv.x - 0.4));

    float c = cloudAlpha(uv * vec2(1.0, uStretch));

    // Cloud layer colors
    vec4 col = uColors0;
    if (c < uCloudCover + 0.03) col = uColors1;
    if (d_light + c * 0.2 > uLightBorder1) col = uColors2;
    if (d_light + c * 0.2 > uLightBorder2) col = uColors3;

    // Blend: where clouds are thin, show dark background instead of transparency
    float cloudMask = step(uCloudCover, c);
    vec4 bgCol = uColors3; // darkest color as background
    col = mix(bgCol, col, cloudMask);

    return vec4(col.rgb, a * col.a);
}

// === STAR (3 layers merged: body + blobs + flares) ===
vec2 Hash2(vec2 p) {
    float r = 523.0 * sin(dot(p, vec2(53.3158, 43.6143))) * uSeed;
    return vec2(fract(15.32354 * r), fract(17.25865 * r));
}

float Cells(vec2 p, float numCells) {
    p *= numCells;
    float d = 1.0e10;
    for (int xo = -1; xo <= 1; xo++) {
        for (int yo = -1; yo <= 1; yo++) {
            vec2 tp = floor(p) + vec2(float(xo), float(yo));
            tp = p - tp - Hash2(mod(tp, numCells / uTiles));
            d = min(d, dot(tp, tp));
        }
    }
    return sqrt(d);
}

// Circle pattern for blobs/flares (from StarBlobs.gdshader)
float starCircle(vec2 uv, float amount, float cSize) {
    float invert = 1.0 / amount;
    if (mod(uv.y, invert * 2.0) < invert) {
        uv.x += invert * 0.5;
    }
    vec2 rand_co = floor(uv * amount) / amount;
    uv = mod(uv, invert) * amount;
    float r = rand(rand_co);
    r = clamp(r, invert, 1.0 - invert);
    float circ = distance(uv, vec2(r));
    return smoothstep(circ, circ + 0.5, invert * cSize * rand(rand_co * 1.5));
}

vec4 starPlanet(vec2 uv, vec2 uvRaw) {
    // Godot uses 3 separate sprites. We merge them:
    // Body: 100x100 at (0,0) → center 50% of our quad
    // Blobs/Flares: 200x200 at (-50,-50) → full quad
    //
    // Time multiplier from Godot: round(size)*2/time_speed
    // With size~4.5, time_speed=0.05 → mult=160
    // Body shader time = t * mult * 0.005 → t * 0.8, then shader does *time_speed → t*0.04
    // Blobs shader time = t * mult * 0.01 → t * 1.6, then *time_speed → t*0.08
    // Flares shader time = t * mult * 0.015 → t * 2.4, then *time_speed → t*0.12

    // Coarse radius gate — the star quad is 2.9× the body radius to
    // leave room for corona/flare, so ~75% of quad pixels are pure
    // transparent outside the flare reach. Exit those before paying
    // for the body Cells noise, the 15-iter blob loop, or flare fbm.
    // 0.52 is slightly beyond the max flare extent visible in the
    // shader output — safe margin.
    if (distance(uv, vec2(0.5)) > 0.52) return vec4(0.0);

    float mult = floor(uSize + 0.5) * 2.0 / max(uTimeSpeed, 0.001);
    float bodyTime = uTime * mult * 0.005;
    float blobTime = uTime * mult * 0.01;
    float flareTime = uTime * mult * 0.015;

    bool dith = dither(uvRaw, uv);

    // === Body: remap center 50% of quad to 0..1 ===
    vec2 bodyUV = (uv - 0.25) * 2.0;
    vec2 bodyPix = floor(bodyUV * uPixels) / uPixels;
    float bodyD = distance(bodyPix, vec2(0.5));
    float bodyA = step(bodyD, 0.49999);

    vec2 bodyRot = rotate2d(bodyPix, uRotation);
    vec2 bodySph = spherify(bodyRot);

    // Star.gdshader: Cells noise plasma
    float cn1 = Cells(bodySph - vec2(bodyTime * uTimeSpeed * 2.0, 0.0), 10.0);
    float cn2 = Cells(bodySph - vec2(bodyTime * uTimeSpeed, 0.0), 20.0);
    float n = cn1 * cn2 * 2.0;
    n = clamp(n, 0.0, 1.0);
    if (dith) n *= 1.3;

    int idx = int(floor(n * 3.0));
    vec4 bodyCol = uColors0;
    if (idx == 1) bodyCol = uColors1;
    if (idx == 2) bodyCol = uColors2;
    if (idx >= 3) bodyCol = uColors3;

    // === Blobs & Flares: use full quad UV (0..1) ===
    vec2 fullPix = floor(uv * uPixels) / uPixels;
    vec2 fullRot = rotate2d(fullPix, uRotation);
    float fullD = distance(fullPix, vec2(0.5));
    float fullAngle = atan(fullRot.x - 0.5, fullRot.y - 0.5);

    // StarBlobs.gdshader: circle pattern in polar coords
    float blobC = 0.0;
    for (int i = 0; i < 15; i++) {
        float r = rand(vec2(float(i)));
        vec2 cUV = vec2(fullD, fullAngle);
        blobC += starCircle(cUV * uSize - blobTime * uTimeSpeed - (1.0 / max(fullD, 0.001)) * 0.1 + r, 2.0, 1.0);
    }
    blobC *= 0.37 - fullD;
    float blobA = step(0.07, blobC - fullD);

    // StarFlares.gdshader: fbm + circle pattern for eruptions
    float fAngle = fullAngle * 0.4;
    vec2 fUV = vec2(fullD, fAngle);

    float fn = fbm(fUV * uSize - flareTime * uTimeSpeed);
    float fc = starCircle(fUV * 1.0 - flareTime * uTimeSpeed + fn, 2.0, 1.0);
    fc *= 1.5;
    float fn2 = fbm(fUV * uSize - flareTime + vec2(100.0, 100.0));
    fc -= fn2 * 0.1;

    float flareAlpha = 0.0;
    // Dithered soft edge + hard edge (storm_width=0.3, storm_dither_width=0.07)
    if (1.0 - fullD > fc) {
        if (fc > 0.3 - 0.07 + fullD && dith) {
            flareAlpha = 1.0;
        }
        if (fc > 0.3 + fullD) {
            flareAlpha = 1.0;
        }
    }
    flareAlpha *= step(fn2 * 0.25, fullD);

    // === Composite back-to-front ===
    vec4 result = vec4(0.0);

    // Flares behind (only outside body)
    if (flareAlpha > 0.0 && bodyA < 1.0) {
        int fIdx = int(floor(fn2 + fc));
        vec4 flareCol = (fIdx > 0) ? uColors1 : uColors0;
        result = vec4(flareCol.rgb, flareAlpha);
    }

    // Blobs (glow spots, visible on and near surface)
    if (blobA > 0.0) {
        if (bodyA > 0.0) {
            // On body: brighten
            bodyCol.rgb = mix(bodyCol.rgb, uColors0.rgb, 0.6);
        } else {
            // Outside body: show as glow
            result = vec4(uColors0.rgb, blobA);
        }
    }

    // Body on top
    if (bodyA > 0.0) {
        result = vec4(bodyCol.rgb, 1.0);
    }

    return result;
}

void main() {
    // vUV goes 0..1 across the quad, exactly like Godot's UV
    vec2 uv = vUV;
    vec2 uvPixelized = floor(uv * uPixels) / uPixels;

    vec4 col;
    if (uPlanetType == 0) {
        col = terranPlanet(uvPixelized, uv);
    } else if (uPlanetType == 1) {
        col = dryPlanet(uvPixelized, uv);
    } else if (uPlanetType == 2) {
        col = islandsPlanet(uvPixelized, uv);
    } else if (uPlanetType == 3) {
        col = gasPlanet(uvPixelized, uv);
    } else {
        col = starPlanet(uvPixelized, uv);
    }

    // Premultiplied alpha
    finalColor = vec4(col.rgb * col.a, col.a);
}
