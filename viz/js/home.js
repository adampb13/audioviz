// Strona główna: biblioteka utworów + wgrywanie + uruchamianie skryptów analizy.
//
// Zasady, które trzymają to szybkie i spójne:
//  • jedno źródło prawdy o stanie = serwer (/api/state); strona nic nie zgaduje,
//  • karty są tworzone RAZ na utwór i tylko „łatane” — pełny re-render co sekundę
//    gubiłby fokus i przewijanie (i migotał),
//  • gdy nie ma aktywnego zadania, odpytywanie zwalnia do 5 s,
//  • każda akcja jest przyciskiem, a nie ukrytym gestem: błąd zawsze widać w #toast.

import { titleFor } from "./titles.js";

const $ = (sel) => document.querySelector(sel);
const STEMS = [
  { id: "wokal", label: "wokal" },
  { id: "bas", label: "bas" },
  { id: "bebny", label: "bębny" },
  { id: "inne", label: "inne" },
];
const AUDIO_EXT = [".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aiff", ".aif"];

const els = {
  env: $("#env"), count: $("#count"), tracks: $("#tracks"),
  drop: $("#drop"), pick: $("#pick"), file: $("#file"), prog: $("#prog"),
  drophint: $("#drophint"), sephint: $("#sephint"),
  jobpane: $("#jobpane"), jpTitle: $("#jp-title"), jpMeta: $("#jp-meta"),
  jpSteps: $("#jp-steps"), jpCancel: $("#jp-cancel"), log: $("#log"),
  toast: $("#toast"), refresh: $("#refresh"), stemsOpen: $("#stems-open"),
  stems: $("#stems"), stemsRows: $("#stems-rows"), stemsSlug: $("#stems-slug"),
};

let caps = {};
let cards = new Map();          // slug -> {root, refs}
let lastSlugs = "";
let activeJobId = null;
let timer = null;
let lastUpload = "";      // ostatnio wgrany plik — podpowiedź nazwy w dialogu stemów

// ------------------------------------------------------------------ pomocnicze
function toast(msg, bad = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle("bad", bad);
  els.toast.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("on"), bad ? 6000 : 2800);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch { /* np. 500 bez JSON-a */ }
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body;
}

const fmtTime = (s) => {
  if (s == null) return "—";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};
// ETA z serwera: „~2 min 10 s" czyta się lepiej niż „2:10" w zdaniu
const fmtEta = (s) => {
  if (s == null) return "—";
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60), r = t % 60;
  return r ? `${m} min ${String(r).padStart(2, "0")} s` : `${m} min`;
};
// etykieta kroku z czasem: w toku pokazujemy RESZTĘ, w kolejce CAŁOŚĆ,
// po fakcie ZMIERZONY czas (serwer podstawia go w `eta`)
function stepChip(s) {
  const cls = s.status === "running" ? "run" : s.status;
  let tail = "";
  let title = "szacowany czas";
  if (s.status === "done") {
    tail = s.eta ? ` · ${fmtEta(s.eta)}` : "";
    title = "zmierzony czas";
  } else if (s.status === "running") {
    // ETA to szacunek — gdy krok go przegonił, lepiej to powiedzieć, niż pokazać „0 s”
    tail = s.eta_left > 0.5
      ? ` ~${fmtEta(s.eta_left)}`
      : ` · dłużej niż ~${fmtEta(s.eta)}`;
  } else {
    tail = s.eta ? ` ~${fmtEta(s.eta)}` : "";
  }
  return `<span class="jp-step ${cls}" title="${title}">${s.label}${tail}</span>`;
}
// polska liczba mnoga: 1 utwór · 2-4 utwory · 5+ utworów (z wyjątkiem 12-14)
function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}

