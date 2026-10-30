// System 2: SFERA-SERCE — ciepły żar wpół zagłębiony w ziemi.
//
// Cztery niezależne wejścia, każde z innej ścieżki:
//   • energia + głośność całości -> KOLOR i JASNOŚĆ. Cicha muzyka = głębokie,
//     matowe złoto; głośna = rozświetlona, kremowa barwa (uGlow 0..1). Ta sama
//     energia steruje rozmiarem, więc kula rośnie i rozjaśnia się razem z utworem.
//   • „bas"  -> STRUKTURA. Poniżej ~0.50 basu kula jest gładka, powyżej 0.85
//     falowanie jest najgłębsze (jedno ciągłe pole, bez impulsów na bit).
//     Bas zmienia tylko amplitudę i tempo falowania — nigdy kierunek, więc nie
//     robi wklęsnięć ani innych deformacji: kula zawsze zostaje kulą.
//   • energia + głośność całości -> ROZMIAR. Najmocniejsze momenty rosną o ~85%.
//   • bębny -> puls rozmiaru, wokal -> drobne drżenie powierzchni.
//
// Bez cząstek: kula świeci sobą (usunięte na życzenie — „inne" jest jedynym
// źródłem koloru, a energia jedynym źródłem rozmiaru).
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

// Przemieszczenie powierzchni wzdłuż normalnej — WYŁĄCZNIE powłoka.
// Pole jest radialne i nie ma wyróżnionego kierunku (suma szumów o średniej 0),
// więc może tylko falować powierzchnię. Żadnych fal biegnących po kuli: sinus
// `dot(n, dir)` wypychał jedną stronę i wklęsnął drugą — z tego brały się
// „wklęśnięcia z jednej strony" i wygląd zmiętej kartki.
// Bas reguluje WYŁĄCZNIE amplitudę i tempo falowania (mocniej/słabiej).
// Deformacja jest CIĄGŁA: jedno wygładzone pole `uStruct` (obecność basu),
// żadnych impulsów „na bit" — kula faluje płynnie, bez uderzeń faktury.
const DISP_GLSL = /* glsl */ `
uniform float uTime;
uniform float uStruct;   // 0..1 — obecność basu: gęstsze, głębsze falowanie
float dispAt(vec3 n) {
  // falowanie płynie CAŁY CZAS, bas zmienia tylko jego tempo — bez skoków na bicie
  float tt = uTime * (0.14 + 0.30 * uStruct);
  float nf = 1.15 + uStruct * 0.85;           // 2-3 garby na kulę: 1.15 → 2.00
  float amp = 0.45 + 0.80 * uStruct;
  float d = snoise(n * nf + vec3(0.0, tt, 0.0)) * 0.72;
  d += snoise(n * (nf * 1.60) + vec3(tt * 0.45, tt * 0.28, 0.0)) * 0.12;
  return d * amp;
}
`;

