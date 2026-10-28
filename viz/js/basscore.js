// RDZEŃ BASOWY — miękkie, kuliste źródło światła w centrum okręgów (na poziomie podłogi).
// Animacja jak miarowe bicie serca: bardzo leniwy LERP podstawy (bas jest ciężki
// i powolny), szybki atak na onsetach basu, utrzymanie objętości + delikatny puls
// przy długich tonach. Barwa <- centroid basu: niskie dźwięki = żarząca miedź,
// wyższe = jasne złoto.
import * as THREE from "three";
import { clamp, damp } from "./data.js";

const VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    // miękkie światło punktowe: jasne, małe centrum + szeroka, delikatna otoczka
    float core = pow(ndv, 3.0);
    float halo = pow(1.0 - ndv, 3.5) * 0.30;
    float g = (core + halo) * uBright;
    gl_FragColor = vec4(uColor * g, g);
  }`;

const COPPER = new THREE.Color(0x9c3d05); // głęboka, żarząca się miedź
const GOLD = new THREE.Color(0xffd27a);   // jasne złoto

export class BassCore {
  constructor(scene) {
    this.meshU = {
      uColor: { value: new THREE.Color() },
      uBright: { value: 0.4 },
    };
    const geo = new THREE.SphereGeometry(1, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.meshU,
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 0, 0); // środek na poziomie podłogi — kopuła wyłania się z niej
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.level = 0;   // leniwa podstawa (energia basu)
    this.hit = 0;     // impuls ataku (onsety basu)
    this.centS = 0.35; // wygładzony, energia-gatowany centroid
    this.centN = 0.35; // znormalizowany centroid (do HUD)
    this.glow = 0;    // poświata eksportowana do okręgów/mgły
  }

  // energy 0..1 (bRms), hit 0..1 (impuls z onsetów w tej klatce), centN 0..1, bpm do pulsu
  update(dt, t, { energy, hit, centN, bpm }) {
    // Asymetria „bicia serca": wzrost szybki (atak basu), opadanie bardzo leniwe —
    // rdzeń nie gaśnie w przerwach między tonami, tylko trzyma objętość.
    this.level = damp(this.level, energy, energy > this.level ? 3.0 : 0.45, dt);
    if (hit > this.hit) this.hit = hit;             // atak natychmiastowy
    this.hit = damp(this.hit, 0, 1.4, dt);          // powolny zanik

    // Barwa z centroidu — ale tylko gdy bas faktycznie gra (inaczej centroid szumi).
    if (energy > 0.06) this.centS = damp(this.centS, centN, 1.5, dt);
    else this.centS = damp(this.centS, 0.35, 0.4, dt); // cisza: wracaj do ciepłej miedzi

    const sustain = clamp(energy - 0.12, 0, 1);
    const beatHz = Math.max(0.8, (bpm || 100) / 60);
    const throb = 1 + 0.055 * Math.sin(t * 2 * Math.PI * beatHz) * sustain;

    const s = (0.22 + 0.55 * this.level + 0.24 * this.hit) * throb;
    this.mesh.scale.setScalar(Math.max(0.05, s));

    this.centN = this.centS;
    this.meshU.uColor.value.copy(COPPER).lerp(GOLD, clamp(this.centS, 0, 1));
    const bright = clamp(0.55 + 1.15 * this.level + 0.85 * this.hit, 0, 2.0);
    this.meshU.uBright.value = bright;
    this.glow = bright * s; // skala ~ jasność dla otoczenia
  }
}
