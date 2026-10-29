// System 5: ATMOSFERA — kopuła nieba z gradientem i chmurami FBM (tempo z analizy),
// złoty pył (Points, 3000) dryfujący w górę i migoczący z centroidem "inne",
// oraz 12 iskier-bokeh zapalanych onsetami bębnów.
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

// ---------- kopuła nieba ----------
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // zawsze na dalekim planie
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop, uHorizon, uGlow;
uniform float uTime;      // czas utworu (chmury płyną z tempem)
varying vec3 vDir;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.05, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, h), 0.8));
  // ciepła poświata tuż nad horyzontem
  col += uGlow * exp(-pow((d.y - 0.04) * 7.0, 2.0)) * 0.35;
  // powolne chmury FBM — tempo utworu skaluje prędkość
  float cl = fbm4(vec3(d.x * 2.2, d.y * 3.0, d.z * 2.2 + uTime * 0.02));
  col *= 1.0 + cl * 0.10 * smoothstep(0.02, 0.35, d.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------- pył ----------
const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uTwinkle; // 0..1 z centroidu "inne"
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = position;
  float s = aSeed;
  // dryf w górę z zawijaniem + lekkie kołysanie
  p.y = mod(p.y + uTime * (0.25 + fract(s * 7.13) * 0.5), 14.0) + 0.2;
  p.x += sin(uTime * (0.2 + fract(s * 3.7) * 0.4) + s * 40.0) * 0.8;
  p.z += cos(uTime * (0.15 + fract(s * 5.3) * 0.3) + s * 17.0) * 0.6;
  float tw = 0.5 + 0.5 * sin(uTime * (1.0 + fract(s * 9.1) * 2.5) + s * 90.0);
  vA = 0.045 + 0.16 * tw * (0.35 + 0.65 * uTwinkle);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // bardzo bliskie drobiny: ogranicz rozmiar i przygaś — bez "śnieżycy" na obiektywie
  gl_PointSize = min((0.9 + fract(s * 4.7) * 1.8) * (120.0 / -mv.z), 10.0);
  vA *= smoothstep(3.0, 14.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = smoothstep(0.5, 0.05, length(c));
  gl_FragColor = vec4(uColor, d * vA);
}
`;

// ---------- iskry (bokeh) ----------
function sparkTexture() {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,243,214,1)");
  g.addColorStop(0.25, "rgba(255,207,138,0.55)");
  g.addColorStop(0.6, "rgba(217,152,74,0.16)");
  g.addColorStop(1, "rgba(217,152,74,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SPARK_COUNT = 12;

export class Atmosphere {
  constructor() {
    this.group = new THREE.Group();

    // niebo
    this.skyU = {
      uTop: { value: new THREE.Color(PAL.skyTop) },
      uHorizon: { value: new THREE.Color(PAL.skyHorizon) },
      uGlow: { value: new THREE.Color(PAL.gold) },
      uTime: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.skyU,
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);

    // pył
    const N = 3000;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 80;       // x -80..80
      pos[i * 3 + 1] = Math.random() * 14;             // y (zawijane w shaderze)
      pos[i * 3 + 2] = -60 + Math.random() * 80;       // z -60..20
      seed[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    dg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.dustU = {
      uTime: { value: 0 },
      uTwinkle: { value: 0.4 },
      uColor: { value: new THREE.Color(PAL.goldBright) },
    };
    const dust = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: this.dustU,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    dust.frustumCulled = false;
    dust.renderOrder = 20;
    this.group.add(dust);

    // iskry — sprite'y; puls zapalany onsetami bębnów
    const tex = sparkTexture();
    this.sparks = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      const sp = new THREE.Sprite(mat);
      // jak na obrazie: głównie prawa strona, między ziemią a wstęgą
      sp.position.set(
        -25 + Math.random() * 65,
        1.2 + Math.random() * 6.5,
        -18 + Math.random() * 26
      );
      sp.scale.setScalar(0.6);
      sp.renderOrder = 21;
      this.sparks.push({ sp, mat, pulse: 0, phase: Math.random() * 6.28 });
      this.group.add(sp);
    }
    this.sparkI = 0;
  }

  // siła onsetu 0.15..1 — zapala kolejną iskrę w karuzeli
  ignite(strength) {
    const s = this.sparks[this.sparkI];
    this.sparkI = (this.sparkI + 1) % SPARK_COUNT;
    s.pulse = Math.max(s.pulse, strength);
  }

  update(t, dt, twinkle, tempoBpm) {
    this.skyU.uTime.value = t * (tempoBpm / 120);
    this.dustU.uTime.value = t;
    this.dustU.uTwinkle.value = twinkle;
    for (const s of this.sparks) {
      s.pulse *= Math.exp(-dt * 2.2);
      const bob = Math.sin(t * 0.6 + s.phase) * 0.4;
      s.sp.position.y += bob * dt;
      const o = Math.min(1, s.pulse * 1.1 + 0.03);
      s.mat.opacity = o;
      s.sp.scale.setScalar(0.5 + s.pulse * 1.8);
    }
  }
}
