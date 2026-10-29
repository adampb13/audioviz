// System 3: WSTĘGA WOKALU — strumień jedwabiu, który LECI od prawej do lewej.
//
// Geometria jest sztywna (x -114..+30, z=-28), ale KAŻDA KOLUMNA pokazuje wokal
// z innego momentu: bufor historii 256 próbek @20 Hz (okno 12.75 s) leci do
// tekstury 256x1 (RGBA float) i jest próbkowany w vertex shaderze.
//   R = pitch_midi  -> Y: melodia 1:1 (52..81 -> 1.6..18.0 m, 0.5 m na półton)
//   G = szerokość [m] (rms_norm + brama frazy: 0.14 m laser .. 10 m pas)
//   B = centroid 0..1 -> barwa: złoto (ciemny śpiew) -> krem -> biel (przegrzanie)
//   A = wobble 0..1 (tempo_local_bpm x ruchliwość melodii) -> siła falowania
// Przesunięcie w czasie jest ciągłe (uShift = ufraction texela), więc strumień płynie
// gładko, a nie skokowo co 50 ms. Głowa pasma (najnowsza próbka) leży W KADRZE
// (x=+30) i rozpuszcza się w punkt przez taper — wstęga zaczyna się na ekranie.
import * as THREE from "three";
import { PAL } from "./glsl.js";
import { sampleAt, clamp, damp } from "./data.js";

const SEGS = 320;      // segmenty wzdłuż X (~0.45 m na segment)
const ACROSS = 8;      // segmenty w poprzek (falloff krawędzi)
const LAYERS = 3;
const BASE_Z = -28.0;

const X_LEN = 144.0;   // długość pasma w świecie
const HEAD_X = 30.0;   // x głowy (najnowsza próbka) — wewnątrz kadru (±46)
const TAPER = 0.13;    // 13% długości (≈19 m, ~1.7 s) rozpuszczania się końcówki

const HIST_N = 256;
const HIST_STEP = 0.05;                  // 20 Hz
const WINDOW = (HIST_N - 1) * HIST_STEP;  // 12.75 s historii w kadrze

const PITCH_LO = 52.0;   // ~E3 — dolne partie piersiowe
const PITCH_HI = 81.0;   // ~A5 — falset/krzyk
const Y_LO = 1.6;        // nad horyzontem, żeby laser nie leżał na linii gór
const Y_HI = 18.0;       // wysoko w kadrze
const Y_PER_SEMI = (Y_HI - Y_LO) / (PITCH_HI - PITCH_LO); // 0.5 m na półton

const W_MIN = 0.14;      // laser
const W_MAX = 10.0;      // masywny pas na cały kadr

