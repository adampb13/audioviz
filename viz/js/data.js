// Wczytanie analysis.json i przygotowanie tablic typowanych pod animację 60 fps.
//
// Układ danych (zweryfikowany na pliku, nie zakładany):
//  - skalarne serie frames.* mają n_frames elementów,
//  - mel_db, chroma, mfcc, spectral_contrast są pasmo-po-paśmie: frames.mel_db[pasmo][klatka],
//  - events.sections to pary [start_s, koniec_s]; każdy stem ma własne sekcje, my bierzemy wokal
//    (wokal najlepiej odzwierciedla strukturę zwrotka/refren).

export const STEM_NAMES = ["wokal", "bas", "bebny", "inne"];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Wykładnicze wygładzanie niezależne od fps: po czasie dt dąży do celu z szybkością lambda.
// To odpowiednik "x += (cel - x) * 0.1" z konspektu, ale nie zależy od liczby klatek.
export const damp = (cur, target, lambda, dt) =>
  cur + (target - cur) * (1 - Math.exp(-lambda * dt));

export function percentile(arr, p) {
  const s = [];
  for (const v of arr) if (v !== null && v !== undefined && Number.isFinite(v)) s.push(v);
  if (!s.length) return 1;
  s.sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))] || 1;
}

function toF32(arr, fill = 0) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out[i] = v === null || v === undefined || !Number.isFinite(v) ? fill : v;
  }
  return out;
}

// Brakujące wartości (null, gdy pyin nie wykrył tonu) wypełnia poprzednią wartością,
// żeby pozycja wstęgi nie skakała do zera. Maskę ważności liczymy osobno (pitch_voiced_prob).
function forwardFill(arr) {
  const n = arr.length;
  const out = new Float32Array(n);
  let first = 0;
  while (first < n && (arr[first] === null || !Number.isFinite(arr[first]))) first++;
  let last = first < n ? arr[first] : 60;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v !== null && Number.isFinite(v)) last = v;
    out[i] = last;
  }
  return out;
}

export class Track {
  constructor(data) {
    const m = data.meta;
    this.fps = m.fps;
    this.n = m.n_frames;
    this.duration = m.duration;

    const S = data.stems;
    const w = S.wokal.frames;
    const b = S.bas.frames;
    const d = S.bebny.frames;
    const o = S.inne.frames;

    // wokal
    this.vRms = toF32(w.rms_norm);
    this.vFlat = toF32(w.flatness);
    this.vZcr = toF32(w.zcr);
    this.vProb = toF32(w.pitch_voiced_prob);
    this.vMidi = forwardFill(w.pitch_midi);
    this.vFlatP95 = percentile(w.flatness, 95);
    this.vZcrP95 = percentile(w.zcr, 95);

    // bas
    this.bRms = toF32(b.rms_norm);
    this.bBw = toF32(b.bandwidth_hz);
    this.bBwP95 = percentile(b.bandwidth_hz, 95);
    this.bMidi = forwardFill(b.pitch_midi);

    // bębny
    this.dRms = toF32(d.rms_norm);
    this.dOnset = toF32(d.onset_norm);
    this.dOnsetThr = percentile(d.onset_norm, 92);
    this.dCent = toF32(d.centroid_hz);

    this.dPeak = toF32(d.peak);
    this.dPeakP99 = percentile(d.peak, 99);

    // inne (zorza)
    this.oRms = toF32(o.rms_norm);
    this.oChroma = o.chroma.map((band) => toF32(band)); // [12][n]
    this.oMel = o.mel_db.map((band) => toF32(band)); // [32][n]

    // Beaty bębnów (posortowane) do sprawdzania, czy uderzenie pokrywa się z tempem
    this.beats = Float64Array.from(S.bebny.events.beats).sort();

    // Onsety bębnów z analizy (librosa, [czas_s, siła]). Używamy czasów zamiast progu na klatkach:
    // przy niższym fps render mógłby przeskoczyć krótki pik onsetu.
    const ons = S.bebny.events.onsets.slice().sort((a, b) => a[0] - b[0]);
    this.onsetT = Float64Array.from(ons, (x) => x[0]);
    // Progi klasyfikacji perkusji liczone z tego utworu: dolna tercja centroidu = stopa,
    // górna = talerze, środek = werbel. (Stałe progi względem p75 nie dawały prawie żadnych talerzy.)
    const cs = [];
    for (const te of this.onsetT) {
      const fr = clamp(Math.round(te * this.fps), 0, this.n - 1);
      if (this.dOnset[fr] >= 0.5 * this.dOnsetThr) cs.push(this.dCent[fr]);
    }
    this.onsetCentLo = percentile(cs, 33);
    this.onsetCentHi = percentile(cs, 67);

    this.sections = S.wokal.events.sections.map(([s, e]) => ({ start: s, end: e }));

    // Miks energii wszystkich stemów, znormalizowany p95 (0..~1.2)
    this.mixRms = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.mixRms[i] = (this.vRms[i] + this.bRms[i] + this.dRms[i] + this.oRms[i]) / 4;
    }
    const mixP95 = percentile(this.mixRms, 95);
    for (let i = 0; i < this.n; i++) this.mixRms[i] = clamp(this.mixRms[i] / mixP95, 0, 1.2);

    // Intensywność sekcji (reżyser): średnia energia w sekcji, skala względem najgłośniejszej
    const means = this.sections.map((sec) => {
      const i0 = Math.max(0, Math.floor(sec.start * this.fps));
      const i1 = Math.min(this.n, Math.max(i0 + 1, Math.floor(sec.end * this.fps)));
      let acc = 0;
      for (let i = i0; i < i1; i++) acc += this.mixRms[i];
      return acc / (i1 - i0);
    });
    const maxMean = Math.max(...means, 1e-6);
    this.sectionIntensity = means.map((v) => 0.12 + 0.88 * (v / maxMean));
  }

  frameAt(t) {
    return clamp(t * this.fps, 0, this.n - 1);
  }

  // Interpolacja liniowa między klatkami (płynny pitch między klatkami 60 fps)
  at(arr, f) {
    const i = Math.floor(f);
    const j = i + 1 < this.n ? i + 1 : i;
    return arr[i] + (arr[j] - arr[i]) * (f - i);
  }

  // Indeksy onsetów z przedziału (t0, t1]: [początek, koniec)
  onsetsBetween(t0, t1) {
    const up = (x) => {
      let lo = 0;
      let hi = this.onsetT.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.onsetT[mid] <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    return [up(t0), up(t1)];
  }

  sectionAt(t) {
    const secs = this.sections;
    for (let i = 0; i < secs.length; i++) if (t < secs[i].end) return i;
    return secs.length - 1;
  }

  // Odległość w sekundach do najbliższego beatu bębnów
  nearestBeatDist(t) {
    const B = this.beats;
    let lo = 0;
    let hi = B.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (B[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    let best = Infinity;
    if (lo < B.length) best = Math.min(best, Math.abs(B[lo] - t));
    if (lo > 0) best = Math.min(best, Math.abs(B[lo - 1] - t));
    return best;
  }

  chromaInto(idx, out) {
    for (let k = 0; k < 12; k++) out[k] = this.oChroma[k][idx];
    return out;
  }

  // mel_db -> 0..1 (stała normalizacja: -60 dB..+10 dB)
  melInto(idx, out) {
    for (let b = 0; b < 32; b++) out[b] = clamp((this.oMel[b][idx] + 60) / 70, 0, 1);
    return out;
  }
}
