// Post-processing: aberracja chromatyczna (uderzenia), soczewka (ciśnienie basu), winieta.
// Parametry steruje main.js: uCA (szerokość rozszczepienia RGB w UV), uShock (ugięcie radialne).
export const postShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCA: { value: 0.0015 },
    uShock: { value: 0 },
    uVig: { value: 0.55 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uCA;
    uniform float uShock;
    uniform float uVig;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 uv = vUv - d * uShock * exp(-r2 * 6.0);
      vec2 dir = normalize(d + 1e-5) * uCA;
      float r = texture2D(tDiffuse, uv + dir).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir).b;
      float vig = clamp(1.0 - uVig * r2 * 2.2, 0.0, 1.0);
      gl_FragColor = vec4(vec3(r, g, b) * vig, 1.0);
    }`,
};
