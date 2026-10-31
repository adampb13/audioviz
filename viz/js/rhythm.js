// KRĘGI UDERZEŃ — obraz RYTMU ścieżki „inne", a nie jej głośności.
//
// Poprzednia wizualizacja „inne" (iskry z obwiedni `peak`) mówiła tylko ILE
// się dzieje. Rytm instrumentów siedzi w zdarzeniach: analiza daje
// `stems.inne.events.onsets = [[czas_s, siła], ...]` — setki uderzeń, mediana
// odstępu ~0.3 s. Z tego da się pokazać JAK grają.
//
// Obraz: każde uderzenie „uderza w piasek" i rozchodzi się po nim kręgiem
// światła. Krąg rośnie od sfery na zewnątrz i gaśnie, więc patrząc na piasek
// widzisz dokładnie sekwencję uderzeń: gęste kręgi = szybki przebieg, pojedynczy
// szeroki = mocny akcent, cisza = pusty piasek. Siła uderzenia daje zasięg
// i jasność kręgu, rejestr widma — barwę (ciemny żar → biel).
//
// Dlaczego kręgi: scena jest zbudowana z miękkich, płynących form (wstęga,
// koncentryczne fale na piasku), więc ostre igły/drobiny czytały się jak
// artefakt, a poziome pierścienie w powietrzu — jak kreska (kamera patrzy
// nisko). Fala na piasku jest w tej samej „miękkości" co reszta sceny i gra
// z falami, które piasek już ma.
//
// Koszt: jeden draw call (InstancedMesh), stała pula 12 kręgów, zero alokacji
// w pętli, wszystko dt-owane. Jasność idzie kolorem instancji (blending
// addytywny), więc bez własnego shadera i bez przezroczystości na materiale.
import * as THREE from "three";
import { PRESETS, DEFAULT_PRESET } from "./palette.js";
import { clamp } from "./data.js";

const DEF = PRESETS[DEFAULT_PRESET].spark;
let COLD = DEF.cold.slice(); // rejestr niski
let MID = DEF.mid.slice();   // środek
let WARM = DEF.warm.slice(); // rejestr wysoki

const SLOTS = 12;        // jednoczesne kręgi
const LIFE = 2.30;       // czas życia kręgu (s)
const R0 = 1.10;         // promień startowy (m) — tuż przy sferze
const R1 = 8.60;         // promień końcowy (m) — poza obrębem fal piasku
const GAIN = 1.12;       // jasność kręgu (× kolor rejestru)

