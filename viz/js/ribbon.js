// WSTĘGA WOKALNA — główny, organiczny element kompozycji.
// Trójkątna taśma (strip) w płaszczyźnie XY, addytywna, pod bloom.
//  - wysokość Y każdego punktu  <- pitch_midi wokalu (kontur melodii z ostatnich ~3.5 s),
//  - grubość i emisja światła   <- rms_norm wokalu (cichy śpiew = cienka nić),
//  - przezroczystość            <- pitch_voiced_prob × wzmocnienie: wokalista milknie ->
//                                  dany fragment wstęgi rozpuszcza się w mroku.
// Geometria aktualizowana na CPU co klatkę (220 punktów — koszt pomijalny),
// dzięki temu szerokość i jasność są per-vertex, a krawędź jest miękka w shaderze.
import * as THREE from "three";
import { clamp } from "./data.js";

const VERT = /* glsl */ `
  attribute vec2 aData; // x: intensywność emisji, y: udział "gorącej" barwy
  varying vec2 vData;
  varying vec2 vUv;
  void main() {
    vData = aData;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uLow;   // głęboka miedź (cichy śpiew)
  uniform vec3 uHigh;  // rozgrzane złoto (krzyk)
  uniform float uGain;
  varying vec2 vData;
  varying vec2 vUv;
  void main() {
    float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float soft = edge * edge * (3.0 - 2.0 * edge); // miękka krawędź taśmy
    float glow = vData.x * soft;
    vec3 col = mix(uLow, uHigh, clamp(vData.y, 0.0, 1.0)) * glow * uGain;
    gl_FragColor = vec4(col, glow);
  }`;

export class VocalRibbon {
  constructor(scene, {
    n = 220,          // punkty taśmy
    window = 3.5,     // ile sekund melodii widać naraz
    width = 15.0,     // rozpiętość X w jednostkach świata
    y0 = 2.55,        // środek wstęgi na osi Y
    yRange = 1.55,    // amplituda Y dla skrajnych tonów
  } = {}) {
    this.n = n;
    this.window = window;
    this.width = width;
    this.y0 = y0;
    this.yRange = yRange;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.data = new Float32Array(n * 2 * 2);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      uv[i * 4 + 0] = i / (n - 1); uv[i * 4 + 1] = 0; // dolna krawędź
      uv[i * 4 + 2] = i / (n - 1); uv[i * 4 + 3] = 1; // górna krawędź
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aData", new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

    this.meshU = {
      uLow: { value: new THREE.Color(0x7a2e08) },
      uHigh: { value: new THREE.Color(0xffd9a0) },
      uGain: { value: 1.55 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.meshU,
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    this.voice = 0; // wygładzona obecność wokalu (do HUD/probe)
    this.rms = 0;
    this.midi = 60;
  }

  // t — czas utworu; voiceGain — kalibracja pitch_voiced_prob (mediana ~0.15)
  update(t, track, voiceGain) {
    const { n, window: win, width } = this;
    const midRef = (track.vMidiLo + track.vMidiHi) / 2;
    const halfRef = Math.max((track.vMidiHi - track.vMidiLo) / 2, 2.5);

    let headVoice = 0;
    for (let i = 0; i < n; i++) {
      const xNorm = i / (n - 1);
      const age = (1 - xNorm) * win;      // prawy brzeg = teraz, lewy = przeszłość
      const ti = t - age;
      const valid = ti >= 0;
      const f = track.frameAt(Math.max(0, ti));

      const midi = track.at(track.vMidi, f);
      const rms = valid ? track.at(track.vRms, f) : 0;
      const voiced = valid ? clamp(track.at(track.vProb, f) * voiceGain, 0, 1) : 0;

      // kontur melodyczny + delikatny, powolny dryf organiczny
      const yN = clamp((midi - midRef) / halfRef, -1, 1);
      const sway = Math.sin(t * 0.45 + xNorm * 5.2) * 0.06 * (0.25 + voiced);
      const y = this.y0 + yN * this.yRange + sway;
      const z = Math.sin(t * 0.3 + xNorm * 3.1) * 0.22;
      const x = -width / 2 + xNorm * width;

      // grubość ∝ głośność; cicha fraza -> cienka nić
      const wHalf = 0.058 * (0.30 + 2.6 * rms) * (0.40 + 0.60 * voiced);
      // emisja ∝ głośność × obecność; przeszłość gaśnie łagodnie
      const ageFade = Math.pow(1 - age / win, 0.8);
      const inten = (0.45 + 3.2 * rms) * voiced * ageFade;
      const heat = clamp(rms * 1.6, 0, 1);

      const o6 = i * 6;
      this.pos[o6 + 0] = x; this.pos[o6 + 1] = y - wHalf; this.pos[o6 + 2] = z;
      this.pos[o6 + 3] = x; this.pos[o6 + 4] = y + wHalf; this.pos[o6 + 5] = z;
      const o4 = i * 4;
      this.data[o4 + 0] = inten; this.data[o4 + 1] = heat;
      this.data[o4 + 2] = inten; this.data[o4 + 3] = heat;

      if (i === n - 1) {
        headVoice = voiced;
        this.rms = rms;
        this.midi = midi;
      }
    }
    this.voice = headVoice;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aData.needsUpdate = true;
  }
}