const VERT = /* glsl */ `
uniform sampler2D uHist;
uniform float uShift;   // (t - tNewest)/HIST_STEP, w texelach [0,1)
uniform float uSpan;    // HIST_N - 1
uniform float uN;       // HIST_N
uniform float uLayer;
uniform float uPhaseY;  // zintegrowana faza (tempo) — bez szarpnięcia przy zmianie BPM
uniform float uPhaseZ;
uniform float uVoiced;
varying vec2 vUv;
varying vec3 vWorld;
varying float vCen;
varying float vWob;
varying float vWidth;
varying float vTaper;

// u = 0 -> najstarsza próbka (lewa krawędź), u = 1 -> teraz (prawa krawędź)
vec4 histAt(float u) {
  float i = clamp(u * uSpan - uShift, 0.0, uSpan);
  float i0 = floor(i);
  float f = i - i0;
  float i1 = min(i0 + 1.0, uSpan);
  vec4 a = texture2D(uHist, vec2((i0 + 0.5) / uN, 0.5));
  vec4 b = texture2D(uHist, vec2((i1 + 0.5) / uN, 0.5));
  return mix(a, b, f);
}

void main() {
  vUv = uv;
  float x = position.x;

  vec4 S = histAt(uv.x);
  float pitch = S.r;
  float width = S.g;
  float cen = S.b;
  float wob = S.a;
  vCen = cen;
  vWob = wob;

  // 0. taper głowy: pasmo rozpuszcza się w punkt, z którego wypływa (smoothstep).
  //    Obejmuje szerokość, falowanie i jasność — inaczej końcówka to ucięta rura.
  float tp = clamp((1.0 - uv.x) / ${TAPER.toFixed(3)}, 0.0, 1.0);
  float taper = tp * tp * (3.0 - 2.0 * tp);
  vTaper = taper;
  float wT = width * taper;
  vWidth = wT;

  // 1. melodia: Y wprost z pitch_midi (niskie partie schodzą, falset unosi)
  float yMel = ${Y_LO.toFixed(2)} + (clamp(pitch, ${PITCH_LO.toFixed(1)}, ${PITCH_HI.toFixed(1)}) - ${PITCH_LO.toFixed(1)}) * ${Y_PER_SEMI.toFixed(4)};

  // 2. falowanie: drobna fala w Y (melodia zostaje czytelna) + duże marszczenie w Z
  float wn = clamp(wT / ${W_MAX.toFixed(1)}, 0.0, 1.0);
  float ripple = sin(x * 0.50 + uPhaseY) * (0.05 + 0.22 * wob);
  float fold = (sin(x * 0.10 + uPhaseZ) * (0.35 + 1.70 * wn) * wob
             + sin(x * 0.25 - uPhaseZ * 1.3 + 0.9) * (0.15 + 0.80 * wn) * wob) * taper;

  // 3. przekrój: grubość = głośność; warstwy rozsuwają się proporcjonalnie
  float h = uv.y - 0.5;
  float y = yMel + ripple * taper + h * wT + (uLayer - 1.0) * wT * 0.10;

  vec4 wp = modelMatrix * vec4(x, y, fold, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uGlow;
uniform float uVoiced;
uniform float uLayerAlpha;
uniform vec3 uGold, uCream, uWhite;
varying vec2 vUv;
varying vec3 vWorld;
varying float vCen;
varying float vWob;
varying float vWidth;
varying float vTaper;
void main() {
  // miękki falloff poprzeczny + wygaśnięcie obu końców pasma
  // (1.0 - smoothstep) zamiast smoothstep z odwróconymi krawędziami — tamten jest
  // niezdefiniowany w GLSL i potrafi dać NaN na sterownikach D3D
  float edge = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
  edge *= smoothstep(0.0, 0.03, vUv.x) * (1.0 - smoothstep(0.985, 1.0, vUv.x));

  // 5 cienkich podłużnych włókien połysku — gładkie, bez szumu
  float fib = pow(clamp(abs(sin(vUv.y * 3.14159 * 5.0)), 0.0, 1.0), 24.0);

  // pseudo-fresnel; cross() z pochodnych może wyjść zerowy (pasmo widziane brzegiem)
  vec3 Nraw = cross(dFdx(vWorld), dFdy(vWorld));
  float Nlen = length(Nraw);
  vec3 N = Nlen > 1e-9 ? Nraw / Nlen : vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.6);

  // barwa: złoto (ciemny, piersiowy śpiew) -> krem -> biel (jasny głos / krzyk)
  vec3 tint = mix(uGold, uCream, smoothstep(0.20, 0.75, vCen));
  tint = mix(tint, uWhite, smoothstep(0.70, 1.00, vCen));

  vec3 col = tint * uGlow * (0.80 + 0.35 * fib);
  col += uWhite * fres * (0.08 + 0.22 * vCen) * (0.2 + 0.8 * uVoiced);

  // szeroki pas nie może wypalić kadru — jasność na piksel spada z polem powierzchni
  float wn = clamp(vWidth / ${W_MAX.toFixed(1)}, 0.0, 1.0);
  // baza 0.02: w ciszy wstęgi po prostu nie ma (0.12 zostawiało cienką jasną
  // linię na linii horyzontu, czytaną jak artefakt)
  float alpha = edge * (0.02 + 0.98 * uVoiced) * uLayerAlpha * mix(0.62, 0.50, wn) * vTaper;
  gl_FragColor = vec4(col, alpha);
}
`;

