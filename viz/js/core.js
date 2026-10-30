// System 2: SFERA-SERCE — ciepły żar wpół zagłębiony w ziemi.
//
// Cztery niezależne wejścia, każde z innej ścieżki:
//   • „inne" -> KOLOR i JASNOŚĆ. Każdy onset przesuwa barwę (bursztyn -> szampańskie
//     złoto) i podbija jasność; między onsetami kula jest przygaszonym żarem.
//     Mocne, głośne dźwięki rozbłyskują kulę DO BIAŁY na ~0.15 s (uWhite).
//   • „bas"  -> STRUKTURA. Poniżej ~0.50 basu kula jest gładka, powyżej 0.85
//     falowanie jest najgłębsze; KAŻDY bit basu dodatkowo wzbiera powłokę (uBeat).
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
const DISP_GLSL = /* glsl */ `
uniform float uTime;
uniform float uStruct;   // 0..1 — obecność basu: gęstsze, głębsze falowanie
uniform float uBeat;     // 0..1 — impuls na KAŻDY bit basu: powłoka wzbiera
float dispAt(vec3 n) {
  // bicie basu przyspiesza falowanie (faktura „żyje" na bicie)...
  float tt = uTime * (0.20 + 0.45 * uBeat);
  float nf = 1.15 + uStruct * 0.85;           // 2-3 garby na kulę: 1.15 → 2.00
  // ...i podbija amplitudę: ta sama powłoka, wyraźniejsze garby. Kierunku nie zmieniamy.
  float amp = 0.40 + 0.55 * uStruct + 0.80 * uBeat;
  float d = snoise(n * nf + vec3(0.0, tt, 0.0)) * 0.72;
  d += snoise(n * (nf * 1.60) + vec3(tt * 0.45, tt * 0.28, 0.0)) * 0.12;
  return d * amp;
}
`;

