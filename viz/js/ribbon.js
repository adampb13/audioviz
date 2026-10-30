// System 3: WSTĘGA WOKALU — prosta, pozioma rzeka jedwabiu rozpięta przez CAŁY kadr:
// x -45..+45 na z=-28, czyli od prawej krawędzi ekranu do lewej, z symetrycznym
// taperem na obu końcach (żadnego uciętego licowania z krawędzią).
//
//   szerokość  = głośność wokalu (rms_norm): cisza -> cienka nić, pełny śpiew -> pas
//   falowanie  = JEDNA faza całkowana z tempo_local_bpm — cała wstęga faluje w tempie
//                lokalnym; faza jest całką, więc zmiana BPM nie szarpie kształtem
//   cisza      = pasmo płaszczeje (amplituda -> 0) i kurczy się do nici
//   kolor      = złoty; przy wysokich/piskliwych dźwiękach jaśnieje (pitch + centroid)
//
// Zero fbm w alpha (jedwab to gładki gradient) i zero historii w teksturze —
// geometria jest sztywna, cała zmienność płynie w uniformach.
import * as THREE from "three";
import { PAL } from "./glsl.js";
import { sampleAt, clamp, damp } from "./data.js";

const SEGS = 320;      // segmenty wzdłuż X (~0.09 m na segment po zwężeniu)
const ACROSS = 8;      // segmenty w poprzek (falloff krawędzi)
const LAYERS = 3;
const BASE_Y = 4.4;    // tuż nad horyzontem, daleko za sferą
const BASE_Z = -28.0;
// Kadr na głębokości BASE_Z (16:9) ma pół szerokości 45 m. Wstęga zajmuje 1/3
// szerokości ekranu i stoi wyśrodkowana, więc jej pół-szerokość = 45/3 = 15 m.
const FRAME_HALF_X = 45.0;
const WIDTH_FRAC = 1 / 3;
const HALF_X = FRAME_HALF_X * WIDTH_FRAC;
const TAPER = 0.22;    // 22% długości z każdej strony rozpuszcza się w punkt:
                       // przy 12% koniec był widocznie ucięty, przy 30% wstęga
                       // wyglądała jak wrzeciono (pełne ciało tylko w środku)

const W_MIN = 0.16;    // cisza: cienka nić
const W_MAX = 4.6;     // pełny śpiew: masywny pas (6.6 m na 30-metrowej wstędze
                       // dawało pas grubości 1/5 długości — wyglądał jak wałek)

const s01 = (v) => v * v * (3.0 - 2.0 * v);   // smoothstep 0..1

