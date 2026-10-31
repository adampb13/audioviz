// Panel H: WSZYSTKIE parametry ramkowe WSZYSTKICH ścieżek (wokal, bas, bębny,
// inne) + blok diagnostyczny sceny.
//
// Jedno źródło prawdy = track.stemParams (data.js); ten moduł tylko próbkuje
// (interpolacja liniowa, ta sama zasada co sampleAt) i rysuje.
//
// Wydajność: słupki idą wyłącznie przez transform: scaleX/scaleY (kompozytor),
// więc pętla klatek nie robi ani jednego reflow. Słupki odświeżamy 30×/s
// (panel jest diagnostyczny — oko nie odczyta szybciej), liczby 4×/s, bo zapis
// textContent to layout. Zwiniętej sekcji nie próbkujemy wcale.
import { clamp } from "./data.js";

// Ścieżki w kolejności panelu: id w track.stemParams, nazwa, rola w scenie.
const STEMS = [
  ["wokal", "wokal", "wstęga · drżenie"],
  ["bas", "bas", "struktura kuli"],
  ["bebny", "bębny", "fale · puls"],
  ["inne", "inne", "koło rytmu"],
];

// Grupowanie 21 pól (ta sama kolejność co w JSON-ie, tylko pogrupowana).
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
  pitch_midi: "midi",
  pitch_hz: "pitch",
};

// Pola, które REALNIE moderują scenę — kropka przy wartości + tooltip.
// Klucz to `stem.id` z analysis.json (np. `inne.onset_strength`), a nie etykieta:
// poprzednie wpisy („inne.onset siła") nie trafiały w żadne p.id, więc kropka
// nie pojawiała się przy najważniejszych parametrach cząsteczek.
const DRIVES = {
  "inne.onset_strength": "cząsteczki: każde uderzenie = 1-3 iskry (siła → ile i jak duże); bramka trzyma ~1.5 zdarzenia/s",
  "inne.onset_norm": "cząsteczki: znormalizowana siła uderzenia — ta sama bramka, inna skala",
  "inne.centroid_hz": "cząsteczki: barwa rejestru — ciemny żar / złoto / jaśniejsze złoto",
  "bas.rms_norm": "struktura kuli: amplituda i tempo falowania powłoki (uStruct/uWobble)",
  "bebny.rms_norm": "fale na ziemi + puls rozmiaru kuli (próg akcentu liczony z tego sygnału)",
  "bebny.peak": "fale na ziemi + puls rozmiaru kuli — szczyt wyznacza akcent",
  "wokal.rms_norm": "szerokość wstęgi + drżenie powierzchni kuli",
  "wokal.pitch_midi": "wysokość wstęgi (unosi się z melodią)",
  "wokal.centroid_hz": "jasność wstęgi — wyższe składowe = jaśniejsze złoto",
};

