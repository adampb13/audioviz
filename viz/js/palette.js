// PRESETY BARWY CAŁEJ SCENY.
//
// Jeden preset przestawia JEDNOCZEŚNIE: niebo, mgłę, ziemię, góry, wstęgę,
// rdzeń kuli, iskry, gwiazdy, tint gradingu ORAZ akcenty interfejsu (panel
// ustawień + panel H) przez zmienne CSS. Dzięki temu scena i UI zawsze trzymają
// jedną tonację — zmiana barwy nie zostawia złotego HUD-u na niebieskiej scenie.
//
// Reguły, które trzymają palety „ładnymi”, a nie tylko kolorowymi:
// • jedna barwa wiodąca + jedna poboczna (akcenty), nigdy trzy równorzędne;
// • tło (niebo/ziemia/mgła/góry) jest CIEMNIEJSZE i mniej nasycone od obiektów
//   świecących — inaczej scena robi się płaska i „plakatowa”;
// • górny koniec żaru (hot) jest jaśniejszy, ale NIE biały: bloom + ACES i tak
//   dokładają biel, więc biel w palecie = wypalona plama;
// • saturacja rośnie ku światłu: cień nasycony mocniej niż światło wygląda
//   brudno, dlatego deep jest ciemnym, ale nie szarym wariantem barwy wiodącej.
//
// Wartości `core.*` i `spark.*` są w przestrzeni liniowej (to idzie do shaderów),
// wartości `css.*` w sRGB (to idzie do arkusza).

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const cssRgb = (hex) => rgb(hex).join(", ");

export const PRESETS = {
  // 1. ZŁOTY — obecny wygląd (bursztyn na brązie). Wartości 1:1 z poprzedniej,
  //    zaszytej palety, żeby wybór „złoty” nie zmienił ani piksela.
  zloty: {
    label: "złoty",
    pal: {
      skyTop: 0x0a0603,
      skyHorizon: 0x4a2b12,
      fog: 0x1a0f08,
      groundLo: 0x140c06,
      groundHi: 0x3d2410,
      gold: 0xd9984a,
      goldBright: 0xffcf8a,
      cream: 0xfff3d6,
      glow: 0xd9984a, // łuna nad horyzontem (uGlow)
    },
    mtn: [[0x060302, 0x140b04], [0x0f0804, 0x241609], [0x241708, 0x4a2f16]],
    core: {
      deepA: [0.34, 0.10, 0.0],
      deepB: [0.44, 0.18, 0.03],
      hotA: [1.0, 0.52, 0.16],
      hotB: [1.0, 0.66, 0.32],
      hotC: [1.0, 0.74, 0.34],
    },
    spark: { cold: [1.0, 0.24, 0.03], mid: [1.0, 0.62, 0.22], warm: [1.0, 0.96, 0.88] },
    stars: { warm: 0xfff3d6, cool: 0xffcf8a },
    lift: [1.0, 0.62, 0.34],
    css: { acc: "#d9984a", acc2: "#ffcf8a", txt: "#ecdfc8", ink: "#090502" },
  },

  // 2. NEONOWY — magenta jako barwa wiodąca, CYJAN tylko na iskrach i gwiazdach
  //    (kontrast komplementarny, ale punktowy: wielka powierzchnia magenty +
  //    drobne zimne akcenty). Tło idzie w fiolet, nie w róż — inaczej scena
  //    świeci na różowo w każdym pikselu i gubi głębię.
  neon: {
    label: "neonowy",
    pal: {
      skyTop: 0x07030c,
      skyHorizon: 0x2b0c36,
      fog: 0x140a1a,
      groundLo: 0x0e080f,
      groundHi: 0x2a1226,
      gold: 0xff3fa4,
      goldBright: 0xff9ad6,
      cream: 0xffe8fb,
      // Łuna jest GŁĘBSZĄ, mniej nasyconą magentą niż sam akcent: przy pełnym
      // nasyceniu niebo zlewało się w jeden różowy pas i gubiło głębię.
      glow: 0xb83a80,
    },
    // góry niemal neutralne (lekki fiolet) — to sylwetki w powietrzu, nie lakiery
    mtn: [[0x06040a, 0x141019], [0x0b0810, 0x1e1722], [0x120e16, 0x2a2130]],
    core: {
      deepA: [0.20, 0.02, 0.16],
      deepB: [0.30, 0.05, 0.24],
      hotA: [1.0, 0.25, 0.62],
      hotB: [1.0, 0.45, 0.75],
      hotC: [1.0, 0.58, 0.86],
    },
    spark: { cold: [0.85, 0.12, 0.90], mid: [1.0, 0.40, 0.80], warm: [0.65, 0.95, 1.0] },
    stars: { warm: 0xffd9f4, cool: 0x8fe4ff },
    lift: [1.0, 0.38, 0.90],
    css: { acc: "#ff3fa4", acc2: "#ff9ad6", txt: "#f7e7fb", ink: "#0d0410" },
  },

  // 3. DEEP BLUE — zimna, spokojna tonacja filmowa. Barwa wiodąca to jasny
  //    błękit (światło), tło granatowo-stalowe. Bez turkusu: turkus + granat
  //    dają „akwarium”, więc akcent trzyma się jednego błękitu o dwóch jasnościach.
  blue: {
    label: "deep blue",
    pal: {
      skyTop: 0x01040c,
      skyHorizon: 0x123a5e,
      fog: 0x06121f,
      groundLo: 0x040a12,
      groundHi: 0x102c46,
      gold: 0x4f9fe8,
      goldBright: 0xa9d8ff,
      cream: 0xe9f6ff,
      glow: 0x4f9fe8,
    },
    mtn: [[0x02060c, 0x0b1a2a], [0x071322, 0x122a41], [0x0f2438, 0x244a6b]],
    core: {
      deepA: [0.02, 0.08, 0.20],
      deepB: [0.05, 0.16, 0.32],
      hotA: [0.30, 0.62, 1.0],
      hotB: [0.50, 0.76, 1.0],
      hotC: [0.72, 0.89, 1.0],
    },
    spark: { cold: [0.10, 0.42, 1.0], mid: [0.40, 0.75, 1.0], warm: [0.92, 0.98, 1.0] },
    stars: { warm: 0xdfeeff, cool: 0x9fd2ff },
    lift: [0.55, 0.80, 1.0],
    css: { acc: "#4f9fe8", acc2: "#a9d8ff", txt: "#dfeeff", ink: "#030a14" },
  },

  // 4. ZIELONY — szmaragd. Ciemna zieleń w tle, jasna mięta w świetle; żar iskier
  //    idzie w limonkę, żeby akcent nie zlewał się z tłem (czysta zieleń na
  //    zieleni znika — potrzebna różnica jasności, nie barwy).
  green: {
    label: "zielony",
    pal: {
      skyTop: 0x04120b,
      skyHorizon: 0x113a26,
      // mgła jaśniejsza niż w pierwszej wersji: przy #07170f daleki plan robił
      // się czarnym pasem odcinającym niebo od pierścieni (w złotym i blue ten
      // obszar czyta się jako teren, bo mgła ma tam więcej światła)
      fog: 0x0a1e13,
      groundLo: 0x07180f,
      groundHi: 0x164a2e,
      gold: 0x4fc48a,
      goldBright: 0xb6f7d2,
      cream: 0xeafff4,
      glow: 0x3f9e6e,
    },
    mtn: [[0x020705, 0x08170f], [0x05120c, 0x0f2a1c], [0x0b2116, 0x1e4a33]],
    core: {
      deepA: [0.02, 0.16, 0.08],
      deepB: [0.05, 0.26, 0.14],
      hotA: [0.35, 0.95, 0.55],
      hotB: [0.55, 1.0, 0.70],
      hotC: [0.75, 1.0, 0.82],
    },
    spark: { cold: [0.12, 0.90, 0.45], mid: [0.55, 1.0, 0.62], warm: [0.92, 1.0, 0.88] },
    stars: { warm: 0xe6fff0, cool: 0xa8f5c8 },
    lift: [0.50, 1.0, 0.70],
    css: { acc: "#4fc48a", acc2: "#b6f7d2", txt: "#e4f7ec", ink: "#04100a" },
  },
};