const VERT = /* glsl */ `
uniform float uWobble;   // uTime, uStruct deklaruje DISP_GLSL poniżej
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
varying float vDisp;
${NOISE_GLSL}
${DISP_GLSL}
void main() {
  vec3 n = normalize(position);
  float d0 = dispAt(n);
  vec3 p = position + n * d0 * uWobble;

  // Normalna z gradientu pola przemieszczenia (różnice skończone po stycznych):
  // bez tego fałdy widać tylko na sylwetce, a światło ich nie łapie.
  vec3 up = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 ta = normalize(cross(n, up));
  vec3 tb = cross(n, ta);
  float e = 0.06;
  float da = dispAt(normalize(n + ta * e));
  float db = dispAt(normalize(n + tb * e));
  vec3 grad = ta * ((da - d0) / e) + tb * ((db - d0) / e);
  // tłumienie dużych gradientów: bez niego normalna „przestrzeliwuje" i na kuli
  // pojawiają się ostre, wielokątne crease'y zamiast miękkiego falowania
  float damp = 1.0 / (1.0 + length(grad) * 0.8);
  vec3 nP = normalize(n - grad * (uWobble * 1.60) * damp);

  vObj = n;
  vDisp = d0;
  vN = normalize(normalMatrix * nP);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
// Kolor kuli podąża za energią/głośnością CAŁEGO utworu (uGlow 0..1).
// uGlow = 0 odtwarza dawny, stały wygląd (złoty żar) — więc cicha muzyka
// nie robi się jaśniejsza niż wcześniej, tylko głośna idzie w stronę kremu.
const float ENERGY = 0.45;  // poziom żaru: ciemny bursztyn -> jasne złoto
const float GAIN = 0.50;    // jasność bazowa
const float HOT = 0.50;     // temperatura górnego końca (bursztyn <-> krem)
uniform float uTime;
uniform float uGlow;   // 0..1 — energia całości: złoto -> rozświetlona
uniform float uStruct;  // struktura basu (ta sama wartość co w VERT)
varying float vDisp;    // przemieszczenie z VERT — jasność garby/doliny
varying vec3 vObj;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  // G = uGlow^2: środek skali zostaje złoty, a rozświetla się dopiero góra
  // zakresu — inaczej cały refren (energia ~0.75) byłby biały.
  float G = uGlow * uGlow;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);

  vec3 deep = mix(vec3(0.34, 0.10, 0.0), vec3(0.44, 0.18, 0.03), G); // ciemny bursztyn
  // górny koniec zostaje POMARAŃCZOWY, nie kremowy: przy bloom+ACES krem
  // odbarwia się do bieli i wtedy akcent koloru na bit przestaje być widoczny
  vec3 hot = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.66, 0.32), HOT * 0.45);
  // głośno -> górny koniec idzie w stronę kremu, ale ZOSTAJE ZŁOTY:
  // pełne rozświetlenie (uGlow = 1) to jasny, ciepły żar, nie biała kula —
  // biel odbiera scenie jej bursztynowy charakter (i tak dodaje ją bloom).
  hot = mix(hot, vec3(1.0, 0.74, 0.34), G * 0.45); // niska niebieska = halo zostaje złote
  vec3 base = mix(deep, hot, min(1.0, ENERGY + 0.10 * G));

  // STRUKTURA BASU = falowanie powłoki: modulujemy JASNOŚĆ (nie geometrię),
  // więc kula zawsze zostaje kulą — bez wklęsnięć i płaskich ścian.
  // Jasność idzie ZA tym samym polem, które wypycha wierzchołki (vDisp), więc
  // garby łapią światło, a doliny zostają ciemniejsze — czyta się jak powłoka,
  // a nie jak plamy na kuli.
  float relief = 1.0 + vDisp * (0.52 * uStruct);
  relief = clamp(relief, 0.65, 1.40);
  // głośno: mocniejszy brzeg (rozświetlona obwódka) i wyższy gain
  vec3 col = base * (0.72 + fres * (0.85 + 0.30 * G)) * (GAIN + 0.16 * G) * relief;
  // miękki sufit: żar trzyma się PONIŻEJ odbarwienia — ACES nie myje go do bieli
  float cap = 0.78 + 0.10 * G;
  col = cap * tanh(col / cap);
  gl_FragColor = vec4(col, 1.0);
}
`;