export class VocalRibbon {
  constructor() {
    const geo = new THREE.PlaneGeometry(X_LEN, 1, SEGS - 1, ACROSS - 1);
    this.group = new THREE.Group();
    // głowa pasma (uv.x = 1) wypada w x = HEAD_X, czyli WEWNĄTRZ kadru
    this.group.position.set(HEAD_X - X_LEN / 2, 0, BASE_Z);

    // bufor historii: R=pitch, G=width[m], B=centroid 0..1, A=wobble 0..1
    this.hist = new Float32Array(HIST_N * 4);
    for (let i = 0; i < HIST_N; i++) this.writeSlot(i, 62, W_MIN, 0.3, 0);
    const tex = new THREE.DataTexture(this.hist, HIST_N, 1, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.tex = tex;

    this.layerMats = [];
    const alphaByLayer = [0.22, 0.40, 0.22];
    for (let l = 0; l < LAYERS; l++) {
      const uniforms = {
        uHist: { value: tex },
        uShift: { value: 0 },
        uSpan: { value: HIST_N - 1 },
        uN: { value: HIST_N },
        uLayer: { value: l },
        uPhaseY: { value: 0 },
        uPhaseZ: { value: 0 },
        uVoiced: { value: 0 },
        uGlow: { value: 0.1 },
        uLayerAlpha: { value: alphaByLayer[l] },
        uGold: { value: new THREE.Color(PAL.gold) },
        uCream: { value: new THREE.Color(PAL.cream) },
        uWhite: { value: new THREE.Color(1.0, 0.985, 0.96) },
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

    // wygładzenia
    this.midiSmooth = 62;
    this.prevMidi = 62;
    this.voicedSmooth = 0;
    this.rmsFast = 0;
    this.rmsSlow = 0;
    this.centSmooth = 0.3;
    this.pitchVel = 0;
    // pamięć frazy: krótka przerwa oddechu nie gasi wstęgi do zera
    this.holdLeft = 0;
    this.rmsPeak = 0;
    this.rmsW = 0;
    // strumień
    this.acc = HIST_STEP; // pierwsza próbka od razu
    this.shift = 0;
    this.phaseY = 0;
    this.phaseZ = 0;
    this.tempoNorm = 0.4;
    this.wob = 0;
    this.width = W_MIN;
    this.probe = { width: W_MIN, pitch: 62, cen: 0.3, wob: 0, voiced: 0, bpm: 120, span: WINDOW };
  }

  writeSlot(i, pitch, width, cen, wob) {
    const o = i * 4;
    this.hist[o] = Number.isFinite(pitch) ? pitch : 62;
    this.hist[o + 1] = Number.isFinite(width) ? width : W_MIN;
    this.hist[o + 2] = Number.isFinite(cen) ? cen : 0.3;
    this.hist[o + 3] = Number.isFinite(wob) ? wob : 0;
  }

  // nowa próbka wchodzi z prawej, najstarsza wypada z lewej
  pushSample(pitch, width, cen, wob) {
    this.hist.copyWithin(0, 4);
    this.writeSlot(HIST_N - 1, pitch, width, cen, wob);
    this.tex.needsUpdate = true;
  }

  // zapełnienie historii prawdziwą przeszłością (po seeku / na starcie utworu)
  prefill(ts, track) {
    const fps = track.fps;
    const P = new Float32Array(HIST_N), R = new Float32Array(HIST_N);
    const C = new Float32Array(HIST_N), B = new Float32Array(HIST_N), V = new Float32Array(HIST_N);
    for (let i = 0; i < HIST_N; i++) {
      const tt = ts - (HIST_N - 1 - i) * HIST_STEP;
      P[i] = sampleAt(track.vMidi, fps, tt);
      V[i] = sampleAt(track.vProb, fps, tt);
      R[i] = clamp(sampleAt(track.vRms, fps, tt), 0, 1);
      C[i] = clamp((sampleAt(track.vCent, fps, tt) - 1200) / 3800, 0, 1);
      B[i] = sampleAt(track.tempo, fps, tt) || 120;
    }
    // pitch tylko tam, gdzie wokal realnie brzmi. W ciszy pyin forward-filluje
    // ostatnią (często błędną) wartość — 76.7 przez 7 s ciszy to cienka jasna
    // linia wysoko w kadrze, czytana jak druga linia horyzontu. Zamiast tego
    // wątek "pamięta" najbliższą wyśpiewaną nutę.
    for (let i = 0; i < HIST_N; i++) P[i] = V[i] >= 0.3 ? P[i] : NaN;
    for (let i = 0; i < HIST_N; i++) {
      if (!Number.isNaN(P[i])) continue;
      let pick = NaN;
      for (let j = i + 1; j < Math.min(HIST_N, i + 60); j++) if (!Number.isNaN(P[j])) { pick = P[j]; break; }
      if (Number.isNaN(pick)) for (let j = i - 1; j >= Math.max(0, i - 60); j--) if (!Number.isNaN(P[j])) { pick = P[j]; break; }
      P[i] = Number.isNaN(pick) ? 62 : pick;
    }
    for (let i = 0; i < HIST_N; i++) {
      // pitch: MEDIANA 5 próbek — usuwa pojedyncze skoki pyin (kolec w pasmie),
      // a zachowuje prawdziwe skoki melodii; rms/centroid: średnia (chcą być gładkie)
      const win = [];
      let sr = 0, sc = 0, k = 0;
      for (let j = -2; j <= 2; j++) {
        const q = i + j;
        if (q < 0 || q >= HIST_N) continue;
        win.push(P[q]); sr += R[q]; sc += C[q]; k++;
      }
      win.sort((a, b) => a - b);
      // mediana usuwa kolec, 3-punktowa średnia (100 ms) wyrównuje resztkowe
      // piłowanie pyin — bez niej cienka nić w cichych partiach rysuje się
      // jako linia kreskowana (sąsiednie kolumny skaczą o pół tonu)
      const pm = win[win.length >> 1];
      const p0 = i > 0 && !Number.isNaN(P[i - 1]) ? P[i - 1] : pm;
      const p2 = i + 1 < HIST_N ? P[i + 1] : pm;
      const p = (p0 + 2 * pm + p2) / 4, r = sr / k, c = sc / k;
      const vel = Math.abs(p - P[Math.max(0, i - 5)]) / (5 * HIST_STEP); // 250 ms okno
      const act = clamp(vel / 10.0, 0, 1);
      const tn = clamp((B[i] - 85.0) / (171.0 - 85.0), 0, 1);
      const wob = clamp((0.30 + 0.70 * tn) * (0.25 + 0.75 * act), 0, 1) * 0.85;
      const w = clamp(W_MIN + (W_MAX - W_MIN) * Math.pow(r, 1.3), W_MIN, W_MAX);
      this.writeSlot(i, p, w, c, wob);
    }
    this.tex.needsUpdate = true;
    this.acc = HIST_STEP;
    this.shift = 0;
  }

  update(t, track, dt) {
    const ts = t + 0.08; // lead 80 ms — kompensacja latencji
    // PAUZA: czas stoi, a dt z rAF leci dalej. Bez tego strumień sunąłby dalej
    // w lewo i wstęga "uciekała" na pauzie, podczas gdy reszta sceny zamarza.
    if (this.lastT !== undefined && Math.abs(t - this.lastT) < 1e-6) dt = 0;
    // skok w czasie (start utworu, seek, demo) -> zapełnij historię prawdziwą
    // przeszłością, inaczej lewa część pasma to przez chwilę sama cisza
    if (this.lastT === undefined || Math.abs(t - this.lastT) > 1.0) this.prefill(ts, track);
    this.lastT = t;
    const midiT = sampleAt(track.vMidi, track.fps, ts);
    const probT = sampleAt(track.vProb, track.fps, ts);
    const rmsT = sampleAt(track.vRms, track.fps, ts);
    // centroid_hz: 1200 Hz (ciemna klatka piersiowa) .. 5000 Hz (krzyk) -> 0..1
    const centT = clamp((sampleAt(track.vCent, track.fps, ts) - 1200) / 3800, 0, 1);
    const bpm = sampleAt(track.tempo, track.fps, ts) || 120;
    const voicedT = clamp((probT - 0.04) / 0.24, 0, 1);

    // --- brama frazy: śpiewa -> trzymaj 0.9 s; cisza -> wygaszanie tau=1.4 s
    if (voicedT > 0.45) {
      this.holdLeft = 0.9;
      this.rmsPeak = Math.max(this.rmsPeak, rmsT);
    } else {
      this.holdLeft = Math.max(0, this.holdLeft - dt);
      this.rmsPeak *= Math.exp(-dt / 1.4);
    }
    const voicedIn = this.holdLeft > 0 ? 1 : voicedT;
    const rmsIn = Math.max(rmsT, this.rmsPeak);

    // Y śledzi melodię TYLKO gdy wokal realnie brzmi — pyin w ciszy podaje
    // forward-fillowane śmieci (np. 76.7), od których wstęga ucieka pod sufit
    if (probT > 0.35) this.midiSmooth = damp(this.midiSmooth, midiT, 12.0, dt);
    this.voicedSmooth = damp(this.voicedSmooth, voicedIn, voicedIn > this.voicedSmooth ? 12.0 : 0.7, dt);
    this.rmsFast = damp(this.rmsFast, rmsIn, 12.0, dt);
    this.rmsSlow = damp(this.rmsSlow, rmsIn, 3.0, dt);
    this.centSmooth = damp(this.centSmooth, centT, 2.5, dt);

    // tempo lokalne -> 0..1 (85..171 BPM)
    this.tempoNorm = clamp((bpm - 85.0) / (171.0 - 85.0), 0, 1);
    // ruchliwość melodii: przeciągane słowo -> 0 (wstęga się prostuje), szybkie słowa -> 1
    const vel = Math.abs(this.midiSmooth - this.prevMidi) / Math.max(dt, 1e-3);
    this.pitchVel = damp(this.pitchVel, vel, 4.0, dt);
    this.prevMidi = this.midiSmooth;
    const act = clamp(this.pitchVel / 10.0, 0, 1);
    this.wob = clamp((0.30 + 0.70 * this.tempoNorm) * (0.25 + 0.75 * act) * this.voicedSmooth, 0, 1);

    // fazy integrowane — zmiana tempa nie może szarpnąć falą
    const spd = (0.6 + 2.4 * this.tempoNorm) * (0.6 + 0.4 * this.wob);
    this.phaseY += dt * spd;
    this.phaseZ += dt * spd * 0.8;

    // szerokość: laser 0.14 m -> masywny pas 10 m (rms_norm^1.3)
    // rmsW (tau≈250 ms) — bez tego wygładzenia każde wejście słowa rozjeżdża pasmo
    // jak trąbka: pionowa ściana w połowie kadru
    this.rmsW = damp(this.rmsW, clamp(rmsIn, 0, 1), 4.0, dt);
    const rmsForW = clamp(this.rmsW, 0, 1);
    const width = clamp(
      W_MIN + (W_MAX - W_MIN) * Math.pow(rmsForW, 1.3) * (0.45 + 0.55 * this.voicedSmooth),
      W_MIN, W_MAX
    );
    const glow = clamp(
      0.10 + 0.45 * this.rmsFast * (0.30 + 0.70 * this.voicedSmooth) + 0.08 * this.voicedSmooth,
      0.05, 0.75
    );

    // strumień 20 Hz: dopisz tyle próbek, ile minęło (po pauzie nie zalewaj bufora)
    this.acc += dt;
    if (this.acc > HIST_STEP * 8) this.acc = HIST_STEP * 8;
    while (this.acc >= HIST_STEP) {
      this.acc -= HIST_STEP;
      this.pushSample(this.midiSmooth, width, this.centSmooth, this.wob);
    }
    this.shift = clamp(this.acc / HIST_STEP, 0, 1);

    const fin = (v, fb) => (Number.isFinite(v) ? v : fb);
    for (const u of this.layerMats) {
      u.uHist.value = this.tex;
      u.uShift.value = this.shift;
      u.uPhaseY.value = fin(this.phaseY, 0);
      u.uPhaseZ.value = fin(this.phaseZ, 0);
      u.uVoiced.value = this.voicedSmooth;
      u.uGlow.value = glow;
    }

    this.width = width;
    this.probe = {
      width, pitch: this.midiSmooth, cen: this.centSmooth, wob: this.wob,
      voiced: this.voicedSmooth, bpm, span: WINDOW, shift: this.shift,
    };
  }
}