const VERT = /* glsl */ `
uniform float uPhase;   // faza falowania — całkowana z lokalnego tempa utworu
uniform float uWidth;   // szerokość pasma [m] — z głośności wokalu
uniform float uPitchY;  // płytki kontur melodii [m]
uniform float uVoiced;  // brama frazy 0..1 (w ciszy 0 -> pasmo płaszczeje)
uniform float uLayer;
uniform float uHalfX;   // aktualna pół-szerokość wstęgi [m] — 1/3 szerokości okna
varying vec2 vUv;
varying vec3 vWorld;
varying float vTaper;
varying float vWide;

void main() {
  vUv = uv;
  // x skalujemy do aktualnej pół-szerokości: przy zmianie proporcji okna
  // wstęga trzyma 1/3 szerokości ekranu, a nie 1/3 z 16:9
  float x = position.x * (uHalfX / ${HALF_X.toFixed(1)});

  // taper symetryczny: 0 na obu końcach kadru, 1 w środku
  float ax = abs(x) / ${HALF_X.toFixed(1)};
  float tp = clamp((1.0 - ax) / ${TAPER.toFixed(3)}, 0.0, 1.0);
  float taper = tp * tp * (3.0 - 2.0 * tp);
  vTaper = taper;

  float w = uWidth * pow(taper, 0.70);
  // 0 = cienka nić, 1 = pełny pas (wygładzone, żeby przejście było ciągłe)
  float wide = clamp((w - ${W_MIN.toFixed(2)}) / ${(W_MAX - W_MIN).toFixed(2)}, 0.0, 1.0);
  wide = wide * wide * (3.0 - 2.0 * wide);
  vWide = wide;

  // falowanie CAŁEJ wstęgi: jedna faza (tempo), amplituda gaśnie w ciszy —
  // wtedy pasmo jest prostą linią, nie drgającą resztką
  float amp = uVoiced;
  float y = ${BASE_Y.toFixed(2)} + uPitchY + (uLayer - 1.0) * 0.12 * taper;
  // częstotliwości ×3: kształt fali był strojony na pasmo 90 m, a wstęga ma
  // teraz 30 m — bez tego cały przebieg mieścił się w 0.36 okresu i prostował
  // się w świecącą deskę
  y += sin(x * 0.225 + uPhase) * (0.20 + 2.00 * wide) * amp;
  y += sin(x * 0.570 - uPhase * 0.72 + 1.7) * (0.06 + 0.60 * wide) * amp;
  y += (uv.y - 0.5) * w;

  // marszczenie w głąb sceny — ta sama faza, też gaśnie w ciszy
  float zFold = (sin(x * 0.165 + uPhase * 0.55) * 2.2 * wide
               + sin(x * 0.390 - uPhase * 0.35 + 0.9) * 0.8 * wide) * amp;

  vec4 wp = modelMatrix * vec4(x, y, zFold, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uGlow;    // energia wokalu (RMSfast)
uniform float uVoiced;
uniform float uBright;  // 0..1 — wysokie/piskliwe dźwięki
uniform float uLayerAlpha;
uniform vec3 uGold, uGoldBright, uCream;
varying vec2 vUv;
varying vec3 vWorld;
varying float vTaper;
varying float vWide;
void main() {
  // miękki falloff poprzeczny (szeroki jednolity rdzeń)
  // (1.0 - smoothstep) zamiast smoothstep z odwróconymi krawędziami — tamten jest
  // niezdefiniowany w GLSL i potrafi dać NaN na sterownikach D3D
  float edge = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));

  // 5 cienkich podłużnych włókien połysku — gładkie, bez szumu
  float fib = pow(clamp(abs(sin(vUv.y * 3.14159 * 5.0)), 0.0, 1.0), 24.0);

  // pseudo-fresnel: krawędzie góra/dół łapią połysk.
  // cross() z pochodnych może wyjść zerowy (pasmo widziane brzegiem) — wtedy
  // normalize() daje NaN, a NaN w buforze HDR rozjeżdża się po mipach blooma
  // w czarne, prostokątne bloki. Dlatego długość z guardem.
  vec3 Nraw = cross(dFdx(vWorld), dFdy(vWorld));
  float Nlen = length(Nraw);
  vec3 N = Nlen > 1e-9 ? Nraw / Nlen : vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.6);

  // kolor: zawsze złoty; wysokie dźwięki dodają jasności (złoto -> jasne złoto
  // -> kremowe prześwity na włóknach), nigdy zimna biel
  vec3 tint = mix(uGold, uGoldBright, 0.75 * uBright);
  vec3 col = tint * (uGlow + 0.55 * uBright) * (0.82 + 0.30 * fib);
  col += uCream * fres * 0.10 * (0.25 + 0.75 * uVoiced);
  col += uCream * uBright * 0.28 * fib;

  // szeroki pas nie może wypalić kadru — jasność na piksel spada z polem powierzchni
  float alpha = edge * (0.05 + 0.95 * uVoiced) * uLayerAlpha;
  alpha *= pow(vTaper, 2.2);
  alpha *= mix(0.60, 0.40, vWide);
  gl_FragColor = vec4(col, alpha);
}
`;

