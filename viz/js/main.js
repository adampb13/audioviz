// Boot sceny "Pustynna Fala Światła".
// Master clock = element audio wokalu (currentTime). analysis.json = scenariusz.
// Utwór wybierany parametrem ?track=<nazwa katalogu w ../data> (domyślnie blindinglights).
// Sterowanie: [SPACJA] start/pauza · [H] HUD · [Esc] ustawienia ·
// ?demo&t=123 — start bez gestu od 123 s.
import * as THREE from "three";
import { Track, STEM_FILES, EventCursor, sampleAt, damp, clamp } from "./data.js";
import { Ground } from "./ground.js";
import { CoreSphere } from "./core.js";
import { VocalRibbon } from "./ribbon.js";
import { Mountains } from "./mountains.js";
import { Atmosphere } from "./atmosphere.js";
import { createPost } from "./postfx.js";
import { createSettings } from "./settings.js";
import { applyPreset, PRESETS, DEFAULT_PRESET } from "./palette.js";
import { titleFor } from "./titles.js";

// Wartości startowe sceny = preset domyślny (applyPreset i tak je ustawia,
// ale konstruktory muszą dostać sensowne kolory już przy tworzeniu materiałów).
const DEF = PRESETS[DEFAULT_PRESET];
import { createHud } from "./hud.js";
import { RhythmWheel } from "./rhythm.js";

const params = new URLSearchParams(location.search);
// ?debug = sonda + ślad klatek (ring 900 klatek ≈ 6 s przy 144 fps)
const DEBUG = params.has("debug");
const TRACK = params.get("track") || "blindinglights";
// ?track= to NAZWA KATALOGU (slug), nie tytuł — do pokazania na ekranie służy
// titleFor() z titles.js (wspólne z biblioteką, żeby obie strony mówiły to samo).
const TRACK_TITLE = titleFor(TRACK);
const AUDIO_DIR = `../data/${TRACK}/`;
const FOG_DENSITY = 0.009; // FogExp2 0x1a0f08, 0.009 (audit v2 P0-C)

