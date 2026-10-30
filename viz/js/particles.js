// POJEDYNCZE ISKRY po bokach kuli — nie chmura, nie fontanna, jedna drobina.
//
// Zasada: iskra pojawia się WYŁĄCZNIE w chwili przekroczenia progu `peak`
// w ścieżce „inne" (próg w main.js, 0.38; p95 tego utworu to 0.446, więc łapie
// mocne akcenty — ~9 zdarzeń na 20 s, jedno co ~2.2 s). Na jedno
// przekroczenie wypada JEDNA iskra, naprzemiennie po lewej i prawej stronie kuli,
// na ziemi tam, gdzie rozchodzą się fale (między kamerą a górami).
//
// Ruch: iskra WYLATUJE Z POWIERZCHNI KULI (start na powłoce, po bokach), leci
// na zewnątrz i w górę, potem grawitacja ściąga ją łukiem na ziemię; życie
// 2.6-3.6 s, wygaszanie w ostatnich 55% — iskra „spokojnie opada i gaśnie",
// nigdy nie strzela i nie znika skokiem.
//
// Zero zależności od FPS: wszystko dt-owane, pula stała (MAX), jeden draw call.
import * as THREE from "three";
import { PAL } from "./glsl.js";

const MAX = 24;              // pula na obie strony — więcej nie jest potrzebne
const LIFE = [2.6, 3.6];     // życie (s)
const SIZE = [1.20, 1.80];   // rozmiar bazowy (m) — pojedyncza drobina, nie plama
const GRAV = 1.35;           // m/s² — lekka grawitacja: iskra płynie, nie spada
const DRAG = 0.32;           // opór powietrza (1/s) — lot zwalnia, nie hamuje ostro
const CORE_Y = 0.3;          // środek kuli (core.js: mesh.position.y)
const FLOOR = 0.20;          // nie zapada się pod ziemię

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
  gl_PointSize = aSize * (430.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uGold, uCream;
varying float vA;
varying float vT;
void main() {
  // miękkie, okrągłe ziarno: halo + gorący środek (dwa różne temperatury)
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float soft = pow(1.0 - r, 2.2);
  float hot = pow(1.0 - r, 7.0);
  vec3 col = mix(uGold, uCream, hot * 0.85);
  float a = (soft * 0.75 + hot * 0.55) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a); // additive: alpha w kolorze, reszta i tak sumuje
}
`;

export class Sparks {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.tint = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.phase = new Float32Array(MAX); // faza kołysania
    this.next = 0;
    this.alive = 0;
    this.spawned = 0;
    this.side = -1; // następna iskra: lewa (-1) czy prawa (+1)

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(this.tint, 1));
    geo.setDrawRange(0, MAX);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uGold: { value: new THREE.Color(PAL.goldBright) },
        uCream: { value: new THREE.Color(PAL.cream) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; // drobiny latają poza bryłą — nie licz AABB
    this.points.renderOrder = 6;
    this.geo = geo;
  }

  // strength 0..1 — jak mocno `peak` przekroczył próg (wpływa na wielkość i lot)
  // radius — promień powierzchni kuli w tej chwili (core.surfaceRadius())
  spawn(strength = 0.5, radius = 0.9) {
    const s = Math.min(1, Math.max(0, strength));
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const i3 = i * 3;

    const side = this.side;
    this.side = -this.side; // naprzemiennie: lewa, prawa, lewa…

    // punkt NA POWIERZCHNI kuli, po bokach: elewacja od lekko w dół do ~+30°,
    // azymut rozrzucony w głąb sceny, żeby iskry nie leciały po jednej linii
    const elev = -0.22 + Math.random() * 0.75;
    const azim = (Math.random() - 0.5) * 0.85;
    const r = radius * 1.02; // tuż nad powłoką — nie chowamy iskry w środku kuli
    const ce = Math.cos(elev), se = Math.sin(elev);
    this.pos[i3] = side * ce * Math.cos(azim) * r;
    this.pos[i3 + 1] = CORE_Y + se * r;
    this.pos[i3 + 2] = ce * Math.sin(azim) * r;

    // wyrzut NA ZEWNĄTRZ (wzdłuż normalnej punktu) + stały komponent w górę,
    // więc iskra wylatuje z boku kuli i unosi się łukiem, zamiast lecieć w dół
    const sp = 1.50 + Math.random() * 1.10 + s * 0.45;
    this.vel[i3] = side * ce * Math.cos(azim) * sp;
    this.vel[i3 + 1] = se * sp * 0.45 + 1.15 + Math.random() * 0.55 + s * 0.25;
    this.vel[i3 + 2] = ce * Math.sin(azim) * sp;

    const life = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]) + s * 0.5;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = (SIZE[0] + Math.random() * (SIZE[1] - SIZE[0])) * (0.85 + 0.35 * s);
    this.size[i] = this.size0[i];
    this.tint[i] = Math.random();
    this.alpha[i] = 0;
    this.phase[i] = Math.random() * Math.PI * 2;
    this.spawned++;
  }

  reset() {
    this.pos.fill(0);
    this.vel.fill(0);
    this.alpha.fill(0);
    this.age.fill(0);
    this.life.fill(0);
    this.next = 0;
    this.alive = 0;
    this.side = -1;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const i3 = i * 3;

      // grawitacja + opór powietrza: lot robi się coraz wolniejszy i miękki
      this.vel[i3 + 1] -= GRAV * dt;
      const drag = Math.exp(-dt * DRAG);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;

      // kołysanie: drobina nie leci po sznurku, tylko dryfuje na boki
      const sway = Math.sin(this.phase[i] + this.age[i] * 1.9) * 0.22 * dt;
      this.pos[i3] += (this.vel[i3] + sway) * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < FLOOR) { // nie zapada się pod ziemię
        this.pos[i3 + 1] = FLOOR;
        this.vel[i3 + 1] *= -0.18; // miękkie odbicie — i tak zaraz gaśnie
      }

      // wejście 0.14 s, potem powolne wygaszanie od 45% życia (kwadratowo = bez „klifu")
      const fadeIn = Math.min(1, this.age[i] / 0.14);
      const fadeOut = 1 - Math.max(0, (u - 0.45) / 0.55);
      this.alpha[i] = fadeIn * fadeOut * fadeOut * 1.0;
      this.size[i] = this.size0[i] * (1 + u * 0.45); // drobina rośnie i blednieje
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
