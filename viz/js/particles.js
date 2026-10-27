// Systemy cząsteczek (GPU Points, rozmiar i kolor per cząstka).
//  - ParticleSystem.emit/update: cząsteczki z życiem (eksplozje stopy, iskry, strzępy wstęgi),
//  - ParticleSystem.updateDust: tło — nieskończone cząsteczki opadające pod wpływem basu.
import * as THREE from "three";

const VERT = `
attribute float aSize;
attribute vec3 aColor;
uniform float uPx;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPx / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform float uBright;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * a * a * uBright, 1.0);
}`;

export class ParticleSystem {
  constructor(parent, count) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count); // aSize (0 = niewidoczna)
    this.base = new Float32Array(count);
    this.life = new Float32Array(count); // <=0 = martwa
    this.maxLife = new Float32Array(count);
    this.speed = new Float32Array(count); // współczynnik prędkości (tło)
    this.cursor = 0;
    this.gravity = 0;
    this.drag = 0.5;
    this.uniforms = { uPx: { value: 800 }, uBright: { value: 1 } };

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));

    this.points = new THREE.Points(
      geom,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  emit(o) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.count;
    const k = i * 3;
    this.pos[k] = o.x;
    this.pos[k + 1] = o.y;
    this.pos[k + 2] = o.z;
    this.vel[k] = o.vx;
    this.vel[k + 1] = o.vy;
    this.vel[k + 2] = o.vz;
    this.col[k] = o.r;
    this.col[k + 1] = o.g;
    this.col[k + 2] = o.b;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.base[i] = o.size;
    this.size[i] = o.size;
  }

  // Cząsteczki balistyczne: prędkość, opór (drag) i grawitacja (this.gravity, +w dół)
  update(dt) {
    const dec = Math.exp(-this.drag * dt);
    const g = this.gravity * dt;
    for (let i = 0; i < this.count; i++) {
      let L = this.life[i];
      if (L <= 0) continue;
      L -= dt;
      this.life[i] = L;
      if (L <= 0) {
        this.size[i] = 0;
        continue;
      }
      const k = i * 3;
      this.vel[k + 1] -= g;
      this.vel[k] *= dec;
      this.vel[k + 1] *= dec;
      this.vel[k + 2] *= dec;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      // zanik rozmiaru z życiem (pierwiastek daje dłuższe, czytelne błyski)
      this.size[i] = this.base[i] * Math.sqrt(L / this.maxLife[i]);
    }
    this.flush();
  }

  // Tło: wszystkie cząsteczki żyją; opadają z prędkością sterowaną basem,
  // zawijają się wokół kamery w osi Z i w osi Y.
  initDust({ halfW, halfH, depth, camZ }) {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k] = (Math.random() * 2 - 1) * halfW;
      this.pos[k + 1] = (Math.random() * 2 - 1) * halfH;
      this.pos[k + 2] = camZ - depth + 6 + Math.random() * depth;
      this.speed[i] = 0.5 + Math.random();
      this.base[i] = 0.03 + Math.random() * 0.06;
      this.size[i] = this.base[i];
      this.life[i] = Infinity;
      this.maxLife[i] = 1;
      const tint = 0.6 + Math.random() * 0.4;
      this.col[k] = 0.7 * tint;
      this.col[k + 1] = 0.9 * tint;
      this.col[k + 2] = tint;
    }
    this.flush();
  }

  updateDust(dt, { fall, camZ, depth, halfW, halfH }) {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k + 1] -= fall * this.speed[i] * dt;
      if (this.pos[k + 1] < -halfH) this.pos[k + 1] += 2 * halfH;
      if (this.pos[k] > halfW) this.pos[k] -= 2 * halfW;
      else if (this.pos[k] < -halfW) this.pos[k] += 2 * halfW;
      if (this.pos[k + 2] > camZ + 6) this.pos[k + 2] -= depth;
      else if (this.pos[k + 2] < camZ - depth + 6) this.pos[k + 2] += depth;
    }
    this.flush();
  }

  flush() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aColor.needsUpdate = true;
  }
}
