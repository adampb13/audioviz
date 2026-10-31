// CZĄSTECZKI RYTMU — obraz RYTMU ścieżki „inne", a nie jej głośności.
//
// Poprzednie podejścia: iskry z obwiedni `peak` (mówiły tylko ILE się dzieje)
// i kręgi na piasku (dobre, ale zbyt „graficzne" — użytkownik chce cząsteczek).
// Wracamy do cząsteczek, ale z DWOMA zmianami, które robią całą różnicę:
//
//  1. Cząsteczki rodzą się z UDERZEŃ (`stems.inne.events.onsets`), czyli z tego
//     samego materiału co fale bębnów — więc widać rytm instrumentów, a nie
//     głośność. Jedno uderzenie = 1-3 cząsteczki, natychmiast, bez rozbiegu.
//  2. Produkcję ogranicza BRAMKA (patrz `gate`): refrakcja 0.15 s + próg siły
//     kalibrowany PER UTWÓR na ~1.5 zdarzenia/s. Surowych onsetów bywa 4-8 na
//     sekundę (mediana odstępu 0.3 s) i to dawało młyn cząsteczek, w którym nie
//     było słychać taktu. Teraz gęstość jest stała i czytelna: każdy przyjęty
//     onset daje 1 cząsteczkę, a uderzenia na takcie (siatka tempa z mediany
//     utworu) 2-3 — rytm widać w akcentach, nie w natłoku.
//
// Ruch: cząsteczka pojawia się od razu w pełnej jasności, potem SPOKOJNIE opada
// (0.3-0.8 m/s, lekki dryf) i gaśnie; dotknąwszy piasku osiada i dogasa w miejscu.
// Kolor z rejestru widma (ciemny żar / złoto / jaśniejsze złoto), rozmiar losowy.
//
// Koszt: jeden draw call (InstancedMesh, 160 cząsteczek w stałej puli), zero
// alokacji w pętli klatek, wszystko dt-owane.
import * as THREE from "three";
import { PRESETS, DEFAULT_PRESET } from "./palette.js";
import { clamp } from "./data.js";

const DEF = PRESETS[DEFAULT_PRESET].spark;
let COLD = DEF.cold.slice();
let MID = DEF.mid.slice();
let WARM = DEF.warm.slice();

const POOL = 160;          // stała pula — brak alokacji w klatce
const LIFE_MIN = 2.6;      // s
const LIFE_MAX = 4.6;      // s
const FALL_MIN = 0.30;     // m/s — spokojne opadanie
const FALL_MAX = 0.85;
const DRIFT = 0.14;        // boczny dryf (m/s)
const SIZE_MIN = 0.075;    // m — ~4 px na tej scenie
const SIZE_MAX = 0.28;
const GAIN = 2.4;          // jasność cząsteczki (× kolor rejestru)
const GROUND_Y = 0.06;     // piasek

// --- bramka produkcji (limity rytmu) ---
// Progi siły są PER UTWÓR (`calibrate`): na gęstym materiale wyżej, na rzadkim
// niżej, ale zawsze tak, żeby wyłapać puls, a nie każdy szmer.
const MIN_GAP = 0.15;      // twarda refrakcja: max ~6.5 zdarzenia/s
const WEAK_GAP = 0.55;     // słabe uderzenie poza taktem wymaga dłuższej przerwy
const BEAT_TOL = 0.08;     // ±80 ms od przewidywanego taktu = „na takt"
const WEAK_TH_DEFAULT = 0.30;
const ACC_TH_DEFAULT = 0.62;

