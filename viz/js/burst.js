// CZĄSTECZKI Z RDZENIA — jedyny system drobin przy ziemi (zastąpił statyczny pył
// z atmosphere.js). Emitowane WYŁĄCZNIE na mocnych uderzeniach basu
// (data.js: bassOnsetT/bassOnsetS, próg ~0.42) i żyją w tym samym niskim paśmie
// co stary pył: y 0.2-3 m, x/z wokół rdzenia.
//
// Cała dynamika liczona w vertex shaderze: CPU przy emisji zapisuje tylko
// (t0, p0, przesunięcie, życie, siłę, rozmiar) w pierścieniowym poolu, więc
// koszt klatki to jedno ustawienie uTime — bez przeliczania 260 cząstek.
import * as THREE from "three";
import { PAL } from "./glsl.js";

const POOL = 260;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;  // pixelRatio: CSS px -> px bufora
uniform float uProj;   // (wysokosc/2)/tan(fov/2) w CSS px — skala perspektywy
attribute float aT0;
attribute vec3 aP0;
attribute vec3 aD;     // całkowite przemieszczenie w czasie życia [m]
attribute float aLife;
attribute float aStrength;
attribute float aSize; // średnica w metrach
varying float vA;
varying float vT;
void main() {
  float age = uTime - aT0;
  if (aLife < 0.0001 || age < 0.0 || age > aLife) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // poza klipem — nic nie rysuje
    gl_PointSize = 0.0;
    vA = 0.0;
    vT = 0.0;
    return;
  }
  float k = clamp(age / aLife, 0.0, 1.0);
  // wyrzut z hamowaniem (1-exp) + powolne unoszenie: drobiny rozpełzają się
  // po ziemi i gasną, zamiast lecieć po linii prostej
  float s = 1.0 - exp(-2.2 * k);
  vec3 p = aP0 + aD * s;
  p.y += 0.30 * age;
  vT = k;
  vA = aStrength * smoothstep(0.0, 0.07, k) * (1.0 - smoothstep(0.42, 1.0, k));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // rozmiar z perspektywą: średnica [m] -> px; rośnie lekko z wiekiem (bokeh)
  gl_PointSize = min((aSize + 0.42 * k) * uProj / -mv.z, 46.0) * uScale;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uWarm, uCool;
varying float vA;
varying float vT;
void main() {
  // falloff jak w gwiazdach: przy sprite'ach 6-16 px środek musi zostać pełny
  float d = 1.0 - smoothstep(0.18, 0.5, length(gl_PointCoord - 0.5));
  vec3 col = mix(uWarm, uCool, vT);
  gl_FragColor = vec4(col, d * vA);
}
`;

export class CoreBurst {
  constructor() {
    this.group = new THREE.Group();

    this.t0 = new Float32Array(POOL).fill(-1e5);
    this.p0 = new Float32Array(POOL * 3);
    this.ds = new Float32Array(POOL * 3);
    this.life = new Float32Array(POOL);
    this.str = new Float32Array(POOL);
    this.size = new Float32Array(POOL);
    this.i = 0;

    const g = new THREE.BufferGeometry();
    // position jest wymagane przez three, ale liczy się tylko p0 w shaderze
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POOL * 3), 3));
    g.setAttribute("aT0", new THREE.BufferAttribute(this.t0, 1));
    g.setAttribute("aP0", new THREE.BufferAttribute(this.p0, 3));
    g.setAttribute("aD", new THREE.BufferAttribute(this.ds, 3));
    g.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1));
    g.setAttribute("aStrength", new THREE.BufferAttribute(this.str, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo = g;

    this.uniforms = {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uProj: { value: 778 },
      uWarm: { value: new THREE.Color(PAL.gold) },
      uCool: { value: new THREE.Color(PAL.goldBright) },
    };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 6; // nad halo rdzenia (5), pod wstęgą (10)
    this.group.add(this.points);
  }

  // strength: 0..1 z basowego onsetu; energy dodatkowo skaluje zasięg (głośniej = dalej)
  emit(t, strength, energy = 0.5) {
    const s = Math.min(Math.max(strength, 0), 1);
    const n = Math.round(5 + s * 9); // 5..14 drobin na uderzenie
    const reach = 0.75 + energy * 0.6;
    for (let j = 0; j < n; j++) {
      const k = this.i;
      this.i = (this.i + 1) % POOL;
      const a = Math.random() * Math.PI * 2;
      const r = 0.7 + Math.random() * 0.8; // start na powierzchni rdzenia
      this.p0[k * 3] = Math.cos(a) * r;
      this.p0[k * 3 + 1] = 0.22 + Math.random() * 0.5;
      this.p0[k * 3 + 2] = Math.sin(a) * r * 0.9;
      // przemieszczenie całkowite: na boki 1.4-5.2 m (× reach), w górę 0.4-1.6 m,
      // lekko w stronę kamery — drobiny zostają w niskim paśmie, nie uciekają w niebo
      const out = (1.4 + Math.random() * 3.8) * reach;
      this.ds[k * 3] = Math.cos(a) * out;
      this.ds[k * 3 + 1] = 0.4 + Math.random() * 1.2;
      this.ds[k * 3 + 2] = Math.sin(a) * out * 0.75 + 0.9;
      this.life[k] = 1.5 + Math.random() * 1.6;
      this.str[k] = 0.22 + s * 0.42;
      this.size[k] = 0.12 + Math.random() * 0.22;
      this.t0[k] = t;
    }
    // jeden upload na uderzenie (7 atrybutów × 260 — ~10 kB, pomijalne)
    for (const name of ["aT0", "aP0", "aD", "aLife", "aStrength", "aSize"]) {
      this.geo.attributes[name].needsUpdate = true;
    }
  }

  setScale(pixelRatio, viewportH, fovDeg) {
    this.uniforms.uScale.value = Math.min(Math.max(pixelRatio, 0.5), 2);
    this.uniforms.uProj.value = (viewportH * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  update(t) {
    this.uniforms.uTime.value = t;
  }
}
