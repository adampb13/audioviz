// Błyski rytmiczne (onsety/beaty bębnów): delikatne, nieprzesadzone.
// Pula N=140 iskier (geometria instancjonowana): przebieg życia iskry:
//   wybudzenie w losowym punkcie powierzchni sfery -> lot radialny (pętla B)
//   -> zanik. Rozjaśnienie atmosfery + krótki impuls deformacji sfery w momencie
//   uderzenia. Akcent beatu (kick/werbel) rozróżniony kolorem.
import * as THREE from "three";
import { clamp } from "./data.js";

const N = 140;

const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aDir;
attribute vec4 aLife; // x: czas startu, y: czas trwania, z: dł. duchu (streak), w: seed
attribute vec3 aCol;

varying float vFade;
varying vec3 vCol;
uniform float uTime;

void main() {
  float t = clamp((uTime - aLife.x) / max(aLife.y, 1e-4), 0.0, 1.0);
  float fade = t * (1.0 - t) * 4.0; // 0 -> 1 -> 0 (pik w t=0.5)
  vec3 pos = aStart + aDir * t * (2.6 + 0.9 * fract(aLife.w * 7.3));
  // krótki duch wzdłuż kierunku lotu
  vec4 world = modelMatrix * vec4(pos, 1.0);
  world.xyz -= normalize(mat3(modelMatrix) * aDir) * aLife.z * t;
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  gl_PointSize = (140.0 + 120.0 * fade) / max(dist, 0.5);
  vFade = fade * (0.5 + 0.5 * t); // pełniej w 2. połowie życia
  vCol = aCol;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying float vFade;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2) * (1.0 - r2) * vFade;
  gl_FragColor = vec4(vCol, a * 0.8);
}
`;

export class Sparks {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const start = new Float32Array(N * 3);
    const dir = new Float32Array(N * 3);
    const life = new Float32Array(N * 4);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      life[i * 4 + 1] = 1e3; // uśpiona: trwa wiecznie, t-start daleko w przyszłości
      life[i * 4 + 3] = Math.random();
    }
    const attrs = {
      position: new THREE.BufferAttribute(pos, 3),
      aStart: new THREE.BufferAttribute(start, 3),
      aDir: new THREE.BufferAttribute(dir, 3),
      aLife: new THREE.BufferAttribute(life, 4),
      aCol: new THREE.BufferAttribute(col, 3),
    };
    for (const k in attrs) g.setAttribute(k, attrs[k]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    g.setDrawRange(0, N);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    this.g = g;
    this.next = 0;
    this.pulse = 0; // impuls dla atmosfery/sfery
    this.time = 0;
  }

  // kindle: moment uderzenia (t), czy akcent (beat), moc (0..1), barwa (0..1)
  spark(t, accent, strength, hue) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    const i3 = i * 3;
    const i4 = i * 4;

    // punkt startu: losowy punkt na powierzchni sfery promienia ~2.1
    const z = Math.random() * 2 - 1;
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const sx = r * Math.cos(ang) * 2.1;
    const sy = r * Math.sin(ang) * 2.1;
    const sz = z * 2.1;
    // kierunek radialny z lekkim rozrzutem
    const nx = sx / 2.1, ny = sy / 2.1, nz = sz / 2.1;
    const j = () => (Math.random() - 0.5) * 0.55;
    const dx = nx + j(), dy = ny + j(), dz = nz + j();
    const dl = Math.hypot(dx, dy, dz) || 1;

    const start = this.g.attributes.aStart;
    const dir = this.g.attributes.aDir;
    const life = this.g.attributes.aLife;
    const col = this.g.attributes.aCol;

    start.array[i3] = sx; start.array[i3 + 1] = sy; start.array[i3 + 2] = sz;
    dir.array[i3] = dx / dl; dir.array[i3 + 1] = dy / dl; dir.array[i3 + 2] = dz / dl;
    // czas życia: 0.5–0.8 s; duch: 0.2–0.5 jednostki; seed
    life.array[i4] = t;
    life.array[i4 + 1] = 0.5 + Math.random() * 0.3;
    life.array[i4 + 2] = 0.2 + Math.random() * 0.3;
    life.array[i4 + 3] = Math.random();
    // kolor: akcent (beat) cieplejszy/błękit, zwykły onset chłodny rozświetlony
    if (accent) {
      col.array[i3] = 0.45 + hue * 0.25; col.array[i3 + 1] = 0.75; col.array[i3 + 2] = 1.0;
    } else {
      col.array[i3] = 0.30 + hue * 0.3; col.array[i3 + 1] = 0.55 + hue * 0.2; col.array[i3 + 2] = 1.0;
    }

    for (const k of [start, dir, life, col]) k.needsUpdate = true;
    this.pulse = Math.min(1, this.pulse + strength * (accent ? 1.0 : 0.7));
  }

  update(dt, tSong) {
    this.time += dt;
    // po seeku/przewinięciu: synchronizacja z zegarem utworu — inaczej iskry
    // zarejestrowane "w przeszłości" względem uTime byłyby niewidoczne
    if (tSong !== undefined && Math.abs(this.time - tSong) > 0.25) this.time = tSong;
    this.mat.uniforms.uTime.value = this.time;
    this.pulse = Math.max(0, this.pulse - dt * 3.2);
  }
}
