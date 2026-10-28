// Fala wokalna w tle (za sferą): wypełniona wstęga światła z jasną granią.
// Matematyka shadera w JEDNOSTKACH ŚWIATA (uPlaneH zamienia uv na metry),
// więc stałe skalują się razem z dopasowaniem płaszczyzny do frustumu.
//  - Widoczność (alpha) ∝ obecność wokalu (pitch_voiced_prob) — fala istnieje,
//    gdy ktoś śpiewa, i wygasa w partiach instrumentalnych,
//  - Wysokość (amplituda) ∝ barwa wokalu (centroid_hz),
//  - Jasność grani ∝ głośność wokalu (rms),
//  - Tempo falowania ∝ chwilowe tempo utworu (tempo_local_bpm, wokal),
//  - Kontura melodyczna: środek fali lekko unosi się z wysokością śpiewu (pitch_midi).
import * as THREE from "three";
import { damp, clamp } from "./data.js";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;   // czas falowania (przyspieszany tempem utworu w main.js)
uniform float uTimbre; // barwa wokalu 0..1.2 -> wysokość fali
uniform float uVoice;  // obecność wokalu 0..1 -> widoczność
uniform float uRms;    // głośność wokalu 0..1 -> jasność
uniform float uPitch;  // -1..1 wysokość tonu -> ułożenie fali
uniform float uPlaneH; // wysokość płaszczyzny w jednostkach świata

float curve(float x, float ph) {
  float c = sin(x * 3.1 + ph) * 0.55;
  c += sin(x * 6.7 - ph * 1.6 + 1.3) * 0.28;
  c += sin(x * 12.9 + ph * 0.6 + 4.1) * 0.14;
  c += sin(x * 1.7 - ph * 0.35 + 2.2) * 0.40;
  return c; // ~[-1.37, 1.37]
}

void main() {
  float x = vUv.x * 2.0 - 1.0;
  float yy = (vUv.y * 2.0 - 1.0) * uPlaneH * 0.5; // jednostki świata względem środka

  // wysokość fali ∝ barwa (doskonalsza głoska wyższa -> fala wyższa)
  float A = 0.35 + 0.85 * uTimbre * (0.35 + 0.65 * uVoice);
  float y0 = -1.65 + uPitch * 0.55;
  float ph = uTime * 1.9;
  float c = curve(x, ph);
  float crest = y0 + A * c;
  float base = -9.0; // dno głęboko poniżej kadru

  float edge = smoothstep(1.0, 0.72, abs(x));

  // wypełnione morze: od base do crest
  float fill = smoothstep(base, base + 0.8, yy) * (1.0 - smoothstep(crest - 0.10, crest + 0.02, yy));
  // jasna grania na kresie fali
  float glow = exp(-pow((yy - crest) * (1.6 + 0.9 / max(A, 0.2)), 2.0));
  float body = fill * 0.30 + glow * 0.85;

  // gradient barwy: przy grani jasny błękit, przy podstawie głęboki
  float hgt = clamp((yy - base) / max(crest - base, 1e-3), 0.0, 1.0);
  vec3 col = mix(vec3(0.05, 0.10, 0.22), vec3(0.45, 0.85, 1.0), hgt * hgt);

  float a = body * edge * uVoice;
  a *= smoothstep(-9.0, -6.0, yy); // morze miekko znika w dole kadru
  gl_FragColor = vec4(col * (0.75 + 0.6 * uRms), a);
}
`;

export class VocalWave {
  constructor(scene, { z = -6.5 }) {
    this.z = z;
    this.timbre = 0.25;
    this.voice = 0;
    this.pitch = 0;
    this.rms = 0;
    this.uniforms = {
      uTime: { value: 0 },
      uTimbre: { value: 0.25 },
      uVoice: { value: 0 },
      uRms: { value: 0 },
      uPitch: { value: 0 },
      uPlaneH: { value: 30 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5; // za aurorą (-10), przed sferą (0)
    this.mesh.position.set(0, 0, z);
    scene.add(this.mesh);
  }

  // dopasowanie rozmiaru płaszczyzny do frustumu kamery na tej głębokości
  // (wysokość z zapasem: kamera się kołysze, a dno ma wychodzić poza kadr)
  fit(camFovDeg, camDist, aspect) {
    const dist = camDist - this.z;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camFovDeg / 2)) * dist;
    const halfW = halfH * aspect;
    const H = halfH * 2 * 2.0;
    this.mesh.scale.set(halfW * 2 * 1.3, H, 1);
    this.uniforms.uPlaneH.value = H;
  }

  update(dt, t, { timbre, voice, rms, pitch }) {
    this.timbre = damp(this.timbre, clamp(timbre, 0, 1.2), 2.5, dt);
    this.voice = damp(this.voice, clamp(voice, 0, 1), 4, dt);
    this.pitch = damp(this.pitch, clamp(pitch, -1, 1), 3, dt);
    this.rms = damp(this.rms, clamp(rms, 0, 1), 6, dt);
    this.uniforms.uTime.value = t;
    this.uniforms.uTimbre.value = this.timbre;
    this.uniforms.uVoice.value = this.voice;
    this.uniforms.uRms.value = this.rms;
    this.uniforms.uPitch.value = this.pitch;
  }

  get crest() {
    return this.uniforms.uTimbre.value;
  }
}
