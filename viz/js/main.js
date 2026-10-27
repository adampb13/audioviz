// Orkiestracja: audio (4 stemy zsynchronizowane po wokalu), analiza -> sceny Three.js.
// Mapowanie na konspekt:
//  1. Wokal   -> wstęga (pitch_midi -> Y, voiced_prob -> alfa, rms -> grubość, flatness/zcr -> strzępienie)
//  2. Bas     -> grawitacja tła (rms), soczewka (pitch), opór ośrodka (bandwidth)
//  3. Bębny   -> kick/hat/werbel wg centroid + onset; uderzenia -> aberracja + pchnięcie kamery
//  4. Inne    -> zorza: chroma -> kolor, mel_db -> zasłony, rms -> jasność
//  5. Reżyser -> sekcje z analizy sterują intensywnością (kamera, FOV, grubość, jasność)
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Track, STEM_NAMES, clamp, damp } from "./data.js";
import { Ribbon } from "./ribbon.js";
import { ParticleSystem } from "./particles.js";
import { Aurora, hsvToRgb } from "./aurora.js";
import { postShader } from "./postfx.js";

const params = new URLSearchParams(location.search);
const DEMO = params.has("demo"); // podgląd bez dźwięku: wirtualny zegar
const AUDIO_DIR = "../data/blindinglights/";
const ANALYSIS_URL = AUDIO_DIR + "analysis.json";

// pyin voiced_prob na wokalu ma medianę ~0.15 w klatkach z wykrytym tonem (p90 ~0.95),
// więc bez wzmocnienia wstęga byłaby przez większość czasu prawie niewidoczna.
// To świadome dostrojenie, nie część danych.
const VOCAL_ALPHA_GAIN = 2.2;
const HEAD_X = 3.0; // pozycja głowy wstęgi w przestrzeni kamery
const RIBBON_SPEED = 1.1; // jednostki/s, z jaką historia ucieka w lewo
const CAM_DIST = 12; // odległość kamery od grupy "bliskiej" (wstęga, eksplozje)
const SAMPLES = 300; // ~5 s historii wstęgi przy 60 fps

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

// Wstęga wokalu z danych bez wygładzania (używane do wypełnienia historii przy starcie/seeku)
function vocalTargets(track, f, I) {
  const midi = track.at(track.vMidi, f);
  const prob = clamp(track.at(track.vProb, f) * VOCAL_ALPHA_GAIN, 0, 1);
  const rms = track.at(track.vRms, f);
  const flat = clamp(track.at(track.vFlat, f) / track.vFlatP95, 0, 1.5);
  const zcr = clamp(track.at(track.vZcr, f) / track.vZcrP95, 0, 1.5);
  return {
    y: clamp((midi - 64) / 12, -1, 1) * 2.6,
    w: (0.03 + 0.2 * rms) * (0.5 + 0.7 * I) * (0.35 + 0.65 * prob),
    a: prob,
    rough: clamp(0.6 * flat + 0.4 * zcr, 0, 1),
    rms,
  };
}

