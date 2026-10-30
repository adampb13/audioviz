// ISKRY WYLATUJĄCE Z KULI — obraz ścieżki „inne" w danej chwili.
//
// Każda iskra niesie TRZY informacje z tej samej chwili utworu, każdą widać
// osobno (pełne mapowanie w README):
//   • ILE iskier    ← obwiednia `peak` (gęstość emisji 0.15–3.5/s), więc gęsty
//                     fragment sypie iskrami, a cichy ledwo jedną;
//   • JAK DUŻA      ← `peak` w chwili emisji (głośny akcent = duża, szybka,
//                     leci wyżej);
//   • JAKI KOLOR    ← `centroid_hz` (jasność widma): ciemny pad = głęboki
//                     czerwony żar, jasny arp/hi-hat = biały żar;
//   • SKĄD WYLATUJE ← też centroid: ciemne dźwięki z dolnej flanki kuli,
//                     jasne z górnej (wysokość startu = wysokość dźwięku).
//
// Ruch: start na POWIERZCHNI kuli (promień z core.surfaceRadius(), więc podąża
// za rozmiarem i pulsem), wyrzut wzdłuż normalnej + w górę, potem grawitacja
// ściąga iskrę łukiem nad fale; wygaszanie w ostatnich 55% życia — „spokojnie
// opada i gaśnie", nigdy nie strzela i nie znika skokiem.
//
// Zero zależności od FPS: wszystko dt-owane, pula stała (MAX), jeden draw call.
import * as THREE from "three";

const MAX = 48;              // pula na obie strony — zapas na gęste fragmenty
const LIFE = [2.0, 3.0];     // życie (s)
const GRAV = 1.35;           // m/s² — lekka grawitacja: iskra płynie, nie spada
const DRAG = 0.32;           // opór powietrza (1/s) — lot zwalnia, nie hamuje ostro
const CORE_Y = 0.3;          // środek kuli (core.js: mesh.position.y)
const FLOOR = 0.20;          // nie zapada się pod ziemię

// Paleta iskier: ciemny żar → złoto → biały żar (sterowana centroidem „inne").
const COLD = [1.00, 0.24, 0.03]; // ciemne widmo (pad, niski synth)
const MID = [1.00, 0.62, 0.22];  // środek skali — złoto
const WARM = [1.00, 0.96, 0.88]; // jasne widmo (arp, hi-hat) — biały żar

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aCol;
varying float vA;
varying vec3 vC;
void main() {
  vA = aAlpha;
  vC = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (430.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying float vA;
varying vec3 vC;
void main() {
  // miękkie, okrągłe ziarno: halo + gorący środek
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float soft = pow(1.0 - r, 2.2);
  float hot = pow(1.0 - r, 7.0);
  // środek jaśniejszy, ale W BARWIE iskry: samo rozjaśnienie (bez mieszania
  // z bielą) — inaczej tone mapping i bloom robiły z każdej iskry białą plamę
  // i kolor z centroidu przestawał być widoczny
  vec3 core = min(vec3(1.7), vC * 1.55 + vec3(0.05));
  vec3 col = mix(vC, core, hot);
  float a = (soft * 0.75 + hot * 0.55) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a); // additive: alpha w kolorze, reszta i tak sumuje
}
`;

export class Sparks {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.phase = new Float32Array(MAX); // faza kołysania
    this.next = 0;
    this.alive = 0;
    this.pool = MAX; // rozmiar puli — panel H pokazuje „żywe / pula"
    this.spawned = 0;
    this.side = -1; // następna iskra: lewa (-1) czy prawa (+1)
    this.lastLoud = 0;   // diagnostyka: czym ostatnio sterowano iskrą
    this.lastBright = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aCol", new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, MAX);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; // drobiny latają poza bryłą — nie licz AABB
    this.points.renderOrder = 6;
    this.geo = geo;
  }

  // loud   0..1 — głośność akcentu (`peak` „inne") → rozmiar, prędkość, wysokość
  // bright 0..1 — jasność widma (`centroid_hz`) → kolor i elewacja na kuli
  // radius — promień powierzchni kuli w tej chwili (core.surfaceRadius())
  spawn(loud = 0.5, bright = 0.5, radius = 0.9) {
    const s = Math.min(1, Math.max(0, loud));
    const b = Math.min(1, Math.max(0, bright));
    this.lastLoud = s;
    this.lastBright = b;

    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const i3 = i * 3;

    const side = this.side;
    this.side = -this.side; // naprzemiennie: lewa, prawa, lewa…

    // miejsce startu NA POWIERZCHNI kuli: elewacja z jasności widma
    // (ciemne dźwięki z dołu, jasne z góry), azymut rozrzucony w głąb sceny
    const elev = -0.30 + 0.62 * b + (Math.random() - 0.5) * 0.34;
    // azymut przesunięty w stronę kamery (patrzy z +z): iskry po bokach kuli,
    // ale po WIDOCZNEJ stronie — inaczej połowa rodziła się za kulą i ginęła
    const azim = (Math.random() - 0.30) * 1.15;
    const r = radius * 1.02; // tuż nad powłoką — nie chowamy iskry w środku kuli
    const ce = Math.cos(elev), se = Math.sin(elev);
    this.pos[i3] = side * ce * Math.cos(azim) * r;
    this.pos[i3 + 1] = CORE_Y + se * r;
    this.pos[i3 + 2] = ce * Math.sin(azim) * r;

    // wyrzut NA ZEWNĄTRZ (wzdłuż normalnej punktu) + komponent w górę,
    // więc iskra wylatuje z boku kuli i unosi się łukiem, zamiast lecieć w dół
    const sp = 1.25 + 1.35 * s + Math.random() * 0.45;
    this.vel[i3] = side * ce * Math.cos(azim) * sp;
    this.vel[i3 + 1] = se * sp * 0.45 + 1.05 + 0.85 * s + Math.random() * 0.40;
    this.vel[i3 + 2] = ce * Math.sin(azim) * sp;

    // kolor: ciemny żar → złoto → biały żar
    if (b < 0.5) {
      const k = b / 0.5;
      this.col[i3] = COLD[0] + (MID[0] - COLD[0]) * k;
      this.col[i3 + 1] = COLD[1] + (MID[1] - COLD[1]) * k;
      this.col[i3 + 2] = COLD[2] + (MID[2] - COLD[2]) * k;
    } else {
      const k = (b - 0.5) / 0.5;
      this.col[i3] = MID[0] + (WARM[0] - MID[0]) * k;
      this.col[i3 + 1] = MID[1] + (WARM[1] - MID[1]) * k;
      this.col[i3 + 2] = MID[2] + (WARM[2] - MID[2]) * k;
    }

    this.age[i] = 0;
    this.life[i] = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]) + s * 0.5;
    // głośny akcent = większa drobina (0.72–2.63 m)
    this.size0[i] = (0.80 + 1.30 * s) * (0.90 + Math.random() * 0.25);
    this.size[i] = this.size0[i];
    this.alpha[i] = 0;
    this.phase[i] = Math.random() * Math.PI * 2;
    this.spawned++;
  }

  reset() {
    this.pos.fill(0);
    this.vel.fill(0);
    this.col.fill(0);
    this.alpha.fill(0);
    this.age.fill(0);
    this.life.fill(0);
    this.next = 0;
    this.alive = 0;
    this.side = -1;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
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
    this.geo.attributes.aCol.needsUpdate = true;
  }
}