// ------------------------------------------------------------------ stan
async function tick() {
  let st;
  try {
    st = await api("/api/state");
  } catch (e) {
    els.env.innerHTML = `<span class="no">serwer nie odpowiada</span> — ${e.message}`;
    schedule(4000);
    return;
  }
  caps = st.caps || {};
  // Renderowanie nie może zabić pętli odświeżania: wyjątek w jednym widoku
  // (np. gdy zadanie zmienia stan w trakcie rysowania) zamrażał CAŁY panel
  // z ostatnim ujęciem licznika. Błąd logujemy, ale pętlę zawsze planujemy dalej.
  for (const paint of [paintEnv, () => paintTracks(st.tracks || []),
                       () => paintJob((st.jobs || [])[0] || null)]) {
    try { paint(); } catch (e) { console.error("[home] render:", e); }
  }
  schedule(st.jobs && st.jobs.length ? 1100 : 5000);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

function paintEnv() {
  const sep = caps.separator
    ? "separator <b>gotowy</b>"
    : 'separator <span class="no">brak</span> · pip install audio-separator';
  els.env.innerHTML = `python <b>${caps.python || "?"}</b> · librosa <b>${caps.librosa ? "ok" : "brak"}</b> · ${sep}`;
  els.sephint.textContent = caps.separator ? "" : "podział na stem'y niedostępny w tym środowisku";
}

// ------------------------------------------------------------------ karty
function buildCard(t) {
  const root = document.createElement("article");
  root.className = "card";
  root.dataset.slug = t.slug;
  root.innerHTML = `
    <div class="c-head">
      <h3><span class="ttl"></span><span class="slug"></span></h3>
      <span class="badge"></span>
    </div>
    <ol class="steps">
      <li data-st="source"><b>źródło</b><span>—</span></li>
      <li data-st="stems"><b>stem'y</b><span>—</span></li>
      <li data-st="analysis"><b>analiza</b><span>—</span></li>
      <li data-st="hits"><b>uderzenia</b><span>—</span></li>
    </ol>
    <div class="actions">
      <a class="btn primary" data-act="open" href="#">otwórz wizualizację</a>
      <div class="row">
        <button class="ghost sm" data-act="prepare" type="button">przygotuj</button>
        <button class="ghost sm" data-act="reanalyze" type="button">analizuj ponownie</button>
        <button class="danger sm" data-act="delete" type="button">usuń</button>
      </div>
    </div>
    <div class="jobline"></div>`;
  const refs = {
    root,
    ttl: root.querySelector(".ttl"),
    slug: root.querySelector(".slug"),
    badge: root.querySelector(".badge"),
    open: root.querySelector('[data-act="open"]'),
    prepare: root.querySelector('[data-act="prepare"]'),
    reanalyze: root.querySelector('[data-act="reanalyze"]'),
    del: root.querySelector('[data-act="delete"]'),
    jobline: root.querySelector(".jobline"),
    steps: Object.fromEntries(STEMS.map((s) => [s.id, null])),
  };
  for (const li of root.querySelectorAll("ol.steps li")) refs.steps[li.dataset.st] = li;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    // „otwórz wizualizację" to zwykły <a> — blokowanie domyślnej akcji tylko
    // dlatego, że wisi w tym samym handlerze, odcinało nawigację
    if (btn.dataset.act !== "open") e.preventDefault();
    cardAction(btn.dataset.act, t.slug);
  });
  return { root, refs };
}

function paintTracks(list) {
  const slugs = list.map((t) => t.slug).join(",");
  if (slugs !== lastSlugs) {
    lastSlugs = slugs;
    cards.clear();
    els.tracks.innerHTML = "";
    if (!list.length) {
      els.tracks.innerHTML =
        `<div class="empty">brak utworów w data/ — wgraj pierwszy plik powyżej.</div>`;
    }
    for (const t of list) {
      const c = buildCard(t);
      cards.set(t.slug, c);
      els.tracks.append(c.root);
    }
  }
  els.count.textContent = `${list.length} ${plural(list.length, "utwór", "utwory", "utworów")}`;
  for (const t of list) {
    const c = cards.get(t.slug);
    if (c) patchCard(c.refs, t);
  }
}

