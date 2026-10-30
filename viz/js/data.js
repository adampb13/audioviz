// Wczytanie analysis.json i przygotowanie tablic typowanych pod animację 60 fps.
// JEDYNY czytnik danych — moduły sceny nie sięgają do surowego JSON-a.
//
// Układ danych (zweryfikowany na pliku, nie zakładany):
//  - meta: { fps, n_frames, duration, stems: [...] }
//  - stems.<nazwa>.frames.* — serie skalarne długości n_frames (oś t = i / fps)
//  - stems.<nazwa>.events.onsets — [[czas_s, siła], ...]; beats — [czas_s, ...];
//    sections — [[start_s, koniec_s], ...]
//  - pitch_midi ma null-e, gdy pyin nie wykrył tonu -> forwardFill + maska pitch_voiced_prob.

export const STEM_FILES = ["wokal", "bas", "bebny", "inne"];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Wykładnicze wygładzanie niezależne od fps ("x += (cel - x) * alpha" z konspektu,
// zapisane jako szybkość lambda: alpha=0.12@60fps -> lambda ~7.7, alpha=0.08 -> ~5.0).
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

// Brakujące wartości pitch (null) wypełnia poprzednią, żeby pozycja nie skakała do zera.
function forwardFill(arr, seed = 60) {
  const n = arr.length;
  const out = new Float32Array(n);
  let first = 0;
  while (first < n && (arr[first] === null || !Number.isFinite(arr[first]))) first++;
  let last = first < n ? arr[first] : seed;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v !== null && Number.isFinite(v)) last = v;
    out[i] = last;
  }
  return out;
}

// Liniowa interpolacja serii klatkowej w czasie t [s] — zasada płynności absolutnej.
export function sampleAt(arr, fps, t) {
  const f = t * fps;
  let i = Math.floor(f);
  if (i < 0) i = 0;
  if (i >= arr.length - 1) return arr[arr.length - 1];
  const fr = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * fr;
}

// Kursor po posortowanych czasach zdarzeń (beaty/onsety) — triggery impulsowe,
// NIE interpolowane. reset(t) po seeku, poll(t, cb) w pętli.
export class EventCursor {
  constructor(times, values = null) {
    this.times = times;
    this.values = values;
    this.i = 0;
  }
  reset(t) {
    this.i = 0;
    while (this.i < this.times.length && this.times[this.i] < t) this.i++;
  }
  poll(t, cb) {
    while (this.i < this.times.length && this.times[this.i] <= t) {
      cb(this.times[this.i], this.values ? this.values[this.i] : 1);
      this.i++;
    }
  }
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
    this.vProb = toF32(w.pitch_voiced_prob);
    this.vMidi = forwardFill(w.pitch_midi);
    this.vCent = toF32(w.centroid_hz);
    this.vCentP95 = percentile(w.centroid_hz, 95) || 1;

    // bas
    this.bRms = toF32(b.rms_norm);
    // p95 głośności basu — struktura kuli normalizuje się do WŁASNEGO zakresu
    // basu (max utworu to 0.43), a nie do 0..1; bez tego bramka 0.30..0.92
    // łapała dopiero górne 25% basu i kula stała prawie gładka
    this.bRmsP95 = percentile(b.rms_norm, 95) || 1;
    this.bPeak = toF32(b.peak);
    this.bPeakP95 = percentile(b.peak, 95) || 1;
    this.bCent = toF32(b.centroid_hz);
    this.bCentP95 = percentile(b.centroid_hz, 95) || 1;

    // bębny
    this.dRms = toF32(d.rms_norm);
    this.dPeak = toF32(d.peak);
    this.dPeakP99 = percentile(d.peak, 99) || 1;
    this.dCent = toF32(d.centroid_hz);

    // inne
    this.oRms = toF32(o.rms_norm);
    this.oRmsP95 = percentile(o.rms_norm, 95) || 1; // do normalizacji głośności „inne"
    this.oCent = toF32(o.centroid_hz);
    this.oCentP95 = percentile(o.centroid_hz, 95) || 1;
    // jasność widma „inne" w log2 (ucho słyszy częstotliwość logarytmicznie):
    // z tego idzie KOLOR iskier i wysokość, z której wylatują z kuli
    this.oCentLo = Math.log2(Math.max(80, percentile(o.centroid_hz, 10) || 300));
    this.oCentHi = Math.max(this.oCentLo + 0.5, Math.log2(Math.max(120, this.oCentP95)));
    // szczyt „inne" — z niego odpalają się pojedyncze iskry po bokach kuli
    this.oPeak = toF32(o.peak);
    this.oPeakP95 = percentile(o.peak, 95) || 1;
    this.tempo = toF32(o.tempo_local_bpm || w.tempo_local_bpm, 120);

    // Zdarzenia: beaty (bębny + bas) i uderzenia bębnów z siłą znormalizowaną p95.
    // "hits" = pełny detektor transientów ze stemu (events.onsets gubi ~1/3 uderzeń);
    // fallback na onsety, gdy utwór nie ma jeszcze policzonych hits.
    this.beatsDrums = Float64Array.from(S.bebny.events.beats).sort();
    this.beatsBass = Float64Array.from(S.bas.events.beats).sort();
    const rawHits = S.bebny.events.hits || S.bebny.events.onsets;
    const ons = rawHits.slice().sort((a, b2) => a[0] - b2[0]);
    const onsStrP95 = percentile(ons.map((x) => x[1]), 95) || 1;
    this.onsetT = Float64Array.from(ons, (x) => x[0]);
    this.onsetS = Float32Array.from(ons, (x) => clamp(x[1] / onsStrP95, 0.05, 1));

