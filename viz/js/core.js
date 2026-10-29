// System 2: SFERA-SERCE — mały, ciepły żar wpół zagłębiony w ziemi (audit P0-1).
// Dwa sygnały: beatPulse (szybki bit) i energySmooth (wolna energia utworu).
// Nigdy czysta biel: bursztyn -> krem; pełny exposure tylko w kulminacji.
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform float uStructure; // 0..1 — mocno obecny bas: sfera dostaje płaty zamiast gładkiej kuli
varying vec3 vN;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec3 p = position;
  float n = snoise(normal * 2.5 + vec3(0.0, uTime * 0.6, 0.0));
  float n2 = snoise(normal * 6.0 - vec3(uTime * 0.35));
  p += normal * (n * 0.7 + n2 * 0.3) * uWobble;
  // STRUKTURA OD BASU: dwa niskoczęstotliwościowe płaty + żebra wzdłuż Y.
  // Gładka kula przy mocnym basie zmienia się w bryłę z wyraźnymi wybrzuszeniami
  // (do ±0.29 promienia), a przy cichym basie wraca do kuli.
  if (uStructure > 0.001) {
    float lobe = snoise(normal * 1.9 + vec3(uTime * 0.16, 0.0, uTime * 0.10));
    float rib = sin(normal.y * 7.0 + uTime * 1.5);
    p += normal * (lobe * 0.17 + rib * 0.05) * uStructure;
  }
  vN = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uEnergy;   // wolna energia 0..~1.15
uniform float uGain;     // 0.55 + energy*0.5 + beatPulse*0.25 (max ~1.4)
uniform float uHot;      // 0..1 z centroidu — przesuwa bursztyn ku kremowi
uniform float uFlash;    // 0..1 — impuls bitów stemu "inne"
uniform float uBassTint; // 0..1 — mocny bas: odcień w stronę miedzi
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);
  // nigdy czysta biel: bursztyn #7a3000 -> #ffcf8a (audit v2 P1).
  // hot jest CELOWO głębszy niż #ffcf8a: ACES odbarwia jasne barwy do bieli,
  // więc przy dużym żarze utrzymanie R>G>B wymaga niższego nasycenia podstawy.
  vec3 deep = vec3(0.478, 0.188, 0.0);
  vec3 hot = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.79, 0.50), uHot * 0.3);
  vec3 base = mix(deep, hot, clamp(uEnergy, 0.0, 1.0));
  // bas: ciemniejsza miedź, żeby struktura była czytelna jako zmiana MATERII
  base = mix(base, vec3(0.72, 0.27, 0.05), uBassTint * 0.5);
  // BŁYSK: ZMIANA KOLORU, nie dopalenie. Wędrujący pas przesuwa barwę
  // bursztyn -> krem; dodajemy tylko drobny highlight. Wcześniej błysk był
  // czysto addytywny i w kulminacji (duża sfera + halo + bloom) wypalał
  // środek do czystej bieli (zmierzone: 80% pikseli bez nasycenia).
  float sw = 0.5 + 0.5 * sin(N.y * 5.5 + N.x * 2.5 - uTime * 6.0);
  // tint CELOWO złoty, nie kremowy: krem odbarwia rdzeń do bieli (ACES), a błysk
  // ma być zmianą barwy — złoto -> jasne złoto, z jaśniejszym pasem przebiegającym
  vec3 flashTint = mix(vec3(1.0, 0.58, 0.16), vec3(1.0, 0.88, 0.62), sw);
  base = mix(base, flashTint, uFlash * (0.38 + 0.44 * sw));
  vec3 col = base * (0.7 + fres * 0.8) * uGain;
  col += vec3(1.0, 0.86, 0.60) * uFlash * 0.10 * sw;
  // miękki sufit 0.95 (nie 1.15): sfera ma zostać bursztynowa także w kulminacji
  col = 0.95 * tanh(col / 0.95);
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
  g.addColorStop(0.0, "rgba(255,193,116,0.20)"); // ciepłe, nie kremowe — halo nie bieli rdzenia
  g.addColorStop(0.35, "rgba(217,140,60,0.13)");
  g.addColorStop(1.0, "rgba(217,140,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CoreSphere {
  constructor() {
    const geo = new THREE.SphereGeometry(0.9, 96, 96);
    this.uniforms = {
      uTime: { value: 0 },
      uWobble: { value: 0.03 },
      uEnergy: { value: 0.4 },
      uGain: { value: 0.8 },
      uHot: { value: 0.5 },
      uFlash: { value: 0 },
      uStructure: { value: 0 },
      uBassTint: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 0.3, 0); // wkopana w ziemię — jak żar (audit v2 P1)

    // miękkie halo zamiast przepalonego dysku
    this.haloMat = new THREE.SpriteMaterial({
      map: haloTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.35,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(3.2);
    this.halo.renderOrder = 5;
    this.mesh.add(this.halo);

    // ziemia ma odbijać to światło, nie płonąć
    this.light = new THREE.PointLight(PAL.gold, 8, 60, 2);
    this.mesh.add(this.light);
  }

  // energySmooth: wolna energia (lambda~1.5-2); beatPulse: 1 przy beacie, gaśnie;
  // vocalWobble: rms*voiced_prob wokalu; hot: 0..1 z centroidu;
  // otherFlash: impuls bitów stemu "inne" (błysk koloru); bassTint: 0..1 obecność basu
  update(t, energySmooth, beatPulse, vocalWobble, hot, otherFlash = 0, bassTint = 0) {
    const e = Math.min(Math.max(energySmooth, 0), 1.15);
    // push = energia po potędze: 0.43 -> 0.30, 0.65 -> 0.55, 1.0 -> 1.0.
    // Sfera ma rosnąć WYRAŹNIE dopiero w kulminacji, a nie o 25% przez cały utwór.
    const push = Math.pow(Math.min(e, 1.0), 1.45);

    this.uniforms.uTime.value = t;
    this.uniforms.uWobble.value = 0.02 + vocalWobble * 0.1;
    this.uniforms.uEnergy.value = e;
    this.uniforms.uHot.value = hot;
    this.uniforms.uFlash.value = otherFlash;
    this.uniforms.uStructure.value = bassTint;
    this.uniforms.uBassTint.value = bassTint;
    // emissiveIntensity wg auditu v2 (cap 1.10: powyżej centrum czyta jako biel,
    // a zasada nadrzędna to "sfera bursztynowa — da się na nią patrzeć")
    this.uniforms.uGain.value = Math.min(
      0.5 + e * 0.85 + beatPulse * 0.22 + otherFlash * 0.15,
      0.95
    );
    // skala: 1.0 (cisza) -> 1.95 (kulminacja) + krótki puls na uderzenie bębna
    const sc = 1.0 + beatPulse * 0.10 + push * 0.85 + otherFlash * 0.04;
    this.mesh.scale.setScalar(sc);
    // halo rośnie z pierwiastkiem skali: przy 2x sferze poświata byłaby 2x
    // większa i po bloomie zalała cały basen mlekiem
    this.halo.scale.setScalar(3.2 / Math.sqrt(Math.max(sc, 0.5)));
    this.light.intensity = 6 + e * 10 + push * 9; // nie pali dziury w ziemi
    this.haloMat.opacity = 0.12 + e * 0.06 + beatPulse * 0.04 + otherFlash * 0.03;
  }
}
