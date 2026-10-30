// System 2: SFERA-SERCE — ciepły żar wpół zagłębiony w ziemi.
//
// Cztery niezależne wejścia, każde z innej ścieżki:
//   • „inne" -> KOLOR i JASNOŚĆ. Każdy onset przesuwa barwę (bursztyn -> szampańskie
//     złoto) i podbija jasność; między onsetami kula jest przygaszonym żarem.
//     Mocne, głośne dźwięki rozbłyskują kulę DO BIAŁY na ~0.15 s (uWhite).
//   • „bas"  -> STRUKTURA. Poniżej ~0.55 basu kula jest gładka, powyżej 0.90 marszczy
//     się na maksa; KAŻDY bit basu dodatkowo uderza w nią żebrem (uBeat) — mocna,
//     czytelna zmiana faktury na każdym bicie.
//   • energia + głośność całości -> ROZMIAR. Najmocniejsze momenty rosną o ~85%.
//   • bębny -> puls rozmiaru, wokal -> drobne drżenie powierzchni.
//
// Bez cząstek: kula świeci sobą (usunięte na życzenie — „inne" jest jedynym
// źródłem koloru, a energia jedynym źródłem rozmiaru).
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

// Przemieszczenie powierzchni wzdłuż normalnej: fałdy basu + żebro na uderzenie.
// Zwraca wartość w jednostkach „wobbli", skalowaną potem przez uWobble.
const DISP_GLSL = /* glsl */ `
uniform float uTime;
uniform float uStruct;   // 0..1 — obecność basu: gęstszy, głębszy szum
uniform float uBeat;     // 0..1 — impuls na KAŻDY bit basu: żebro po kuli
float dispAt(vec3 n) {
  float nf = 2.2 + uStruct * 2.6;
  float d = snoise(n * nf + vec3(0.0, uTime * 0.55, 0.0)) * 0.70;
  d += snoise(n * 6.0 - vec3(uTime * 0.35)) * 0.30;
  // drugi, wolniejszy przebieg tylko od basu — szerokie pasma, nie drobny szum
  d += snoise(n * (nf * 1.6) + vec3(uTime * 0.42)) * 0.45 * uStruct;
  // UDERZENIE BASU: dwa żebra biegnące po kuli w różnych kierunkach
  d += sin(dot(n, vec3(0.35, 1.0, 0.20)) * 5.5 - uTime * 5.5) * 1.35 * uBeat;
  d += sin(dot(n, vec3(-0.80, 0.35, 0.60)) * 4.0 + uTime * 3.0) * 0.75 * uBeat;
  return d;
}
`;