function patchCard(r, t) {
  r.ttl.textContent = titleFor(t.slug);
  r.slug.textContent = t.slug;

  const a = t.analysis;
  const hasStems = t.stems && t.stems.length === 4;
  const busy = !!t.job;
  r.root.classList.toggle("ready", t.state === "ready");
  r.root.classList.toggle("job", busy);

  // --- kroki ---
  const set = (li, done, running, line) => {
    li.classList.toggle("done", !!done && !running);
    li.classList.toggle("run", !!running);
    li.querySelector("span").textContent = line;
  };
  set(r.steps.source, !!t.source, false,
      t.source ? `${t.source.pretty}` : "brak pliku");
  set(r.steps.stems, hasStems, busy && t.job?.current === "separate",
      hasStems ? "4 / 4" : `${t.stems?.length || 0} / 4`);
  set(r.steps.analysis, !!a && !a.broken, busy && t.job?.current === "analyze",
      a ? (a.broken ? "uszkodzony plik" : `${fmtTime(a.duration)} · ${a.fps ?? "?"} fps`)
        : "brak analysis.json");
  set(r.steps.hits, !!a && a.hits > 0, busy && t.job?.current === "hits",
      a ? (a.hits ? `${a.hits} zdarzeń` : "brak") : "—");

  // --- odznaka ---
  const badge = r.badge;
  badge.className = "badge";
  if (busy) {
    badge.classList.add("busy");
    badge.textContent = t.job.status === "queued" ? "w kolejce" : "przetwarzanie";
  } else if (t.state === "ready") {
    badge.classList.add("ready"); badge.textContent = "gotowy";
  } else if (t.state === "analyzed") {
    badge.classList.add("analyzed"); badge.textContent = "do dokończenia";
  } else if (t.state === "stems") {
    badge.textContent = !hasStems ? "niekompletny" : t.source ? "do analizy" : "tylko stem'y";
  } else {
    badge.textContent = "surowy plik";
  }

  // --- akcje ---
  const canOpen = t.playable && !busy;
  r.open.href = `./index.html?track=${encodeURIComponent(t.slug)}`;
  r.open.classList.toggle("off", !canOpen);
  r.open.setAttribute("aria-disabled", String(!canOpen));

  const missing = t.missing || [];
  const needsSeparate = missing.includes("separate");
  const blockSep = needsSeparate && !caps.separator;
  // „przygotuj” nie może proponować analizy, gdy stemów jest 1-3: serwer by to
  // odrzucił, a użytkownik dostałby błąd po kliknięciu zamiast wyjaśnienia.
  const stemsShort = missing.includes("analyze") && !hasStems;
  r.prepare.hidden = !missing.length;
  r.prepare.disabled = busy || blockSep || stemsShort || !missing.length;
  r.prepare.title = blockSep
    ? "brak audio-separator — wgraj gotowe stem'y"
    : stemsShort
      ? `analiza wymaga czterech stemów — masz ${t.stems?.length || 0} / 4`
      : missing.length
        ? `wykona: ${missing.map((m) => ({ analyze: "analiza", hits: "uderzenia", separate: "podział" }[m])).join(" → ")}`
        : "";
  r.reanalyze.hidden = !hasStems;
  r.reanalyze.disabled = busy;
  r.del.disabled = busy;

  r.jobline.classList.toggle("on", busy);
  if (busy) {
    const st = t.job;
    const cur = st.steps.find((s) => s.status === "running");
    const eta = st.eta_left ? ` · zostało ~${fmtEta(st.eta_left)}` : "";
    r.jobline.textContent = `${st.status === "queued" ? "w kolejce" : (cur?.label || "przygotowanie")} · ${st.elapsed}s${eta}`;
  }
}

