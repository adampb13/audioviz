// Panel H: WSZYSTKIE parametry ramkowe ścieżki „inne" jako słupki wielkości.
// Jedno źródło prawdy = track.inneParams (data.js); ten moduł tylko próbkuje
// (interpolacja liniowa, ta sama zasada co sampleAt) i rysuje.
//
// Wydajność: słupki idą wyłącznie przez transform: scaleX/scaleY (kompozytor),
// więc pętla klatek nie robi ani jednego reflow. Liczby odświeżamy 4×/s —
// oko nie odczyta szybciej, a zapis textContent to layout.
import { clamp } from "./data.js";

// Kolejność i grupowanie 21 pól z stems.inne.frames (data.js → inneParams).
const GROUPS = [
  ["głośność", ["rms", "rms_norm", "rms_db", "peak", "zcr"]],
  ["widmo", [
    "centroid_hz", "bandwidth_hz", "rolloff_hz", "flatness",
    "spectral_contrast", "dominant_hz",
  ]],
  ["barwa", ["mel_db", "mfcc", "chroma", "chroma_active"]],
  ["zdarzenia", ["onset_strength", "onset_norm", "tempo_local_bpm"]],
  ["ton", ["pitch_hz", "pitch_midi", "pitch_voiced_prob"]],
];

// Krótkie etykiety tam, gdzie nazwa pola nie mieści się w kolumnie 78 px
// (pełna nazwa zostaje w title = p.id, więc nic nie ginie).
const SHORT = {
  spectral_contrast: "contrast",
  tempo_local_bpm: "tempo",
  pitch_voiced_prob: "voiced_prob",
  centroid_hz: "centroid",
  bandwidth_hz: "bandwidth",
  onset_strength: "onset_str",
};

// Pola, które realnie sterują iskrami (oznaczone kropką w panelu H).
const DRIVES = {
  peak: "steruje iskrami: gęstość emisji + rozmiar drobiny",
  centroid_hz: "steruje iskrami: kolor (ciemny żar ↔ biały żar) + wysokość wylotu z kuli",
};

const UNIT = {
  rms_db: "dB",
  centroid_hz: "Hz", bandwidth_hz: "Hz", rolloff_hz: "Hz", dominant_hz: "Hz", pitch_hz: "Hz",
  tempo_local_bpm: "bpm",
  pitch_midi: "midi",
};

// Próbkowanie jednego parametru w czasie t: out[0..k-1]. Zwraca k.
function sampleParam(p, t, fps, out) {
  const k = p.k;
  const n = p.data.length / k;
  if (n < 2) { for (let j = 0; j < k; j++) out[j] = 0; return k; }
  const f = clamp(t * fps, 0, n - 1.0001);
  const i = Math.floor(f);
  const fr = f - i;
  const a = i * k;
  const b = a + k;
  for (let j = 0; j < k; j++) out[j] = p.data[a + j] + (p.data[b + j] - p.data[a + j]) * fr;
  return k;
}

export function createInneHud(track) {
  const el = document.createElement("div");
  el.id = "inne";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "parametry ścieżki inne");

  const head = document.createElement("div");
  head.className = "hd";
  const hLeft = document.createElement("span");
  const hRight = document.createElement("span");
  head.append(hLeft, hRight);

  const byId = new Map(track.inneParams.map((p) => [p.id, p]));
  const rows = [];
  el.append(head);

  for (const [title, ids] of GROUPS) {
    const grp = document.createElement("div");
    grp.className = "grp";
    const gt = document.createElement("div");
    gt.className = "gt";
    gt.textContent = title;
    grp.append(gt);

    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue; // inny utwór może nie mieć wszystkich pól
      const row = document.createElement("div");
      row.className = p.k > 1 ? "row vec" : "row";

      const lb = document.createElement("span");
      lb.className = "lb";
      lb.textContent = SHORT[p.id] || p.label;
      lb.title = p.id;
      // • = parametr, który steruje iskrami (main.js → particles.js):
      //   peak → gęstość i rozmiar, centroid → kolor i miejsce wylotu
      if (DRIVES[p.id]) {
        lb.classList.add("drv");
        lb.title = `${p.id} — ${DRIVES[p.id]}`;
      }

      const vl = document.createElement("span");
      vl.className = "vl";

      if (p.k > 1) {
        // wektor (mel 32 / mfcc 13 / chroma 12 / kontrast 7): pasek pasm
        const strip = document.createElement("span");
        strip.className = "strip";
        strip.dataset.k = String(p.k);
        const bars = [];
        for (let j = 0; j < p.k; j++) {
          const b = document.createElement("i");
          strip.append(b);
          bars.push(b);
        }
        row.append(lb, strip, vl);
        rows.push({ p, bars, vl, tmp: new Float32Array(p.k) });
      } else {
        const bar = document.createElement("span");
        bar.className = "bar";
        const fill = document.createElement("i");
        bar.append(fill);
        row.append(lb, bar, vl);
        rows.push({ p, fill, vl, tmp: new Float32Array(1) });
      }
      grp.append(row);
    }
    el.append(grp);
  }

  function bars(t) {
    const fps = track.fps;
    for (const r of rows) {
      const p = r.p;
      const k = sampleParam(p, t, fps, r.tmp);
      const span = p.hi - p.lo || 1;
      if (k === 1) {
        r.fill.style.transform = `scaleX(${clamp((r.tmp[0] - p.lo) / span, 0, 1).toFixed(4)})`;
      } else {
        for (let j = 0; j < k; j++) {
          const v = clamp((r.tmp[j] - p.lo) / span, 0, 1);
          r.bars[j].style.transform = `scaleY(${v.toFixed(3)})`;
        }
      }
    }
  }

  // text(t, info): liczby i nagłówek — 4×/s, bo zapis textContent to layout.
  function text(t, info = {}) {
    hLeft.textContent = `inne · t ${t.toFixed(2)}  sec ${(info.section ?? 0) + 1}/${info.sections ?? 1}`;
    hRight.textContent =
      `${Math.round(info.fps ?? 60)}fps · ${info.waves ?? 0} fal` +
      (info.muted ? ` · ${info.muted}` : "");

    for (const r of rows) {
      const p = r.p;
      if (p.k === 1) {
        r.vl.textContent = fmt(r.tmp[0], p) + (UNIT[p.id] ? " " + UNIT[p.id] : "");
      } else {
        // dla pasm pokazujemy szczyt paska — reszta jest w słupkach
        let m = 0;
        for (let j = 0; j < p.k; j++) if (Math.abs(r.tmp[j]) > Math.abs(m)) m = r.tmp[j];
        r.vl.textContent = `×${p.k} ${fmt(m, p)}`;
      }
    }
  }

  return { el, bars, text };
}

function fmt(v, p) {
  if (!Number.isFinite(v)) return "—";
  const s = v.toFixed(p.dec);
  return s === "-0" || s === "-0.0" || s === "-0.00" ? s.slice(1) : s;
}
