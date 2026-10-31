// System 1: ZIEMIA — ciemna, pomarszczona pustynia z koncentrycznymi falami od uderzeń bębnów.
// 1 uderzenie = 1 fala (max 30 slotów); fala per-piksel, życie z siły (zasięg 23-54 m, do krawędzi kadru).
import * as THREE from "three";
import { NOISE_GLSL, FOG_GLSL } from "./glsl.js";
import { PRESETS, DEFAULT_PRESET } from "./palette.js";

const DEF = PRESETS[DEFAULT_PRESET]; // wartości startowe = preset domyślny

const MAX_WAVES = 30; // każdy transient ma własną falę; max współbieżnych policzony z danych = 27

const VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;   // analityczna normalna bazy (fbm) — gładka, bez faset
varying float vWrinkle; // zmarszczki bazowe (do cieniowania)
varying float vDist;
${NOISE_GLSL}
void main() {
  vec3 p = position; // geometria już obrócona: y w górę, xz to plan podłogi

  // baza całkowicie gładka (audit v2 P0-A): jedna oktawa, niska
  float wr = fbm4(vec3(p.x * 0.03, uTime * 0.03, p.z * 0.03)) * 0.18;

  // normalna bazy z pochodnej analitycznej (fbm jest niskoczęstotliwościowy —
  // 4 tapy na wierzchołek wystarczą; zero faset z dFdx)
  float e = 0.6;
  float wx = fbm4(vec3((p.x + e) * 0.03, uTime * 0.03, p.z * 0.03)) * 0.18;
  float wz = fbm4(vec3(p.x * 0.03, uTime * 0.03, (p.z + e) * 0.03)) * 0.18;
  vNormal = normalize(vec3(-(wx - wr) / e, 1.0, -(wz - wr) / e));

  p.y += wr; // fale BEZ deformacji geometrii — liczone per-piksel w fragmencie
  vWrinkle = wr;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vDist = length(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec4 uWaves[${MAX_WAVES}]; // x: t0, y: amp, z: speed, w: życie (2.6-6.0 s)
uniform vec3 uCorePos;      // pozycja sfery-serca (światło kluczowe)
uniform float uCoreGlow;    // energia sfery 0..~1.2
uniform float uPulse;       // beatPulse 0..1
uniform vec3 uColLo, uColHi, uGold, uGoldBright;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWrinkle;
varying float vDist;
${FOG_GLSL}
void main() {
  // fale jako pole wysokości liczone PER-PIKSEL: gładkie koncentryczne pierścienie
  // przy dowolnej rozdzielczości siatki (koniec z kanciastymi fasetami na trójkątach)
  float r = length(vWorld.xz);
  // atan(0,0) jest niezdefiniowany — w centrum kadru dawał NaN i czarny piksel
  float ang = r > 1e-4 ? atan(vWorld.z, vWorld.x) : 0.0;
  float crest = 0.0;
  float gx = 0.0, gz = 0.0;
  const float K = 0.85;   // liczba falowa (λ ≈ 7.4 m) — drobne, jedwabne zmarszczki
  const float SIG = 0.06; // szerokość otoczki — miękkie, jedwabne krawędzie
  const float RHO = 0.010; // tłumienie radialne — fala żyje do krawędzi kadru
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    float amp = uWaves[i].y;
    if (amp < 0.001) continue;
    float age = uTime - uWaves[i].x;
    float life = uWaves[i].w; // życie zależne od siły uderzenia
    if (age < 0.0 || age > life) continue;
    float front = age * uWaves[i].z; // 9 m/s — zasięg do ~55 m (krawędź kadru)
    // lekka nieregularność azymutalna (wspólna faza dla wszystkich fal — pierścienie
    // są wtedy współśrodkowe jak zmarszczki na jedwabiu, a nie marmur z interferencji)
    float wob = sin(ang * 3.0 + age * 0.5) * 0.20 + sin(ang * 5.0) * 0.08;
    float d = r - front - wob;
    float env = exp(-d * d * SIG)
              * smoothstep(0.0, 0.10, age)
              * (1.0 - smoothstep(life * 0.72, life, age))
              * exp(-r * RHO);
    float s = sin(d * K);
    crest += amp * max(s, 0.0) * env;
    // pochodna radialna dh/dr — nachylenie grzbietu do światła, bez udziału siatki
    float dh = amp * env * (K * cos(d * K) - s * (2.0 * SIG * d + RHO));
    gx += dh * vWorld.x / max(r, 1e-4);
    gz += dh * vWorld.z / max(r, 1e-4);
  }
  vec3 N = normalize(vec3(vNormal.x - gx, vNormal.y, vNormal.z - gz));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uCorePos - vWorld);

  // baza: czekoladowy brąz, jaśniejsza na wypukłościach zmarszczek
  float shade = clamp(0.5 + vWrinkle * 1.4, 0.0, 1.0);
  vec3 base = mix(uColLo, uColHi, shade * 0.55);

  // światło sfery: matowe (roughness ~0.65) — ciasny zasięg, bez żółtej plamy
  float rCore = length(uCorePos.xz - vWorld.xz);
  float diff = max(dot(N, L), 0.0);
  // L + V zeruje się dokładnie na osi kamera-sfera — normalize(0) = NaN
  vec3 hv = L + V;
  float hlen = length(hv);
  vec3 H = hlen > 1e-5 ? hv / hlen : N;
  float spec = pow(max(dot(N, H), 0.0), 24.0);
  float att = 1.0 / (1.0 + rCore * rCore * 0.02);
  vec3 lit = base * (0.20 + diff * att * (0.30 + uCoreGlow * 0.5));
  lit += uGold * spec * att * (0.06 + uCoreGlow * 0.10);

  // jasna sadzawka pod sferą (owalna poświata z obrazu referencyjnego)
  float pool = exp(-rCore * rCore * 0.05) * (0.10 + uCoreGlow * 0.30 + uPulse * 0.18);
  lit += uGoldBright * pool * 0.14;

  // złoty emissive na grzbietach fal — #d9984a, bez bieli (smoothstep per-piksel)
  // próg 0.55, bo przy 3-4 nakładających się falach crest sumuje się do ~0.4
  lit += uGold * smoothstep(0.06, 0.55, crest) * (0.14 + uCoreGlow * 0.16);

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
      uColLo: { value: c(DEF.pal.groundLo) }, // baza z presetu (złoty: #140c06 z auditu)
      uColHi: { value: c(DEF.pal.groundHi) },
      uGold: { value: c(DEF.pal.gold) },
      uGoldBright: { value: c(DEF.pal.goldBright) },
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

  // t0 w czasie UTWORU; amp 0.12..0.22 MAX, nigdy 0.6 (audit v2); 9 m/s
  pushWave(t0, amp, speed = 9, life = 6.0) {
    // guard: NaN w polu fali zatrułby CAŁE pole (env -> NaN -> czarna ziemia do końca życia slotu)
    if (!Number.isFinite(t0) || !Number.isFinite(amp)) return;
    const a = Math.min(Math.max(amp, 0.02), 0.22);
    const sp = Number.isFinite(speed) ? Math.min(Math.max(speed, 1), 20) : 9;
    const lf = Number.isFinite(life) ? Math.min(Math.max(life, 1.0), 8.0) : 3.0;
    const w = this.waves[this.waveI];
    w.set(t0, a, sp, lf);
    this.waveI = (this.waveI + 1) % MAX_WAVES;
  }

  // po przewinięciu utworu: wygaszone wszystkie fale (stare t0 i tak by zniknęły,
  // ale po restarcie czasu t0 > t dawałoby falę „z przyszłości")
  reset() {
    for (const w of this.waves) w.set(0, 0, 7, 0);
    this.waveI = 0;
  }

  // Preset barwy ziemi (+ mgła, bo FOG_GLSL miesza ku uFogColor).
  setPalette({ lo, hi, gold, bright, fog }) {
    const u = this.uniforms;
    u.uColLo.value.setHex(lo);
    u.uColHi.value.setHex(hi);
    u.uGold.value.setHex(gold);
    u.uGoldBright.value.setHex(bright);
    if (fog != null) u.uFogColor.value.setHex(fog);
  }

  update(t, energy, beatPulse) {
    this.uniforms.uTime.value = Number.isFinite(t) ? t : 0;
    this.uniforms.uCoreGlow.value = energy;
    this.uniforms.uPulse.value = beatPulse;
  }
}
