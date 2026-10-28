// Orkiestracja nowego modelu graficznego (konspekt + redefinicja sceny):
//  - SFERA (pierwszy plan, bohater): promień ∝ chwilowa głośność (szybko) + energia
//    miksu (wolno) + delikatny puls beatu; deformacja simplex ∝ energia i obecność
//    wokalu (pitch_voiced_prob); kolor = rampa głęboki granat -> jasny błękit wg
//    barwy miksu (centroid ważony głośnością stemów);
//  - FALA WOKALNA (tło za sferą): wysokość ∝ barwa wokalu (centroid), środek ∝
//    wysokość tonu (pitch_midi), widoczność ∝ pitch_voiced_prob, jasność ∝ głośność
//    wokalu, tempo falowania ∝ chwilowe tempo utworu;
//  - BŁYSKI (delikatne): onsety bębnów -> iskry z powierzchni sfery; uderzenia
//    zgodne z beatami -> akcent (cieplejszy kolor, mocniejszy impuls);
//  - ZORZA (tło): tempo transformacji ∝ chwilowe tempo miksu + energia.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Track, STEM_NAMES, clamp, damp } from "./data.js";
import { Sphere } from "./sphere.js";
import { VocalWave } from "./wave.js";
import { Aurora } from "./aurora.js";
import { Sparks } from "./sparks.js";
import { postShader } from "./postfx.js";

const params = new URLSearchParams(location.search);
const DEMO = params.has("demo"); // podgląd bez dźwięku: wirtualny zegar
const AUDIO_DIR = "../data/blindinglights/";
const ANALYSIS_URL = AUDIO_DIR + "analysis.json";

// pyin voiced_prob ma medianę ~0.15 w klatkach z wykrytym tonem, więc bez
// wzmocnienia wokal byłby prawie niewidoczny. Świadome dostrojenie.
const VOICE_GAIN = 2.2;
const CAM_DIST = 10; // odległość kamery od sfery

const $ = (id) => document.getElementById(id);
const hud = $("hud");
const overlay = $("overlay");
const startBtn = $("start");
const errBox = $("err");

const audios = STEM_NAMES.map((n) => {
  const a = new Audio(AUDIO_DIR + n + ".wav");
  a.preload = "auto";
  return a;
});
const master = audios[0]; // wokal jest zegarem głównym

let pausedAt = parseFloat(params.get("t") || "0") || 0;
let demoT = pausedAt;
let demoPlaying = false;

function clockNow() {
  if (DEMO) return demoT;
  return master.paused ? pausedAt : master.currentTime;
}

function isRunning() {
  return DEMO ? demoPlaying : !master.paused;
}

async function setPlaying(on) {
  if (DEMO) {
    demoPlaying = on;
    return;
  }
  if (on) {
    audios.forEach((a) => (a.currentTime = pausedAt));
    await Promise.all(audios.map((a) => a.play()));
  } else {
    pausedAt = master.currentTime;
    audios.forEach((a) => a.pause());
  }
}

function loadMetadata(a) {
  return new Promise((ok, bad) => {
    a.addEventListener("loadedmetadata", () => ok(), { once: true });
    a.addEventListener("error", () => bad(new Error("nie wczytano " + a.src)), { once: true });
    a.load();
  });
}

