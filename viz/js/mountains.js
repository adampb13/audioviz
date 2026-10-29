// System 4: GÓRY — panorama z 5 pasm na różnych głębokościach.
//
// Grzbiet jest wypalany na CPU przy starcie (góry są statyczne — nigdy się nie
// ruszają), więc w vertex shaderze nie ma ani jednego wywołania szumu: 5 pasm ×
// 768 kolumn to ~4k ewaluacji raz, zamiast ~30k wierzchołków × 6 oktaw co klatkę.
//
// Głębia = perspektywa powietrzna, a nie "ciemniej z odległością". W poprzedniej
// wersji dalsze pasma były CIEMNIEJSZE i dodatkowo zjadała je mgła sceny
// (FogExp2 0.009 @260 m => 99.6% koloru #1a0f08), więc panorama była jedną czarną
// plamą. Tu każde pasmo miesza się ku jasnemu kolorowi nieba przy horyzoncie:
// im dalej, tym więcej mgły, więc grzbiety jaśnieją, tracą kontrast i mięknie im
// krawędź — dokładnie tak, jak czyta się prawdziwą panoramę o zmierzchu.
import * as THREE from "three";
import { PAL } from "./glsl.js";

const COLS = 768;   // kolumny grzbietu (~1 m na kolumnę na dalszych pasmach)
const ROWS = 6;     // wiersze: 0 = podstawa, 1 = grzbiet (gradient mgły w pionie)

// ---------- szum 1D (statyczny profil, wypalany raz) ----------
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
function vnoise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
}

// gładki fbm (nie ridged) — kopuły masywów, doliny
function fbm1(x, oct) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// Profil grzbietu = masyw ⊗ turnie:
//  - "massif" (λ ~ 600-1200 m) decyduje, GDZIE są góry i jak wysokie — bez niego
//    ridged daje równy "ząbek" na całej szerokości (sztuczny jak tekturowa dekoracja),
//  - "peaks" (ridged z domain warpem) daje ostre, asymetryczne turnie,
//  - sharp: bliskie pasma mają łagodne pagóry, dalekie — ostrą grań turniową.
function ridgeProfile(x, seed, oct, sharp, freqBase) {
  const massif = 0.5 + 0.5 * fbm1(x * 0.0016 + seed * 5.3, 3);
  let sum = 0, amp = 1, norm = 0, freq = freqBase;
  for (let o = 0; o < oct; o++) {
    const w = vnoise(x * freq * 0.4 + seed * 3.1) * 2.0;
    const n = 1 - Math.abs(vnoise(x * freq + w + seed * 11.3 + o * 41.7));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.48;
    freq *= 2.11;
  }
  const peaks = sum / norm;
  return massif * (1 - sharp) + (0.34 * massif + 0.66 * peaks) * sharp;
}

const VERT = /* glsl */ `
attribute float aT;      // 0 = podstawa, 1 = grzbiet
attribute float aSlope;  // nachylenie profilu (-1..1) — strona zwrócona do światła
varying float vT;
varying float vSlope;
varying vec3 vWorld;
void main() {
  vT = aT;
  vSlope = aSlope;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uDark;      // kolor grzbietu przy podstawie
uniform vec3 uLight;     // kolor grzbietu przy szczytach
uniform vec3 uHaze;      // kolor nieba przy horyzoncie (ku niemu idzie mgła)
uniform float uHazeAmt;  // ile mgły w szczycie pasma (rośnie z odległością)
uniform float uBaseHaze; // ile mgły w dolinie (stopy gór rozpuszczone)
uniform float uRelief;   // siła cieniowania zboczy
uniform float uRim;      // podświetlenie krawędzi grzbietu
uniform float uEdgeSoft; // miękkość samej krawędzi (dalekie pasma się rozmywają)
varying float vT;
varying float vSlope;
varying vec3 vWorld;
void main() {
  // pionowy gradient: ciemniej w dole, jaśniej przy szczytach
  float lift = smoothstep(0.0, 0.75, vT);
  vec3 col = mix(uDark, uLight, lift);

  // zbocza: strona odwrócona od światła ciemniejsza, zwrócona — jaśniejsza
  col *= 1.0 + vSlope * 0.22 * uRelief;

  // cienka jasna krawędź na samym grzbiecie (backlight od poświaty horyzontu)
  float crest = smoothstep(0.88, 1.0, vT);
  col += uLight * crest * 0.30 * uRim;

  // mgła: rośnie z odległością pasma i w stronę podstawy (doliny w oparach)
  float hz = uHazeAmt + (1.0 - smoothstep(0.0, 0.55, vT)) * uBaseHaze;
  col = mix(col, uHaze, clamp(hz, 0.0, 0.94));

  // miękka krawędź: dalekie granie wchodzą w niebo gradientem, nie nożem
  col = mix(col, uHaze, smoothstep(1.0 - uEdgeSoft, 1.0, vT) * 0.85);

  gl_FragColor = vec4(col, 1.0);
}
`;