    // Onsety basu i „inne" osobno — sfera-serce reaguje na nie różnie: „inne"
    // rozjaśnia, „bas" wypuszcza cząstki i zmienia strukturę. Ta sama
    // normalizacja p95 co dla bębnów, żeby siła 1.0 znaczyła to samo.
    const onsety = (stem) => {
      const arr = (stem.events.onsets || []).slice().sort((a, b2) => a[0] - b2[0]);
      const pr = percentile(arr.map((x) => x[1]), 95) || 1;
      return [
        Float64Array.from(arr, (x) => x[0]),
        Float32Array.from(arr, (x) => clamp(x[1] / pr, 0.05, 1)),
      ];
    };
    [this.bassOnsetT, this.bassOnsetS] = onsety(S.bas);
    // Każdy BIT ścieżki „bas" (siatka beatów, nie onsety) — z niej sfera
    // wypuszcza cząstki: "na każdy bit w basie", bez progu siły.
    this.bassBeatT = toF32(S.bas.events.beats || []);
    this.bassBeatS = new Float32Array(this.bassBeatT.length).fill(1);
    [this.otherOnsetT, this.otherOnsetS] = onsety(S.inne);

    // ---- WSZYSTKIE parametry ramkowe KAŻDEJ ścieżki (panel H) ----
    // Jedna definicja dla wszystkich stemów: panel H pokazuje ten sam zestaw
    // 21 pól dla wokal / bas / bebny / inne (bębny nie mają pól pitch*).
    // Packowane frame-major: data[i*k + j], gdzie i = ramka, j = pasmo.
    // Wektorowe pola w JSON są pasmowo (mel_db: 32 × n_frames), skalary: n_frames.
    // Skala słupka (lo..hi) jest STAŁA dla wielkości unormowanych (0..1, dB, midi)
    // i liczona jako p98 wartości bezwzględnej dla reszty — jeden głośny moment
    // nie ściska całej skali, a inny utwór działa bez zmian.
    const ABS_RANGE = {
      rms_norm: [0, 1], onset_norm: [0, 1], pitch_voiced_prob: [0, 1],
      chroma: [0, 1], chroma_active: [0, 12],
      rms_db: [-60, 0], mel_db: [-60, 22],
      tempo_local_bpm: [60, 180], pitch_midi: [36, 84], pitch_hz: [0, 1000],
    };
    const FIELDS = [
      ["rms", 0, 3], ["rms_norm", 0, 3], ["rms_db", 0, 1], ["peak", 0, 3], ["zcr", 0, 3],
      ["centroid_hz", 0, 0], ["bandwidth_hz", 0, 0], ["rolloff_hz", 0, 0],
      ["flatness", 0, 3], ["spectral_contrast", 1, 1], ["dominant_hz", 0, 0],
      ["mel_db", 1, 1], ["mfcc", 1, 1], ["chroma", 1, 2], ["chroma_active", 0, 0],
      ["onset_strength", 0, 2], ["onset_norm", 0, 3], ["tempo_local_bpm", 0, 1],
      ["pitch_hz", 0, 0], ["pitch_midi", 0, 1], ["pitch_voiced_prob", 0, 3],
    ];
    const packBands = (frames, field) => {
      const bands = frames[field] || [];
      const k = bands.length || 1;
      const out = new Float32Array(this.n * k);
      for (let j = 0; j < k; j++) {
        const b = bands[j] || [];
        for (let i = 0; i < this.n && i < b.length; i++) {
          out[i * k + j] = Number.isFinite(b[i]) ? b[i] : 0;
        }
      }
      return out;
    };
    const p98abs = (data) => {
      const a = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) a[i] = Math.abs(data[i]);
      return percentile(a, 98) || 1;
    };
    // Jedna ścieżka → lista parametrów do panelu H. Pola, których stem nie ma
    // (bębny nie mają pitch*), po prostu nie trafiają do listy.
    const buildParams = (frames) => {
      const out = [];
      for (const [field, vec, dec] of FIELDS) {
        const raw = frames[field];
        if (!raw || (vec ? !raw.length : !raw.length)) continue;
        let data;
        if (vec) data = packBands(frames, field);
        else if (field === "pitch_hz" || field === "pitch_midi") data = forwardFill(raw);
        else data = toF32(raw);
        const range = ABS_RANGE[field] || null;
        out.push({
          id: field,
          label: field, // etykieta w panelu H = nazwa pola z JSON
          k: data.length / this.n,
          data,
          lo: range ? range[0] : 0,
          hi: range ? range[1] : p98abs(data),
          dec,
        });
      }
      return out;
    };
    this.stemParams = {
      wokal: buildParams(w),
      bas: buildParams(b),
      bebny: buildParams(d),
      inne: buildParams(o),
    };
    this.inneParams = this.stemParams.inne; // zgodność wstecz (stary kod/README)

    // Sekcje z wokalu (najlepiej oddaje strukturę zwrotka/refren)
    this.sections = S.wokal.events.sections.map(([s, e]) => ({ start: s, end: e }));

    // Energia miksu dla sfery-serca: bas + inne + piki bębnów, normalizowana p95.
    this.energy = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const e = 0.45 * this.bRms[i] + 0.3 * this.oRms[i] + 0.25 * clamp(this.dPeak[i] / this.dPeakP99, 0, 1);
      this.energy[i] = e;
    }
    const eP95 = percentile(this.energy, 95) || 1;
    for (let i = 0; i < this.n; i++) this.energy[i] = clamp(this.energy[i] / eP95, 0, 1.15);
  }

  sectionAt(t) {
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i];
      if (t >= s.start && t < s.end) return i;
    }
    return this.sections.length - 1;
  }
}