const UNIT = {
  rms_db: "dB",
  centroid_hz: "Hz", bandwidth_hz: "Hz", rolloff_hz: "Hz", dominant_hz: "Hz",
  pitch_hz: "Hz",
  tempo_local_bpm: "bpm",
  // pitch_midi bez jednostki: etykieta wiersza już mówi "midi", a "58.2 midi"
  // nie mieściło się w kolumnie 54px i zawijało się na drugą linię
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

// ---------- blok diagnostyczny: wiersze "etykieta → tekst" ----------
// get(info) zwraca gotowy string; brak danych = „—”.
const DBG = [
  ["scena", [
    ["t sceny", (i) => i.t.toFixed(2) + " s"],
    ["audio", (i) => (i.audioT == null ? "demo" : i.audioT.toFixed(2) + " s")],
    ["Δ zegara", (i) => (i.audioT == null ? "—" : fmtSigned(i.audioT - i.t, 3) + " s")],
    ["seek", (i) => (i.seekT == null ? "—" : i.seekT.toFixed(2) + " s")],
    ["sekcja", (i) => `${(i.section ?? 0) + 1}/${i.sections ?? 1}`],
    ["stan", (i) => i.state ?? "—"],
  ]],
  ["wydajność", [
    ["fps", (i) => Math.round(i.fps ?? 0) + (i.fpsP95 ? ` · p5 ${i.fpsP95}` : "")],
    ["klatka", (i) => (i.dt ? (i.dt * 1000).toFixed(1) + " ms" : "—")],
    ["pixel ratio", (i) => (i.px ?? 1).toFixed(2)],
    ["draw calls", (i) => String(i.calls ?? 0)],
    ["trójkąty", (i) => fmtK(i.tris ?? 0)],
  ]],
  ["sfera", [
    ["glow (kolor)", (i) => f3(i.core?.glow)],
    ["uStruct", (i) => f3(i.core?.uStruct), true],
    ["uWobble", (i) => f3(i.core?.uWobble)],
    ["puls bębnów", (i) => f3(i.core?.pulse), true],
    ["skala", (i) => f3(i.core?.scale)],
    ["promień", (i) => (i.core?.radius != null ? i.core.radius.toFixed(3) + " m" : "—")],
  ]],
  // surowe próbki vs obwiednie — tu widać, czy scena nadąża za dźwiękiem
  ["obwiednie (surowe → stan)", [
    ["wokal", (i) => arrow(i.raw?.vRms, i.env?.vRms)],
    ["bas", (i) => arrow(i.raw?.bRms, i.env?.bRms)],
    ["bębny", (i) => arrow(i.raw?.dRms, i.env?.dRms)],
    ["inne", (i) => arrow(i.raw?.oRms, i.env?.oRms)],
    ["energia", (i) => arrow(i.raw?.energy, i.env?.energy), true],
    ["tempo", (i) => (i.tempo ? Math.round(i.tempo) + " bpm" : "—")],
  ]],
  // koronę czytamy jak miernik rytmu: ile słupków pali się TERAZ, jak szybko
  // biegnie światło (uderzenia/s) i jak jasne jest widmo ostatniego uderzenia
  ["korona rytmu", [
    ["zapalone / 48", (i) => String(i.other?.marks ?? 0)],
    ["tempo światła", (i) => (i.other?.rate != null ? i.other.rate.toFixed(2) + " /s" : "—")],
    ["obwiednia", (i) => f3(i.other?.env)],
    ["jasność widma", (i) => f3(i.other?.bright)],
    ["ostatni peak", (i) => f3(i.other?.peak)],
  ]],
  ["zdarzenia", [
    ["fale", (i) => String(i.waves ?? 0), true],
    ["onsety", (i) => String(i.onsets ?? 0)],
    ["rozbłyski", (i) => String(i.bursts ?? 0)],
    ["trafienia inne", (i) => String(i.otherHits ?? 0), true],
    ["cząsteczki rytmu", (i) => String(i.wheelMarks ?? 0), true],
    ["dropEnv", (i) => f3(i.dropEnv)],
  ]],
  ["utwór / miks", [
    ["utwór", (i) => i.track ?? "—"],
    ["długość", (i) => (i.duration ? i.duration.toFixed(1) + " s" : "—")],
    ["głośności", (i) => i.gains ?? "—"],
    ["głośność", (i) => i.volume ?? "—"],
    ["preset", (i) => i.preset ?? "—"],
    ["kontekst", (i) => (i.ctxLost ? "utracony" : "ok")],
  ]],
];

export function createHud(track) {
  const el = document.createElement("div");
  el.id = "stempanel";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "parametry wszystkich ścieżek");

  const head = document.createElement("div");
  head.className = "hd";
  const hLeft = document.createElement("span");
  const hRight = document.createElement("span");
  head.append(hLeft, hRight);
  el.append(head);

  // Dwie kolumny flex z ręcznym podziałem sekcji (lewa: wokal+bas+bębny,
  // prawa: inne+scena — po ~60 wierszy). CSS multicol rozrywał sekcje
  // i przestawiał nagłówki, więc jest zwykłe flex + jeden scrollbar.
  const cols = document.createElement("div");
  cols.className = "cols";
  const colA = document.createElement("div");
  colA.className = "col";
  const colB = document.createElement("div");
  colB.className = "col";
  cols.append(colA, colB);
  el.append(cols);
  const PLACE = { wokal: colA, bas: colA, bebny: colA, inne: colB };

  const rows = [];   // wszystkie słupki (płasko) — bars() leci po tej liście
  const stems = [];  // sekcje ścieżek — do zwijania i próbkowania

  for (const [key, title, role] of STEMS) {
    const params = track.stemParams?.[key] || [];
    const sec = document.createElement("section");
    sec.className = "pstm";
    sec.dataset.stem = key;

    const sh = document.createElement("div");
    sh.className = "sh";
    sh.title = `${key}.frames — klik: zwiń`;
    const shName = document.createElement("span");
    shName.className = "nm";
    shName.textContent = title;
    const shRole = document.createElement("span");
    shRole.className = "rl";
    shRole.textContent = role;
    sh.append(shName, shRole);
    sec.append(sh);

    const byId = new Map(params.map((p) => [p.id, p]));
    const body = document.createElement("div");
    body.className = "sb";
    sec.append(body);

    const local = [];
    for (const [gt, ids] of GROUPS) {
      const grp = document.createElement("div");
      grp.className = "grp";
      const gtl = document.createElement("div");
      gtl.className = "gt";
      gtl.textContent = gt;
      grp.append(gtl);

      for (const id of ids) {
        const p = byId.get(id);
        if (!p) continue; // np. bębny nie mają pól pitch*
        const row = document.createElement("div");
        row.className = p.k > 1 ? "row vec" : "row";

        const lb = document.createElement("span");
        lb.className = "lb";
        lb.textContent = SHORT[p.id] || p.label;
        lb.title = `${key}.${p.id}`;
        const drive = DRIVES[`${key}.${p.id}`];
        if (drive) {
          lb.classList.add("drv");
          lb.title = `${key}.${p.id} — ${drive}`;
        }

        const vl = document.createElement("span");
        // Kropka siedzi przy WARTOŚCI (nie przy etykiecie): to ona się zmienia,
        // gdy parametr moderuje scenę. Tooltip zostaje na etykiecie.
        vl.className = drive ? "vl drv" : "vl";
        if (drive) vl.title = drive;

        let entry;
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
          entry = { p, bars, vl, tmp: new Float32Array(p.k) };
        } else {
          const bar = document.createElement("span");
          bar.className = "bar";
          const fill = document.createElement("i");
          bar.append(fill);
          row.append(lb, bar, vl);
          entry = { p, fill, vl, tmp: new Float32Array(1) };
        }
        grp.append(row);
        local.push(entry);
        rows.push(entry);
      }
      // grupa bez ani jednego pola (bębny nie mają pitch*) nie trafia do panelu
      if (grp.childElementCount > 1) body.append(grp);
    }

    // zwijanie: nagłówek ścieżki chowa jej grupy (i wyłącza próbkowanie)
    sh.addEventListener("click", () => {
      const off = sec.classList.toggle("fold");
      for (const e of local) e.off = off;
    });

    stems.push({ sec, local });
    (PLACE[key] || colB).append(sec);
  }

  // ---------- blok diagnostyczny ----------
  const dbg = document.createElement("section");
  dbg.className = "pstm dbg";
  const dh = document.createElement("div");
  dh.className = "sh";
  const dn = document.createElement("span");
  dn.className = "nm";
  dn.textContent = "scena";
  const dr = document.createElement("span");
  dr.className = "rl";
  dr.textContent = "diagnostyka";
  dh.append(dn, dr);
  dbg.append(dh);

  const dbgRows = [];
  for (const [title, items] of DBG) {
    const grp = document.createElement("div");
    grp.className = "grp";
    const gtl = document.createElement("div");
    gtl.className = "gt";
    gtl.textContent = title;
    grp.append(gtl);
    for (const [label, get, drv] of items) {
      const row = document.createElement("div");
      row.className = "row kv";
      const lb = document.createElement("span");
      lb.className = "lb";
      lb.textContent = label;
      const vv = document.createElement("span");
      vv.className = drv ? "vv drv" : "vv";
      if (drv) vv.title = "ta wartość moderuje scenę";
      row.append(lb, vv);
      grp.append(row);
      dbgRows.push({ vv, get });
    }
    dbg.append(grp);
  }
  // zwijanie bloku diagnostycznego tak samo jak ścieżek
  dh.addEventListener("click", () => dbg.classList.toggle("fold"));
  colB.append(dbg);

  // 30 Hz na słupki (panel diagnostyczny), 4 Hz na liczby (textContent = layout)
  let acc = 1, lastT = -1;
  function bars(t, dt = 0.016) {
    acc += dt;
    if (acc < 1 / 30) return;
    acc = 0;
    if (Math.abs(t - lastT) < 1e-6) return; // pauza: nic się nie zmienia
    lastT = t;
    const fps = track.fps;
    for (const r of rows) {
      if (r.off) continue;
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

  // text(t, info): liczby, nagłówek i blok diagnostyczny — 4×/s.
  function text(t, info = {}) {
    hLeft.textContent =
      `wszystkie ścieżki · t ${t.toFixed(2)} s · sekcja ${(info.section ?? 0) + 1}/${info.sections ?? 1}`;
    hRight.textContent =
      `${Math.round(info.fps ?? 60)} fps · ${info.calls ?? 0} calls · ${info.waves ?? 0} fal` +
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
    for (const r of dbgRows) {
      let v;
      try { v = r.get(info); } catch { v = "—"; }
      r.vv.textContent = v ?? "—";
    }
  }

  return { el, bars, text };
}

function fmt(v, p) {
  if (!Number.isFinite(v)) return "—";
  const s = v.toFixed(p.dec);
  return s === "-0" || s === "-0.0" || s === "-0.00" ? s.slice(1) : s;
}

function f3(v) {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(3);
}

function fmtSigned(v, d) {
  if (!Number.isFinite(v)) return "—";
  const s = v.toFixed(d);
  if (v > 0) return "+" + s;
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

function fmtK(v) {
  if (!Number.isFinite(v) || v === 0) return "0";
  return v >= 1000 ? Math.round(v / 1000) + "k" : String(Math.round(v));
}

// „surowe → obwiednia” + strzałka: jedyne miejsce, w którym od razu widać,
// czy scena goni dźwięk, czy już jest nad nim
function arrow(raw, env) {
  if (raw == null || env == null || !Number.isFinite(raw) || !Number.isFinite(env)) return "—";
  const d = env - raw;
  const sign = Math.abs(d) < 0.002 ? "=" : d > 0 ? "▲" : "▼";
  return `${raw.toFixed(3)} → ${env.toFixed(3)} ${sign}`;
}
