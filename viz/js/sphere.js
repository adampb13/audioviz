// Sfera centralna (pierwszy plan, bohater sceny).
//  - Wielkość: promień ∝ chwilowa głośność (szybki atak) + energia miksu (wolna),
//  - Kształt: deformacja simplex noise 3D w vertex shaderze, głębokość ∝ energia
//    i chwilowa głośność, modulowana obecnością wokalu (konspekt: "zasilana mocą
//    wokalu oraz pitch_voiced_prob"),
//  - Kolorystyka: rampa od głębokiego granatu do jasnego błękitu wg barwy miksu
//    (centroid ważony głośnością stemów),
//  - Beaty/onsety: delikatny puls (rozjaśnienie + chwilowe pogłębienie deformacji)
//    oraz poświata atmosferyczna.
import * as THREE from "three";
import { damp, clamp } from "./data.js";

const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// Simplex noise 3D (Ashima Arts / Stefan Gustavson)
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
`;

const VERT = /* glsl */ `
uniform float uTime;   // czas przepływu szumu (przyspieszany tempem i energią)
uniform float uAmp;    // głębokość deformacji (udział promienia)
uniform float uRadius; // promień bazowy
uniform float uPulse;  // impuls beatu/onsetu 0..1
uniform float uScale;  // skala szumu
uniform float uFlow;   // prędkość przepływu szumu

varying vec3 vN;
varying vec3 vPos;
varying float vNz;

${NOISE}

// Pole szumu: 3 oktawy, znormalizowane do ~[-1, 1]
float field(vec3 p) {
  float n = snoise(p);
  n += 0.5 * snoise(p * 2.03 + vec3(1.7, 9.2, 3.1));
  n += 0.25 * snoise(p * 4.1 + vec3(8.3, 2.8, 4.7));
  return n / 1.75;
}

// Deformacja promienia: pozycja jednostkowa -> powierzchnia sfery
vec3 shape(vec3 p, out float nOut) {
  float n = field(p * uScale + vec3(uTime * 0.7, uTime * uFlow, uTime * uFlow * 0.6));
  nOut = n;
  float amp = uAmp * (1.0 + uPulse * 0.9);
  return p * (uRadius * (1.0 + amp * n));
}

