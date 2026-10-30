// System cząstek bocznych: dwa emitery przy lewej i prawej krawędzi kadru.
// Odpalają się WYŁĄCZNIE na ewidentne, duże piki ścieżki „inne" (detekcja w main.js:
// atak głośności ponad wolną obwiednię + refrakcja 1.2 s) — czyli rzadko, kilka razy
// na 20 s. Cząstki unoszą się powoli i gasną; zero zależności od FPS (dt-owane).
import * as THREE from "three";
import { PAL } from "./glsl.js";

const MAX = 900;           // pula na oba emitery
const PER_SIDE = 44;       // cząstek na emiter w jednym wybuchu
const LIFE = [2.6, 4.6];   // życie (s)
const SIZE = [0.7, 2.4];   // rozmiar bazowy (px przy 1 m)

// Emitery: x = ±13.5 m na z ≈ 3 m, czyli tuż przy bocznych krawędziach kadru
// (przy fov 55 i kamerze z = 22 połowa szerokości kadru na tej głębokości ≈ 18 m).
const EMITTERS = [
  { x: -13.5, dir: -1 },
  { x: 13.5, dir: 1 },
];

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aTint;
varying float vA;
varying float vT;
void main() {
  vA = aAlpha;
  vT = aTint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uWarm, uCool;
varying float vA;
varying float vT;
void main() {
  float d = 1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5));
  if (d * vA < 0.004) discard;
  gl_FragColor = vec4(mix(uWarm, uCool, vT), d * vA);
}
`;

export class SideParticles {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.tint = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.next = 0;
    this.alive = 0;
    this.bursts = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(this.tint, 1));
    geo.setDrawRange(0, MAX);

    this.uniforms = {
      uWarm: { value: new THREE.Color(PAL.gold) },
      uCool: { value: new THREE.Color(PAL.cream) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.geo = geo;
  }

  // strength 0..1 — siła piku „inne” (z ataku głośności)
  burst(strength = 1) {
    const s = Math.min(1, Math.max(0, strength));
    this.bursts++;
    for (const em of EMITTERS) {
      const n = Math.round(PER_SIDE * (0.5 + 0.5 * s));
      for (let k = 0; k < n; k++) {
        const i = this.next;
        this.next = (this.next + 1) % MAX;
        const i3 = i * 3;
        this.pos[i3] = em.x + em.dir * (Math.random() * 1.8);
        this.pos[i3 + 1] = 0.35 + Math.random() * 1.6;
        this.pos[i3 + 2] = 2 + Math.random() * 4;
        // unoszenie + lekki rozjazd na zewnątrz kadru
        this.vel[i3] = em.dir * (0.5 + Math.random() * 1.9) + (Math.random() - 0.5) * 0.6;
        this.vel[i3 + 1] = (1.1 + Math.random() * 2.4) * (0.7 + 0.5 * s);
        this.vel[i3 + 2] = (Math.random() - 0.5) * 1.2;
        const life = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
        this.age[i] = 0;
        this.life[i] = life;
        this.size0[i] = (SIZE[0] + Math.random() * (SIZE[1] - SIZE[0])) * (0.75 + 0.45 * s);
        this.size[i] = this.size0[i];
        this.tint[i] = Math.random();
        this.alpha[i] = 0;
      }
    }
  }

  reset() {
    this.pos.fill(0);
    this.vel.fill(0);
    this.alpha.fill(0);
    this.age.fill(0);
    this.life.fill(0);
    this.next = 0;
    this.alive = 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  update(dt) {
    const damp = Math.exp(-dt * 0.55); // opór: ruch spowalnia, nic nie „wyskakuje”
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      const i3 = i * 3;
      this.vel[i3] *= damp;
      this.vel[i3 + 1] *= damp;
      this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // wejście 0.18 s, wyjście w ostatnich 55% życia
      const fadeIn = Math.min(1, this.age[i] / 0.18);
      const fadeOut = 1 - Math.max(0, (u - 0.45) / 0.55);
      this.alpha[i] = fadeIn * fadeOut * fadeOut * 0.55;
      this.size[i] = this.size0[i] * (1 + u * 0.55); // drobina rośnie i blednieje
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