export class RhythmWheel {
  constructor() {
    this.group = new THREE.Group();

    this.age = new Float32Array(SLOTS).fill(1e9); // wiek kręgu (s)
    this.life = new Float32Array(SLOTS).fill(1);  // 0..1 — siła uderzenia (zasięg)
    this.col = new Float32Array(SLOTS * 3);       // kolor rejestru
    this.shown = new Float32Array(SLOTS * 3);     // kolor × jasność → GPU
    this.reach = new Float32Array(SLOTS);         // maks. promień tego kręgu
    this.cursor = 0;
    this.phase = 0;
    this.lapRate = 0;
    this.bpm = 120;
    this.marks = 0;
    this.total = 0;
    this.lastLane = 1;
    this._pending = 0;

    // torus leżący płasko: promień 1, cienka rura — skalowany na instancji
    // rura 0.030 przy skali 1 → ~2-3 px: bloom dokłada miękką poświatę,
    // więc krąg czyta się jako fala światła, a nie jako ostra kreska
    const geo = new THREE.TorusGeometry(1, 0.030, 6, 128);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.07, 0); // tuż nad piaskiem, bez z-fightingu

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, SLOTS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.shown, 3);
    this.group.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    // start: wszystkie kręgi niewidoczne (skala 0)
    for (let i = 0; i < SLOTS; i++) {
      this._s.set(0.0001, 1, 0.0001);
      this._m.compose(this._p.set(0, 0, 0), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // strength 0..1 (siła uderzenia), bright 0..1 (rejestr: jasność widma)
  hit(strength, bright) {
    const s = clamp(strength, 0, 1);
    const b = clamp(bright, 0, 1);
    const lane = b < 0.34 ? 0 : b < 0.67 ? 1 : 2;
    this.lastLane = lane;

    // najstarszy krąg ustępuje nowemu — pula nigdy się nie rozrasta
    const i = this.cursor % SLOTS;
    this.cursor++;

    this.age[i] = 0;
    this.life[i] = s;
    this.reach[i] = R0 + (R1 - R0) * (0.45 + 0.55 * s);

    this._laneColor(i, lane);

    this.total++;
    this._pending++;
  }

  // Barwa zostaje w rodzinie akcentu sceny: niski rejestr = głęboki żar,
  // środek = złoto, wysoki = złoto rozjaśnione do 45% bieli. Pełna biel
  // wypadała z tonacji (preset `spark.warm` jest casi-biały, projektowany pod
  // drobne iskry, nie pod duże powierzchnie światła). Zapis wprost do tablicy —
  // zero alokacji, bo to leci na każdym uderzeniu.
  _laneColor(i, lane) {
    const i3 = i * 3;
    if (lane === 0) {
      this.col[i3] = COLD[0]; this.col[i3 + 1] = COLD[1]; this.col[i3 + 2] = COLD[2];
    } else if (lane === 1) {
      this.col[i3] = MID[0]; this.col[i3 + 1] = MID[1]; this.col[i3 + 2] = MID[2];
    } else {
      this.col[i3] = MID[0] + (WARM[0] - MID[0]) * 0.45;
      this.col[i3 + 1] = MID[1] + (WARM[1] - MID[1]) * 0.45;
      this.col[i3 + 2] = MID[2] + (WARM[2] - MID[2]) * 0.45;
    }
  }

  update(dt, active, bpm) {
    this.bpm = bpm || 120;
    const speed = active ? 1 : 0.55; // wyciszona ścieżka: fale wolniej dogasają
    let alive = 0;

    for (let i = 0; i < SLOTS; i++) {
      if (this.age[i] > LIFE) continue;
      this.age[i] += dt * speed;
      const u = clamp(this.age[i] / LIFE, 0, 1);
      if (u >= 1) {
        this.age[i] = 1e9;
        this.shown[i * 3] = 0;
        this.shown[i * 3 + 1] = 0;
        this.shown[i * 3 + 2] = 0;
        this._s.set(0.0001, 1, 0.0001);
        this._m.compose(this._p.set(0, 0, 0), this._q, this._s);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      // rozchodzenie: szybki start, spokojne wyhamowanie na końcu
      const e = 1 - Math.pow(1 - u, 2.2);
      const r = R0 + (this.reach[i] - R0) * e;
      this._s.set(r, 1, r);
      this._m.compose(this._p.set(0, 0, 0), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);

      // jasność: natychmiast po uderzeniu pełna, potem miękko gaśnie;
      // ×dystans przyrostu, żeby rozciągnięty krąg nie rósł w grubości wizualnej
      const fade = Math.pow(1 - u, 2.0);
      const k = fade * GAIN * (0.55 + 0.45 * this.life[i]);
      const i3 = i * 3;
      this.shown[i3] = this.col[i3] * k;
      this.shown[i3 + 1] = this.col[i3 + 1] * k;
      this.shown[i3 + 2] = this.col[i3 + 2] * k;
      if (fade > 0.06) alive++;
    }
    this.marks = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;

    const inst = this._pending / Math.max(dt, 1e-3);
    this._pending = 0;
    this.lapRate += (inst - this.lapRate) * (1 - Math.exp(-dt * 3));
    this.phase = (this.cursor % SLOTS) / SLOTS;
  }

  setPalette({ cold, mid, warm }) {
    COLD = cold.slice(); MID = mid.slice(); WARM = warm.slice();
    // nowe kręgi dostaną barwę nowego presetu
  }

  reset() {
    this.age.fill(1e9);
    this.life.fill(0);
    this.col.fill(0);
    this.shown.fill(0);
    this.cursor = 0;
    this.phase = 0;
    this.lapRate = 0;
    this.marks = 0;
    this.total = 0;
    this._pending = 0;
    for (let i = 0; i < SLOTS; i++) {
      this._s.set(0.0001, 1, 0.0001);
      this._m.compose(this._p.set(0, 0, 0), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