const VERT = /* glsl */ `
uniform float uWobble;   // uTime, uStruct, uBeat deklaruje DISP_GLSL poniżej
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
varying float vDisp;
${NOISE_GLSL}
${DISP_GLSL}
void main() {
  vec3 n = normalize(position);
  float d0 = dispAt(n);
  // bit basu wzbiera całą powłokę równomiernie (~2%) — to też nie deformuje kształtu
  float breath = 1.0 + 0.02 * uBeat;
  vec3 p = (position + n * d0 * uWobble) * breath;

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
// Kolor kuli jest STAŁY — ścieżka „inne" nie ma z nim nic wspólnego.
const float ENERGY = 0.45;  // poziom żaru: ciemny bursztyn -> jasne złoto
const float GAIN = 0.50;    // jasność bazowa
const float HOT = 0.50;     // temperatura górnego końca (bursztyn <-> krem)
uniform float uTime;
uniform float uStruct;  // struktura basu (ta sama wartość co w VERT)
uniform float uBeat;    // bit basu — wzbiera falowanie jasności
varying float vDisp;    // przemieszczenie z VERT — jasność garby/doliny
varying vec3 vObj;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);

  vec3 deep = vec3(0.34, 0.10, 0.0);                                  // ciemny bursztyn
  // górny koniec zostaje POMARAŃCZOWY, nie kremowy: przy bloom+ACES krem
  // odbarwia się do bieli i wtedy akcent koloru na bit przestaje być widoczny
  vec3 hot = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.66, 0.32), HOT * 0.45);
  vec3 base = mix(deep, hot, ENERGY);

  // STRUKTURA BASU = falowanie powłoki: modulujemy JASNOŚĆ (nie geometrię),
  // więc kula zawsze zostaje kulą — bez wklęsnięć i płaskich ścian.
  // Jasność idzie ZA tym samym polem, które wypycha wierzchołki (vDisp), więc
  // garby łapią światło, a doliny zostają ciemniejsze — czyta się jak powłoka,
  // a nie jak plamy na kuli.
  float relief = 1.0 + vDisp * (0.28 * uStruct + 0.34 * uBeat);
  relief = clamp(relief, 0.65, 1.40);
  vec3 col = base * (0.72 + fres * 0.85) * GAIN * relief;
  // miękki sufit: żar trzyma się PONIŻEJ odbarwienia — ACES nie myje go do bieli
  const float cap = 0.78;
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
const BEAT_GROW = 0.10; // dodatkowy puls od bębnów

export class CoreSphere {
  constructor() {
    this.group = new THREE.Group();

    const geo = new THREE.SphereGeometry(R_BASE, 144, 144); // gęsta siatka: fałdy gładkie, bez faset
    this.uniforms = {
      uTime: { value: 0 },
      uWobble: { value: 0.03 },
      uStruct: { value: 0 },
      uBeat: { value: 0 },
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
    this.bass = 0;  // obecność basu (struktura)
    this.beat = 0;  // impuls struktury na bit basu
    this.scale = 1; // wygładzony rozmiar (energia + puls bębnów)
  }

  // DROP: bas uderza mocniej — struktura dostaje grubsze żebro. Koloru NIE
  // dotykamy: kolor kuli jest stały i nie zależy od żadnej ścieżki.
  loudHit(v = 1) {
    const s = Math.min(1, Math.max(0, v));
    this.beat = Math.max(this.beat, 0.85 * s);
  }

  // KAŻDY bit „bas" — WYŁĄCZNIE struktura (żebro biegnące po kuli).
  // Bas nie ma prawa dotknąć koloru ani bieli.
  bassPulse(strength) {
    const s = Math.min(1, Math.max(0.2, strength));
    this.beat = Math.max(this.beat, 0.55 + 0.45 * s);
  }

  // energySmooth: energia całości (rozmiar); beatPulse: puls bębnów (rozmiar);
  // bassEnv: obecność basu (struktura). Kolor kuli nie zależy od żadnej ścieżki.
  update(t, dt, energySmooth, beatPulse, bassEnv) {
    // STRUKTURA — tylko bas. Szybki atak, szybsze puszczenie: zmiany mają być
    // wyraźne w rytm basu, ale wciąż bez skoków.
    const kb = bassEnv > this.bass ? 9.0 : 2.4;
    this.bass += (bassEnv - this.bass) * (1 - Math.exp(-dt * kb));
    this.beat *= Math.exp(-dt * 7.0);  // żebro basu znika w ~0.2 s

    // ROZMIAR — sumaryczna energia i głośność muzyki. Krzywa potęgowa, żeby
    // spokojne fragmenty były wyraźnie mniejsze, a najmocniejsze momenty rosły
    // o ~85% (1.00 -> 1.85). Puls bębnów dokłada 0.10 na uderzenie.
    const en = Math.min(1, Math.max(0, energySmooth));
    const scT = 1.0 + GROW * Math.pow(en, 1.15) + beatPulse * BEAT_GROW;
    this.scale += (scT - this.scale) * (1 - Math.exp(-dt * 6.0)); // bez skoków

    this.uniforms.uTime.value = t;
    // struktura TYLKO przy MOCNO obecnym basie: poniżej 0.55 kula jest
    // gładka, powyżej 0.90 marszczy się na maksa (smoothstep = bez skoku)
    const st0 = 0.50, st1 = 0.85;
    const q = Math.min(1, Math.max(0, (this.bass - st0) / (st1 - st0)));
    const bassG = q * q * (3 - 2 * q);
    this.uniforms.uStruct.value = bassG;
    this.uniforms.uBeat.value = this.beat;
    // Amplituda przemieszczenia: spokój 1.8% promienia, pełne fałdy basu ~5.3%.
    // Żebro bitu (uBeat) siedzi w polu funkcji, więc dokłada się samo — razem
    // najgorszy przypadek ~20% promienia: mocno widać, kula się nie rozlatuje.
    this.uniforms.uWobble.value = 0.016 + bassG * 0.026;

    this.mesh.scale.setScalar(this.scale);
    // światło rzucane na ziemię: słabe i krótkie — kula ma świecić sobą,
    // nie zalewać sceny (audit: „nie oświetlać jakoś bardzo sceny do góry")
    this.light.intensity = 2.4;
    this.light.distance = 15 + this.scale * 4;
    this.haloMat.opacity = 0.10;
    this.haloMat.color.setRGB(1.0, 0.72, 0.44); // stała ciepła poświata
  }
}
