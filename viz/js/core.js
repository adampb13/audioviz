// System 2: SFERA-SERCE — mały, ciepły żar wpół zagłębiony w ziemi (audit P0-1).
// Dwa sygnały: beatPulse (szybki bit) i energySmooth (wolna energia utworu).
// Nigdy czysta biel: bursztyn -> krem; pełny exposure tylko w kulminacji.
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWobble;
varying vec3 vN;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec3 p = position;
  float n = snoise(normal * 2.5 + vec3(0.0, uTime * 0.6, 0.0));
  float n2 = snoise(normal * 6.0 - vec3(uTime * 0.35));
  p += normal * (n * 0.7 + n2 * 0.3) * uWobble;
  vN = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uEnergy; // wolna energia 0..~1.15
uniform float uGain;   // 0.55 + energy*0.5 + beatPulse*0.25 (max ~1.4)
uniform float uHot;    // 0..1 z centroidu — przesuwa bursztyn ku kremowi
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  // nigdy czysta biel: bursztyn #7a3000 -> #ffcf8a (audit v2 P1)
  vec3 deep = vec3(0.478, 0.188, 0.0);
  vec3 hot = mix(vec3(1.0, 0.812, 0.541), vec3(1.0, 0.85, 0.62), uHot * 0.3);
  vec3 base = mix(deep, hot, clamp(uEnergy, 0.0, 1.0));
  vec3 col = base * (0.7 + fres * 0.8) * uGain;
  // miękki sufit: po stacku z halo+bloom nigdy nie dobija do czystej bieli
  col = 1.15 * tanh(col / 1.15);
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

export class CoreSphere {
  constructor() {
    const geo = new THREE.SphereGeometry(0.9, 96, 96);
    this.uniforms = {
      uTime: { value: 0 },
      uWobble: { value: 0.03 },
      uEnergy: { value: 0.4 },
      uGain: { value: 0.8 },
      uHot: { value: 0.5 },
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
  // vocalWobble: rms*voiced_prob wokalu; hot: 0..1 z centroidu
  update(t, energySmooth, beatPulse, vocalWobble, hot) {
    this.uniforms.uTime.value = t;
    this.uniforms.uWobble.value = 0.02 + vocalWobble * 0.1;
    this.uniforms.uEnergy.value = energySmooth;
    this.uniforms.uHot.value = hot;
    // emissiveIntensity wg auditu v2 (cap 1.35: powyżej centrum czyta jako biel,
    // a zasada nadrzędna to "sfera bursztynowa — da się na nią patrzeć")
    this.uniforms.uGain.value = Math.min(
      0.5 + energySmooth * 1.2 + beatPulse * 0.3,
      1.35
    );
    this.mesh.scale.setScalar(1.0 + beatPulse * 0.12 + energySmooth * 0.25);
    this.light.intensity = 6 + energySmooth * 18; // nie pali dziury w ziemi
    this.haloMat.opacity = 0.12 + energySmooth * 0.1 + beatPulse * 0.06;
  }
}
