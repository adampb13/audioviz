// Boot sceny "Pustynna Fala Światła".
// Master clock = element audio wokalu (currentTime). analysis.json = scenariusz.
// Utwór wybierany parametrem ?track=<nazwa katalogu w ../data> (domyślnie blindinglights).
// Sterowanie: [SPACJA] start/pauza · [H] HUD · ?demo&t=123 — start bez gestu od 123 s.
import * as THREE from "three";
import { Track, STEM_FILES, EventCursor, sampleAt, damp, clamp } from "./data.js";
import { PAL } from "./glsl.js";
import { Ground } from "./ground.js";
import { CoreSphere } from "./core.js";
import { VocalRibbon } from "./ribbon.js";
import { Mountains } from "./mountains.js";
import { Atmosphere } from "./atmosphere.js";
import { createPost } from "./postfx.js";
import { createSettings } from "./settings.js";

const params = new URLSearchParams(location.search);
const TRACK = params.get("track") || "blindinglights";
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
scene.background = new THREE.Color(PAL.skyTop);

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
const ground = new Ground(PAL.fog, FOG_DENSITY);
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

const post = createPost(renderer, scene, camera);

// Sonda QA (?debug): dostęp do obiektów sceny dla zrzutów, pomiarów i bisectowania
if (params.has("debug")) {
  window.__dbg = { renderer, scene, camera, post, ground, core, ribbon, mountains, atmosphere };
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
const settings = createSettings((id, on) => {
  const el = audio[id];
  if (el) el.muted = !on;
});
if (window.__dbg) { window.__dbg.settings = settings; window.__dbg.audio = audio; }

// ---------- zdarzenia (triggery impulsowe, bez interpolacji) ----------
// Fale i puls sfery pochodzą WYŁĄCZNIE z uderzeń w ścieżce "bebny"
// (track.onsetT/onsetS to onsety tego stemu z siłą znormalizowaną p95).
const onsets = new EventCursor(track.onsetT, track.onsetS);
// Sfera: „inne” steruje jasnością, mocny „bas” wypuszcza cząstki.
const otherOnsets = new EventCursor(track.otherOnsetT, track.otherOnsetS);
// Akcenty melodyczne „inne” — to one dają rozbłysk (patrz detect_accents.py).
const accents = new EventCursor(track.accentT, track.accentS);
const bassBeats = new EventCursor(track.bassBeatT, track.bassBeatS);
let lastOther = -1, lastBass = -1, lastBurst = -10;
function resetCursors(t) {
  onsets.reset(t);
  otherOnsets.reset(t);
  accents.reset(t);
  bassBeats.reset(t);
  lastBurst = t - 2; // po przewinięciu nie strzelamy fajerwerkiem od razu
}

// ---------- stan tłumiony (LERP: alpha=0.12 RMS, 0.08 pitch @60fps) ----------
const S = {
  vRms: 0, vProb: 0, vMidi: 60, vCent: 0,
  bRms: 0, bCent: 0,
  dRms: 0, oRms: 0, oSlow: 0, oCent: 0, tempo: 120,
  energy: 0, dropEnv: 0, dropLog: [], beatPulse: 0, wavesFired: 0, onsetsFired: 0, otherHits: 0, otherFlash: 0, bassHits: 0, bursts: 0,
};
let lastWaveT = -10; // debounce fal (audit P0-6)
// pomiary z checklisty: FPS p95 z bufora 240 klatek
const fpsHist = new Float32Array(240);
let fpsI = 0, fpsN = 0;

// ---------- odtwarzanie ----------
const btn = document.getElementById("start");
const overlay = document.getElementById("overlay");
const hud = document.getElementById("hud");
let playing = false;
let demoMode = params.has("demo");
let demoT = parseFloat(params.get("t") || "0") || 0;
// Po pauzie zegar MUSI stać w miejscu. Wcześniej currentTime() wracał do demoT
// (=0), więc pauza przewijała utwór na początek, a wznowienie grało od zera —
// scena skakała (fale znikają, wstęga się resetuje).
let pausedAt = null;

function currentTime() {
  const m = masterAudio();
  if (!m) return demoT;
  if (playing) return m.currentTime;
  return pausedAt !== null ? pausedAt : demoT;
}

async function setPlaying(p) {
  const els = STEM_FILES.map((n) => audio[n]).filter(Boolean);
  if (p) {
    const t0 = currentTime();
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
  else if (e.code === "KeyH") { hud.hidden = !hud.hidden; }
});
if (demoMode) overlay.classList.add("hidden");
resetCursors(demoT);

// ---------- pętla ----------
const clock = new THREE.Clock();
let hudTimer = 0, fps = 60;
window.__viz = {};

renderer.info.autoReset = false; // ręczny reset — info liczy CAŁĄ klatkę (scena+passy)
function frame() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  if (demoMode) demoT += dt; // demo bez audio: własny zegar, ten sam kod próbkowania
  const t = currentTime();

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
  const oCentRaw = sampleAt(track.oCent, track.fps, t);
  const tempoT = sampleAt(track.tempo, track.fps, t); // nie jest ścieżką — zawsze aktywny
  const energyRaw = sampleAt(track.energy, track.fps, t);

  const vRmsT = vRmsRaw * g.wokal;
  const vProbT = vProbRaw * g.wokal;
  const vMidiT = vMidiRaw;
  const vCentT = clamp(vCentRaw / track.vCentP95, 0, 1) * g.wokal;
  const bRmsT = bRmsRaw * g.bas;
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
  S.bRms = damp(S.bRms, bRmsT, 7.7, dt);
  S.bCent = damp(S.bCent, bCentT, 5.0, dt);
  S.dRms = damp(S.dRms, dRmsT, 7.7, dt);
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

  // uderzenia w bębny: fala na ziemi + JEDEN puls sfery, nic więcej
  onsets.poll(t, (_t0, s) => {
    S.onsetsFired++;
    if (!g.bebny) return;              // wyciszone „bebny” = zero fal i zero pulsu
    if (s < 0.02) return;              // próg tylko na cyfrową ciszę — każdy transient = fala
    if (t - lastWaveT < 0.05) return;  // dedupe 50 ms (detektor ma rozdzielczość 16.7 ms)
    lastWaveT = t;
    const sn = clamp(s, 0, 1);
    // siła -> amplituda i życie: ghost note = mały krótki pierścień, akcent = duży, 2.6 s
    ground.pushWave(t, 0.10 + sn * 0.12, 9, 2.6 + sn * 3.4); // amp ≤ 0.22, zasięg 23-54 m
    S.wavesFired++;
    S.beatPulse = Math.max(S.beatPulse, 0.10 + sn * 0.90); // sfera pulsuje raz, na ten sam atak
  });

  // aktualizacje systemów
  ground.update(t, S.energy, S.beatPulse);
  // „inne” -> jasność na KAŻDYM onsiecie tej ścieżki (klawisze, nagłe dźwięki).
  // Próg tylko na cyfrową ciszę; 40 ms dedupe (detektor: rozdzielczość 16.7 ms).
  // Akcenty „inne”: 461 pików na utwór, ale tylko część to ZNACZĄCE uderzenia
  // melodii. Trzy progi: <0.45 cisza (ozdobniki), 0.45-0.75 ciepły akcent,
  // >=0.75 pełny rozbłysk do bieli. Refractory 0.20 s, bo akcenty i tak są
  // rzadkie (~0.9/s), a przy gęstym motywie nie chcemy stroboskopu.
  accents.poll(t, (_t0, s) => {
    S.accentsFired = (S.accentsFired || 0) + 1;
    if (!g.inne) return;
    if (s < 0.45) return;
    if (t - lastOther < 0.20) return;
    lastOther = t;
    S.otherFlash++;
    core.otherHit(s, clamp(S.oRms / (track.oRmsP95 || 1), 0, 1));
  });
  // KAŻDY bit „bas” -> mocna zmiana STRUKTURY kuli (żebro biegnące po powierzchni).
  // Bez progu siły; pomijamy tylko bity, gdy bas w ogóle nie gra.
  bassBeats.poll(t, () => {
    S.bassHits++;
    if (!g.bas) return;                // wyciszony „bas” = kula gładka, bez żebra
    if (S.bRms < 0.12) return;
    core.bassPulse(clamp(S.bRms * 1.5, 0.2, 1));
  });
  // DROP: energia wystrzeliła ponad wolną obwiednię (cisza -> głośna muzyka).
  // Warunki: skok > 0.20, teraz naprawdę głośno (>0.55), tło jeszcze ciche
  // (<0.42), edge + 1.4 s cooldown (obwiednia dogania skok przez ~0.5 s).
  const jump = energyT - S.dropEnv;
  // rozbłysk należy do „bas” (jak żebro na bit) — przy wyciszonym basie nie strzela
  if (g.bas && jump > 0.20 && energyT > 0.55 && S.dropEnv < 0.42 && t - lastBurst > 1.4) {
    lastBurst = t;
    S.bursts++;
    S.dropLog.push({ t: +t.toFixed(2), jump: +jump.toFixed(2), e: +energyT.toFixed(2), env: +S.dropEnv.toFixed(2) });
    if (S.dropLog.length > 12) S.dropLog.shift();
    core.loudHit(clamp((jump - 0.15) / 0.55, 0.4, 1));
  }

  // głośność „inne" znormalizowana p95 — jedyny sygnał koloru/jasności sfery
  const oSlowN = clamp(S.oSlow / (track.oRmsP95 || 1), 0, 1);
  core.update(t, dt, S.energy, S.beatPulse, S.bRms, oSlowN, S.oCent);
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
    hud.textContent =
      `t ${t.toFixed(2)}  sec ${sec + 1}/${track.sections.length}  ` +
      `vR ${S.vRms.toFixed(2)} vP ${S.vProb.toFixed(2)} midi ${S.vMidi.toFixed(1)}  ` +
      `bR ${S.bRms.toFixed(2)} en ${S.energy.toFixed(2)} bp ${S.beatPulse.toFixed(2)}  ` +
      `sz ${core.scale.toFixed(2)} w ${core.white.toFixed(2)} st ${core.uniforms.uStruct.value.toFixed(2)}  ` +
      `waves ${S.wavesFired}  blysk ${S.bursts}  p95 ${fpsP95}fps  dc ${calls}`;
    window.__viz = {
      t, section: sec, sections: track.sections.length,
      vRms: S.vRms, vProb: S.vProb, vMidi: S.vMidi, vCent: S.vCent,
      bRms: S.bRms, dRms: S.dRms, oRms: S.oRms,
      energy: S.energy, dropEnv: S.dropEnv, dropLog: S.dropLog.slice(), beatPulse: S.beatPulse,
      wavesFired: S.wavesFired, onsetsFired: S.onsetsFired, bursts: S.bursts, fps,
      otherHits: S.otherHits, otherFlash: S.otherFlash, accentsFired: S.accentsFired || 0,
      fpsP95, calls, tris,
      ribbonW: ribbon.width, ribbon: ribbon.probe,
      core: { flash: core.flash, white: core.white, beat: core.beat, scale: core.scale,
        uStruct: core.uniforms.uStruct.value, uWobble: core.uniforms.uWobble.value },
      ctxLost, track: TRACK,
      muted: Object.keys(settings.gain).filter((k) => !settings.gain[k]),
    };
  }
}
renderer.setAnimationLoop(frame);