const VERT = /* glsl */ `
uniform float uWobble;   // uTime, uStruct, uBeat deklaruje DISP_GLSL poniżej
varying vec3 vN;
varying vec3 vWorld;
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
  vec3 nP = normalize(n - grad * uWobble * 1.25);

  vN = normalize(normalMatrix * nP);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uEnergy; // poziom żaru 0..1 — z „inne" (głośność + błysk)
uniform float uGain;   // jasność — z „inne"
uniform float uHot;    // 0..1 z centroidu „inne" — przesuwa bursztyn ku kremowi
uniform float uFlash;  // 0..1 — kolorystyczny akcent na KAŻDYM onsiecie „inne"
uniform float uWhite;  // 0..1 — mocny dźwięk: kula rozbłyskuje do bieli
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);

  vec3 deep = vec3(0.34, 0.10, 0.0);                                  // ciemny bursztyn
  // górny koniec zostaje POMARAŃCZOWY, nie kremowy: przy bloom+ACES krem
  // odbarwia się do bieli i wtedy akcent koloru na bit przestaje być widoczny
  vec3 hot = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.66, 0.32), uHot * 0.45);
  vec3 base = mix(deep, hot, clamp(uEnergy, 0.0, 1.0));

  // BIT „inne" = przesunięcie BARWY, nie tylko jasności: bursztyn -> szampańskie
  // złoto (chłodniejsze, jaśniejsze), gaśnie w ~0.15 s po onsiecie
  // na bit „inne" kula się ZARUMIENIA: głębsza, bardziej nasycona czerwień
  vec3 beatTint = vec3(1.0, 0.24, 0.08);
  base = mix(base, beatTint, clamp(uFlash * 0.95, 0.0, 1.0));

  // MOCNE uderzenie „inne" (klawisze): kolor idzie w stronę ciepłej bieli,
  // ale tylko do połowy i przez jasność — ma być GLOW, nie błysk lampy.
  base = mix(base, vec3(1.0, 0.92, 0.80), clamp(uWhite * 0.45, 0.0, 1.0));

  // jasność zmienia TYLKO głośność „inne" (uGain) i biel (uWhite); akcent barwy
  // (uFlash) nie podnosi jasności — inaczej kolor natychmiast przepalał się do bieli
  vec3 col = base * (0.72 + fres * 0.85) * (uGain + uFlash * 0.05 + uWhite * 0.40);
  // miękki sufit: spokojny żar trzyma się PONIŻEJ odbarwienia (ACES nie myje go do
  // bieli), a rozjaśnienie otwiera go tylko do 1.22 — poświata bez przepalenia
  float cap = 0.72 + 0.26 * clamp(uWhite, 0.0, 1.0);
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

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
      uEnergy: { value: 0.35 },
      uGain: { value: 0.55 },
      uHot: { value: 0.5 },
      uFlash: { value: 0 },
      uWhite: { value: 0 },
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
    this.flash = 0; // akcent kolorystyczny od pojedynczego uderzenia „inne"
    this.white = 0; // rozbłysk do bieli od mocnego dźwięku
    this.glow = 0;  // WYGŁADZONY żar: głośność „inne" + błysk (0..1)
    this.bass = 0;  // obecność basu (struktura)
    this.beat = 0;  // impuls struktury na bit basu
    this.scale = 1; // wygładzony rozmiar (energia + puls bębnów)
  }

  // KAŻDY onset w „inne" — źródło koloru i jasności. Niski próg, bo ciche
  // klawisze też mają zmienić barwę; akcenty dostają pełną moc i biel.
  otherHit(strength, loudness = 1) {
    const s = Math.min(1, Math.max(0, strength));
    this.flash = Math.max(this.flash, 0.30 + 0.70 * s);
    // Biel dopiero wtedy, gdy jest naprawdę głośno (loudness = energia całości)
    // i transient jest mocny — i tylko jako rozjaśnienie z poświatą, nie błysk.
    // bramka na głośność SAMEJ ścieżki „inne" (loudness = oRms/oRmsP95), nie na
    // energię całości: inaczej po wyciszeniu basu ciche klawisze nie rozjaśniają
    // kuli, a w pełnym miksie rozjaśniał ją bas.
    // sufit 0.85: rozjaśnienie z poświatą, nigdy lampa błyskowa
    const w = Math.min(0.85, ss(0.38, 0.74, loudness) * (0.40 + 0.65 * s));
    if (w > 0.06) this.white = Math.max(this.white, w);
  }

  // DROP: bas uderza mocniej — struktura dostaje grubsze żebro. Koloru NIE
  // dotykamy: barwa i biel należą wyłącznie do „inne".
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
  // bassEnv: obecność basu (struktura); otherLoud/otherCent: „inne" (kolor, jasność)
  update(t, dt, energySmooth, beatPulse, bassEnv, otherLoud, otherCent) {
    // STRUKTURA — tylko bas. Szybki atak, szybsze puszczenie: zmiany mają być
    // wyraźne w rytm basu, ale wciąż bez skoków.
    const kb = bassEnv > this.bass ? 9.0 : 2.4;
    this.bass += (bassEnv - this.bass) * (1 - Math.exp(-dt * kb));
    this.flash *= Math.exp(-dt * 6.5); // krótki akcent: każdy klawisz osobno
    this.white *= Math.exp(-dt * 7.5); // biel tylko na chwilę
    this.beat *= Math.exp(-dt * 7.0);  // żebro basu znika w ~0.2 s

    // JASNOŚĆ/KOLOR — wyłącznie „inne". Głośność ciągła + akcent onsetu,
    // wygładzone obwiednią, żeby kolor płynął, a nie przeskakiwał.
    const target = Math.min(1, otherLoud * 0.95 + this.flash * 0.60);
    const kg = target > this.glow ? 7.0 : 3.0;
    this.glow += (target - this.glow) * (1 - Math.exp(-dt * kg));

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
    this.uniforms.uHot.value = otherCent;
    // szeroki, ale niezbyt przepalony zakres: ciemny bursztyn -> jasne złoto
    this.uniforms.uEnergy.value = 0.05 + this.glow * 0.78;
    // Jasność trzymana PONIŻEJ progu blooma: kula ma czytać się jako bursztyn
    // z widocznymi fałdami; do bieli strzela tylko uWhite (mocny dźwięk).
    this.uniforms.uGain.value = 0.26 + this.glow * 0.46;
    this.uniforms.uFlash.value = this.flash;
    this.uniforms.uWhite.value = this.white;
    // Amplituda przemieszczenia: spokój 1.8% promienia, pełne fałdy basu ~5.3%.
    // Żebro bitu (uBeat) siedzi w polu funkcji, więc dokłada się samo — razem
    // najgorszy przypadek ~20% promienia: mocno widać, kula się nie rozlatuje.
    this.uniforms.uWobble.value = 0.018 + bassG * 0.035;

    this.mesh.scale.setScalar(this.scale);
    // światło rzucane na ziemię: słabe i krótkie — kula ma świecić sobą,
    // nie zalewać sceny (audit: „nie oświetlać jakoś bardzo sceny do góry")
    this.light.intensity = 1.2 + this.glow * 2.8 + this.white * 1.1;
    this.light.distance = 15 + this.scale * 4;
    this.haloMat.opacity = 0.06 + this.glow * 0.07 + this.white * 0.05;
    // halo MUSI zmieniać barwę razem z kulą — inaczej additive krem zjada akcent
    // koloru na bicie (kula wygląda na białą mimo czerwonego tintu)
    const fr = this.flash;
    const wh = this.white;
    this.haloMat.color.setRGB(
      1.0,
      ((0.81 * (1 - fr) + 0.34 * fr) * (1 - wh * 0.85) + wh * 0.85),
      ((0.54 * (1 - fr) + 0.16 * fr) * (1 - wh * 0.85) + wh * 0.85)
    );
  }
}
