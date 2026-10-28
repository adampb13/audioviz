// Zorza wolumetryczna w tle: pełnoekranowy shader GLSL. Tempo transformacji
// ∝ chwilowe tempo utworu (miks) i energia; jasność ∝ energia. Subtelne tło,
// nie konkurujące z sferą na pierwszym planie.
import * as THREE from "three";

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uSpeed;   // przepływ: tempo utworu + energia
uniform float uLevel;   // energia miksu 0..1.2
uniform vec3 uCol1;     // głęboki granat (cicho)
uniform vec3 uCol2;     // błękit/teal (energia)

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  vec2 uv = vUv;
  float t = uTime * (0.10 + 0.30 * uSpeed);
  float lvl = clamp(uLevel, 0.0, 1.2);

  // pionowa kurtyna: 3 nakładające się pasma zorzy
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float yBand = 0.34 + fi * 0.20 - 0.05 * lvl;
    float x = uv.x * (2.2 + fi * 0.8) + t * (0.12 + fi * 0.05);
    float y = uv.y * (1.1 + fi * 0.3) + t * 0.07;
    float n = snoise(vec3(x, y, t * 0.35 + fi * 3.7));
    float band = exp(-pow((uv.y - yBand - n * 0.22) * (5.5 + fi), 2.0));
    acc += band * (0.42 - fi * 0.11);
  }

  acc *= 0.75 + 0.25 * snoise(vec3(t * 0.9, uv.x * 1.5, 7.7)); // delikatne migotanie
  acc *= 0.45 + 0.8 * lvl;

  vec3 deep = vec3(0.012, 0.020, 0.045);
  float xk = clamp(uv.x + 0.15 * snoise(vec3(uv.y * 1.4, t * 0.25, 2.2)), 0.0, 1.0);
  vec3 col = mix(uCol1, uCol2, clamp(0.25 + 0.75 * xk * (0.4 + 0.6 * lvl), 0.0, 1.0));
  vec3 outc = deep + col * acc;

  float vig = 1.0 - 0.55 * pow(length(uv - 0.5) * 1.35, 2.4);
  outc *= vig;
  gl_FragColor = vec4(outc, 1.0);}`;

export class Aurora {
  constructor(scene) {
    this.col1 = new THREE.Vector3(0.10, 0.16, 0.34); // głęboki granat
    this.col2 = new THREE.Vector3(0.16, 0.38, 0.55); // błękit/teal
    this.speed = 0.4;
    this.level = 0.4;
    this.uniforms = {
      uTime: { value: 0 },
      uSpeed: { value: this.speed },
      uLevel: { value: this.level },
      uCol1: { value: this.col1 },
      uCol2: { value: this.col2 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  // speed: 0..1 (chwilowe tempo utworu znormalizowane + energia); level: energia miksu 0..1.2
  update(dt, t, { speed, level }) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 4);
    this.level += (level - this.level) * Math.min(1, dt * 5);
    this.uniforms.uTime.value = t;
    this.uniforms.uSpeed.value = this.speed;
    this.uniforms.uLevel.value = this.level;
  }
}
