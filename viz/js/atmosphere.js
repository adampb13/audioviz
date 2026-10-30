// System 5: ATMOSFERA — kopuła nieba z gradientem (chmury prawie niewidoczne),
// gwiazdy na niebie i 8 hero bokeh-iskier od onsetów bębnów.
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

// ---------- gwiazdy ----------
// Statyczne drobiny na sferze o promieniu 760, wyłącznie nad panoramą gór
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

    // Pył nad ziemią usunięty: 250 drobin w pasmie y 0.2..4.0 leciało dokładnie
    // nad falami i czytało się jako kasza/brud na obrazie, a nie jako powietrze.
    // Zostają tylko 8 hero bokeh (od uderzeń bębnów) i gwiazdy na niebie.

    // gwiazdy — statyczne drobiny na sferze R=760 (ZA górami), nad panoramą. Azimut zawężony
    // do sektora, który kamera faktycznie widzi (±65° od osi patrzenia), inaczej
    // 90% gwiazd ląduje za plecami i niebo zostaje puste.
    const NS = 320;
    const sp = new Float32Array(NS * 3);
    const sSize = new Float32Array(NS);
    const sBright = new Float32Array(NS);
    const sPhase = new Float32Array(NS);
    const sRate = new Float32Array(NS);
    const sTint = new Float32Array(NS);
    // R = 760: dalekie pasmo gór sięga ~600 m od kamery (kurtyna z 30% zapasu),
    // więc przy R = 430 gwiazdy na bocznych krawędziach kadru były BLIŻEJ niż
    // góry i rysowały się na ich tle. 760 m > 600 m + zapas, a wciąż < far (900).
    const R = 760;
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

    // Iskry (8 sprite'ów bokeh) usunięte: latały swobodnie po scenie bez związku
    // z muzyką i czytały się jako przypadkowe plamy. Cząsteczki wypuszcza teraz
    // wyłącznie sfera-serce, i tylko na uderzenie basu. Zostają gwiazdy.
  }

  // rozmiar gwiazd w CSS px niezależnie od DPR bufora
  setPixelRatio(r) {
    this.starU.uScale.value = Math.min(Math.max(r, 1), 2);
  }

  update(t, dt, energySmooth, tempoBpm) {
    this.skyU.uTime.value = t * (tempoBpm / 120);
    this.starU.uTime.value = t;
  }
}