// ------------------------------------------------------------------ akcje kart
async function cardAction(act, slug) {
  try {
    if (act === "open") return; // <a> sama nawiguje
    if (act === "delete") {
      if (!confirm(`Usunąć utwór „${titleFor(slug)}” razem ze stemami i analysis.json?`)) return;
      await api(`/api/tracks/${encodeURIComponent(slug)}`, {
        method: "DELETE", headers: { "X-Confirm": slug },
      });
      toast(`usunięto ${slug}`);
      return tick();
    }
    const body = act === "prepare"
      ? { slug, prepare: true }
      : { slug, steps: ["analyze", "hits"] };
    const res = await api("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const eta = res?.job?.eta_total;
    toast(`${act === "prepare" ? "uruchomiono przygotowanie" : "uruchomiono analizę"} · szac. ${fmtEta(eta)}`);
    tick();
  } catch (e) {
    toast(e.message, true);
  }
}

// ------------------------------------------------------------------ panel zadania
const seenDone = new Set();   // żeby „gotowe" nie powtarzało się przy każdym odświeżeniu
const DROPHINT_DEFAULT = "albo przeciągnij tutaj · wav, mp3, flac, m4a, ogg";
function paintJob(job) {
  if (!job) {
    if (activeJobId) { activeJobId = null; els.jobpane.classList.remove("on"); }
    return;
  }
  if (job.id !== activeJobId) {
    activeJobId = job.id;
    els.jpTitle.textContent = `przygotowanie · ${job.slug}`;
    els.jobpane.classList.add("on");
    els.log.textContent = "";
    els.log.dataset.atBottom = "1";
  }
  if (job.status === "queued") {
    els.jpMeta.textContent = `w kolejce (${job.queue_pos}) · szac. ${fmtEta(job.eta_total)}`;
  } else if (job.status === "running") {
    els.jpMeta.textContent = `${job.elapsed} s · zostało ~${fmtEta(job.eta_left)} (szac.)`;
  } else if (job.status === "done") {
    els.jpMeta.textContent = `gotowe · ${fmtEta(job.elapsed)}`;
    if (!seenDone.has(job.id)) { seenDone.add(job.id); toast(`gotowe: ${job.slug} · ${fmtEta(job.elapsed)}`); }
    els.drophint.textContent = DROPHINT_DEFAULT;   // znika „…w toku", gdy kafel jest już gotowy
  } else {
    els.jpMeta.textContent = `${job.status === "error" ? "błąd" : "anulowane"} · ${job.elapsed} s`;
    els.drophint.textContent = DROPHINT_DEFAULT;
  }
  els.jpSteps.innerHTML = job.steps.map(stepChip).join("");

  // log: dopisujemy tylko NOWE linie i trzymamy się dołu, jeśli użytkownik nie odjechał
  const atBottom = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 24;
  els.log.textContent = "";
  for (const l of job.lines) {
    const d = document.createElement("div");
    d.className = l.level;
    d.textContent = l.text;
    els.log.append(d);
  }
  if (atBottom) els.log.scrollTop = els.log.scrollHeight;
  els.jpCancel.hidden = job.status !== "queued" && job.status !== "running";
}

els.jpCancel.addEventListener("click", async () => {
  if (!activeJobId) return;
  try { await api(`/api/cancel?id=${activeJobId}`, { method: "POST" }); }
  catch (e) { toast(e.message, true); }
});

// ------------------------------------------------------------------ upload
function uploadFile(file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* niżej */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body?.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("połączenie przerwane"));
    xhr.send(file);
  });
}

