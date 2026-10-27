// Wstęga wokalu: historia próbek. Świeża próbka to głowa wstęgi (po prawej),
// starsze uciekają w lewo i gasną. Szerokość i przezroczystość płyną z danych wokalu.
import * as THREE from "three";

export class Ribbon {
  constructor(parent, { samples = 300, widthMul = 1, alphaMul = 1 }) {
    this.K = samples;
    this.widthMul = widthMul;
    this.alphaMul = alphaMul;
    this.hist = [];
    this.pos = new Float32Array(samples * 2 * 3);
    this.col = new Float32Array(samples * 2 * 3);

    const idx = [];
    for (let i = 0; i < samples - 1; i++) {
      const a = 2 * i;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      idx.push(a, c, b, b, c, d);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setIndex(idx);

    this.mesh = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  // s = { t, y, w, a, rough, zw }  — zw to pozycja Z w świecie (nie lokalna)
  push(s) {
    this.hist.push(s);
    if (this.hist.length > this.K) this.hist.shift();
  }

  update(now, { headX, speed, nearZ, color }) {
    const H = this.hist;
    const n = H.length;
    const K = this.K;
    if (n === 0) {
      this.col.fill(0);
      this.mesh.geometry.attributes.color.needsUpdate = true;
      return;
    }
    for (let j = 0; j < K; j++) {
      const live = j < n;
      const s = H[live ? j : n - 1];
      const x = headX + (s.t - now) * speed;
      const y = s.y;
      const z = s.zw - nearZ;
      const hw = Math.max(0.002, s.w * this.widthMul);
      // Szorstkość (flatness/zcr) strzępi krawędzie: każda krawędź dostaje inne drżenie
      const fray = s.rough * 0.9;
      const jt = Math.sin(s.t * 47.3 + j * 0.71) * fray;
      const jb = Math.sin(s.t * 31.9 + j * 1.13 + 2.0) * fray;
      // Ogon gaśnie w kierunku najstarszych próbek
      const trail = live ? Math.pow(j / Math.max(1, n - 1), 1.2) : 0;
      const alpha = live ? s.a * this.alphaMul * trail : 0;

      const p = j * 6;
      this.pos[p] = x;
      this.pos[p + 1] = y + hw * (1 + jt);
      this.pos[p + 2] = z;
      this.pos[p + 3] = x;
      this.pos[p + 4] = y - hw * (1 + jb);
      this.pos[p + 5] = z;

      const r = color[0] * alpha;
      const g = color[1] * alpha;
      const b = color[2] * alpha;
      this.col[p] = r;
      this.col[p + 1] = g;
      this.col[p + 2] = b;
      this.col[p + 3] = r;
      this.col[p + 4] = g;
      this.col[p + 5] = b;
    }
    const geom = this.mesh.geometry;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  }
}
