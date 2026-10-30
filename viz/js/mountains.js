// System 4: GÓRY — panorama z 3 pasm na różnych głębokościach.
//
// Grzbiet jest wypalany na CPU (góry są statyczne — nigdy się nie ruszają), więc
// w vertex shaderze nie ma ani jednego wywołania szumu: 3 pasma × 768 kolumn to
// ~2.3k ewaluacji, i to tylko przy starcie oraz przy zmianie proporcji okna.
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

// Profil grzbietu = masyw ⊗ turnie o TĘPYCH szczytach:
//  - "massif" (λ ~ 600-1200 m) decyduje, GDZIE są góry i jak wysokie — bez niego
//    ridged daje równy "ząbek" na całej szerokości (sztuczny jak tekturowa dekoracja),
//  - "peaks": n = (1-|noise|)^1.8 — potęga WIĘKSZA od 1 tępi wierzchołek (kopuła).
//    Uwaga na kierunek: (1-|n|)^p przy p<1 ma w szczycie cusp (ostry koniec),
//    przy p>1 — gładkie, zaokrąglone wierzchołki. p=1 to ani to, ani to.
//  - lacunarity 2.02 i gain 0.40 dają drobne, ale nie piłowate garby,
//  - sharp: bliskie pasma mają łagodne pagóry, dalekie — wyraźniejszą grań.
function ridgeProfile(x, seed, oct, sharp, freqBase, massifFreq) {
  const massif = 0.5 + 0.5 * fbm1(x * massifFreq + seed * 5.3, 3);
  let sum = 0, amp = 1, norm = 0, freq = freqBase;
  for (let o = 0; o < oct; o++) {
    const w = vnoise(x * freq * 0.4 + seed * 3.1) * 1.5;
    const n = Math.pow(1 - Math.abs(vnoise(x * freq + w + seed * 11.3 + o * 41.7)), 2.2);
    sum += n * amp;
    norm += amp;
    amp *= 0.40;   // 0.50 zostawiało drobne, ostre stożki na grzbietach
    freq *= 2.02;
  }
  const peaks = sum / norm;
  return massif * (1 - sharp) + (0.30 * massif + 0.70 * peaks) * sharp;
}