const errBox = document.getElementById("err");
window.addEventListener("error", (e) => {
  errBox.hidden = false;
  errBox.textContent = String(e.message || e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  errBox.hidden = false;
  errBox.textContent = String(e.reason && (e.reason.stack || e.reason.message) || e.reason);
});

// ---------- renderer / scena / kamera ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
// Budżet pikseli: bufor rysowania + dwa render-targety kompozytora (half-float) rosną
// z KWADRATEM pixelRatio. Na ekranie 4K przy DPR 2 to ~33 mln px → ~800 MB VRAM,
// czyli realne ryzyko utraty kontekstu GPU i mrugających czarnych prostokątów.
// Dlatego tniemy DPR tak, by bufor nie przekraczał ~9 mln px (≈4K).
const MAX_BUF_PIXELS = 9.0e6;
function pixelRatioFor(w, h) {
  const max = Math.min(window.devicePixelRatio || 1, 2);
  // schodki 0.5 — wymiary bufora zostają całkowite (render-targety nie dostają
  // ułamkowych szerokości, które GL i tak obcina)
  for (let r = max; r >= 0.5; r -= 0.5) {
    if (w * r * h * r <= MAX_BUF_PIXELS) return r;
  }
  return 0.5;
}
renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // animowane w pętli: 1.0 + energySmooth*0.35
document.body.appendChild(renderer.domElement);

// Utrata kontekstu GPU (sterownik/TDR/przeciążenie VRAM): three sam woła preventDefault,
// ale render-targety kompozytora zostają ze starymi uchwytami → trzeba je odtworzyć,
// inaczej obraz zostaje czarny do końca sesji.
let ctxLost = 0;
renderer.domElement.addEventListener("webglcontextlost", () => { ctxLost++; }, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(DEF.pal.skyTop);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 7, 22);
camera.lookAt(0, 3, 0);

// ---------- dane ----------
const resp = await fetch(`${AUDIO_DIR}analysis.json`);
if (!resp.ok) {
  errBox.hidden = false;
  errBox.textContent = `Nie mogę wczytać ${AUDIO_DIR}analysis.json (HTTP ${resp.status})`;
  throw new Error("analysis.json missing");
}
const track = new Track(await resp.json());

// ---------- systemy sceny ----------
const ground = new Ground(DEF.pal.fog, FOG_DENSITY);
scene.add(ground.mesh);
const core = new CoreSphere();
scene.add(core.group);
const ribbon = new VocalRibbon();
scene.add(ribbon.group);
ribbon.resize(camera.aspect);
const mountains = new Mountains(); // własna mgła per pasmo (nie scena FogExp2)
scene.add(mountains.group);
mountains.resize(window.innerWidth / window.innerHeight);
const atmosphere = new Atmosphere();
atmosphere.setPixelRatio(renderer.getPixelRatio());
scene.add(atmosphere.group);
// Ścieżka „inne" ma JEDEN obraz, zbudowany z RYTMU (zdarzeń), nie z głośności:
//   • cząsteczki rytmu (rhythm.js) — iskra na akcent rozsypana po całej scenie,
//     opada i gaśnie; siła daje jasność, rejestr widma — barwę. Patrząc na
//     piasek widzisz sekwencję uderzeń, a nie głośność utworu.
const wheel = new RhythmWheel();
scene.add(wheel.group);

const post = createPost(renderer, scene, camera);

// ---------- preset barwy (jedno źródło prawdy dla całej sceny) ----------
// Wszystkie warstwy mają setPalette(); applyPreset rozdaje im nowe kolory,
// a interfejs dostaje akcenty przez zmienne CSS (--acc/--acc2), więc UI nie
// zostaje w złocie, gdy scena jest niebieska.
const sys = { scene, ground, core, ribbon, mountains, atmosphere, wheel, post };
let presetKey = applyPreset(DEFAULT_PRESET, sys);

// Sonda QA (?debug): dostęp do obiektów sceny dla zrzutów, pomiarów i bisectowania
if (params.has("debug")) {
  window.__dbg = { renderer, scene, camera, post, ground, core, ribbon, mountains, atmosphere, wheel };
}

// po utracie kontekstu render-targety trzeba zbudować od nowa
renderer.domElement.addEventListener("webglcontextrestored", () => {
  post.composer.reset();
  errBox.hidden = true;
  errBox.textContent = "";
}, false);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight));
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.composer.setPixelRatio(renderer.getPixelRatio());
  post.composer.setSize(window.innerWidth, window.innerHeight);
  atmosphere.setPixelRatio(renderer.getPixelRatio());
  mountains.resize(camera.aspect);
  ribbon.resize(camera.aspect);
});

// ---------- audio: 4 stem-y, master clock = pierwszy obecny ----------
const audio = {};
for (const name of STEM_FILES) {
  const el = new Audio();
  el.preload = "auto";
  el.src = `${AUDIO_DIR}${name}.wav`;
  el.onerror = () => { audio[name] = null; };
  audio[name] = el;
}
const masterAudio = () => STEM_FILES.map((n) => audio[n]).find((el) => el && el.src);

// ---------- panel ścieżek (przycisk w lewym dolnym rogu) ----------
// Wyciszenie ścieżki = `muted` na audio ORAZ gain 0 na jej sygnale w pętli,
// więc test „co robi sam bas / sam wokal" nie wymaga grzebania w kodzie.
const settings = createSettings({
  onToggle: (id, on) => {
    const el = audio[id];
    if (el) el.muted = !on;
  },
  onRestart: () => restartTrack(),
  // głośność ogólna: sam poziom dźwięku (scena czyta dane, nie sygnał głośnika)
  onVolume: (v) => {
    for (const n of STEM_FILES) {
      const el = audio[n];
      if (el) el.volume = v;
    }
  },
  onPreset: (key) => {
    presetKey = applyPreset(key, sys);
  },
  preset: DEFAULT_PRESET,
});
if (window.__dbg) { window.__dbg.settings = settings; window.__dbg.audio = audio; }

