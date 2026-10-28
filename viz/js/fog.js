// MGŁA / DYM — tło sceny: gęsta, podświetlona od dołu, w ciepłej ciemnobrązowej bazie.
// Wielka odwrócona sfera + pełnoekranowy shader szumu wolumetrycznego (fbm).
//  - prędkość przepływu dymu <- chwilowe tempo utworu (inne.tempo_local_bpm),
//  - odcień podświetlenia    <- chroma stemu "inne" zmapowana na ciepłą paletę
//                               (brąz -> miedź -> złoto -> wyblakły róż),
//  - jasność                 <- globalny poziom energii (cisza = prawie czerń).
import * as THREE from "three";
import { damp } from "./data.js";

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform float uPhase;   // skumulowany czas przepływu (zależy od tempa)
  uniform float uLevel;   // globalna jasność (energia miksu)
  uniform vec3  uBase;    // ciemny brąz (baza mgły)
  uniform vec3  uTint;    // ciepły odcień z chromy
  varying vec3  vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.13 + vec2(19.7, -7.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    // pseudo-projekcja kierunku na płaszczyznę mgły; dół "gęstszy"
    vec2 p = d.xz / (abs(d.y) + 0.85);
    float n1 = fbm(p * 2.1 + vec2(uPhase * 0.9, -uPhase * 0.55));
    float n2 = fbm(p * 4.7 + vec2(-uPhase * 0.6, uPhase * 0.8) + n1);
    float n = n1 * 0.65 + n2 * 0.35;

    float bottom = 1.0 - smoothstep(-0.15, 0.75, d.y); // 1 przy podłodze
    float lit = bottom * (0.55 + 0.45 * n);

    vec3 col = uBase * (0.16 + 0.34 * n);          // ciemna, żywa baza
    col += uTint * lit * 0.42 * uLevel;            // ciepłe podświetlenie od dołu
    col *= (0.10 + 0.90 * uLevel);                 // cisza -> prawie czerń
    gl_FragColor = vec4(col, 1.0);
  }`;

// Ciepła paleta dla chromy: brąz, miedź, złoto, wyblakły róż (12 klas dźwięku rozłożone równomiernie)
const PALETTE = [
  new THREE.Color(0x4a2410), // brąz
  new THREE.Color(0xb35c1e), // miedź
  new THREE.Color(0xf5c66b), // złoto
  new THREE.Color(0xd98a86), // wyblakły róż
];

function paletteAt(x, out) {
  // x w 0..3 (po pozycjach palety), liniowo między sąsiadami
  const i = Math.min(PALETTE.length - 2, Math.max(0, Math.floor(x)));
  const f = Math.min(1, Math.max(0, x - i));
  return out.copy(PALETTE[i]).lerp(PALETTE[i + 1], f);
}

export class SmokeFog {
  constructor(scene) {
    this.meshU = {
      uPhase: { value: 0 },
      uLevel: { value: 0.3 },
      uBase: { value: new THREE.Color(0x1c0e06) },
      uTint: { value: new THREE.Color(0xb35c1e) },
    };
    const geo = new THREE.SphereGeometry(80, 40, 28);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.meshU,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.phase = 0;
    this.tint = new THREE.Color(0xb35c1e);
    this._tmp = new THREE.Color();
    this._chroma = new Float32Array(12);
    this.speed = 0; // do HUD
  }

  // chroma[12] z Track.chromaInto; speed 0..1 (z tempa); level = globalna jasność
  update(dt, running, chromaArr, speed, level) {
    // przepływ mgły — fazowy, związany z zegarem utworu (pauza zamraża ruch)
    this.speed = speed;
    if (running) this.phase += dt * (0.05 + 0.5 * speed);
    this.meshU.uPhase.value = this.phase;
    this.meshU.uLevel.value = level;

    // chroma -> pozycja w ciepłej palecie (średnia ważona energii klas)
    let sum = 0, acc = 0;
    for (let k = 0; k < 12; k++) {
      const w = chromaArr[k];
      sum += w;
      acc += w * (k / 11) * (PALETTE.length - 1);
    }
    if (sum > 0.08) {
      paletteAt(acc / sum, this._tmp);
      this.tint.lerp(this._tmp, 1 - Math.exp(-0.9 * dt)); // miękkie przesuwanie z akordami
    }
    this.meshU.uTint.value.copy(this.tint);
  }
}
