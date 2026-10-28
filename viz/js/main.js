// Orkiestracja sceny wg konspektu „mniej znaczy więcej":
//  - WSTĘGA WOKALNA (pierwszy plan): kontur melodii (pitch_midi) na osi Y, grubość
//    i emisja ∝ głośność wokalu, przezroczystość ∝ pitch_voiced_prob (milknięcie =
//    rozpuszczenie w mroku);
//  - OKRĘGI NA PODŁODZE (bębny): płaska płaszczyzna + SDF w shaderze; każdy onset
//    stopy/werbla wyzwala pierścień-kroplę; jasność i grubość ∝ peak/siła uderzenia;
//  - RDZEŃ BASOWY (centrum okręgów, na poziomie podłogi): miękkie kuliste światło,
//    leniwy LERP jak bicie serca, atak na onsetach basu, barwa miedź->złoto
//    z centroidu basu;
//  - MGŁA (tło): fbm dymu, przepływ ∝ chwilowe tempo, odcień z chromy „inne"
//    w ciepłej palecie (brąz/miedź/złoto/wyblakły róż);
//  - Złota zasada: dynamika w emisji światła i przezroczystości, nie w ruchu
//    geometrii; cisza -> ekran niemal gaśnie.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Track, STEM_NAMES, clamp, damp } from "./data.js";
import { VocalRibbon } from "./ribbon.js";
import { DrumRings } from "./rings.js";
import { BassCore } from "./basscore.js";
import { SmokeFog } from "./fog.js";
import { postShader } from "./postfx.js";

const params = new URLSearchParams(location.search);
const DEMO = params.has("demo"); // podgląd bez dźwięku: wirtualny zegar
const AUDIO_DIR = "../data/blindinglights/";
const ANALYSIS_URL = AUDIO_DIR + "analysis.json";

// pyin voiced_prob ma medianę ~0.15 w klatkach z wykrytym tonem, więc bez
// wzmocnienia wokal byłby prawie niewidoczny. Świadome dostrojenie.
const VOICE_GAIN = 2.2;

const $ = (id) => document.getElementById(id);
const hud = $("hud");
const overlay = $("overlay");
const startBtn = $("start");
const errBox = $("err");