// Dodatkowe wygładzenie wypalonego profilu (box, promień w metrach): nawet po
// smoothstepie zostają 1-2-kolumnowe zadziory, które na ekranie czytają się jak
// ostre igły. Promień liczony z dx, więc działa tak samo na bliskim i dalekim paśmie.
function softenProfile(arr, radius) {
  const r = Math.max(2, Math.round(radius));
  const n = arr.length;
  const tmp = new Float32Array(n);
  tmp.set(arr);
  for (let c = 0; c < n; c++) {
    let acc = 0, cnt = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.max(0, Math.min(n - 1, c + k));
      acc += tmp[j];
      cnt++;
    }
    arr[c] = acc / cnt;
  }
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
  // pionowy gradient: ciemniej w dole, jaśniej dopiero przy grani
  // (przy 0.0-0.75 cała górna połowa pasma była jednolicie jasna i gubiło się to,
  //  że światło pada na wierzchołki, a nie na całe zbocze)
  float lift = smoothstep(0.45, 1.0, vT);
  vec3 col = mix(uDark, uLight, lift);

  // zbocza: strona odwrócona od światła ciemniejsza, zwrócona — jaśniejsza
  col *= 1.0 + vSlope * 0.22 * uRelief;

  // podświetlenie grani: SZEROKI, miękki gradient przy szczycie. Wąskie
  // smoothstep(0.88,1.0) dawało 1-2 px świecący drut przez całą szerokość kadru.
  float crest = smoothstep(0.78, 1.0, vT);
  col += uLight * crest * 0.16 * uRim;

  // mgła: rośnie z odległością pasma, a u podstawy sięga tylko dolnej 1/3
  float hz = uHazeAmt + (1.0 - smoothstep(0.0, 0.30, vT)) * uBaseHaze;
  col = mix(col, uHaze, clamp(hz, 0.0, 0.94));

  // miękka krawędź: dalekie granie wchodzą w niebo gradientem, nie nożem.
  // Tylko dla pasm, które i tak toną w mgle (uHazeAmt): na ciemnym bliskim
  // i średnim paśmie ten sam zabieg rysował JASNY DRUT przez cały grzbiet.
  col = mix(col, uHaze, smoothstep(1.0 - uEdgeSoft, 1.0, vT) * 0.85 * smoothstep(0.10, 0.30, uHazeAmt));

  gl_FragColor = vec4(col, 1.0);
}
`;

// Trzy pasma. Wysokości nie są "na oko" — wynikają z rzutu kamery (pos [0,7,22],
// look [0,3,0], fov 55): ułamek wysokości ekranu, na którym ląduje szczyt:
//   z=-95  h=4.2  → szczyt na 0.349 (niski, ciemny grzbiet przed nami)
//   z=-175 h=24   → szczyt na 0.238
//   z=-320 h=90   → szczyt na 0.077 — to jest to "jedno wysokie z tyłu";
//                   całe pasmo od podstawy (0.347) po szczyt zajmuje ~28% kadru.
// Szerokość kurtyny NIE jest tu wpisana: liczy ją konstruktor z frustum
// (halfWidthAt), z 30% zapasem, i przelicza na każdym resize — pasmo zawsze
// sięga poza obie krawędzie ekranu, więc nigdy nie widać jego uciętego końca.
// freq: liczba fal na metr — odwrotnie proporcjonalna do odległości, żeby w KAŻDYM
// paśmie szczyty wypadały co ~60-90 px.
const LAYERS = [
  { z: -95,  h: 9.0,  haze: 0.02, base: 0.06, oct: 5, seed: 1.7, sharp: 0.40, relief: 0.85, rim: 0.16, soft: 0.05, freq: 0.0150, dark: 0x060302, lit: 0x140b04 },
  { z: -175, h: 24.0, haze: 0.14, base: 0.10, oct: 6, seed: 4.3, sharp: 0.58, relief: 0.70, rim: 0.14, soft: 0.09, freq: 0.0115, dark: 0x0f0804, lit: 0x241609 },
  { z: -320, h: 90.0, haze: 0.34, base: 0.16, oct: 6, seed: 8.9, sharp: 0.58, relief: 0.55, rim: 0.22, soft: 0.15, freq: 0.0095, dark: 0x241708, lit: 0x4a2f16 },
];

// ---------- geometria kamery → szerokość kurtyny ----------
// Musi być zgodna z main.js; trzymana tutaj, bo tylko góry jej potrzebują.
const CAM_POS = [0, 7, 22];
const CAM_LOOK = [0, 3, 0];
const CAM_FOV = 55;
const REF_ASPECT = 16 / 9;   // aspect, dla którego wypalana jest siatka
const WIDTH_MARGIN = 1.30;   // 30% zapasu poza kadrem

const _camPos = new THREE.Vector3(...CAM_POS);
const _camFwd = new THREE.Vector3(...CAM_LOOK).sub(_camPos).normalize();

// połowa szerokości kadru (w metrach) na głębokości z
function halfWidthAt(z, aspect) {
  const depth = new THREE.Vector3(0, 0, z).sub(_camPos).dot(_camFwd);
  return depth * Math.tan((CAM_FOV * Math.PI) / 360) * aspect;
}

export class Mountains {
  constructor() {
    this.group = new THREE.Group();
    this.layers = [];

    // kolor mgły = niebo tuż nad horyzontem (lekko podbity: tonacja i bloom
    // rozjaśniają obrazek, więc czysty PAL.skyHorizon byłby za ciemny i pasma
    // zlewałyby się z powrotem w czarną plamę)
    const hazeColor = new THREE.Color(PAL.skyHorizon).multiplyScalar(1.45);

    for (const L of LAYERS) {
      const w = 2 * halfWidthAt(L.z, REF_ASPECT) * WIDTH_MARGIN;
      const { geo, crestMax } = buildRidge(L, w);
      const uniforms = {
        uDark: { value: new THREE.Color(L.dark) },
        uLight: { value: new THREE.Color(L.lit) },
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
      this.layers.push({ mesh, uniforms, z: L.z, h: L.h, haze: L.haze, crestMax, cfg: L, w });
    }
  }

  // Szerokość kurtyny musi zależeć od proporcji okna, inaczej po bokach widać
  // ucięty koniec pasma. Siatkę PRZEBUDOWUJEMY z nową szerokością, a nie skalujemy
  // w X: skalowanie ściskało profile w pionie okna (900×1000 => scale 0.51)
  // i łagodne szczyty robiły się z powrotem igłami.
  resize(aspect) {
    for (const ly of this.layers) {
      const w = 2 * halfWidthAt(ly.z, aspect) * WIDTH_MARGIN;
      if (Math.abs(w - ly.w) < 1) continue;
      const { geo, crestMax } = buildRidge(ly.cfg, w);
      ly.mesh.geometry.dispose();
      ly.mesh.geometry = geo;
      ly.w = w;
      ly.crestMax = crestMax;
    }
  }

  // sonda QA: przełączanie pasm (bisect "które pasmo psuje kadr") i ich parametry
  setLayerVisible(i, on) {
    if (this.layers[i]) this.layers[i].mesh.visible = on;
  }
}

// Buduje siatkę "kurtyny": kolumna x ma wysokość crest(x), a wiersze są
// proporcjonalnie rozłożone między podstawę i grzbiet (t = 0..1).
function buildRidge(L, w) {
  const half = w / 2;
  const dx = w / COLS;

  // profil w kolumnach, potem normalizacja do 0.28..1.0 wysokości pasma
  const raw = new Float32Array(COLS + 1);
  // zakres normalizacji liczymy TYLKO z kolumn widocznych w kadrze (kurtyna jest
  // o 30% szersza). Inaczej najwyższy szczyt wypadał za krawędzią ekranu i ten
  // widoczny był o ~25% niższy, niż zakłada konfiguracja.
  const visHalf = half / WIDTH_MARGIN;
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c <= COLS; c++) {
    // długość fali masywu ~ połowa szerokości kurtyny: stała 0.0016 (λ 625 m)
    // dawała na bliskim (280 m) i średnim (470 m) paśmie mniej niż jeden masyw
    // na cały kadr, więc czytały się jak gładkie wydmy
    const v = ridgeProfile(-half + c * dx, L.seed, L.oct, L.sharp, L.freq, 2.2 / w);
    raw[c] = v;
    if (Math.abs(-half + c * dx) > visHalf) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // wygładzenie PRZED normalizacją: promień ~10% długości fali najwyższej oktawy
  // (w metrach) — tępi tylko 1-2-kolumnowe zadziory, nie formy
  const topWL = 1 / (L.freq * Math.pow(2.02, L.oct - 1));
  softenProfile(raw, Math.max(3.5, (0.10 * topWL) / dx));

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
