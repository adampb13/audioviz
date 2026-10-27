// Zorza wolumetryczna w tle: pełnoekranowy shader GLSL.
// Kolor i jasność są wygładzane (damp), mel_db (32 pasma) modulują pionowe zasłony.
import * as THREE from "three";
import { damp } from "./data.js";

export function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uCol1;
uniform vec3 uCol2;
uniform float uMel[32];
uniform float uBright;
uniform float uI;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  int bi = int(clamp(floor(uv.x * 32.0), 0.0, 31.0));
  float m = uMel[bi];

  // Domain warp: zasłony zorzy falują powoli
  float warp = fbm(vec2(uv.x * 2.5, uv.y * 1.2 - uTime * 0.04) + vec2(0.0, uTime * 0.03));
  float curtain = sin(uv.x * 9.0 + warp * 7.0 + uTime * 0.25) * 0.5 + 0.5;
  float height = smoothstep(0.05, 0.95, uv.y + (warp - 0.5) * 0.7 - 0.05);
  float streak = fbm(vec2(uv.x * 18.0 + warp * 3.0, uv.y * 3.0 - uTime * 0.35));
  streak = streak * streak * 1.6;

  float body = curtain * height * (0.25 + 0.75 * streak);
  body *= 0.55 + 0.9 * m; // ostre pasma mel = bardziej postrzępiona zorza

  vec3 col = mix(uCol1, uCol2, clamp(uv.y * 0.9 + warp * 0.5 - 0.2, 0.0, 1.0));
  float bright = uBright * (0.4 + 0.6 * uI);
  gl_FragColor = vec4(col * body * bright, 1.0);
}`;

export class Aurora {
  constructor(scene) {
    this.col1 = new THREE.Vector3(0.2, 0.3, 0.6);
    this.col2 = new THREE.Vector3(0.4, 0.2, 0.6);
    this.mel = new Float32Array(32);
    this.bright = 0;
    this.uniforms = {
      uTime: { value: 0 },
      uCol1: { value: this.col1 },
      uCol2: { value: this.col2 },
      uMel: { value: this.mel },
      uBright: { value: 0 },
      uI: { value: 0 },
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

  // colA/colB: [r,g,b]; melTarget: 32 wartości 0..1; bright: 0..1; I: intensywność sekcji
  update(dt, t, { colA, colB, melTarget, bright, I }) {
    const L = 6; // ~ "lerp 0.1 przy 60 fps" z konspektu, niezależne od fps
    this.col1.x = damp(this.col1.x, colA[0], L, dt);
    this.col1.y = damp(this.col1.y, colA[1], L, dt);
    this.col1.z = damp(this.col1.z, colA[2], L, dt);
    this.col2.x = damp(this.col2.x, colB[0], L, dt);
    this.col2.y = damp(this.col2.y, colB[1], L, dt);
    this.col2.z = damp(this.col2.z, colB[2], L, dt);
    for (let i = 0; i < 32; i++) this.mel[i] = damp(this.mel[i], melTarget[i], 18, dt);
    this.bright = damp(this.bright, bright, L, dt);
    this.uniforms.uTime.value = t;
    this.uniforms.uBright.value = this.bright;
    this.uniforms.uI.value = I;
  }
}
