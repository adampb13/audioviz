// System 5: ATMOSFERA — kopuła nieba z gradientem (chmury prawie niewidoczne),
// złoty pył (250 drobin nisko nad ziemią) i 8 hero bokeh-iskier od onsetów bębnów.
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
  col += uGlow * exp(-pow((d.y - 0.04) * 7.0, 2.0)) * 0.25;
  // prawie niewidoczne chmury (audit P0-5: zero prążków na niebie)
  float cl = fbm4(vec3(d.x * 2.2, d.y * 3.0, d.z * 2.2 + uTime * 0.02));
  col *= 1.0 + cl * 0.03 * smoothstep(0.02, 0.35, d.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------- pył ----------
// Audit P0-4: 250 drobin NISKO nad ziemią (y 0.2..4.0), powolny dryf,
// opacity = 0.12 + energySmooth*0.25, migotanie 0.8+0.2*sin. Kolor #ffcf8a, nigdy biały.
const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uEnergy; // wolna energia utworu
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = position;
  float s = aSeed;
  // powolny unoszenie z zawijaniem w niskim paśmie + bardzo delikatne kołysanie
  p.y = mod(p.y + uTime * (0.10 + fract(s * 7.13) * 0.15), 3.8) + 0.2;
  p.x += sin(uTime * (0.10 + fract(s * 3.7) * 0.15) + s * 40.0) * 0.5;
  p.z += cos(uTime * (0.08 + fract(s * 5.3) * 0.12) + s * 17.0) * 0.4;
  float tw = 0.8 + 0.2 * sin(uTime * (0.6 + fract(s * 9.1) * 1.2) + s * 90.0);
  vA = (0.12 + uEnergy * 0.25) * tw;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // bardzo bliskie drobiny: ogranicz rozmiar i przygaś — bez "śnieżycy" na obiektywie
  gl_PointSize = min((0.6 + fract(s * 4.7) * 1.4) * (120.0 / -mv.z), 8.0);
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
  // 1.0 - smoothstep zamiast smoothstep(0.5, 0.05, ...): odwrócone krawędzie
  // są w GLSL niezdefiniowane i mogą dać NaN (a ten szerzy się po bloomie)
  float d = 1.0 - smoothstep(0.05, 0.5, length(c));
  gl_FragColor = vec4(uColor, d * vA);
}
`;

// ---------- gwiazdy ----------
// Statyczne drobiny na sferze o promieniu 430, wyłącznie nad panoramą gór
// (elewacja 9..88°). Pozycje się nie ruszają — jedyny ruch to bardzo wolne
// migotanie ±9%, które czyta się jako "żywa" gwiazda, nie jako dryf pyłu.
const STAR_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;    // <pixelRatio>, żeby gwiazda miała stały rozmiar w CSS px
uniform float uTwinkle;
attribute float aSize;   // rozmiar w CSS px
attribute float aBright;
attribute float aPhase;
attribute float aRate;
attribute float aTint;
varying float vA;
varying float vTint;
void main() {
  vTint = aTint;
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * aRate + aPhase));
  vA = aBright * tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale);
  gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uWarm, uCool;
varying float vA;
varying float vTint;
void main() {
  // UWAGA: gl_PointCoord dla sprite'a 2-3 px trafia w 0.25/0.75, czyli r≈0.35.
  // Falloff smoothstep(0.18, 0.5) trzyma środek pełny dopiero od ~3 px; przy
  // ciasnym smoothstep(0.0, 0.5) małe gwiazdy miały alpha ~5% i ich nie było.
  float d = 1.0 - smoothstep(0.18, 0.5, length(gl_PointCoord - 0.5));
  vec3 col = mix(uWarm, uCool, vTint);
  gl_FragColor = vec4(col, d * vA);
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

const SPARK_COUNT = 8; // hero bokeh jak na referencji

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

    // pył — 250 drobin nisko nad ziemią
    const N = 250;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 45;       // x -45..45
      pos[i * 3 + 1] = Math.random() * 3.8;            // y (zawijane w shaderze do 0.2..4.0)
      pos[i * 3 + 2] = -30 + Math.random() * 45;       // z -30..15
      seed[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    dg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.dustU = {
      uTime: { value: 0 },
      uEnergy: { value: 0.4 },
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

    // gwiazdy — statyczne drobiny na sferze R=430, nad panoramą. Azimut zawężony
    // do sektora, który kamera faktycznie widzi (±65° od osi patrzenia), inaczej
    // 90% gwiazd ląduje za plecami i niebo zostaje puste.
    const NS = 320;
    const sp = new Float32Array(NS * 3);
    const sSize = new Float32Array(NS);
    const sBright = new Float32Array(NS);
    const sPhase = new Float32Array(NS);
    const sRate = new Float32Array(NS);
    const sTint = new Float32Array(NS);
    const R = 430;
    const A0 = -Math.PI / 2;                      // oś patrzenia = -Z
    const ASPAN = THREE.MathUtils.degToRad(130);
    for (let i = 0; i < NS; i++) {
      // y = sin(elewacja) rozłożony równomiernie. Kadr pokazuje 0°..+37°, a góry
      // zasłaniają pierwsze ~7° — więc gwiazdy wypełniają dokładnie 8..37°
      // (rozrzucanie ich po całej kapsule do 79° marnowało połowę na niebo,
      // którego kamera nigdy nie widzi).
      const y = 0.14 + Math.random() * 0.46;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const a = A0 + (Math.random() - 0.5) * ASPAN;
      sp[i * 3] = Math.cos(a) * rr * R;
      sp[i * 3 + 1] = y * R;
      sp[i * 3 + 2] = Math.sin(a) * rr * R;
      const big = Math.pow(Math.random(), 5);       // tylko nieliczne duże
      sSize[i] = 1.1 + big * 2.4;                   // CSS px
      sBright[i] = 0.14 + Math.pow(Math.random(), 2.0) * 0.62;
      sPhase[i] = Math.random() * 6.283;
      sRate[i] = 0.10 + Math.random() * 0.35;       // migotanie 0.016..0.056 Hz
      sTint[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sg.setAttribute("aSize", new THREE.BufferAttribute(sSize, 1));
    sg.setAttribute("aBright", new THREE.BufferAttribute(sBright, 1));
    sg.setAttribute("aPhase", new THREE.BufferAttribute(sPhase, 1));
    sg.setAttribute("aRate", new THREE.BufferAttribute(sRate, 1));
    sg.setAttribute("aTint", new THREE.BufferAttribute(sTint, 1));
    this.starU = {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uTwinkle: { value: 0.18 },
      uWarm: { value: new THREE.Color(PAL.cream) },
      uCool: { value: new THREE.Color(PAL.goldBright) },
    };
    const stars = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: this.starU,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    stars.frustumCulled = false;
    stars.renderOrder = 12;
    this.group.add(stars);

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
      // jak na obrazie: głównie prawa strona, między ziemią a wstęgą, y 2..7
      sp.position.set(
        -20 + Math.random() * 55,
        2.0 + Math.random() * 5.0,
        -18 + Math.random() * 26
      );
      const baseSize = 0.6 + Math.random() * 0.6; // 0.6..1.2 m
      sp.scale.setScalar(baseSize);
      sp.renderOrder = 21;
      this.sparks.push({ sp, mat, pulse: 0, phase: Math.random() * 6.28, baseSize });
      this.group.add(sp);
    }
    this.sparkI = 0;
  }

  // rozmiar gwiazd w CSS px niezależnie od DPR bufora
  setPixelRatio(r) {
    this.starU.uScale.value = Math.min(Math.max(r, 1), 2);
  }

  // siła onsetu 0.15..1 — zapala kolejną iskrę w karuzeli
  ignite(strength) {
    const s = this.sparks[this.sparkI];
    this.sparkI = (this.sparkI + 1) % SPARK_COUNT;
    s.pulse = Math.max(s.pulse, strength);
  }

  update(t, dt, energySmooth, tempoBpm) {
    this.skyU.uTime.value = t * (tempoBpm / 120);
    this.dustU.uTime.value = t;
    this.dustU.uEnergy.value = energySmooth;
    this.starU.uTime.value = t;
    for (const s of this.sparks) {
      s.pulse *= Math.exp(-dt * 2.2);
      const bob = Math.sin(t * 0.6 + s.phase) * 0.4;
      s.sp.position.y += bob * dt;
      const o = Math.min(0.85, s.pulse * 0.9 + 0.02);
      s.mat.opacity = o;
      s.sp.scale.setScalar(s.baseSize * (1 + s.pulse * 0.5));
    }
  }
}