// ---------- zdarzenia (triggery impulsowe, bez interpolacji) ----------
// Fale i puls sfery pochodzą WYŁĄCZNIE z uderzeń w ścieżce "bebny"
// (track.onsetT/onsetS to onsety tego stemu z siłą znormalizowaną p95).
const onsets = new EventCursor(track.onsetT, track.onsetS);
// Uderzenia „inne" — osobny kursor: rytm tej ścieżki jedzie na cząsteczki.
// Sam kursor podaje KAŻDY onset; bramkę (próg siły, refrakcja, blokada na takt)
// trzyma rhythm.js — inaczej 4-8 zdarzeń/s dawało młyn bez czytelnego pulsu.
const oOnsets = new EventCursor(track.otherOnsetT, track.otherOnsetS);
// Progi bramki dobieramy do materiału (gęsty vs rzadki), zanim ruszy pierwsza
// klatka. Tempo siatki = MEDIANA tempa lokalnego: chwilowe BPM skacze (120→171
// w kilka sekund), więc siatka na nim dryfowałaby i „na takt" przestało cokolwiek
// znaczyć.
const gridBpm = (() => {
  const a = track.tempo;
  if (!a || !a.length) return 120;
  const v = [];
  for (let i = 0; i < a.length; i += 4) {
    const b = a[i];
    if (b > 40 && b < 220) v.push(b);
  }
  if (!v.length) return 120;
  v.sort((x, y) => x - y);
  return v[v.length >> 1];
})();
wheel.calibrate(track.otherOnsetT, track.otherOnsetS, track.duration, gridBpm);
let lastBass = -1, lastBurst = -10;
function resetCursors(t) {
  onsets.reset(t);
  oOnsets.reset(t);
  lastBurst = t - 2;    // po przewinięciu nie strzelamy fajerwerkiem od razu
  lastWaveT = t - 2;    // …i nie blokujemy pierwszej fali debounce'em z przyszłości
  oPeakPrev = 0;
  S.otherEnv = 0;
}

// Odporny reset warstwy sceny. Bez tego pojedynczy brak metody (np. stary
// moduł z cache przeglądarki: „ground.reset is not a function") przerywał
// restart w połowie — audio wracało do 0, a kursory i fale zostawały w tyle.
function safeReset(obj, name) {
  const fn = obj && obj[name];
  if (typeof fn !== "function") {
    console.warn(`[audioviz] brak ${name}() na warstwie sceny — pomijam. Twarde odświeżenie: Ctrl+F5.`);
    return false;
  }
  try { fn.call(obj); return true; } catch (e) {
    console.warn(`[audioviz] ${name}() rzucił wyjątek:`, e);
    return false;
  }
}

// „od początku”: audio, zegar demo, kursory zdarzeń, fale na ziemi.
// Stan odtwarzania zostaje — jeśli grało, gra dalej, tylko od 0 s.
function restartTrack() {
  const els = STEM_FILES.map((n) => audio[n]).filter(Boolean);
  for (const el of els) {
    try { el.currentTime = 0; } catch (e) { /* niegotowy strumień — zegar i tak wróci do 0 */ }
  }
  demoT = 0;
  pausedAt = null;
  beginSeek(0);         // seek jest asynchroniczny — patrz currentTime()
  resetCursors(0);
  safeReset(ground, "reset");
  safeReset(wheel, "reset");
  if (playing) for (const el of els) el.play().catch(() => {});
  if (window.__viz) window.__viz.t = 0;
}

// ---------- stan tłumiony (LERP: alpha=0.12 RMS, 0.08 pitch @60fps) ----------
const S = {
  vRms: 0, vProb: 0, vMidi: 60, vCent: 0,
  bRms: 0, bCent: 0,
  dRms: 0, oRms: 0, oSlow: 0, oCent: 0, tempo: 120, dPeak: 0,
  energy: 0, dropEnv: 0, dropLog: [], beatPulse: 0, wavesFired: 0, onsetsFired: 0, otherHits: 0, bassHits: 0, bursts: 0,
};
let lastWaveT = -10; // debounce fal (audit P0-6)
// CZĄSTECZKI = UDERZENIE ścieżki „inne" (mapowanie w README):
//   liczba i rozmiar ← siła uderzenia z `events.onsets`
//   kolor            ← `centroid_hz` w chwili uderzenia (jasne widmo = jaśniejsze złoto)
//   Bramka w rhythm.js przepuszcza ~2-4 zdarzenia/s (akcenty + uderzenia na takt).
const OTHER_LOUD = 0.10;   // poniżej tej głośności „inne" praktycznie milczy
const OTHER_FULL = 0.55;   // górna skala obwiedni na panelu H

let oPeakPrev = 0;         // ostatnia próbka `peak` — tylko sonda/HUD

S.otherEnv = 0;            // obwiednia głośności „inne" (tylko panel H)
S.otherBright = 0;         // jasność widma „inne" 0..1 (kolor słupka)
if (window.__dbg) window.__dbg.S = S;
// pomiary z checklisty: FPS p95 z bufora 240 klatek
const fpsHist = new Float32Array(240);
let fpsI = 0, fpsN = 0;

