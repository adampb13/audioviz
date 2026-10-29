// System 1: ZIEMIA — ciemna, pomarszczona pustynia z koncentrycznymi falami od beatów.
// Audit P0-2: max 3 fale (gwarancja sprzętowa), 1 bit = 1 fala: wolna, długa, niska.
import * as THREE from "three";
import { NOISE_GLSL, FOG_GLSL, PAL } from "./glsl.js";

const MAX_WAVES = 2; // trzecia fala zabija najstarszą (audit v2 P0-A)

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[${MAX_WAVES}]; // x: t0, y: amp, z: speed, w: seed
varying vec3 vWorld;
varying float vCrest;   // dodatni grzbiet fali (do emissive)
varying float vWrinkle; // zmarszczki bazowe (do cieniowania)
varying float vDist;
${NOISE_GLSL}
void main() {
  vec3 p = position; // geometria już obrócona: y w górę, xz to plan podłogi
  float r = length(p.xz);

  // baza całkowicie gładka (audit v2 P0-A): jedna oktawa, niska
  float wr = fbm4(vec3(p.x * 0.03, uTime * 0.03, p.z * 0.03)) * 0.18;

  // fale od beatów: 1 front, wolny i szeroki, niski
  float hw = 0.0, crest = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    float amp = uWaves[i].y;
    if (amp < 0.001) continue;
    float age = uTime - uWaves[i].x;
    if (age < 0.0) continue;
    float front = age * uWaves[i].z; // 6 m/s, nie 12
    float d = r - front;
    float env = exp(-d * d * 0.02) * exp(-age * 0.7) * exp(-r * 0.012);
    float w = sin(d * 0.35);
    hw += amp * w * env;
    crest += amp * max(w, 0.0) * env;
  }

  p.y += wr + hw;
  vWrinkle = wr;
  vCrest = crest;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vDist = length(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCorePos;      // pozycja sfery-serca (światło kluczowe)
uniform float uCoreGlow;    // energia sfery 0..~1.2
uniform float uPulse;       // beatPulse 0..1
uniform vec3 uColLo, uColHi, uGold, uGoldBright;
varying vec3 vWorld;
varying float vCrest;
varying float vWrinkle;
varying float vDist;
${FOG_GLSL}
void main() {
  // normalna z pochodnych ekranowych — zmarszczki łapią światło bez liczenia normalnych CPU
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.y < 0.0) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uCorePos - vWorld);

  // baza: czekoladowy brąz, jaśniejsza na wypukłościach zmarszczek
  float shade = clamp(0.5 + vWrinkle * 1.4, 0.0, 1.0);
  vec3 base = mix(uColLo, uColHi, shade * 0.55);

  // światło sfery: matowe (roughness ~0.65) — ciasny zasięg, bez żółtej plamy
  float rCore = length(uCorePos.xz - vWorld.xz);
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 24.0);
  float att = 1.0 / (1.0 + rCore * rCore * 0.02);
  vec3 lit = base * (0.20 + diff * att * (0.30 + uCoreGlow * 0.5));
  lit += uGold * spec * att * (0.06 + uCoreGlow * 0.10);

  // jasna sadzawka pod sferą (owalna poświata z obrazu referencyjnego)
  float pool = exp(-rCore * rCore * 0.05) * (0.10 + uCoreGlow * 0.30 + uPulse * 0.18);
  lit += uGoldBright * pool * 0.14;

  // złoty emissive na grzbietach fal — #d9984a, bez bieli
  lit += uGold * smoothstep(0.02, 0.18, vCrest) * (0.5 + uCoreGlow * 0.5);

  lit = applyFog(lit, vDist);
  gl_FragColor = vec4(lit, 1.0);
}
`;

export class Ground {
  constructor(fogColor, fogDensity) {
    const geo = new THREE.PlaneGeometry(400, 400, 320, 320);
    geo.rotateX(-Math.PI / 2);
    this.waves = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 7, 0));
    this.waveI = 0;
    const c = (hex) => new THREE.Color(hex);
    this.uniforms = {
      uTime: { value: 0 },
      uWaves: { value: this.waves },
      uCorePos: { value: new THREE.Vector3(0, 0.4, 0) },
      uCoreGlow: { value: 0.4 },
      uPulse: { value: 0 },
      uColLo: { value: c(0x140c06) }, // baza #140c06 z auditu
      uColHi: { value: c(PAL.groundHi) },
      uGold: { value: c(PAL.gold) },
      uGoldBright: { value: c(PAL.goldBright) },
      uFogColor: { value: c(fogColor) },
      uFogDensity: { value: fogDensity },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      extensions: { derivatives: true },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  // t0 w czasie UTWORU; amp 0.12..0.22 MAX, nigdy 0.6 (audit v2); 6 m/s
  pushWave(t0, amp, speed = 6) {
    const w = this.waves[this.waveI];
    w.set(t0, Math.min(amp, 0.22), speed, 0);
    this.waveI = (this.waveI + 1) % MAX_WAVES;
  }

  update(t, energy, beatPulse) {
    this.uniforms.uTime.value = t;
    this.uniforms.uCoreGlow.value = energy;
    this.uniforms.uPulse.value = beatPulse;
  }
}