async function handleFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const file = list[0];
  if (list.length > 1) { toast("na raz wgrywamy jeden plik muzyczny — stem'y mają osobny przycisk", true); }
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!AUDIO_EXT.includes(ext)) {
    toast(`nieobsługiwany format ${ext} — dozwolone: ${AUDIO_EXT.join(", ")}`, true);
    return;
  }
  els.drop.classList.add("busy");
  els.prog.classList.add("on");
  els.drophint.innerHTML = `<span class="name">${file.name}</span> · wysyłam…`;
  try {
    const res = await uploadFile(file, {
      onProgress: (p) => { els.prog.firstElementChild.style.width = `${Math.round(p * 100)}%`; },
    });
    els.drophint.innerHTML = `<span class="name">${res.file}</span> · ${res.pretty} — wgrane`;
    lastUpload = res.slug;
    toast(`wgrany ${res.file}`);
    await tick();
    if (caps.separator) {
      try {
        const job = await api("/api/run", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: res.slug, prepare: true }),
        });
        // od razu widać, ile to potrwa: osobno podział (Demucs) i analiza
        const steps = job?.job?.steps || [];
        const per = steps.map((s) => `${s.label} ~${fmtEta(s.eta)}`).join(" · ");
        els.drophint.innerHTML =
          `<span class="name">${res.file}</span> · ${res.pretty} — podział i analiza w toku`;
        toast(`podział i analiza w toku · ${per} · razem ~${fmtEta(job?.job?.eta_total)}`);
      } catch (e) { toast(e.message, true); }
    } else {
      toast("podział niedostępny — użyj „wgraj stem'y”, żeby przejść do analizy", true);
    }
    tick();
  } catch (e) {
    els.drophint.textContent = DROPHINT_DEFAULT;
    toast(e.message, true);
  } finally {
    els.drop.classList.remove("busy");
    setTimeout(() => { els.prog.classList.remove("on"); els.prog.firstElementChild.style.width = "0"; }, 900);
  }
}

els.pick.addEventListener("click", (e) => { e.stopPropagation(); els.file.click(); });
els.drop.addEventListener("click", () => els.file.click());
els.drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.file.click(); }
});
els.file.addEventListener("change", () => { handleFiles(els.file.files); els.file.value = ""; });
for (const ev of ["dragenter", "dragover"]) {
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("hot"); });
}
for (const ev of ["dragleave", "drop"]) {
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && els.drop.contains(e.relatedTarget)) return;
    els.drop.classList.remove("hot");
  });
}
els.drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

// ------------------------------------------------------------------ dialog stemów
const stemFiles = {};
function buildStemRows() {
  els.stemsRows.innerHTML = "";
  for (const s of STEMS) {
    const row = document.createElement("div");
    row.className = "stemrow";
    row.innerHTML = `
      <label>${s.label}</label>
      <input type="text" readonly placeholder="wybierz plik…" />
      <button type="button" class="ghost pick">wybierz</button>`;
    const input = row.querySelector("input");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".wav,.mp3,.flac,.ogg,.aiff";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const f = fileInput.files[0];
      if (!f) return;
      stemFiles[s.id] = f;
      input.value = f.name;
      row.querySelector(".pick").classList.add("ok");
      row.querySelector(".pick").textContent = "zmień";
    });
    row.querySelector(".pick").addEventListener("click", () => fileInput.click());
    row.append(fileInput);
    els.stemsRows.append(row);
  }
}

els.stemsOpen.addEventListener("click", () => {
  for (const k of Object.keys(stemFiles)) delete stemFiles[k];
  for (const row of els.stemsRows.children) {
    row.querySelector("input").value = "";
    const b = row.querySelector(".pick");
    b.classList.remove("ok");
    b.textContent = "wybierz";
  }
  els.stemsSlug.value = lastUpload;
  els.stems.showModal();
});
$("#stems-cancel").addEventListener("click", () => els.stems.close());

$("#stems-send").addEventListener("click", async (e) => {
  e.preventDefault();
  const slug = els.stemsSlug.value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (!slug) return toast("podaj nazwę utworu", true);
  const missing = STEMS.filter((s) => !stemFiles[s.id]).map((s) => s.label);
  if (missing.length) return toast(`brakuje: ${missing.join(", ")}`, true);

  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    for (const s of STEMS) {
      const f = stemFiles[s.id];
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      await fetch(`/api/stems/${encodeURIComponent(slug)}?stem=${s.id}&ext=${ext}`, {
        method: "PUT", body: f, headers: { "Content-Type": f.type || "application/octet-stream" },
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`); });
    }
    const job = await api("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, steps: ["analyze", "hits"] }),
    });
    els.stems.close();
    toast(`wgrane stem'y ${slug} — analiza w toku · szac. ${fmtEta(job?.job?.eta_total)}`);
    tick();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------------ start
els.refresh.addEventListener("click", () => { lastSlugs = ""; tick(); });
buildStemRows();
tick();