export class VocalRibbon {
  constructor() {
    const geo = new THREE.PlaneGeometry(HALF_X * 2, 1, SEGS - 1, ACROSS - 1);
    this.group = new THREE.Group();
    this.group.position.set(0, 0, BASE_Z); // wyśrodkowana: końce na krawędziach kadru
    this.layerMats = [];
    const alphaByLayer = [0.26, 0.46, 0.26];
    for (let l = 0; l < LAYERS; l++) {
      const uniforms = {
        uPhase: { value: 0 },
        uLayer: { value: l },
        uHalfX: { value: HALF_X },
        uWidth: { value: W_MIN },
        uPitchY: { value: 0 },
        uVoiced: { value: 0 },
        uGlow: { value: 0.1 },
        uBright: { value: 0 },
        uLayerAlpha: { value: alphaByLayer[l] },
        uGold: { value: new THREE.Color(PAL.gold) },
        uGoldBright: { value: new THREE.Color(PAL.goldBright) },
        uCream: { value: new THREE.Color(PAL.cream) },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        extensions: { derivatives: true },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + l;
      this.group.add(mesh);
      this.layerMats.push(uniforms);
    }

    // wygładzenia — wszystko ciągłe, nic nie skacze na granicy ramki danych
    this.midiSmooth = 62;
    this.midiFast = 62;  // szybkie wygładzenie samej barwy (τ≈85 ms)
    this.centSmooth = 0.3;
    this.voicedSmooth = 0;
    this.rmsFast = 0;    // blask (τ≈100 ms)
    this.rmsW = 0;       // szerokość (τ≈330 ms)
    this.phase = 0;      // całka prędkości falowania [rad]
    this.bpmSmooth = 110;
    this.holdLeft = 0;   // brama frazy: krótka przerwa nie gasi wstęgi
    this.rmsPeak = 0;
    this.lastT = undefined;
  }

  // Wstęga ma zajmować 1/3 szerokości OKNA przy dowolnej proporcji: pół-szerokość
  // kadru na głębokości BASE_Z rośnie liniowo z aspectem (45 m dla 16:9), a wstęga
  // to jej trzecia część. Bez tego 21:9 zwężało ją poniżej 1/3, a pion rozdymał.
  resize(aspect) {
    const halfX = FRAME_HALF_X * (aspect / (16 / 9)) * WIDTH_FRAC;
    for (const u of this.layerMats) u.uHalfX.value = halfX;
  }

  // gain: 1 = wokal gra, 0 = ścieżka wyciszona w panelu → wstęga zjeżdża do nici
  update(t, track, dt, gain = 1) {
    const ts = t + 0.08; // lead 80 ms — kompensacja latencji
    // PAUZA: czas stoi, a dt z rAF leci dalej — bez tego falowanie i szerokość
    // dryfowałyby, gdy reszta sceny zamarza
    if (this.lastT !== undefined && Math.abs(t - this.lastT) < 1e-6) dt = 0;
    this.lastT = t;

    const midiT = sampleAt(track.vMidi, track.fps, ts);
    const probT = sampleAt(track.vProb, track.fps, ts) * gain;
    const rmsT = clamp(sampleAt(track.vRms, track.fps, ts) * gain, 0, 1);
    const centT = clamp(sampleAt(track.vCent, track.fps, ts) / (track.vCentP95 || 4000), 0, 1);
    const bpmT = sampleAt(track.tempo, track.fps, ts) || 110;

    // --- głośność -> szerokość i blask (dwa różne czasy wygaszania)
    this.rmsW = damp(this.rmsW, rmsT, 3.0, dt);
    this.rmsFast = damp(this.rmsFast, rmsT, 10.0, dt);

    // --- brama frazy: śpiewa -> trzymaj 0.9 s; cisza -> powolne wygaszanie (τ≈1.4 s)
    // bramujemy też energią: pyin deklaruje "voiced" także w ciszy (74 ramki
    // z prob>0.5 przy rms<0.02), a wtedy wstęga falowałaby bez dźwięku
    const energyGate = clamp((rmsT - 0.012) / 0.030, 0, 1);
    const voicedT = s01(clamp((probT - 0.04) / 0.24, 0, 1)) * energyGate;
    if (voicedT > 0.45) {
      this.holdLeft = 0.9;
      this.rmsPeak = Math.max(this.rmsPeak, rmsT);
    } else {
      this.holdLeft = Math.max(0, this.holdLeft - dt);
      this.rmsPeak *= Math.exp(-dt / 1.4);
    }
    const voicedIn = this.holdLeft > 0 ? 1 : voicedT;
    const rmsIn = Math.max(rmsT, this.rmsPeak);

    // voiced: attack 8, release 0.7 (τ≈1.4 s) — zanik frazy, nie trzask
    this.voicedSmooth = damp(
      this.voicedSmooth, voicedIn, voicedIn > this.voicedSmooth ? 8.0 : 0.7, dt
    );

    // --- melodia płytko w Y; tylko gdy wokal realnie brzmi (pyin w ciszy
    //     forward-filluje śmieci, od których pasmo uciekało do góry)
    if (probT > 0.35) {
      this.midiSmooth = damp(this.midiSmooth, midiT, 5.0, dt);
      this.midiFast = damp(this.midiFast, midiT, 12.0, dt);
    }
    this.centSmooth = damp(this.centSmooth, centT, 3.0, dt);

    // --- FALOWANIE: jedna faza dla całej wstęgi, prędkość z lokalnego tempa.
    // Całkujemy (a nie mnożymy czasu), więc zmiana BPM zmienia tempo fal, a nie
    // fazę — pasmo nie przeskakuje, gdy w danych tempo się zmienia.
    this.bpmSmooth = damp(this.bpmSmooth, bpmT, 1.5, dt);
    const tn = clamp((this.bpmSmooth - 85) / 95, 0, 1);
    this.phase += dt * (0.30 + 1.70 * s01(tn));

    // guard: NaN/Inf w danych nie ma prawa trafić do vertex shadera
    const fin = (v, fb) => (Number.isFinite(v) ? v : fb);

    // szerokość = głośność: cisza -> nić, pełny śpiew -> masywny pas
    // (rms śpiewu: mediana 0.53, p05 0.22 — wykładnik 0.8 daje 2..5 m)
    const loud = Math.pow(clamp(this.rmsW, 0, 1), 0.80);
    const width = fin(W_MIN + (W_MAX - W_MIN) * loud, W_MIN);
    const pitchY = fin(clamp((this.midiSmooth - 62.0) * 0.10, -1.3, 1.3), 0.0);
    // jasność: wysokie dźwięki (pitch) + piskliwość barwy (centroid); mediana
    // pitchu to 64.8, więc dopiero powyżej 64 głos zaczyna jaśnieć
    const bright = fin(clamp(
      (0.60 * clamp((this.midiFast - 64.0) / 14.0, 0, 1)
       + 0.40 * clamp((this.centSmooth - 0.25) / 0.60, 0, 1)) * this.voicedSmooth, 0, 1
    ), 0);
    const glow = fin(
      0.12 + 0.45 * this.rmsFast * (0.30 + 0.70 * this.voicedSmooth) + 0.10 * this.voicedSmooth,
      0.12
    );

    for (const u of this.layerMats) {
      u.uPhase.value = fin(this.phase, 0);
      u.uWidth.value = width;
      u.uPitchY.value = pitchY;
      u.uVoiced.value = this.voicedSmooth;
      u.uGlow.value = glow;
      u.uBright.value = bright;
    }

    // sonda weryfikacyjna (__viz): szerokość, kontur, jasność, tempo fal
    this.width = width;
    this.probe = {
      width, pitchY, bright, glow,
      voiced: this.voicedSmooth,
      rms: this.rmsW,
      bpm: this.bpmSmooth,
      phase: this.phase,
      hold: this.holdLeft,
    };
  }
}