// Kolor zorzy z chromy: ważona suma barw 12 półtonów (C = niebieski, B = purpura)
function chromaColor(ch) {
  let r = 0, g = 0, b = 0, ws = 0, best = -1, bestK = 0;
  for (let k = 0; k < 12; k++) {
    const w = Math.pow(Math.max(ch[k], 0), 1.6);
    const hue = 0.6 + (k / 12) * 0.4;
    const [cr, cg, cb] = hsvToRgb(hue, 0.85, 1);
    r += cr * w;
    g += cg * w;
    b += cb * w;
    ws += w;
    if (ch[k] > best) {
      best = ch[k];
      bestK = k;
    }
  }
  if (ws < 1e-6) return { col: [0.15, 0.15, 0.3], hue: 0.6 };
  return { col: [r / ws, g / ws, b / ws], hue: 0.6 + (bestK / 12) * 0.4 };
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

  const near = new THREE.Group(); // wszystko "tuż przed kamerą" podąża za kamerą
  scene.add(near);

  const aurora = new Aurora(scene);
  const core = new Ribbon(near, { widthMul: 1.0, alphaMul: 1.0, samples: SAMPLES });
  const halo = new Ribbon(near, { widthMul: 3.2, alphaMul: 0.28, samples: SAMPLES });
  const dust = new ParticleSystem(scene, 2600);
  const kicks = new ParticleSystem(near, 900);
  const hats = new ParticleSystem(near, 1400);
  const fuzz = new ParticleSystem(near, 900);
  const systems = [dust, kicks, hats, fuzz];

  const DUST = { halfW: 16, halfH: 9, depth: 60 };
  dust.initDust({ ...DUST, camZ: camera.position.z });
  dust.uniforms.uBright.value = 0;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.15);
  composer.addPass(bloom);
  const post = new ShaderPass(postShader);
  composer.addPass(post);
  composer.addPass(new OutputPass());

  // --- stan
  const S = {
    I: 0.2, travel: 0, push: 0, phase: 0, fov: 50, caSpike: 0,
    vy: 0, vw: 0.1, va: 0, fuzzAcc: 0, lastTick: clockNow(),
  };
  const C = { kick: 0, hat: 0, snare: 0, nudge: 0 };
  const tmpChroma = new Float32Array(12);
  const tmpMel = new Float32Array(32);

  // Wypełnienie historii wstęgi tym, co było w ostatnich ~5 s (żeby seek nie zaczynał od pustki)
  for (let j = 0; j < SAMPLES; j++) {
    const tt = clockNow() - (SAMPLES - 1 - j) / track.fps;
    const f = track.frameAt(tt);
    const V = vocalTargets(track, f, S.I);
    core.push({ t: tt, y: V.y, w: V.w, a: V.a, rough: V.rough, zw: camera.position.z - CAM_DIST });
    halo.push({ t: tt, y: V.y, w: V.w, a: V.a, rough: V.rough, zw: camera.position.z - CAM_DIST });
  }

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

  // --- zdarzenia bębnów
  function burst(sys, n, origin, speedMin, speedMax, life, size, colorFn) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speedMin + Math.random() * (speedMax - speedMin);
      const [r, g, b] = colorFn();
      sys.emit({
        x: origin.x, y: origin.y, z: origin.z,
        vx: sp * Math.sin(ph) * Math.cos(th),
        vy: sp * Math.sin(ph) * Math.sin(th),
        vz: sp * Math.cos(ph) * 0.4,
        size: size * (0.7 + 0.6 * Math.random()),
        r, g, b,
        life: life * (0.7 + 0.6 * Math.random()),
      });
    }
  }

  function onKick(pk) {
    C.kick++;
    burst(kicks, 70, { x: 0, y: 0, z: 0 }, 2.5, 7, 1.2, 0.3, () => [1.0, 0.4 + 0.3 * Math.random(), 0.7]);
    S.caSpike = Math.max(S.caSpike, 0.6 + 0.4 * pk);
  }


  function onHat(pk) {
    C.hat++;
    for (let i = 0; i < 30; i++) {
      hats.emit({
        x: (Math.random() * 2 - 1) * 5,
        y: (Math.random() * 2 - 1) * 2.5,
        z: (Math.random() * 2 - 1),
        vx: (Math.random() * 2 - 1) * 1.5,
        vy: Math.random() * 2,
        vz: 0,
        size: 0.05 + Math.random() * 0.05,
        r: 1, g: 0.95, b: 0.8,
        life: 0.35 + Math.random() * 0.25,
      });
    }
    S.caSpike = Math.max(S.caSpike, 0.25 * pk);
  }

  function onSnare(pk) {
    C.snare++;
    for (let i = 0; i < 25; i++) {
      fuzz.emit({
        x: HEAD_X, y: S.vy, z: 0,
        vx: (Math.random() * 2 - 1) * 3 - RIBBON_SPEED,
        vy: (Math.random() * 2 - 1) * 2,
        vz: 0,
        size: 0.09,
        r: 0.5, g: 0.9, b: 1,
        life: 0.5,
      });
    }
    S.caSpike = Math.max(S.caSpike, 0.35 * pk);
  }

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
    const idx = Math.round(f);

    // --- reżyser
    const sIdx = track.sectionAt(t);
    const targetI = 0.6 * track.sectionIntensity[sIdx] + 0.4 * track.at(track.mixRms, f);
    S.I = damp(S.I, clamp(targetI, 0, 1.2), 1.2, dt);

    // --- bas: grawitacja, soczewka, opór
    const gB = Math.pow(track.at(track.bRms, f), 0.8);
    const bassHz = 440 * Math.pow(2, (track.at(track.bMidi, f) - 69) / 12);
    const bwN = clamp(track.at(track.bBw, f) / track.bBwP95, 0, 1.5);
    if (running) {
      S.travel += dt * (0.02 + 1.7 * Math.pow(S.I, 1.6));
      S.phase += dt * 2 * Math.PI * (bassHz / 40);
    }
    S.push = damp(S.push, 0, 7, dt);
    S.fov = damp(S.fov, 50 + 14 * S.I, 2, dt);

    const camZ = CAM_DIST - S.travel - S.push;
    camera.position.set(Math.sin(S.phase * 0.5) * 0.06 * S.I, Math.cos(S.phase * 0.37) * 0.05 * gB, camZ);
    camera.lookAt(0, 0, camZ - CAM_DIST);
    if (Math.abs(camera.fov - S.fov) > 0.01) {
      camera.fov = S.fov;
      camera.updateProjectionMatrix();
    }
    near.position.z = camZ - CAM_DIST;
    const uPx = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const s of systems) s.uniforms.uPx.value = uPx;

    // --- wokal: wstęga
    const V = vocalTargets(track, f, S.I);
    S.vy = damp(S.vy, V.y - gB * 1.1, 12, dt); // bas ściąga wstęgę w dół
    S.vw = damp(S.vw, V.w, 10, dt);
    S.va = damp(S.va, V.a, 10, dt);
    if (running) {
      const zl = Math.sin(t * 1.3) * 0.6 * (0.4 + S.I) + Math.sin(t * 0.37) * 0.3;
      const sample = { t, y: S.vy, w: S.vw, a: S.va, rough: V.rough, zw: near.position.z + zl };
      core.push(sample);
      halo.push(sample);

      // Szorstki/szeptany wokal gubi cząsteczki z głowy wstęgi
      S.fuzzAcc += dt * 90 * V.rough * S.va * (0.3 + V.rms * 2);
      while (S.fuzzAcc >= 1) {
        S.fuzzAcc -= 1;
        fuzz.emit({
          x: HEAD_X, y: S.vy + (Math.random() - 0.5) * S.vw * 2, z: zl,
          vx: -RIBBON_SPEED + (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4, vz: 0,
          size: 0.04 + 0.03 * Math.random(),
          r: 0.6, g: 0.9, b: 1,
          life: 0.8,
        });
      }
    }

    // --- bębny: onsety z analizy (czas), klasyfikacja po centroidzie i sile onsetu w tej klatce
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
          // Onset zgodny z beatem (events.beats, ±90 ms) pcha kamerę: kick mocno, reszta lekko.
          // W danych kicki (niski centroid) nigdy nie padają na beat, więc warunek tylko na kicku nie działał.
          if (track.nearestBeatDist(te) < 0.09) {
            S.push += cent < track.onsetCentLo ? 0.35 : 0.12;
            C.nudge++;
          }
          if (cent < track.onsetCentLo) onKick(pk);
          else if (cent > track.onsetCentHi) onHat(pk);
          else onSnare(pk);
        }
      }
      S.lastTick = t;
    }

    // --- tło: cząsteczki opadają z prędkością zależną od basu, opór z bandwidth
    const fall = (0.3 + 6 * gB) / (0.6 + bwN);
    const dustB = 0.04 + 0.9 * clamp((S.I - 0.25) / 0.35, 0, 1);
    dust.uniforms.uBright.value = dustB;
    if (running) {
      dust.updateDust(dt, { fall, camZ, depth: DUST.depth, halfW: DUST.halfW, halfH: DUST.halfH });
      kicks.drag = 2.5; kicks.gravity = 0; kicks.update(dt);
      hats.drag = 1.2; hats.gravity = 3.5; hats.update(dt);
      fuzz.drag = 1.5; fuzz.gravity = 0; fuzz.update(dt);
    } else {
      dust.flush();
    }

    // --- kolory zorzy z chromy, mel_db, jasność z rms "inne"
    const idxC = clamp(idx, 0, track.n - 1);
    const cc = chromaColor(track.chromaInto(idxC, tmpChroma));
    const colB = hsvToRgb((cc.hue + 0.12) % 1, 0.9, 1);
    const oRms = track.at(track.oRms, f);
    aurora.update(dt, t, {
      colA: cc.col,
      colB,
      melTarget: track.melInto(idxC, tmpMel),
      bright: clamp(oRms * 1.8, 0, 1) * (0.35 + 0.65 * S.I),
      I: S.I,
    });

    // --- wstęga: rysowanie
    const coreCol = [0.8 * (0.6 + 0.3 * S.I), 0.97 * (0.6 + 0.3 * S.I), 1.0 * (0.6 + 0.3 * S.I)];
    const haloCol = [cc.col[0] * 1.2, cc.col[1] * 1.2, cc.col[2] * 1.2];
    core.update(t, { headX: HEAD_X, speed: RIBBON_SPEED, nearZ: near.position.z, color: coreCol });
    halo.update(t, { headX: HEAD_X, speed: RIBBON_SPEED, nearZ: near.position.z, color: haloCol });

    // --- post: aberracja (uderzenia), soczewka (sub-bas), bloom (intensywność)
    S.caSpike = damp(S.caSpike, 0, 9, dt);
    post.uniforms.uCA.value = 0.0012 + 0.012 * S.caSpike;
    post.uniforms.uShock.value = 0.025 * gB * (0.5 + 0.5 * Math.sin(S.phase));
    bloom.strength = 0.4 + 0.35 * S.I;

    aurora.uniforms.uTime.value = t;
    composer.render(dt);

    // --- HUD
    if (rawDt > 0) fpsEMA = damp(fpsEMA, 1 / rawDt, 2, rawDt);
    hudAcc += rawDt;
    if (hudAcc > 0.25) {
      hudAcc = 0;
      const mm = Math.floor(t / 60);
      const ss = (t % 60).toFixed(2).padStart(5, "0");
      hud.textContent =
        `t ${mm}:${ss}  sekcja ${sIdx + 1}/${track.sections.length}  intensywność ${S.I.toFixed(2)}\n` +
        `kamera z=${camZ.toFixed(2)}  FOV ${camera.fov.toFixed(1)}  bas ${bassHz.toFixed(0)} Hz  grawitacja ${gB.toFixed(2)}\n` +
        `wokal: midi ${track.at(track.vMidi, f).toFixed(1)}  alfa ${S.va.toFixed(2)}  rough ${V.rough.toFixed(2)}\n` +
        `bębny: kick ${C.kick}  hat ${C.hat}  werbel ${C.snare}  beat-nudge ${C.nudge}\n` +
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
    get wstegaSamples() { return core.hist.length; },
    get dustBright() { return dust.uniforms.uBright.value; },
    get camZ() { return camera.position.z; },
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