export const PRESET_ORDER = ["zloty", "neon", "blue", "green"];
export const DEFAULT_PRESET = "zloty";

// Hex → CSS. Zmienne ustawiamy na :root, więc każdy element (panel, HUD, gear)
// dostaje nowy akcent bez przechodzenia po drzewie DOM.
function applyCss(preset) {
  const r = document.documentElement.style;
  const { acc, acc2, txt, ink } = preset.css;
  r.setProperty("--acc", acc);
  r.setProperty("--acc-rgb", cssRgb(acc));
  r.setProperty("--acc2", acc2);
  r.setProperty("--acc2-rgb", cssRgb(acc2));
  r.setProperty("--txt-rgb", cssRgb(txt));
  r.setProperty("--ink-rgb", cssRgb(ink));
  document.documentElement.dataset.preset = preset.key || "";
}

// Wpisuje preset we wszystkie warstwy sceny. `sys` = instancje z main.js.
// Każda warstwa ma własny setPalette() — tu decydujemy tylko, CO dostaje.
export function applyPreset(key, sys) {
  const preset = PRESETS[key] || PRESETS[DEFAULT_PRESET];
  const p = preset.pal;

  if (sys.scene) {
    sys.scene.background.setHex(p.skyTop);
    if (sys.scene.fog) sys.scene.fog.color.setHex(p.fog);
  }
  sys.ground?.setPalette({
    lo: p.groundLo, hi: p.groundHi, gold: p.gold, bright: p.goldBright, fog: p.fog,
  });
  sys.core?.setPalette({
    deepA: preset.core.deepA, deepB: preset.core.deepB,
    hotA: preset.core.hotA, hotB: preset.core.hotB, hotC: preset.core.hotC,
    light: p.gold, halo: p.cream,
  });
  sys.ribbon?.setPalette({ gold: p.gold, bright: p.goldBright, cream: p.cream });
  sys.mountains?.setPalette({ layers: preset.mtn, horizon: p.skyHorizon });
  sys.atmosphere?.setPalette({
    top: p.skyTop, horizon: p.skyHorizon, glow: p.glow ?? p.gold,
    warm: preset.stars.warm, cool: preset.stars.cool,
  });
  sys.sparks?.setPalette(preset.spark);
  sys.post?.setPalette({ lift: preset.lift });

  applyCss({ ...preset, key });
  return key in PRESETS ? key : DEFAULT_PRESET;
}
