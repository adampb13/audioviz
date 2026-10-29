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
const BASE_Y = 9.0;
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
  float yBase = ${BASE_Y.toFixed(1)} + uPitchY;
  yBase += sin(x * 0.15 + uTime * 0.4) * 0.35 * uVoiced;
  yBase += (uLayer - 1.0) * 0.15;
  float y = yBase + (uv.y - 0.5) * uWidth;
  vec4 wp = modelMatrix * vec4(x, y, 0.0, 1.0);
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
  float edge = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
  edge *= smoothstep(0.0, 0.02, vUv.x) * smoothstep(1.0, 0.98, vUv.x);

  // 5 cienkich podłużnych włókien połysku — gładkie, bez szumu
  float fib = pow(abs(sin(vUv.y * 3.14159 * 5.0)), 24.0);

  // pseudo-fresnel: krawędzie góra/dół łapią połysk
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 1.6);

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
    const width = 0.3 + this.voicedSmooth * (1.8 + this.rmsSlow * 1.2);
    const pitchY = clamp((this.midiSmooth - 62.0) * 0.10, -1.2, 1.2);
    const glow =
      0.10 +
      0.45 * this.rmsFast * (0.30 + 0.70 * this.voicedSmooth) +
      0.10 * this.voicedSmooth;

    for (const u of this.layerMats) {
      u.uTime.value = t;
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
