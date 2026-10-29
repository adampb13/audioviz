// System 3: WSTĘGA WOKALU — szeroka, pozioma rzeka jedwabiu DALEKO za sferą
// (audit v2 P0-B: deska, nie trail). Sztywna geometria x -80..80, y=9, z=-28;
// szerokość z wygładzonego RMSslow (max ~3.3 m), jasność z RMSfast, kontur Y
// z pitch (płytko, +/-1.2 m). Zero fbm w alpha — jedwab to gładki gradient
// + 5 cienkich podłużnych włókien połysku. Bez wokalu: nić 0.3 m, alpha 0.08.
import * as THREE from "three";
import { PAL } from "./glsl.js";
import { sampleAt, clamp, damp } from "./data.js";

const SEGS = 256;    // segmenty wzdłuż X
const ACROSS = 8;    // segmenty w poprzek (falloff krawędzi)
const LAYERS = 3;
const BASE_Y = 4.2;  // niżej w kadrze: pasmo wisi tuż nad horyzontem, nie pod niebem
const BASE_Z = -28.0;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uLayer;
uniform float uWidth;   // stabilna szerokość pasma (m)
uniform float uPitchY;  // (midiSmooth-62)*0.10, płytki kontur
uniform float uVoiced;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  float x = position.x; // -80..80

  // szerokość -> siła zagięć: nić między frazami jest prosta, pełne pasmo faluje mocno
  // (wide 0..1 z uWidth 0.6..3.0 m; smoothstep, żeby przejście było ciągłe)
  float wide = clamp((uWidth - 0.6) / 2.4, 0.0, 1.0);
  wide = wide * wide * (3.0 - 2.0 * wide);
  float bendAmp = (0.18 + 1.85 * wide) * uVoiced;   // pionowe wędrowanie pasma
  float foldAmp = 2.6 * wide * uVoiced;             // zagięcia w głąb sceny (Z)

  float yBase = ${BASE_Y.toFixed(1)} + uPitchY + (uLayer - 1.0) * 0.15;
  yBase += sin(x * 0.13 + uTime * 0.35) * bendAmp;
  yBase += sin(x * 0.29 - uTime * 0.22 + 1.7) * bendAmp * 0.42;

  // zagięcia: pasmo podchodzi do kamery i odchodzi — jedwab marszczy się w głąb
  float zFold = sin(x * 0.07 + uTime * 0.19) * foldAmp
              + sin(x * 0.18 - uTime * 0.13 + 0.9) * foldAmp * 0.35;

  float y = yBase + (uv.y - 0.5) * uWidth;
  vec4 wp = modelMatrix * vec4(x, y, zFold, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uGlow;    // z RMSfast — jasność
uniform float uVoiced;
uniform float uCent;    // 0..1 — barwa bursztyn <-> krem
uniform float uLayerAlpha;
uniform vec3 uGold, uCream;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  // miękki falloff poprzeczny (szeroki jednolity rdzeń) + wygaśnięcie końców
  // (1.0 - smoothstep) zamiast smoothstep z odwróconymi krawędziami — tamten jest
  // niezdefiniowany w GLSL i potrafi dać NaN na sterownikach D3D
  float edge = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
  edge *= smoothstep(0.0, 0.02, vUv.x) * (1.0 - smoothstep(0.98, 1.0, vUv.x));

  // 5 cienkich podłużnych włókien połysku — gładkie, bez szumu
  float fib = pow(clamp(abs(sin(vUv.y * 3.14159 * 5.0)), 0.0, 1.0), 24.0);

  // pseudo-fresnel: krawędzie góra/dół łapią połysk.
  // cross() z pochodnych może wyjść zerowy (pasmo widziane brzegiem) — wtedy
  // normalize() daje NaN, a NaN w buforze HDR rozjeżdża się po mipach blooma
  // w czarne, prostokątne bloki. Dlatego długość z guardem i clamp na podstawie pow().
  vec3 Nraw = cross(dFdx(vWorld), dFdy(vWorld));
  float Nlen = length(Nraw);
  vec3 N = Nlen > 1e-9 ? Nraw / Nlen : vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.6);

  vec3 tint = mix(uGold, uCream, clamp(uCent * 0.5, 0.0, 0.6));
  vec3 col = tint * uGlow * (0.8 + 0.35 * fib);
  col += uCream * fres * 0.10 * (0.2 + 0.8 * uVoiced);
  col += uGold * (1.0 - uVoiced) * 0.15; // nić między frazami — cienka, ale widoczna

  // bez wokalu: nić alpha 0.08 — nie znika, nie wskakuje
  float alpha = edge * (0.08 + 0.92 * uVoiced) * uLayerAlpha;
  gl_FragColor = vec4(col, alpha);
}
`;

export class VocalRibbon {
  constructor() {
    const geo = new THREE.PlaneGeometry(160, 1, SEGS - 1, ACROSS - 1);
    this.group = new THREE.Group();
    this.group.position.set(0, 0, BASE_Z); // daleko za sferą, nad horyzontem
    this.layerMats = [];
    const alphaByLayer = [0.30, 0.55, 0.30];
    for (let l = 0; l < LAYERS; l++) {
      const uniforms = {
        uTime: { value: 0 },
        uLayer: { value: l },
        uWidth: { value: 0.3 },
        uPitchY: { value: 0 },
        uVoiced: { value: 0 },
        uGlow: { value: 0.1 },
        uCent: { value: 0.3 },
        uLayerAlpha: { value: alphaByLayer[l] },
        uGold: { value: new THREE.Color(PAL.gold) },
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
    // wygładzenia (audit v2): szerokość tylko z RMSslow, jasność z RMSfast
    this.midiSmooth = 62;
    this.voicedSmooth = 0;
    this.rmsFast = 0;
    this.rmsSlow = 0;
    // pamięć frazy: krótka przerwa oddechu/spółgłoski nie gasi wstęgi do zera
    this.holdLeft = 0;   // sekundy trzymania pełnej szerokości po ostatniej dźwięcznej ramce
    this.rmsPeak = 0;    // peak-hold energii (rozkład ~1.4 s)
  }

  update(t, track, dt) {
    const ts = t + 0.08; // lead 80 ms — kompensacja latencji
    const midiT = sampleAt(track.vMidi, track.fps, ts);
    const probT = sampleAt(track.vProb, track.fps, ts);
    const rmsT = sampleAt(track.vRms, track.fps, ts);
    const centT = clamp(sampleAt(track.vCent, track.fps, ts) / track.vCentP95, 0, 1);
    const voicedT = Math.min(1, Math.max(0, (probT - 0.04) / 0.24)); // smoothstep 0.04..0.28

    // --- brama frazy: śpiewa -> trzymaj 0.9 s; cisza -> powolne wygasanie (τ≈1.4 s)
    if (voicedT > 0.45) {
      this.holdLeft = 0.9;
      this.rmsPeak = Math.max(this.rmsPeak, rmsT);
    } else {
      this.holdLeft = Math.max(0, this.holdLeft - dt);
      this.rmsPeak *= Math.exp(-dt / 1.4);
    }
    const voicedIn = this.holdLeft > 0 ? 1 : voicedT;
    const rmsIn = Math.max(rmsT, this.rmsPeak);

    this.midiSmooth = damp(this.midiSmooth, midiT, 5.0, dt);
    // voiced: attack 12, release 0.7 (τ≈1.4 s) — zanik frazy, nie trzask
    this.voicedSmooth = damp(
      this.voicedSmooth, voicedIn, voicedIn > this.voicedSmooth ? 12.0 : 0.7, dt
    );
    this.rmsFast = damp(this.rmsFast, rmsIn, 12.0, dt);
    this.rmsSlow = damp(this.rmsSlow, rmsIn, 3.0, dt);

    // szerokość bazowa 2.5 m, modulacja tylko +/-1.0 m — bez pompowania
    // guard: NaN/Inf w danych nie ma prawa trafić do vertex shadera (rozwala
    // całą geometrię pasma w śmieci na ekranie)
    const fin = (v, fb) => (Number.isFinite(v) ? v : fb);
    const width = fin(0.3 + this.voicedSmooth * (1.8 + this.rmsSlow * 1.2), 0.3);
    const pitchY = fin(clamp((this.midiSmooth - 62.0) * 0.10, -1.2, 1.2), 0.0);
    const glow = fin(
      0.10 +
      0.45 * this.rmsFast * (0.30 + 0.70 * this.voicedSmooth) +
      0.10 * this.voicedSmooth,
      0.10
    );

    for (const u of this.layerMats) {
      u.uTime.value = fin(t, 0);
      u.uWidth.value = width;
      u.uPitchY.value = pitchY;
      u.uVoiced.value = this.voicedSmooth;
      u.uGlow.value = glow;
      u.uCent.value = centT;
    }
    // sonda weryfikacyjna (__viz): szerokość wstęgi i jej brama
    this.width = width;
    this.probe = { width, voiced: this.voicedSmooth, rms: this.rmsSlow, hold: this.holdLeft };
  }
}
