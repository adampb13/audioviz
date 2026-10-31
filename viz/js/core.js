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
import { PRESETS, DEFAULT_PRESET } from "./palette.js";

// Wartości startowe = preset domyślny (złoty). Zmiana presetu idzie przez
// setPalette(), więc konstruktor nie musi znać żadnego innego wariantu.
const DEF = PRESETS[DEFAULT_PRESET];
import { NOISE_GLSL } from "./glsl.js";

// Przemieszczenie powierzchni wzdłuż normalnej — WYŁĄCZNIE powłoka.
// Pole jest radialne i nie ma wyróżnionego kierunku (suma szumów o średniej 0),
// więc może tylko falować powierzchnię. Żadnych fal biegnących po kuli: sinus
// `dot(n, dir)` wypychał jedną stronę i wklęsnął drugą — z tego brały się
// „wklęśnięcia z jednej strony" i wygląd zmiętej kartki.
// Bas reguluje WYŁĄCZNIE amplitudę i tempo falowania (mocniej/słabiej).
// Deformacja jest CIĄGŁA: jedno wygładzone pole `uStruct` (obecność basu),
// żadnych impulsów „na bit" — kula faluje płynnie, bez uderzeń faktury.
const DISP_GLSL = /* glsl */ `
uniform float uFlow;     // SKUMULOWANA faza falowania (JS: += dt * tempo)
uniform float uStruct;   // 0..1 — obecność basu: gęstsze, głębsze falowanie
uniform float uWobble;   // amplituda gładkiego falowania (JS)
uniform float uSpike;    // 0..1 — WYŁĄCZNIE najmocniejsze uderzenia basu
uniform float uSpikeLen; // długość igieł w jednostkach świata

float dispAt(vec3 n) {
  // Faza jest CAŁKOWANA w JS, a nie liczona jako uTime * tempo: przy zmianie
  // tempa (bas wchodzi) uTime * k przeskakiwałoby o kilkadziesiąt jednostek
  // i całe pole szumu przetasowywało się w jednej klatce — faktura „przewijała
  // się" dopiero po uderzeniu. Teraz bas tylko przyspiesza płynięcie.
  float tt = uFlow;
  float nf = 1.15 + uStruct * 0.85;           // 2-3 garby na kulę: 1.15 → 2.00
  float amp = 0.45 + 0.80 * uStruct;
  float d = snoise(n * nf + vec3(0.0, tt, 0.0)) * 0.72;
  d += snoise(n * (nf * 1.60) + vec3(tt * 0.45, tt * 0.28, 0.0)) * 0.12;
  return d * amp;
}

// IGLY — powierzchnia przechodzi w stożki przy najmocniejszych basach.
// Pole jest JEDNYM szumem podniesionym do potęgi (nie progiem): wierzchołki
// siedzą tam, gdzie szum jest blisko 1, a im wyższa potęga, tym węższe stożki
// i więcej „płaskiej" powierzchni między nimi. Dzięki temu nie ma przeskoków —
// igły WYRASTAJĄ z falowania (uSpike rośnie gładko, faza płynie dalej tym samym
// uFlow), a między uderzeniami pole wraca do miękkich garbów, nie do siatki.
// Druga oktawa (2.13×) daje drobne igły na plecach większych — inaczej kula
// wyglądała jak rzep, a nie jak iglasta powierzchnia.
float spikeAt(vec3 n) {
  if (uSpike < 0.002) return 0.0;
  // Częstotliwość ~3.3 daje ~10 stożków na widoczną półkulę, czyli ~7 wierzchołków
  // siatki na stożek — przy 144 segmentach to minimum, żeby grot był gładki,
  // a nie postrzępiony. Wyższa potęga (6.0) zwężała groty do 1 wierzchołka
  // i igły znikały w aliasingu sylwetki.
  vec3 q = n * 7.2 + vec3(0.0, uFlow * 0.24, uFlow * 0.14);
  // Samo "pow(noise, k)" nie działało: snoise rzadko dochodzi do 1.0, więc po
  // podniesieniu do potęgi igły miały 5-10% zamierzonej długości (kula tylko
  // się marszczyła). smoothstep rozciąga GÓRNĄ część rozkładu na pełny zakres
  // 0..1, a potęga zwęża groty — dopiero to daje stożki o realnej wysokości.
  float a = smoothstep(0.24, 0.62, snoise(q));
  float b = smoothstep(0.30, 0.70, snoise(q * 1.72 + vec3(19.7, 4.3, 11.1)));
  float c = smoothstep(0.34, 0.74, snoise(q * 2.85 + vec3(5.5, 23.1, 2.7)));
  float sa = a * a * a * a * a;
  float sb = b * b * b * 0.22;
  float sc = c * c * 0.14;
  return (sa + sb + sc) * uSpike;
}
`;

