// System 1: ZIEMIA — ciemna, pomarszczona pustynia z koncentrycznymi falami od beatów.
// Fale: kolejka max 8 aktywnych { t0, amp, speed } w uniformach; pushWave tylko na zdarzenie.
import * as THREE from "three";
import { NOISE_GLSL, FOG_GLSL, PAL } from "./glsl.js";

const MAX_WAVES = 8;

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

  // delikatne zmarszczki jedwabnego piasku
  float wr = fbm4(vec3(p.x * 0.08, uTime * 0.05, p.z * 0.08)) * 0.4;
  wr += fbm4(vec3(p.x * 0.35, uTime * 0.03 + 7.0, p.z * 0.35)) * 0.08;

  // fale od beatów
  float hw = 0.0, crest = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    float amp = uWaves[i].y;
    if (amp < 0.001) continue;
    float age = uTime - uWaves[i].x;
    if (age < 0.0) continue;
    float front = age * uWaves[i].z;
    float d = r - front;
    float env = exp(-d * d * 0.15) * exp(-age * 1.2) * exp(-r * 0.02);
    float w = sin(d * 2.5);
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

  // światło sfery: diffuse + spec (mokry połysk)
  float rCore = length(uCorePos.xz - vWorld.xz);
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0);
  float att = 1.0 / (1.0 + rCore * rCore * 0.004);
  vec3 lit = base * (0.20 + diff * att * (0.45 + uCoreGlow * 0.8));
  lit += uGold * spec * att * (0.20 + uCoreGlow * 0.55);

  // jasna sadzawka pod sferą (owalna poświata z obrazu referencyjnego)
  float pool = exp(-rCore * rCore * 0.035) * (0.12 + uCoreGlow * 0.45 + uPulse * 0.25);
  lit += uGoldBright * pool * 0.28;

  // złoty emissive na grzbietach fal
  lit += uGold * smoothstep(0.015, 0.22, vCrest) * (0.5 + uCoreGlow * 0.5);

  lit = applyFog(lit, vDist);
  gl_FragColor = vec4(lit, 1.0);
}
`;

export class Ground {
  constructor(fogColor, fogDensity) {
    const geo = new THREE.PlaneGeometry(400, 400, 320, 320);
    geo.rotateX(-Math.PI / 2);
    this.waves = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 12, 0));
    this.waveI = 0;
    const c = (hex) => new THREE.Color(hex);
    this.uniforms = {
      uTime: { value: 0 },
      uWaves: { value: this.waves },
      uCorePos: { value: new THREE.Vector3(0, 1.2, 0) },
      uCoreGlow: { value: 0.4 },
      uPulse: { value: 0 },
      uColLo: { value: c(PAL.groundLo) },
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

  // t0 w czasie UTWORU; amp ~0.35..1.0; speed jednostki/s frontu
  pushWave(t0, amp, speed = 12) {
    const w = this.waves[this.waveI];
    w.set(t0, amp, speed, 0);
    this.waveI = (this.waveI + 1) % MAX_WAVES;
  }

  update(t, energy, beatPulse) {
    this.uniforms.uTime.value = t;
    this.uniforms.uCoreGlow.value = energy;
    this.uniforms.uPulse.value = beatPulse;
  }
}