vec3 orthogonal(vec3 v) {
  return normalize(abs(v.x) > abs(v.z) ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
}

void main() {
  vec3 p = position; // jednostkowa kula
  vec3 nrm = normalize(p);
  vec3 tg = orthogonal(nrm);
  vec3 bt = normalize(cross(nrm, tg));
  float e = 0.02;

  float n0, n1, n2;
  vec3 P0 = shape(p, n0);
  vec3 Pt = shape(normalize(p + tg * e), n1);
  vec3 Pb = shape(normalize(p + bt * e), n2);

  // normalna z różnic skończonych (przestrzeń obiektu)
  vec3 N = normalize(cross(Pt - P0, Pb - P0));
  vN = normalize(normalMatrix * N);
  vPos = (modelViewMatrix * vec4(P0, 1.0)).xyz;
  vNz = n0;
  gl_Position = projectionMatrix * vec4(vPos, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColLow;   // głęboki granat
uniform vec3 uColHigh;  // jasny błękit
uniform float uCent;    // barwa miksu 0..1.2
uniform float uPulse;   // impuls 0..1
uniform float uBright;
varying vec3 vN;
varying vec3 vPos;
varying float vNz;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vPos);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.6);

  // rampa barwy: granat -> błękit
  float k = smoothstep(0.12, 0.92, uCent);
  vec3 body = mix(uColLow, uColHigh, k);

  // modelowanie bryły szumem: wypukłości jaśniejsze, zagłębienia ciemniejsze
  float shade = clamp(vNz * 0.5 + 0.5, 0.0, 1.0);
  body *= 0.42 + 0.58 * shade;

  // terminator: krawędzie ciemniejsze, środek jaśniejszy
  body *= 0.35 + 0.65 * ndv;

  // fresnelowa poświata krawędzi
  vec3 rim = mix(uColLow * 3.2, uColHigh * 1.15, k);
  body += rim * fres * (0.30 + 0.25 * uPulse);

  // delikatny puls beatu
  body += vec3(0.9, 0.95, 1.0) * uPulse * 0.10;

  gl_FragColor = vec4(body * uBright, 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
uniform float uRadius;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position * uRadius * 1.22, 1.0);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCol;
uniform float uGlow;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vPos);
  float limb = 1.0 - abs(dot(N, V)); // BackSide: widoczna wewnętrzna powierzchnia
  float a = pow(clamp(limb, 0.0, 1.0), 2.6);
  gl_FragColor = vec4(uCol * a * uGlow, 1.0);
}
`;

const R0 = 2.05;
const COL_LOW = new THREE.Color(0.14, 0.035, 0.10); // głęboki granat/karmazyn
const COL_HIGH = new THREE.Color(0.60, 0.83, 1.0); // jasny błękit

export class Sphere {
  constructor(scene) {
    this.rCur = R0 * 0.85;
    this.ampCur = 0.12;
    this.centCur = 0.25;
    this.time = 0;

    this.uRadius = { value: this.rCur };
    this.uAmp = { value: this.ampCur };
    this.uPulse = { value: 0 };
    this.uCent = { value: this.centCur };

    const uniforms = {
      uTime: { value: 0 },
      uAmp: this.uAmp,
      uRadius: this.uRadius,
      uPulse: this.uPulse,
      uCent: this.uCent,
      uScale: { value: 2.0 },
      uFlow: { value: 0.35 },
      uBright: { value: 1.1 },
      uColLow: { value: COL_LOW.clone() },
      uColHigh: { value: COL_HIGH.clone() },
    };
    this.meshU = uniforms; // pełny dostęp do uniformów materiału w update()
    this.mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 6),
      new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
    );
    scene.add(this.mesh);

    // atmosfera: poświata wokół limbu
    this.glowCol = { value: new THREE.Color(0.35, 0.55, 1.0) };
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uRadius: this.uRadius, uCol: this.glowCol, uGlow: { value: 0.5 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.glow = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), this.glowMat);
    this.glow.renderOrder = 1;
    scene.add(this.glow);
  }

  // radius/amp/cent/pulse/flow/bright — wartości chwilowe wyliczone w main.js;
  // wygładzamy je tu (różne tempo każdej wielkości).
  update(dt, { radius, amp, cent, pulse, flow, bright }) {
    this.rCur = damp(this.rCur, radius, 13, dt);
    this.ampCur = damp(this.ampCur, clamp(amp, 0, 0.5), 7, dt);
    this.centCur = damp(this.centCur, clamp(cent, 0, 1.2), 2.4, dt);
    this.time += dt * clamp(flow, 0.1, 1.2);

    this.uRadius.value = this.rCur;
    this.uAmp.value = this.ampCur;
    this.uPulse.value = clamp(pulse, 0, 1);
    this.uCent.value = this.centCur;
    this.meshU.uTime.value = this.time;
    this.meshU.uFlow.value = flow;
    this.uniformsBright = bright;

    const bm = this.mesh.material.uniforms;
    bm.uBright.value = bright;

    // poświata: kolor wg barwy, mocniejsza przy pulsie
    const k = clamp((this.centCur - 0.15) / 0.75, 0, 1);
    const sk = k * k * (3 - 2 * k);
    this.glowCol.value.copy(COL_LOW).lerp(COL_HIGH, sk);
    this.glowMat.uniforms.uGlow.value = 0.28 + 0.24 * clamp(pulse, 0, 1);

    // wolny obrót + subtelny kołyskowy wobble
    this.mesh.rotation.y += dt * (0.06 + 0.08 * clamp(flow, 0, 1));
    this.mesh.rotation.x = Math.sin(this.time * 0.13) * 0.10;
  }

  get radius() {
    return this.rCur;
  }
  get amp() {
    return this.ampCur;
  }
}