const VERT = /* glsl */ `
// uFlow, uStruct, uWobble, uSpike, uSpikeLen deklaruje DISP_GLSL poniżej
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
varying float vDisp;
varying float vSpike;    // 0..~1.4 — do podświetlenia grotów w FRAG
${NOISE_GLSL}
${DISP_GLSL}
void main() {
  vec3 n = normalize(position);
  float d0 = dispAt(n);
  float s0 = spikeAt(n);
  vec3 p = position + n * (d0 * uWobble + s0 * uSpikeLen);

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
  // Gradient igieł liczę OSOBNO i bez tłumienia: przy igłach chcemy właśnie
  // ostrej normalnej (groty łapią światło), a tłumienie wypłaszczało je do
  // „stożków z plasteliny”. 0.55 to tylko zabezpieczenie przed przeprostem.
  vec3 gradS = vec3(0.0);
  if (uSpike > 0.002) {
    float sa0 = spikeAt(n);
    float sa1 = spikeAt(normalize(n + ta * e));
    float sb1 = spikeAt(normalize(n + tb * e));
    gradS = ta * ((sa1 - sa0) / e) + tb * ((sb1 - sa0) / e);
    gradS = clamp(gradS, -4.0, 4.0);
  }
  vec3 nP = normalize(n - grad * (uWobble * 1.60) * damp - gradS * (uSpikeLen * 0.55));

  vObj = n;
  vDisp = d0;
  vSpike = s0;
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
uniform float uGlow;   // 0..1 — energia całości: złoto -> rozświetlona
uniform float uStruct;  // struktura basu (ta sama wartość co w VERT)
uniform float uSpike;   // 0..1 — igły: przy nich lustro kuli przygasa
// Paleta żaru (presety barwy, palette.js). Trzy pary zamiast zaszytych vec3:
// deepA/deepB = cień powłoki (cicho -> głośno), hotA/hotB = górny koniec,
// hotC = domieszka przy pełnym rozświetleniu.
uniform vec3 uDeepA, uDeepB, uHotA, uHotB, uHotC;
varying float vDisp;    // przemieszczenie z VERT — jasność garby/doliny
varying float vSpike;   // pole igieł z VERT — groty świecą mocniej
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

  vec3 deep = mix(uDeepA, uDeepB, G); // ciemny żar (preset)
  // górny koniec zostaje POMARAŃCZOWY, nie kremowy: przy bloom+ACES krem
  // odbarwia się do bieli i wtedy akcent koloru na bit przestaje być widoczny
  vec3 hot = mix(uHotA, uHotB, HOT * 0.45);
  // głośno -> górny koniec idzie w stronę kremu, ale ZOSTAJE ZŁOTY:
  // pełne rozświetlenie (uGlow = 1) to jasny, ciepły żar, nie biała kula —
  // biel odbiera scenie jej bursztynowy charakter (i tak dodaje ją bloom).
  hot = mix(hot, uHotC, G * 0.45); // akcent presetu przy pełnym żarze
  vec3 base = mix(deep, hot, min(1.0, ENERGY + 0.10 * G));

  // STRUKTURA BASU = falowanie powłoki: modulujemy JASNOŚĆ (nie geometrię),
  // więc kula zawsze zostaje kulą — bez wklęsnięć i płaskich ścian.
  // Jasność idzie ZA tym samym polem, które wypycha wierzchołki (vDisp), więc
  // garby łapią światło, a doliny zostają ciemniejsze — czyta się jak powłoka,
  // a nie jak plamy na kuli.
  // groty igieł: własne, węższe wzmocnienie (pole spike ma wąskie szczyty, więc
  // podświetlają się tylko końce — reszta powierzchni zostaje ciemna i spokojna)
  float tip = clamp(vSpike * 1.30, 0.0, 1.0);
  // światło kluczowe dla grotów (w przestrzeni widoku, z góry-lewej): stożki są
  // wtedy modelowane światłem, a nie płaskie — bez tego igły czytały się jak
  // wycięte płetwy w jednym kolorze. Reszta kuli nadal świeci własnym żarem.
  float lam = clamp(dot(N, normalize(vec3(-0.34, 0.72, 0.60))), 0.0, 1.0);
  base = mix(base, uHotC, tip * (0.10 + 0.26 * lam));
  float relief = 1.0 + vDisp * (0.52 * uStruct) + tip * (0.30 + 0.95 * lam);
  relief = clamp(relief, 0.65, 1.85);
  // głośno: mocniejszy brzeg (rozświetlona obwódka) i wyższy gain
  // Przy igłach samo lustro kuli przygasa: bez tego groty i tło miały tę samą
  // jasność i kolce czytały się tylko po sylwetce. Doliny ciemnieją, groty nie.
  float body = 1.0 - 0.20 * uSpike * (1.0 - tip);
  vec3 col = base * (0.72 + fres * (0.85 + 0.30 * G)) * (GAIN + 0.16 * G) * relief * body;
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
  // BIAŁY gradient — kolor nadaje dopiero SpriteMaterial.color z presetu
  // (wcześniej kolor był wypieczony w teksturze i nie dał się przefarbować).
  g.addColorStop(0.0, "rgba(255,255,255,0.24)"); // niski center-alpha: nie clipować
  g.addColorStop(0.35, "rgba(255,255,255,0.15)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
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

    // Ikosfera zamiast siatki sferycznej: wierzchołki są ROZŁOŻONE RÓWNOMIERNIE
    // (siatka sferyczna ma bieguny, gdzie igły zlepiały się w plamę), a przy
    // detail=6 mamy 40 962 wierzchołki, czyli odstęp ~0.016 j. — dość, żeby grot
    // igły miał 3-4 wierzchołki i nie rozsypywał się w aliasing.
    const geo = new THREE.IcosahedronGeometry(R_BASE, 6);
    this.uniforms = {
      uFlow: { value: 0 },
      uWobble: { value: 0.03 },
      uStruct: { value: 0 },
      uSpike: { value: 0 },
      uSpikeLen: { value: 0.42 },
      uGlow: { value: 0 },
      // paleta (nadpisywana przez setPalette przy zmianie presetu)
      uDeepA: { value: new THREE.Color().fromArray(DEF.core.deepA) },
      uDeepB: { value: new THREE.Color().fromArray(DEF.core.deepB) },
      uHotA: { value: new THREE.Color().fromArray(DEF.core.hotA) },
      uHotB: { value: new THREE.Color().fromArray(DEF.core.hotB) },
      uHotC: { value: new THREE.Color().fromArray(DEF.core.hotC) },
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
      color: new THREE.Color(DEF.pal.gold),
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(2.6);
    this.halo.renderOrder = 5;
    this.mesh.add(this.halo);

    // ziemia ma odbijać to światło, nie płonąć
    this.light = new THREE.PointLight(DEF.pal.gold, 8, 60, 2);
    this.mesh.add(this.light);

    // obwiednie (czysto JS)
    this.bass = 0;  // CIĄGŁA, wygładzona obecność basu (struktura)
    this.spike = 0;     // 0..1 — igły: TYLKO najmocniejsze uderzenia basu
    this.bassSlow = 0;  // wolna obwiednia basu: punkt odniesienia dla „rise"
    this.flow = 0;  // skumulowana faza falowania powłoki (całka tempa)
    this.pulse = 0; // puls od uderzenia w bębny (rozmiar, szybki ale gładki)
    this.scale = 1; // wygładzony rozmiar bazowy (z energii całości)
    this.glow = 0;  // 0..1 — rozświetlenie barwy (ta sama energia całości)
  }

  // Preset barwy: żar powłoki + światło punktowe + halo. Same zapisy uniformów,
  // więc przełączanie w trakcie grania jest darmowe (brak rekompilacji shadera).
  setPalette({ deepA, deepB, hotA, hotB, hotC, light, halo }) {
    const u = this.uniforms;
    u.uDeepA.value.fromArray(deepA);
    u.uDeepB.value.fromArray(deepB);
    u.uHotA.value.fromArray(hotA);
    u.uHotB.value.fromArray(hotB);
    u.uHotC.value.fromArray(hotC);
    if (light != null) this.light.color.setHex(light);
    if (halo != null) this.haloMat.color.setHex(halo);
  }

  // energySmooth: energia całości (rozmiar I rozświetlenie barwy);
  // beatPulse: puls bębnów (rozmiar); bassEnv: obecność basu (struktura).
  // promień POWIERZCHNI kuli w danej chwili (puls + rozmiar) — z niego
  // wylatują iskry, więc zawsze startują dokładnie na powłoce, nie w środku
  surfaceRadius() {
    return R_BASE * this.mesh.scale.x;
  }

  update(t, dt, energySmooth, beatPulse, bassEnv) {
    // STRUKTURA — tylko bas, i WYŁĄCZNIE ciągle. Obwiednia jest wciąż
    // wygładzona (atak 16/s ≈ 62 ms, puszczenie 3.6/s ≈ 280 ms), ale na tyle
    // szybka, że faktura zmienia się RAZEM z basem, a nie pół sekundy po nim;
    // powrót jest 3.5× wolniejszy, więc kula nie drga na każdym bicie.
    const kb = bassEnv > this.bass ? 16.0 : 3.6;
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

    // struktura TYLKO przy MOCNO obecnym basie: poniżej 0.25 kula jest
    // gładka, powyżej 0.90 marszczy się na maksa (smoothstep = bez skoku).
    // Bas jest znormalizowany do p95 utworu, więc progi znaczą to samo
    // w każdym utworze — wcześniej surowe rms_norm rzadko przekraczało 0.3
    // i faktura prawie nigdy się nie włączała.
    const st0 = 0.25, st1 = 0.90;
    const q = Math.min(1, Math.max(0, (this.bass - st0) / (st1 - st0)));
    const bassG = q * q * (3 - 2 * q);
    this.uniforms.uStruct.value = bassG;
    // IGLY — próg na SAMYM szczycie basu (0.86 → 0.985), liczony z SUROWEGO
    // sygnału, nie z wygładzonego this.bass: obwiednia struktury ma atak 62 ms,
    // więc szczyt trwający 100 ms zdążyłby się w niej spłaszczyć do ~0.8 i igły
    // nigdy by się nie włączyły. W utworze jest 112 biegów basu > p95, mediana
    // 0.1 s, najdłuższy 0.6 s — próg trafia dokładnie w te uderzenia.
    // Wyjście idzie przez własną obwiednię (atak 26/s, powrót 3.4/s): igły
    // wyrastają w ~40 ms i opadają ~300 ms, więc między uderzeniami kula zdąża
    // wrócić do miękkiego falowania i nie „trzepocze".
    // Próg jest DWUCZŁONOWY, bo sam poziom nie wystarcza: w głośnym dropie bas
    // siedzi przy p95 przez kilka taktów i igły zostałyby włączone na stałe
    // (57% próbek > 0.5 w pomiarze). Dlatego igły zapala UDERZENIE, nie poziom:
    // „rise" = jak bardzo bas jest wyżej niż jego własna wolna obwiednia
    // (~0.5 s), a "lvl" = czy w ogóle jest głośno. W ustabilizowanej głośnej
    // sekcji rise ≈ 0, więc kula wraca do miękkiego falowania i tylko realne
    // akcenty ją „najeżają".
    const kbS = bassEnv > this.bassSlow ? 2.2 : 1.6;
    this.bassSlow += (bassEnv - this.bassSlow) * (1 - Math.exp(-dt * kbS));
    const rise = Math.max(0, bassEnv - this.bassSlow);
    const sstep = (x, a, b) => {
      const q = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return q * q * (3 - 2 * q);
    };
    const spikeT = sstep(bassEnv, 0.70, 0.90) * sstep(rise, 0.05, 0.20);
    // atak 16/s (~60 ms: igły WYRASTAJĄ w 3-4 klatkach, widać sam wzrost),
    // powrót 3.2/s (~310 ms: opadają płynnie, zanim wejdzie następne)
    const ks = spikeT > this.spike ? 16.0 : 3.2;
    this.spike += (spikeT - this.spike) * (1 - Math.exp(-dt * ks));
    this.uniforms.uSpike.value = this.spike;
    // faza falowania całkowana z tempa: bas przyspiesza płynięcie, ale nigdy
    // nie przeskakuje — wzór i kolejność mają znaczenie (bassG policzony wyżej)
    this.flow += dt * (0.14 + 0.30 * bassG);
    this.uniforms.uFlow.value = this.flow;
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