// 5 pasm: z, wysokość, mgła w szczycie, mgła u podstawy, oktawy, seed, ostrość
// grzbietu, cieniowanie zboczy, rim, miękkość krawędzi, szerokość kurtyny, freq.
// Wysokości rosną z odległością, więc dalsze szczyty stoją WYŻEJ na ekranie niż
// bliższe — to czyta się jako głębia nawet przy zerowym paralaksie kamery.
// freq: liczba fal na metr — odwrotnie proporcjonalna do odległości, żeby w KAŻDYM
// paśmie szczyty wypadały co ~60-90 px. Bez tego dalekie pasmo ma 4 turnie na cały
// kadr i czyta się jak płaskowyż, a nie jak odległy łańcuch.
const LAYERS = [
  { z: -95,  h: 7.0,  haze: 0.06, base: 0.22, oct: 6, seed: 1.7,  sharp: 0.34, relief: 0.85, rim: 0.55, soft: 0.05, w: 230, freq: 0.0179 },
  { z: -135, h: 12.0, haze: 0.20, base: 0.26, oct: 5, seed: 4.3,  sharp: 0.48, relief: 0.70, rim: 0.40, soft: 0.09, w: 310, freq: 0.0133 },
  { z: -190, h: 19.0, haze: 0.38, base: 0.30, oct: 4, seed: 8.9,  sharp: 0.62, relief: 0.55, rim: 0.26, soft: 0.14, w: 420, freq: 0.0099 },
  { z: -270, h: 30.0, haze: 0.58, base: 0.34, oct: 3, seed: 13.1, sharp: 0.78, relief: 0.40, rim: 0.14, soft: 0.22, w: 580, freq: 0.0072 },
  { z: -380, h: 44.0, haze: 0.76, base: 0.38, oct: 3, seed: 21.7, sharp: 0.90, relief: 0.28, rim: 0.06, soft: 0.32, w: 790, freq: 0.0052 },
];

export class Mountains {
  constructor() {
    this.group = new THREE.Group();
    this.layers = [];

    // kolor mgły = niebo tuż nad horyzontem (lekko podbity: tonacja i bloom
    // rozjaśniają obrazek, więc czysty PAL.skyHorizon byłby za ciemny i pasma
    // zlewałyby się z powrotem w czarną plamę)
    const hazeColor = new THREE.Color(PAL.skyHorizon).multiplyScalar(1.45);

    for (const L of LAYERS) {
      const { geo, crestMax } = buildRidge(L);
      const uniforms = {
        uDark: { value: new THREE.Color(0x150c05) },
        uLight: { value: new THREE.Color(0x2b1a0c) },
        uHaze: { value: hazeColor },
        uHazeAmt: { value: L.haze },
        uBaseHaze: { value: L.base },
        uRelief: { value: L.relief },
        uRim: { value: L.rim },
        uEdgeSoft: { value: L.soft },
      };
      const mesh = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms })
      );
      mesh.position.set(0, -0.5, L.z); // podstawa schowana pół metra pod horyzont
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.layers.push({ mesh, uniforms, z: L.z, h: L.h, haze: L.haze, crestMax });
    }
  }

  // sonda QA: przełączanie pasm (bisect "które pasmo psuje kadr") i ich parametry
  setLayerVisible(i, on) {
    if (this.layers[i]) this.layers[i].mesh.visible = on;
  }
}

// Buduje siatkę "kurtyny": kolumna x ma wysokość crest(x), a wiersze są
// proporcjonalnie rozłożone między podstawę i grzbiet (t = 0..1).
function buildRidge(L) {
  const half = L.w / 2;
  const dx = L.w / COLS;

  // profil w kolumnach, potem normalizacja do 0.28..1.0 wysokości pasma
  const raw = new Float32Array(COLS + 1);
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c <= COLS; c++) {
    const v = ridgeProfile(-half + c * dx, L.seed, L.oct, L.sharp, L.freq);
    raw[c] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const crestArr = new Float32Array(COLS + 1);
  for (let c = 0; c <= COLS; c++) crestArr[c] = L.h * (0.28 + 0.72 * ((raw[c] - lo) / span));

  // Nachylenie grzbietu jako ŚREDNIA po oknie ±5 kolumn. Bez tego każda kolumna
  // dostawała własny odcień i całe pasmo czytało się jak pionowe prążki kurtyny.
  const slopeArr = new Float32Array(COLS + 1);
  const W = 40;
  for (let c = 0; c <= COLS; c++) {
    let acc = 0;
    for (let k = -W; k <= W; k++) {
      const a = Math.max(0, Math.min(COLS, c + k));
      const b = Math.max(0, Math.min(COLS, c + k + 1));
      acc += crestArr[b] - crestArr[a];
    }
    slopeArr[c] = acc / (2 * W + 1) / dx;
  }

  const nv = (COLS + 1) * (ROWS + 1);
  const pos = new Float32Array(nv * 3);
  const aT = new Float32Array(nv);
  const aSlope = new Float32Array(nv);
  let crestMax = 0;

  for (let c = 0; c <= COLS; c++) {
    const x = -half + c * dx;
    const yTop = crestArr[c];
    if (yTop > crestMax) crestMax = yTop;
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const i = c * (ROWS + 1) + r;
      pos[i * 3] = x;
      pos[i * 3 + 1] = t * yTop;
      pos[i * 3 + 2] = 0;
      aT[i] = t;
      aSlope[i] = Math.max(-1, Math.min(1, slopeArr[c] * 14));
    }
  }

  const idx = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const a = c * (ROWS + 1) + r;
      const b = a + 1;
      const d = (c + 1) * (ROWS + 1) + r;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geo.setAttribute("aSlope", new THREE.BufferAttribute(aSlope, 1));
  geo.setIndex(idx);
  return { geo, crestMax };
}