const audioErrs = []; // stemy, które nie wczytały się (nazwa + kod błędu)
const audios = STEM_NAMES.map((n) => {
  const a = new Audio(AUDIO_DIR + n + ".wav");
  a.preload = "auto";
  a.addEventListener("error", () =>
    audioErrs.push(n + ": kod " + (a.error?.code ?? "?")),
  );
  return a;
});
const master = audios[0]; // wokal jest zegarem głównym
let playFails = 0; // nieudane play() (np. blokada autoodtwarzania)

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
    const r = await Promise.allSettled(audios.map((a) => a.play()));
    const failed = r.filter((x) => x.status === "rejected");
    if (failed.length) {
      playFails++;
      throw new Error(
        failed.map((x) => x.reason?.name || String(x.reason)).join(", "),
      );
    }
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

  // Ostrzeżenie o software rendering (np. SwiftShader: ~20 fps zamiast 60+)
  let gpuWarn = "";
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const rstr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|software|basic render/i.test(rstr)) {
      gpuWarn =
        "⚠ RENDEROWANIE PROGRAMOWE (" + rstr + ") — włącz akcelerację sprzętową";
    }
  } catch (_) { /* brak rozpoznania — pomiń */ }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);

  const fog = new SmokeFog(scene);
  const rings = new DrumRings(scene);
  const core = new BassCore(scene);
  const ribbon = new VocalRibbon(scene);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.45);
  composer.addPass(bloom);
  const post = new ShaderPass(postShader);
  composer.addPass(post);
  composer.addPass(new OutputPass());

  // --- stan
  const S = {
    glow: 0.12,    // globalny poziom światła (cisza -> prawie czerń)
    energy: 0.2,   // wolna energia miksu
    push: 0,       // delikatne pchnięcie kamery na mocnym uderzeniu
    kickPulse: 0,  // impuls do postfx
    bassHit: 0,    // impuls ataku rdzenia w tej klatce
    lastTick: clockNow(),
  };
  const C = { rings: 0, bassHits: 0 };
  const chromaArr = new Float32Array(12);

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

    // --- globalny blask: cisza -> niemal czerń (złota zasada).
    // Gamma rozciąga dynamikę: ciche partie ciemnieją, refren wyraźnie rozbłyska.
    const loudT = track.at(track.mixRms, f);
    S.energy = damp(S.energy, loudT, 1.2, dt);
    const eg = Math.pow(clamp(S.energy, 0, 1), 1.25);
    S.glow = damp(S.glow, clamp(0.07 + 1.0 * eg, 0, 1.1), 2.2, dt);

    // --- seek/pauza: bez zaległych zdarzeń
    const jump = t < S.lastTick || t - S.lastTick > 0.5;

    // --- bębny: onsety -> pierścienie na podłodze
    if (running) {
      if (jump) rings.reset(t);
      else {
        const [a, b] = track.onsetsBetween(S.lastTick, t);
        for (let k = a; k < b; k++) {
          const te = track.onsetT[k];
          const fr = clamp(Math.round(te * track.fps), 0, track.n - 1);
          if (track.dOnset[fr] < track.dOnsetThr * 0.5) continue; // słabe onsety pomijamy
          const pk = clamp(track.dPeak[fr] / track.dPeakP99, 0, 1);
          const str = clamp(track.onsetS[k] / track.onsetSP95, 0, 1);
          rings.spawn(te, pk, str);
          C.rings++;
          if (pk > 0.75) {
            S.push += 0.14 * pk;      // mocna stopa: delikatne pchnięcie kadru
            S.kickPulse = Math.max(S.kickPulse, pk);
          }
        }
        // --- bas: onsety -> atak rdzenia
        const [ba, bb] = track.bassOnsetsBetween(S.lastTick, t);
        for (let k = ba; k < bb; k++) {
          const te = track.bOnsetT[k];
          const fr = clamp(Math.round(te * track.fps), 0, track.n - 1);
          const str = clamp(track.bOnsetS[k] / track.bOnsetSP95, 0, 1);
          const pk = clamp(track.bPeak[fr] / track.bPeakP99, 0, 1);
          S.bassHit = Math.max(S.bassHit, 0.35 + 0.4 * str + 0.35 * pk);
          C.bassHits++;
        }
      }
      S.lastTick = t;
    }
    S.push = damp(S.push, 0, 6, dt);
    S.kickPulse = damp(S.kickPulse, 0, 5, dt);

    // --- rdzeń basowy: energia basu, atak, barwa z centroidu, puls z tempa basu
    const bRms = clamp(track.at(track.bRms, f) * 1.35, 0, 1);
    const bCentN = clamp(
      (track.at(track.bCent, f) - track.bCentLo) / Math.max(1, track.bCentHi - track.bCentLo),
      0, 1,
    );
    core.update(dt, t, {
      energy: bRms,
      hit: S.bassHit,
      centN: bCentN,
      bpm: track.bTempo[idx],
    });
    S.bassHit = damp(S.bassHit, 0, 4, dt);

    // --- okręgi: czas utworu + ambientowa poświata od rdzenia
    rings.update(t, clamp(core.glow * 0.085, 0, 0.4) * S.glow);

    // --- wstęga wokalna
    ribbon.update(t, track, VOICE_GAIN);

    // --- mgła: przepływ ∝ tempo „inne", odcień z chromy, jasność ∝ blask
    track.chromaInto(idx, chromaArr);
    const fogSpeed = clamp((track.oTempo[idx] - 70) / 120, 0, 1);
    fog.update(dt, running, chromaArr, fogSpeed, S.glow);

    // --- kamera: spokojna, minimalny dryf; mocna stopa lekko podsuwa kadr
    const drift = 0.5 + 0.5 * S.energy;
    camera.position.set(
      Math.sin(t * 0.10) * 0.45 * drift,
      3.25 + Math.sin(t * 0.065) * 0.22 * drift,
      11.2 - S.push,
    );
    camera.lookAt(0, 2.15, 0);

    // --- post: bloom niesie poświatę; aberracja/soczewka tylko cieniem przy stopie
    bloom.strength = 0.26 + 0.34 * S.glow + 0.10 * core.hit;
    post.uniforms.uCA.value = 0.0008 + 0.004 * S.kickPulse;
    post.uniforms.uShock.value = 0.006 * S.kickPulse;

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
        `t ${mm}:${ss}  sekcja ${sIdx + 1}/${track.sections.length}  blask ${S.glow.toFixed(2)}\n` +
        `wstęga: midi ${ribbon.midi.toFixed(1)}  voice ${ribbon.voice.toFixed(2)}  rms ${ribbon.rms.toFixed(2)}\n` +
        `okręgi: ${C.rings}  rdzeń: poziom ${core.level.toFixed(2)}  atak ${core.hit.toFixed(2)}  barwa ${track.at(track.bCent, f).toFixed(0)} Hz\n` +
        `mgła: tempo ${track.oTempo[idx].toFixed(0)} bpm  odcień #${fog.tint.getHexString()}  bas-hity ${C.bassHits}\n` +
        `fps ${fpsEMA.toFixed(0)}   audio ${
          DEMO
            ? "DEMO (bez dźwięku)"
            : master.paused
              ? "PAUZA"
              : Math.floor(master.currentTime) + "s"
        }   spacja: pauza   H: ukryj` + (gpuWarn ? "\n" + gpuWarn : "");
    }
  }

  // Test/debug: stan dostępny w konsoli i w testach przeglądarkowych
  window.__viz = {
    track,
    S,
    C,
    get t() { return clockNow(); },
    get running() { return isRunning(); },
    get glow() { return S.glow; },
    get ribbonVoice() { return ribbon.voice; },
    get ribbonRms() { return ribbon.rms; },
    get ribbonMidi() { return ribbon.midi; },
    get ringsSpawned() { return C.rings; },
    get coreLevel() { return core.level; },
    get coreHit() { return core.hit; },
    get coreCentN() { return core.centN; },
    get fogSpeed() { return fog.speed; },
    get fogTint() { return "#" + fog.tint.getHexString(); },
    get fps() { return fpsEMA; },
    get audio() {
      return {
        paused: master.paused,
        t: master.currentTime,
        volume: master.volume,
        muted: master.muted,
        ready: audios.map((a) => a.readyState),
        loadErrors: audioErrs,
        playFails,
      };
    },
  };

  // Pierwsza klatka przed startem (mgła i kontury widoczne pod overlayem)
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