async function boot() {
  hud.textContent = "ładowanie analizy…";
  const res = await fetch(ANALYSIS_URL);
  if (!res.ok) throw new Error("analysis.json: HTTP " + res.status);
  const track = new Track(await res.json());

  if (!DEMO) {
    hud.textContent = "ładowanie stemów…";
    await Promise.all(audios.map(loadMetadata));
  }

  // --- scena
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 1);
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
  camera.position.set(0, 0, CAM_DIST);
  camera.lookAt(0, 0, 0);

  const sphere = new Sphere(scene);
  const wave = new VocalWave(scene, { z: -6.5 });
  const aurora = new Aurora(scene);
  const sparks = new Sparks(scene);

  function fitBackdrop() {
    wave.fit(camera.fov, CAM_DIST, camera.aspect);
  }
  fitBackdrop();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.40);
  composer.addPass(bloom);
  const post = new ShaderPass(postShader);
  composer.addPass(post);
  composer.addPass(new OutputPass());

  // --- stan
  const S = {
    loud: 0.2,      // wygładzona głośność miksu (szybko)
    prevLoud: 0.2,  // do składowej prędkości (at) głośności
    energy: 0.3,    // wygładzona energia miksu (wolno)
    push: 0,        // delikatne pchnięcie kamery na akcencie beatu
    waveT: 0,       // czas falowania fali wokalnej (tempo utworu)
    lastTick: clockNow(),
  };
  const C = { onsets: 0, accents: 0, kicks: 0, hats: 0, snares: 0 };

  // --- kontrolki
  startBtn.onclick = async () => {
    try {
      await setPlaying(true);
      overlay.classList.add("hidden");
    } catch (e) {
      errBox.textContent = "Odtwarzanie zablokowane: " + e.message;
    }
  };
  addEventListener("keydown", async (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (overlay.classList.contains("hidden")) await setPlaying(!isRunning());
      else startBtn.click();
    }
    if (e.key === "h" || e.key === "H") hud.classList.toggle("off");
  });
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
    fitBackdrop();
  });

  // --- pętla
  let last = performance.now();
  let lastSync = 0;
  let hudAcc = 0;
  let fpsEMA = 60;

  function tick(now) {
    requestAnimationFrame(tick);
    const rawDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const running = isRunning();
    const dt = running ? rawDt : 0;
    if (DEMO && demoPlaying) demoT += rawDt;

    // Synchronizacja stemów z wokalem (co ~400 ms, tylko gdy gra)
    if (!DEMO && running && now - lastSync > 400) {
      lastSync = now;
      const mt = master.currentTime;
      for (const a of audios) {
        if (a !== master && Math.abs(a.currentTime - mt) > 0.05) a.currentTime = mt;
      }
    }

    const t = clockNow();
    const f = track.frameAt(t);
    const idx = clamp(Math.round(f), 0, track.n - 1);

    // --- chwilowa głośność i energia miksu (sterują sferą: rozmiar + deformacja)
    const loudT = track.at(track.mixRms, f);
    S.prevLoud = S.loud;
    S.loud = damp(S.loud, loudT, 18, dt);
    const loudVel = clamp((S.loud - S.prevLoud) / Math.max(dt, 1e-4), 0, 6);
    const fastLoud = clamp(S.loud + loudVel * 0.12, 0, 1.2); // atak: skok głośności natychmiast
    S.energy = damp(S.energy, loudT, 1.1, dt);
    const energy = clamp(S.energy, 0, 1.1);

    // --- bębny: onsety z analizy -> iskry (klasyfikacja po centroidzie, akcent po beatach)
    if (running) {
      // Po seeku lub wznowieniu po pauzie nie wyzwalamy zaległych onsetów
      const jump = t < S.lastTick || t - S.lastTick > 0.5;
      if (!jump) {
        const [a, b] = track.onsetsBetween(S.lastTick, t);
        for (let k = a; k < b; k++) {
          const te = track.onsetT[k];
          const fr = clamp(Math.round(te * track.fps), 0, track.n - 1);
          if (track.dOnset[fr] < track.dOnsetThr * 0.5) continue; // słabe onsety pomijamy
          const cent = track.dCent[fr];
          const pk = clamp(track.dPeak[fr] / track.dPeakP99, 0, 1);
          const accent = track.nearestBeatDist(te) < 0.09;
          const hue = clamp(track.centMix[fr] / track.centMixP95, 0, 1);
          sparks.spark(te, accent, pk, hue);
          C.onsets++;
          if (accent) {
            C.accents++;
            S.push += 0.18 * (0.4 + 0.6 * pk); // delikatne pchnięcie kamery na beacie
          }
          if (cent < track.onsetCentLo) C.kicks++;
          else if (cent > track.onsetCentHi) C.hats++;
          else C.snares++;
        }
      }
      S.lastTick = t;
    }
    S.push = damp(S.push, 0, 6, dt);
    const pulse = sparks.pulse;

    // --- kamera: delikatny dryf + pchnięcie na akcencie
    const drift = 0.35 + 0.45 * energy;
    camera.position.set(
      Math.sin(t * 0.11) * 0.55 * drift,
      Math.sin(t * 0.07) * 0.35 * drift,
      CAM_DIST - S.push,
    );
    camera.lookAt(0, -0.1, 0);

    // --- sfera: rozmiar ∝ głośność+energia, deformacja ∝ energia+wokal, kolor ∝ barwa
    const voiceRaw = clamp(track.at(track.vProb, f) * VOICE_GAIN, 0, 1);
    sphere.update(dt, {
      radius: 1.05 + 0.50 * fastLoud + 0.55 * energy + 0.25 * pulse,
      amp: 0.08 + 0.26 * energy + 0.18 * voiceRaw + 0.22 * pulse,
      cent: clamp(track.centMix[idx] / track.centMixP95, 0, 1.2),
      pulse,
      flow: clamp(
        0.25 + 0.9 * clamp((track.tempoMix[idx] - 70) / 140, 0, 1) + 0.5 * energy,
        0.1, 1.2,
      ),
      bright: 0.72 + 0.30 * energy + 0.22 * pulse,
    });

    // --- fala wokalna: barwa -> wysokość, midi -> kontura, prob -> widoczność
    const timbre = clamp(track.at(track.vCent, f) / track.vCentP95, 0, 1.2);
    const midi = track.at(track.vMidi, f);
    wave.update(dt, S.waveT, {
      timbre,
      voice: voiceRaw,
      rms: track.at(track.vRms, f),
      pitch: clamp((midi - 60) / 17, -1, 1),
    });
    if (running) {
      S.waveT += dt * (0.55 + 0.9 * clamp((track.at(track.vTempo, f) - 70) / 150, 0, 1));
    }

    // --- zorza: tempo ∝ tempo miksu + energia, jasność ∝ energia
    aurora.update(dt, t, {
      speed: clamp(0.15 + 0.7 * clamp((track.tempoMix[idx] - 70) / 140, 0, 1) + 0.4 * energy, 0, 1.2),
      level: clamp(0.15 + 0.9 * energy + 0.2 * track.at(track.oRms, f), 0, 1.2),
    });

    // --- iskry: cykl życia + wygaszenie impulsu
    sparks.update(dt, running ? t : undefined);

    // --- post: delikatny pulsujący bloom + aberracja tylko na akcentach
    post.uniforms.uCA.value = 0.0012 + 0.010 * pulse;
    post.uniforms.uShock.value = 0.012 * pulse;
    bloom.strength = 0.22 + 0.16 * energy + 0.12 * pulse;

    composer.render(dt);

    // --- HUD
    if (rawDt > 0) fpsEMA = damp(fpsEMA, 1 / rawDt, 2, rawDt);
    hudAcc += rawDt;
    if (hudAcc > 0.25) {
      hudAcc = 0;
      const mm = Math.floor(t / 60);
      const ss = (t % 60).toFixed(2).padStart(5, "0");
      const sIdx = track.sectionAt(t);
      hud.textContent =
        `t ${mm}:${ss}  sekcja ${sIdx + 1}/${track.sections.length}  głośność ${S.loud.toFixed(2)}  energia ${energy.toFixed(2)}\n` +
        `sfera: r ${sphere.radius.toFixed(2)}  deformacja ${sphere.amp.toFixed(2)}  barwa ${track.centMix[idx].toFixed(0)} Hz  tempo ${track.tempoMix[idx].toFixed(0)} bpm\n` +
        `fala: barwa ${timbre.toFixed(2)}  midi ${midi.toFixed(1)}  voice ${voiceRaw.toFixed(2)}\n` +
        `bębny: onsety ${C.onsets}  akcenty ${C.accents}  (kick ${C.kicks}  hat ${C.hats}  werbel ${C.snares})\n` +
        `fps ${fpsEMA.toFixed(0)}   spacja: pauza   H: ukryj`;
    }
  }

  // Test/debug: stan dostępny w konsoli i w testach przeglądarkowych
  window.__viz = {
    track,
    S,
    C,
    get t() { return clockNow(); },
    get running() { return isRunning(); },
    get sphereRadius() { return sphere.radius; },
    get sphereAmp() { return sphere.amp; },
    get waveVoice() { return wave.voice; },
    get waveTimbre() { return wave.timbre; },
    get wavePitch() { return wave.pitch; },
    get pulse() { return sparks.pulse; },
    get fps() { return fpsEMA; },
  };

  // Pierwsza klatka przed startem (żeby tło i zorza były widoczne pod overlayem)
  requestAnimationFrame((n) => {
    last = n;
    tick(n);
  });
  hud.textContent = DEMO ? "tryb demo (?demo): kliknij Start" : "gotowe — kliknij Start";
}

boot().catch((e) => {
  console.error(e);
  errBox.textContent = "Błąd: " + e.message;
  hud.textContent = "";
});