export class RhythmWheel {
  constructor() {
    this.group = new THREE.Group();

    this.pos = new Float32Array(POOL * 3);
    this.vel = new Float32Array(POOL * 3);
    this.age = new Float32Array(POOL).fill(1e9);
    this.life = new Float32Array(POOL).fill(1);
    this.size = new Float32Array(POOL).fill(SIZE_MIN);
    this.gain = new Float32Array(POOL);          // jasność z siły uderzenia
    this.col = new Float32Array(POOL * 3);       // kolor rejestru
    this.shown = new Float32Array(POOL * 3);     // kolor × wygaszanie → GPU

    this.cursor = 0;
    this.now = 0;
    this.beat = 0;           // faza taktu 0..1 (diagnostyka/HUD)
    this.bpm = 120;
    this.marks = 0;          // żywe cząsteczki
    this.total = 0;          // przyjęte uderzenia
    this.dropped = 0;        // odrzucone przez bramkę
    this.spawned = 0;
    this.lastLane = 1;
    this.lapRate = 0;        // przyjęte zdarzenia/s (wygładzone)
    this.gridBpm = 120;      // STABILNE tempo siatki (mediana utworu) — nie dryfuje
    this.weakTh = WEAK_TH_DEFAULT;   // próg „słabego" uderzenia (kalibrowany)
    this.accTh = ACC_TH_DEFAULT;     // próg akcentu (kalibrowany)
    this.calib = null;       // wynik kalibracji — diagnostyka
    this._pending = 0;
    this._lastHit = -10;
    this._lastBeatHit = -10;

    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.shown, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    for (let i = 0; i < POOL; i++) {
      this._s.set(0.0001, 0.0001, 0.0001);
      this._m.compose(this._p.set(0, -50, 0), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Czy to uderzenie wchodzi? Zasady: mocne zawsze (po refrakcji), słabe tylko
  // gdy wypada na takt albo po dłuższej przerwie. Dzięki temu młyn surowych
  // onsetów zamienia się w czytelny puls.
  gate(t, strength) {
    const s = clamp(strength, 0, 1);
    const gap = t - this._lastHit;
    if (gap < MIN_GAP) return 0;

    const period = 60 / Math.max(40, this.gridBpm);
    const phase = ((t % period) / period + 1) % 1;
    const onBeat = Math.min(phase, 1 - phase) * period <= BEAT_TOL;

    // Przyjęcie zależy WYŁĄCZNIE od siły (próg skalibrowany na ~1.5 zdarzenia/s),
    // a takt decyduje o wielkości: na takcie 2-3 cząsteczki, między taktami 1.
    if (s >= this.accTh) return onBeat ? 3 : 2;                     // akcent
    return onBeat ? 2 : 1;
  }

  // Kalibracja progów na konkretnym utworze: dobieramy je tak, żeby bramka
  // puszczała ~`target` zdarzeń na sekundę. Gęsty materiał (4-8 onsetów/s) nie
  // zalewa sceny, rzadki nie milknie — a akcenty i takt zostają czytelne.
  calibrate(onsetT, onsetS, duration, bpm = 120, target = 1.5) {
    const n = Math.min(onsetT?.length || 0, onsetS?.length || 0);
    if (n < 8 || !(duration > 1)) return;

    // kandydatów filtrujemy tą samą refrakcją co bramka — inaczej kalibracja
    // liczyłaby zdarzenia, których bramka nigdy nie zobaczy
    const strengths = [];
    let last = -1e9;
    for (let i = 0; i < n; i++) {
      const t = onsetT[i];
      if (t - last < MIN_GAP) continue;
      last = t;
      strengths.push(clamp(onsetS[i], 0, 1));
    }
    if (strengths.length < 8) return;
    strengths.sort((a, b) => a - b);

    this.gridBpm = (bpm > 40 && bpm < 220) ? bpm : 120;

    const want = clamp(Math.round(target * duration), 8, strengths.length);
    const q = strengths[Math.max(0, strengths.length - want)];
    this.weakTh = clamp(q, 0.08, 0.72);
    this.accTh = clamp(this.weakTh * 1.55 + 0.10, 0.28, 0.95);
    this.calib = {
      candidates: strengths.length, want,
      weakTh: +this.weakTh.toFixed(3), accTh: +this.accTh.toFixed(3),
      perSec: +((strengths.length - strengths.findIndex((s) => s >= this.weakTh)) / duration).toFixed(2),
    };
  }

  // t — czas utworu (s), strength 0..1, bright 0..1 (rejestr widma)
  hit(t, strength, bright) {
    this.now = t;
    const n = this.gate(t, strength);
    if (!n) { this.dropped++; return; }

    this._lastHit = t;
    this.total++;
    this._pending++;
    const s = clamp(strength, 0, 1);
    const b = clamp(bright, 0, 1);
    const lane = b < 0.34 ? 0 : b < 0.67 ? 1 : 2;
    this.lastLane = lane;
    if (n >= 2) this._lastBeatHit = t;

    for (let k = 0; k < n; k++) this._spawn(s, lane);
  }

  _spawn(strength, lane) {
    const i = this.cursor % POOL;
    this.cursor++;
    const i3 = i * 3;

    // miejsce: losowo wokół sfery, czasem dalej na piasku — „na scenie", ale
    // nigdy pod kamerą i nigdy w powietrzu nad horyzontem
    const ang = Math.random() * Math.PI * 2;
    const rad = 1.6 + Math.pow(Math.random(), 0.65) * 8.2;
    this.pos[i3] = Math.cos(ang) * rad;
    // wysokość startu: akcent potrafi wyjść wysoko (na tle gór), słaby tuż nad piaskiem
    this.pos[i3 + 1] = 0.40 + Math.random() * (1.6 + 3.0 * strength);
    this.pos[i3 + 2] = Math.sin(ang) * rad * 0.82;

    this.vel[i3] = (Math.random() - 0.5) * DRIFT * 2;
    this.vel[i3 + 1] = -(FALL_MIN + Math.random() * (FALL_MAX - FALL_MIN));
    this.vel[i3 + 2] = (Math.random() - 0.5) * DRIFT * 2;

    this.age[i] = 0;
    this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    this.size[i] = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN) * (0.6 + 0.4 * strength);
    this.gain[i] = 0.55 + 0.45 * strength;

    let c;
    if (lane === 0) c = COLD;
    else if (lane === 1) c = MID;
    else c = [MID[0] + (WARM[0] - MID[0]) * 0.45,
              MID[1] + (WARM[1] - MID[1]) * 0.45,
              MID[2] + (WARM[2] - MID[2]) * 0.45];
    // lekka wariacja barwy, żeby chmura nie była jednolita
    const v = 0.86 + Math.random() * 0.28;
    this.col[i3] = c[0] * v;
    this.col[i3 + 1] = c[1] * v;
    this.col[i3 + 2] = c[2] * v;

    this.spawned++;
  }

  update(t, dt, active, bpm) {
    this.now = t;
    if (bpm) this.bpm = bpm;
    const period = 60 / Math.max(40, this.gridBpm);
    this.beat = (t % period) / period;

    const speed = active ? 1 : 0.55; // wyciszona ścieżka: dogasa wolniej
    let alive = 0;

    for (let i = 0; i < POOL; i++) {
      if (this.age[i] > this.life[i]) continue;
      this.age[i] += dt * speed;
      const u = this.age[i] / this.life[i];
      const i3 = i * 3;

      if (u >= 1) {
        this.age[i] = 1e9;
        this.shown[i3] = 0; this.shown[i3 + 1] = 0; this.shown[i3 + 2] = 0;
        this._s.set(0.0001, 0.0001, 0.0001);
        this._m.compose(this._p.set(0, -50, 0), this._q, this._s);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }

      // opadanie z osiadaniem na piasku (nie „przelatuje" przez scenę)
      let y = this.pos[i3 + 1] + this.vel[i3 + 1] * dt * speed;
      if (y <= GROUND_Y) {
        y = GROUND_Y;
        this.vel[i3 + 1] = 0;
        this.vel[i3] *= 0.4;
        this.vel[i3 + 2] *= 0.4;
      }
      this.pos[i3] += this.vel[i3] * dt * speed;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt * speed;

      // natychmiast pełna jasność, potem spokojne gaśnięcie
      const fade = Math.min(1, (1 - u) * 1.45);
      const k = fade * fade * GAIN * this.gain[i];
      this.shown[i3] = this.col[i3] * k;
      this.shown[i3 + 1] = this.col[i3 + 1] * k;
      this.shown[i3 + 2] = this.col[i3 + 2] * k;

      const sc = this.size[i];
      this._s.set(sc, sc, sc);
      this._m.compose(this._p.set(this.pos[i3], y, this.pos[i3 + 2]), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      if (fade > 0.05) alive++;
    }

    this.marks = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;

    const inst = this._pending / Math.max(dt, 1e-3);
    this._pending = 0;
    this.lapRate += (inst - this.lapRate) * (1 - Math.exp(-dt * 3));
  }

  setPalette({ cold, mid, warm }) {
    COLD = cold.slice(); MID = mid.slice(); WARM = warm.slice();
  }

  reset() {
    this.age.fill(1e9);
    this.life.fill(1);
    this.col.fill(0);
    this.shown.fill(0);
    this.cursor = 0;
    this.beat = 0;
    this.marks = 0;
    this.total = 0;
    this.dropped = 0;
    this.spawned = 0;
    this.lapRate = 0;
    this._pending = 0;
    this._lastHit = -10;
    this._lastBeatHit = -10;
    // progi i siatka NIE są tu zerowane — należą do utworu, nie do odtwarzania
    for (let i = 0; i < POOL; i++) {
      this._s.set(0.0001, 0.0001, 0.0001);
      this._m.compose(this._p.set(0, -50, 0), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