// ---------- odtwarzanie ----------
const btn = document.getElementById("start");
const overlay = document.getElementById("overlay");
const hud = document.getElementById("hud");
const hintTrack = document.getElementById("hint-track");
if (hintTrack) hintTrack.textContent = TRACK_TITLE;
// panel H: WSZYSTKIE parametry wszystkich czterech ścieżek + diagnostyka (hud.js)
const hudPanel = createHud(track);
hud.textContent = "";
hud.appendChild(hudPanel.el);
// informacje domyślnie schowane — klawisz H pokazuje/ukrywa podgląd stanu
hud.classList.add("off");
let hudOn = false; // panel H domyślnie schowany; słupki liczymy tylko gdy widać
let playing = false;
let demoMode = params.has("demo");
let demoT = parseFloat(params.get("t") || "0") || 0;
// Po pauzie zegar MUSI stać w miejscu. Wcześniej currentTime() wracał do demoT
// (=0), więc pauza przewijała utwór na początek, a wznowienie grało od zera —
// scena skakała (fale znikają, wstęga się resetuje).
let pausedAt = null;

// Przewinięcie elementu audio jest ASYNCHRONICZNE: po `el.currentTime = 0`
// element jeszcze przez kilka/kilkanaście klatek raportuje STARĄ pozycję
// (zmierzone: 31.48 s przez ~10 klatek po restarcie). Zegar czytający to
// bezpośrednio wystrzeliwał w przyszłość, kursor zdarzeń przeskakiwał na koniec
// listy, a lastWaveT lądował przed nami — czyli po restarcie ZERO fal i cisza
// w scenie do końca utworu. Dlatego po każdym seeku zegar stoi na celu,
// dopóki element go nie potwierdzi (z bezpiecznikiem 500 ms).
let seekT = null;   // cel przewijania
let seekUntil = 0;  // bezpiecznik w ms — gdyby element nigdy nie potwierdził

function beginSeek(t) {
  seekT = t;
  seekUntil = performance.now() + 500;
}

function currentTime() {
  const m = masterAudio();
  if (!m) return demoT;
  if (!playing) return pausedAt !== null ? pausedAt : demoT;
  if (seekT !== null) {
    if (Math.abs(m.currentTime - seekT) < 0.30 || performance.now() > seekUntil) seekT = null;
    else return seekT; // zegar stoi — scena nie widzi skoku w przyszłość
  }
  return m.currentTime;
}

async function setPlaying(p) {
  const els = STEM_FILES.map((n) => audio[n]).filter(Boolean);
  if (p) {
    const t0 = currentTime();
    beginSeek(t0); // ten sam problem: po przewinięciu element chwilę kłamie o pozycji
    for (const el of els) el.currentTime = t0;
    try {
      await Promise.all(els.map((el) => el.play()));
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent = String(e);
      return;
    }
    playing = true;
    demoMode = false;
    pausedAt = null;
    resetCursors(t0); // kursor uderzeń staje tam, gdzie wznowiliśmy — bez salwy zaległych fal
    overlay.classList.add("hidden");
  } else {
    // zapamiętaj pozycję PRZED pauzą, inaczej currentTime() nie ma czego zwrócić
    pausedAt = els.length ? els[0].currentTime : demoT;
    for (const el of els) el.pause();
    playing = false;
    overlay.classList.remove("hidden");
    btn.textContent = "Wznów";
  }
}

btn.addEventListener("click", () => setPlaying(true));
window.addEventListener("keydown", (e) => {
  // e.repeat: trzymana spacja potrafiła migać pauzą i wznawianiem (ciemna
  // zasłona overlay włączała się i wyłączała kilkanaście razy na sekundę)
  if (e.repeat) return;
  if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
  else if (e.code === "KeyH") { hudOn = !hudOn; hud.classList.toggle("off", !hudOn); }
});
if (demoMode) overlay.classList.add("hidden");
resetCursors(demoT);