// miękkie halo wokół żaru (zamiast twardego dysku) — radial gradient z canvas
function haloTexture() {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, "rgba(255,207,138,0.22)"); // niski center-alpha: nie clipować
  g.addColorStop(0.35, "rgba(217,152,74,0.15)");
  g.addColorStop(1.0, "rgba(217,152,74,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const R_BASE = 0.9;     // promień siatki sfery
const GROW = 0.85;      // ile rośnie kula przy pełnej energii (1 -> 1.85)
const BEAT_GROW = 0.26; // puls od bębnów: do +26% promienia na uderzenie

export class CoreSphere {
  constructor() {
    this.group = new THREE.Group();

    const geo = new THREE.SphereGeometry(R_BASE, 144, 144); // gęsta siatka: fałdy gładkie, bez faset
    this.uniforms = {
      uTime: { value: 0 },
      uWobble: { value: 0.03 },
      uStruct: { value: 0 },
      uGlow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 0.3, 0); // wkopana w ziemię — jak żar
    this.group.add(this.mesh);

    // miękkie halo zamiast przepalonego dysku
    this.haloMat = new THREE.SpriteMaterial({
      map: haloTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.35,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(2.6);
    this.halo.renderOrder = 5;
    this.mesh.add(this.halo);

    // ziemia ma odbijać to światło, nie płonąć
    this.light = new THREE.PointLight(PAL.gold, 8, 60, 2);
    this.mesh.add(this.light);

    // obwiednie (czysto JS)
    this.bass = 0;  // CIĄGŁA, wygładzona obecność basu (struktura)
    this.pulse = 0; // puls od uderzenia w bębny (rozmiar, szybki ale gładki)
    this.scale = 1; // wygładzony rozmiar bazowy (z energii całości)
    this.glow = 0;  // 0..1 — rozświetlenie barwy (ta sama energia całości)
  }

  // energySmooth: energia całości (rozmiar I rozświetlenie barwy);
  // beatPulse: puls bębnów (rozmiar); bassEnv: obecność basu (struktura).
  update(t, dt, energySmooth, beatPulse, bassEnv) {
    // STRUKTURA — tylko bas, i WYŁĄCZNIE ciągle. Obwiednia jest wygładzona
    // dwustronnie (atak 3.2/s, puszczenie 1.8/s), więc faktura „oddycha"
    // razem z obecnością basu, a nie drga na każdym jego bicie.
    const kb = bassEnv > this.bass ? 3.2 : 1.8;
    this.bass += (bassEnv - this.bass) * (1 - Math.exp(-dt * kb));

    // ROZMIAR — bazowo z energii całości, a na to puls bębnów.
    const en = Math.min(1, Math.max(0, energySmooth));
    const scT = 1.0 + GROW * Math.pow(en, 1.15);
    this.scale += (scT - this.scale) * (1 - Math.exp(-dt * 6.0)); // bez skoków
    // puls bębnów: szybki, ale gładki atak (0.05 s) i krótkie, czytelne
    // wybrzmienie (~0.11 s) — przy gęstych uderzeniach (4/s) kula wyraźnie
    // „pompuje”, a nie stoi napompowana.
    const kp = beatPulse > this.pulse ? 22.0 : 9.0;
    this.pulse += (beatPulse - this.pulse) * (1 - Math.exp(-dt * kp));

    // ROZŚWIETLENIE BARWY — ten sam sygnał co rozmiar (energia/głośność całości),
    // ale inna obwiednia: kolor zmienia się WOLNIEJ niż rozmiar (atak 3.0/s,
    // powrót 1.1/s), więc kula „nabiera światła" przez kilka sekund refrenu,
    // a nie miga na każdy akcent. Poniżej 0.18 energii kolor jest dokładnie
    // taki jak dawniej (uGlow = 0) — cisza nie rozjaśnia kuli.
    const gq = Math.min(1, Math.max(0, (en - 0.20) / (1.00 - 0.20)));
    const glowT = gq * gq * (3 - 2 * gq);
    const kg = glowT > this.glow ? 3.0 : 1.1;
    this.glow += (glowT - this.glow) * (1 - Math.exp(-dt * kg));
    this.uniforms.uGlow.value = this.glow;
    const scalePulse = this.scale * (1 + BEAT_GROW * this.pulse);

    this.uniforms.uTime.value = t;
    // struktura TYLKO przy MOCNO obecnym basie: poniżej 0.55 kula jest
    // gładka, powyżej 0.90 marszczy się na maksa (smoothstep = bez skoku)
    const st0 = 0.30, st1 = 0.92;
    const q = Math.min(1, Math.max(0, (this.bass - st0) / (st1 - st0)));
    const bassG = q * q * (3 - 2 * q);
    this.uniforms.uStruct.value = bassG;
    // Amplituda przemieszczenia: spokój 1.4% promienia, pełne fałdy basu ~4.8%.
    // Bas zmienia TYLKO tę amplitudę — deformacja jest ciągła, bez impulsów.
    this.uniforms.uWobble.value = 0.014 + bassG * 0.034;

    this.mesh.scale.setScalar(scalePulse);
    // światło rzucane na ziemię: słabe i krótkie — kula ma świecić sobą,
    // nie zalewać sceny (audit: „nie oświetlać jakoś bardzo sceny do góry")
    this.light.intensity = 2.4 + 1.3 * this.glow;
    this.light.distance = 15 + this.scale * 4;
    // halo idzie za rozświetleniem: jaśniejsze i bliżej kremu, ale nadal dyskretne
    this.haloMat.opacity = 0.10 + 0.08 * this.glow;
    this.haloMat.color.setRGB(1.0, 0.72 + 0.15 * this.glow, 0.44 + 0.22 * this.glow);
  }
}
