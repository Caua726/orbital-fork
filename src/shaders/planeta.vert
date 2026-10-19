in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

uniform mat3 uTransformMatrix;
uniform mat3 uProjectionMatrix;
// Pixi v8 MVP = projection × world (render-group / filter offset) × local.
// Without the world term a filtered mesh lands at the wrong spot inside the
// filter's render texture and gets clipped (suns at zoom ≤ 0.5).
uniform mat3 uWorldTransformMatrix;

void main() {
    vUV = aUV;
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