// ---------- pętla ----------
const clock = new THREE.Clock();
let hudTimer = 0, fps = 60, prevT = 0;
window.__viz = {};
// pierścieniowy ślad klatek (?debug) + dostęp do niego z konsoli: __trace(300)
const TRACE_N = 900;
const trace = new Array(TRACE_N).fill(null);
let traceI = 0;
window.__trace = (n = TRACE_N) => {
  const out = [];
  for (let i = 0; i < TRACE_N; i++) {
    const v = trace[(traceI + i) % TRACE_N];
    if (v) out.push(v);
  }
  return out.slice(-n);
};

renderer.info.autoReset = false; // ręczny reset — info liczy CAŁĄ klatkę (scena+passy)
function frame() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  if (demoMode) demoT += dt; // demo bez audio: własny zegar, ten sam kod próbkowania
  const t = currentTime();
  // Siatka bezpieczeństwa: zegar cofnięty (seek w tył zrobiony gdzie indziej,
  // restart elementu przez przeglądarkę) = kursory i fale wracają do teraźniejszości.
  // Bez tego kursor stałby na końcu listy, a lastWaveT blokował fale do końca utworu.
  // Warunek seekT === null: podczas własnego przewijania zegar celowo stoi na celu
  // (0 s), więc to nie jest „cofnięcie" i nie wolno tu kasować blokady seeka.
  if (seekT === null && t < prevT - 0.25) {
    resetCursors(t);
    safeReset(ground, "reset");
    safeReset(wheel, "reset");
  }
  prevT = t;
  if (hudOn) hudPanel.bars(t, dt); // panel H: słupki 30 fps, tylko gdy widoczny

  // próbki surowe (interpolacja między klatkami) -> stan tłumiony (damp)
  // Gain ścieżek z panelu: 0 = wyciszona, jej sygnał nie wchodzi do animacji.
  const g = settings.gain;
  const vRmsRaw = sampleAt(track.vRms, track.fps, t);
  const vProbRaw = sampleAt(track.vProb, track.fps, t);
  const vMidiRaw = sampleAt(track.vMidi, track.fps, t);
  const vCentRaw = sampleAt(track.vCent, track.fps, t);
  const bRmsRaw = sampleAt(track.bRms, track.fps, t);
  const bCentRaw = sampleAt(track.bCent, track.fps, t);
  const dRmsRaw = sampleAt(track.dRms, track.fps, t);
  const oRmsRaw = sampleAt(track.oRms, track.fps, t);
  const oPeakRaw = sampleAt(track.oPeak, track.fps, t);
  const oCentRaw = sampleAt(track.oCent, track.fps, t);
  const tempoT = sampleAt(track.tempo, track.fps, t); // nie jest ścieżką — zawsze aktywny
  const energyRaw = sampleAt(track.energy, track.fps, t);

  const vRmsT = vRmsRaw * g.wokal;
  const vProbT = vProbRaw * g.wokal;
  const vMidiT = vMidiRaw;
  const vCentT = clamp(vCentRaw / track.vCentP95, 0, 1) * g.wokal;
  const bRmsT = clamp(bRmsRaw / track.bRmsP95, 0, 1) * g.bas; // 0..1 w skali basu
  const bCentT = clamp(bCentRaw / track.bCentP95, 0, 1) * g.bas;
  const dRmsT = dRmsRaw * g.bebny;
  const oRmsT = oRmsRaw * g.inne;
  const oCentT = clamp(oCentRaw / track.oCentP95, 0, 1) * g.inne;
  // energia = mix stemów (0.45 bas + 0.30 inne + 0.25 bebny) — po wyciszeniu
  // ścieżki jej udział wypada, więc cisza na scenie jest naprawdę cicha
  const mixAll = 0.45 * bRmsRaw + 0.30 * oRmsRaw + 0.25 * dRmsRaw;
  const mixNow = 0.45 * bRmsRaw * g.bas + 0.30 * oRmsRaw * g.inne + 0.25 * dRmsRaw * g.bebny;
  const stemMix = mixAll > 1e-4 ? clamp(mixNow / mixAll, 0, 1)
    : (g.bas || g.inne || g.bebny ? 1 : 0);
  const energyT = energyRaw * stemMix;

  // wokal: szybki atak, wolne puszczanie — brak lagi, brak migotania (audit P0-3)
  S.vRms = damp(S.vRms, vRmsT, vRmsT > S.vRms ? 17.3 : 4.4, dt);
  S.vProb = damp(S.vProb, vProbT, vProbT > S.vProb ? 17.3 : 4.4, dt);
  S.vMidi = damp(S.vMidi, vMidiT, 5.0, dt);
  S.vCent = damp(S.vCent, vCentT, 5.0, dt);
  // bas: struktura kuli ma nadążać za dźwiękiem (atak ~40 ms, powrót ~200 ms) —
  // przy 7.7/s obwiednia gubiła się za uderzeniem i faktura „doganiała" bas
  S.bRms = damp(S.bRms, bRmsT, bRmsT > S.bRms ? 25.0 : 5.0, dt);
  S.bCent = damp(S.bCent, bCentT, 5.0, dt);
  S.dRms = damp(S.dRms, dRmsT, 7.7, dt);
  // szczyt bębnów z wolno opadającym ogonem (τ≈2.5 s) = poziom odniesienia dla progu
  // akcentu; bez niego każdy transient dostawał falę i ziemia stawała się mgłą
  S.dPeak = Math.max(S.dRms, S.dPeak * Math.exp(-dt / 2.5));
  S.oRms = damp(S.oRms, oRmsT, 7.7, dt);
  // wolna obwiednia głośności „inne” — steruje jasnością kuli, więc nie może
  // podskakiwać na każdą nutę (7.7/s dawało migotanie)
  S.oSlow = damp(S.oSlow, oRmsT, 1.7, dt);
  S.oCent = damp(S.oCent, oCentT, 5.0, dt);
  // energia robi światło (sfera/bloom/exposure), NIE robi fal — wolna (audit P0-6)
  S.tempo = damp(S.tempo, tempoT, 3.0, dt);
  S.energy = damp(S.energy, energyT, 2.0, dt);
  // wolna obwiednia TYLKO do detekcji dropu (τ≈2.5 s): trzyma „poziom tła",
  // więc skok energii ponad nią = wejście z ciszy w głośną muzykę
  S.dropEnv = damp(S.dropEnv, energyT, 2.5, dt);
  S.beatPulse *= Math.exp(-dt * 3.0);

  // uderzenia w bębny: fala na ziemi + JEDEN puls sfery, nic więcej.
  // Bramka rytmiczna, nie „każdy transient": falę dostaje tylko akcent (≥45% szczytu)
  // i nie częściej niż co pół taktu. Ghost note'y i podwójne uderzenia w jednej
  // ósemce dawały 27 pierścieni naraz — obraz czytał się jak mgła, nie jak puls.
  onsets.poll(t, (_t0, s) => {
    S.onsetsFired++;
    if (!g.bebny) return;              // wyciszone „bebny” = zero fal i zero pulsu
    if (s < 0.02) return;              // cyfrowa cisza nigdy nie jest uderzeniem
    const sn = clamp(s, 0, 1);
    const beat = 60 / clamp(S.tempo || 120, 55, 190);
    if (t - lastWaveT < Math.max(0.18, beat * 0.5)) return;   // max 2 fale na takt
    if (sn < S.dPeak * 0.45) return;                          // tylko akcenty
    lastWaveT = t;
    // siła -> amplituda i życie: słabszy akcent = mniejszy i krótszy pierścień
    ground.pushWave(t, 0.12 + sn * 0.10, 9, 2.2 + sn * 1.6); // zasięg ~20-34 m, życie 2.2-3.8 s
    S.wavesFired++;
    S.beatPulse = Math.max(S.beatPulse, 0.50 + sn * 0.50); // sfera pulsuje raz, na ten sam atak
  });

  // RYTM „inne": cząsteczki jadą WYŁĄCZNIE na uderzeniach (events.onsets).
  // Jedno uderzenie = 1-3 cząsteczki (siła → ile i jakie duże), rejestr widma →
  // barwa. Rytm powstaje z samych zdarzeń, a nie z obwiedni głośności.
  if (g.inne) {
    oOnsets.poll(t, (t0, s) => {
      // jasność widma w chwili uderzenia (log2 — ucho słyszy częstotliwość logarytmicznie)
      const cz = Math.log2(Math.max(80, sampleAt(track.oCent, track.fps, t0)));
      const bright = clamp((cz - track.oCentLo) / Math.max(0.5, track.oCentHi - track.oCentLo), 0, 1);
      S.otherBright = bright;
      S.otherHits++;
      wheel.hit(t0, s, bright);
    });
    // obwiednia tylko na panel H — mówi, jak głośno jest w „inne" W TEJ CHWILI
    const loud = clamp((oPeakRaw - OTHER_LOUD) / Math.max(0.05, OTHER_FULL - OTHER_LOUD), 0, 1);
    S.otherEnv = damp(S.otherEnv, loud, loud > S.otherEnv ? 9.0 : 2.2, dt);
    oPeakPrev = oPeakRaw;
  } else {
    oPeakPrev = 0; // wyciszone „inne" = brak cząsteczek (pula dogasa)
    S.otherEnv = 0;
    S.otherBright = 0;
  }

  // aktualizacje systemów
  ground.update(t, S.energy, S.beatPulse);
  wheel.update(t, dt, !!g.inne, S.tempo, camera);
  // Struktura kuli reaguje na bas CIĄGLE (obwiednia S.bRms w core.update) —
  // żadnych impulsów na pojedynczy bit.
  // DROP: energia wystrzeliła ponad wolną obwiednię (cisza -> głośna muzyka).
  // Tylko log/diagnostyka — struktura kuli jest ciągła, więc drop jej nie „szarpie”.
  // Warunki: skok > 0.20, teraz naprawdę głośno (>0.55), tło jeszcze ciche
  // (<0.42), edge + 1.4 s cooldown (obwiednia dogania skok przez ~0.5 s).
  const jump = energyT - S.dropEnv;
  // rozbłysk należy do „bas” (jak żebro na bit) — przy wyciszonym basie nie strzela
  if (g.bas && jump > 0.20 && energyT > 0.55 && S.dropEnv < 0.42 && t - lastBurst > 1.4) {
    lastBurst = t;
    S.bursts++;
    S.dropLog.push({ t: +t.toFixed(2), jump: +jump.toFixed(2), e: +energyT.toFixed(2), env: +S.dropEnv.toFixed(2) });
    if (S.dropLog.length > 12) S.dropLog.shift();
  }

  // barwa sfery idzie za energią całości (core.glow) — nie za „inne"
  // Struktura kuli dostaje SUROWY (znormalizowany) bas: wygładza go tylko
  // JEDEN filtr, ten w core (atak 16/s). Podwójne tłumienie (S.bRms 25/s
  // + core 14/s) dawało razem ~120 ms opóźnienia faktury za uderzeniem —
  // teraz jest jeden stopień i ~70 ms. S.bRms zostaje jako wartość do
  // odczytu w panelu H / sondzie.
  core.update(t, dt, S.energy, S.beatPulse, bRmsT);
  ribbon.update(t, track, dt, g.wokal);
  atmosphere.update(t, dt, S.energy, S.tempo);
  // pełny exposure tylko w piku (audit v2 P1)
  renderer.toneMappingExposure = 1.05 + S.energy * 0.3;

  // kamera: powolny proceduralny drift
  const cd = t * 0.1;
  camera.position.x = Math.sin(cd) * 0.8;
  camera.position.y = 7 + Math.sin(t * 0.07) * 0.4;
  camera.position.z = 22;
  camera.lookAt(0, 3, 0);

  // ŚLAD KLATEK (?debug): surowe próbki vs stan sceny w KAŻDEJ klatce.
  // __viz odświeża się 4×/s, więc do pomiaru opóźnienia (np. „bas a struktura
  // kuli") potrzebny jest zapis per-klatka — inaczej rozdzielczość to 250 ms.
  if (DEBUG) {
    trace[traceI] = {
      t: +t.toFixed(3),
      v: +vRmsT.toFixed(4), b: +bRmsT.toFixed(4), be: +S.bRms.toFixed(4),
      d: +dRmsT.toFixed(4), o: +oRmsT.toFixed(4), e: +energyT.toFixed(4),
      st: +core.uniforms.uStruct.value.toFixed(4), cb: +core.bass.toFixed(4),
      g: +core.glow.toFixed(4),
      p: +S.beatPulse.toFixed(4),
    };
    traceI = (traceI + 1) % TRACE_N;
  }

  post.grade.uniforms.uTime.value = t;
  post.composer.render();

  // pomiary wydajności (checklist akceptacji)
  fpsHist[fpsI] = dt > 0 ? 1 / dt : 60;
  fpsI = (fpsI + 1) % fpsHist.length;
  fpsN = Math.min(fpsN + 1, fpsHist.length);

  // HUD + sonda weryfikacyjna
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    const sec = track.sectionAt(t);
    const sorted = Array.from(fpsHist.subarray(0, fpsN)).sort((a, b) => a - b);
    const fpsP95 = Math.round(sorted[Math.floor((fpsN - 1) * 0.05)] || 0); // dolne 5%
    const calls = renderer.info.render.calls;
    const tris = renderer.info.render.triangles;
    const audioEl = masterAudio();
    hudPanel.text(t, {
      section: sec, sections: track.sections.length,
      fps, fpsP95, waves: S.wavesFired, calls, tris,
      muted: Object.keys(settings.gain).filter((k) => !settings.gain[k]).join(" "),
      dt, px: renderer.getPixelRatio(),
      // zegar: t sceny vs currentTime elementu — rozjazd = źródło „opóźnienia"
      t, audioT: demoMode || !audioEl ? null : audioEl.currentTime, seekT,
      state: demoMode ? "demo" : playing ? "gra" : "pauza",
      core: {
        glow: core.glow, scale: core.scale, pulse: core.pulse,
        uStruct: core.uniforms.uStruct.value, uWobble: core.uniforms.uWobble.value,
        bass: core.bass, radius: core.surfaceRadius(),
      },
      // surowe próbki tej klatki vs wygładzone obwiednie, które widzi scena
      raw: { vRms: vRmsRaw, bRms: bRmsT, dRms: dRmsRaw, oRms: oRmsRaw, energy: energyT },
      // bas: obwiednia SCENY (w core), nie pomocnicze S.bRms — to ona rusza kulą
      env: { vRms: S.vRms, bRms: core.bass, dRms: S.dRms, oRms: S.oRms, energy: S.energy },
      tempo: S.tempo,
      other: {
        env: S.otherEnv, bright: S.otherBright, peak: oPeakPrev,
        marks: wheel.marks, rate: wheel.lapRate,
      },
      dropEnv: S.dropEnv, onsets: S.onsetsFired, bursts: S.bursts, otherHits: S.otherHits,
      wheelMarks: wheel.marks,
      track: TRACK_TITLE, duration: track.duration,
      gains: `w${settings.gain.wokal} b${settings.gain.bas} d${settings.gain.bebny} i${settings.gain.inne}`,
      volume: Math.round(settings.volume * 100) + "%",
      preset: PRESETS[presetKey].label,
      ctxLost,
    });
    window.__viz = {
      t, section: sec, sections: track.sections.length,
      vRms: S.vRms, vProb: S.vProb, vMidi: S.vMidi, vCent: S.vCent,
      bRms: S.bRms, dRms: S.dRms, oRms: S.oRms,
      // surowe (znormalizowane) próbki tej klatki — do pomiaru opóźnienia sceny
      bRaw: +bRmsT.toFixed(4), dRaw: +dRmsT.toFixed(4), oRaw: +oRmsT.toFixed(4),
      vRaw: +vRmsT.toFixed(4),
      energy: S.energy, dropEnv: S.dropEnv, dropLog: S.dropLog.slice(), beatPulse: S.beatPulse,
      wavesFired: S.wavesFired, onsetsFired: S.onsetsFired, bursts: S.bursts, fps,
      otherHits: S.otherHits,
      wheel: { marks: wheel.marks, total: wheel.total, phase: +wheel.beat.toFixed(3),
        rate: +wheel.lapRate.toFixed(2), lastLane: wheel.lastLane,
        dropped: wheel.dropped, spawned: wheel.spawned, bpm: +wheel.bpm.toFixed(1),
        calib: wheel.calib },
      fpsP95, calls, tris,
      ribbonW: ribbon.width, ribbon: ribbon.probe,
      core: { pulse: core.pulse, scale: core.scale, glow: core.glow,
        uStruct: core.uniforms.uStruct.value, uWobble: core.uniforms.uWobble.value },
      other: { peak: +oPeakPrev.toFixed(3), env: +S.otherEnv.toFixed(3),
        bright: +S.otherBright.toFixed(3) },
      ctxLost, track: TRACK_TITLE,
      muted: Object.keys(settings.gain).filter((k) => !settings.gain[k]),
      // poziom każdego elementu audio (głośność ogólna × wyciszenie ścieżki)
      vols: Object.fromEntries(STEM_FILES.map((n) => [n, audio[n] ? +audio[n].volume.toFixed(2) : null])),
      preset: presetKey,
    };
  }
}
renderer.setAnimationLoop(frame);
