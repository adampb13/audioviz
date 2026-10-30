// PROFIL GRZBIETU — czysta matematyka, bez importu three.
//
// Wydzielone, żeby dało się policzyć i obejrzeć kształt sylwetki w node, bez
// przeglądarki (`node scripts/crest_preview.mjs`). Grzbiet gór jest STATYCZNY:
// liczy się go raz przy starcie, więc może być dowolnie drogi (ok. 24k kolumn
// łącznie na 4 pasma × 7 oktaw ≈ 0.3 M ewaluacji szumu — kilka ms).
//
// Charakter alpejski bierze się z trzech rzeczy:
//  1. ridged multifractal (1-|noise|, podniesiony do potęgi) — ostre granie,
//     nie gładkie kopuły; wysoka lacunarity (2.3-2.6) daje drobne zadrapania,
//  2. envelope masywów z twardym progiem — między masywami są PRAWDZIWE przełęcze
//     (wartość spada do zera), a nie sinusoida,
//  3. rzadkie iglice (needle) wypchnięte ponad linię grzbietu — pojedyncze
//     strzeliste turnie, które dają "dynamiczną linię horyzontu".

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}

// ---------- szum 1D ----------
export function hash1(n, seed = 0) {
  const s = Math.sin(n * 127.1 + seed * 311.7 + 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function vnoise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10); // quintic: brak "węży" na krawędziach
  return (hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u) * 2 - 1;
}

export function fbm1(x, oct, seed = 0, lacun = 2.03, gain = 0.5) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise1(x * f, seed + i * 17);
    n += a;
    a *= gain;
    f *= lacun;
  }
  return s / n;
}

// ---------- szum 2D (bake tekstur skały i chmur) ----------
export function hash2(x, y, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function vnoise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return (top + (bot - top) * uy) * 2 - 1;
}

// 2D fbm ZAWIJANE (tileable): kafle bez szwu — krata szumu zawijana modulo okres.
// lacunarity MUSI być całkowita (2.0), inaczej period kolejnej oktawy nie jest
// wielokrotnością i na krawędzi kafla pojawia się szew.
export function fbm2p(u, v, period, oct, seed = 0, gain = 0.5) {
  let s = 0, a = 1, n = 0, p = period;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise2p(u * p, v * p, p, p, seed + i * 13);
    n += a;
    a *= gain;
    p *= 2;
  }
  return s / n;
}

// szum 2D z okresową kratą
export function vnoise2p(x, y, px, py, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = (i, j) => hash2(((i % px) + px) % px, ((j % py) + py) % py, seed);
  const a = w(ix, iy), b = w(ix + 1, iy), c = w(ix, iy + 1), d = w(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return (top + (bot - top) * uy) * 2 - 1;
}

// ridged: 1-|noise| podniesione do potęgi — ostre granie zamiast obłości.
function ridged1(x, cfg) {
  let sum = 0, amp = 1, norm = 0, freq = cfg.freq;
  for (let o = 0; o < cfg.oct; o++) {
    const w = vnoise1(x * freq * 0.35 + cfg.seed * 3.1 + o * 5.7, cfg.seed + 2) * cfg.warp;
    const n = 1 - Math.abs(vnoise1(x * freq + w + cfg.seed * 11.3 + o * 37.1, cfg.seed + 3 + o));
    sum += Math.pow(n, cfg.sharp) * amp;
    norm += amp;
    amp *= cfg.gain;
    freq *= cfg.lacun;
  }
  return sum / norm;
}

// Wysokość grzbietu w 0..1 (przed normalizacją): envelope masywów ⊗ turnie ⊗ iglice.
export function crestRaw(x, cfg) {
  const m = 0.5 + 0.5 * fbm1(x * cfg.mFreq + cfg.seed * 5.3, 3, cfg.seed + 1, 2.11, 0.55);
  const env = smoothstep(cfg.mLow, cfg.mHigh, m);
  // druga, drobniejsza modulacja: wewnątrz masywu też są niższe i wyższe odcinki
  const sub = 0.72 + 0.28 * (0.5 + 0.5 * fbm1(x * cfg.mFreq * 3.7 + cfg.seed * 9.1, 2, cfg.seed + 5));
  const rid = ridged1(x, cfg);
  const crag = Math.pow(rid, cfg.pow);
  const needle = Math.pow(smoothstep(cfg.nT, 1.0, rid), 1.7);
  return env * sub * (cfg.floor + (1 - cfg.floor) * clamp01(crag + needle * cfg.nAmp));
}

// Wypala profil do tablicy znormalizowanej 0..1 (0 = najniższa przełęcz, 1 = najwyższy szczyt).
export function bakeCrest(x0, x1, cols, cfg, accessor) {
  const out = new Float32Array(cols);
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < cols; c++) {
    const x = x0 + (x1 - x0) * (c / (cols - 1));
    const v = crestRaw(x, cfg);
    out[c] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let c = 0; c < cols; c++) out[c] = accessor((out[c] - lo) / span);
  return { crest: out, lo, hi };
}

// ---------- kamera → ekran (potrzebne, by szczyt NIE wyszedł za kadr) ----------
// Kamera jest statyczna (góry stoją), więc rzut liczy się raz.
export const CAM = { pos: [0, 7, 22], look: [0, 3, 0], fov: 55 };

const camBasis = () => {
  const f = norm(sub(CAM.look, CAM.pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { f, r, u };
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const TANH = Math.tan((CAM.fov * Math.PI) / 360);

// ndc.y punktu (0, worldY, z); aspect nie wpływa na pion
export function ndcY(worldY, z) {
  const { f, u } = camBasis();
  const v = [0 - CAM.pos[0], worldY - CAM.pos[1], z - CAM.pos[2]];
  const dep = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  const y = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  return y / (dep * TANH);
}

// worldY, który trafia w dane ndc.y na głębokości z
export function worldYAtNdc(ndc, z) {
  const { f, u } = camBasis();
  const d = [f[0] + u[0] * ndc * TANH, f[1] + u[1] * ndc * TANH, f[2] + u[2] * ndc * TANH];
  const t = (z - CAM.pos[2]) / d[2];
  return CAM.pos[1] + d[1] * t;
}

// połowa szerokości kadru na głębokości z (dla danego aspect)
export function halfWidthAt(z, aspect = 16 / 9) {
  const dep = Math.abs(CAM.pos[2] - z);
  return dep * TANH * aspect;
}

export const BASE_Y = -0.5;      // podstawa pasma: tuż pod horyzontem
export const TOP_NDC = 0.99;     // górna krawędź kurtyny = 0.5% pod górną krawędzią kadru

// ---------- PROJEKT PANORAMY ----------
// peakFrac: gdzie MA trafić najwyższy szczyt, jako ułamek wysokości kadru od góry
// (0 = górna krawędź). Gwarantuje "góry nie wychodzą za ekran".
// band: ułamek kadru od szczytu do linii mgły (wizualna masa pasma).
// Profil: freq/lacun/oct decydują o ostrości, sharp/pow o szpicowatości,
// floor o tym, jak wysokie są przełęcze.
export const RANGES = [
  {
    id: "near", seed: 1.7, z: -95, peakFrac: 0.205, gamma: 1.30,
    freq: 0.0210, oct: 6, lacun: 2.40, gain: 0.50, sharp: 1.85, warp: 1.8,
    pow: 1.35, nT: 0.76, nAmp: 0.16, floor: 0.17,
    mFreq: 0.0116, mLow: 0.34, mHigh: 0.74,
    fogY0: 0.5, fogY1: 10.0, rockSize: 6.5, hiY0: 7.0, hiY1: 17.0,
    haze: 0.04, fogBase: 0.40, relief: 1.00, rim: 0.55, snow: 0.10,
    cloud: 0.12, cloudLo: 0.02, cloudHi: 0.30,
    dark: 0x060302, lit: 0x3a2410, rimCol: 0xffc98a,
  },
  {
    id: "mid", seed: 4.3, z: -165, peakFrac: 0.115, gamma: 1.24,
    freq: 0.0130, oct: 6, lacun: 2.42, gain: 0.50, sharp: 1.80, warp: 1.9,
    pow: 1.40, nT: 0.74, nAmp: 0.18, floor: 0.18,
    mFreq: 0.0080, mLow: 0.32, mHigh: 0.72,
    fogY0: 0.0, fogY1: 26.0, rockSize: 12.0, hiY0: 17.0, hiY1: 36.0,
    haze: 0.16, fogBase: 0.44, relief: 0.95, rim: 0.42, snow: 0.13,
    cloud: 0.14, cloudLo: 0.03, cloudHi: 0.36,
    dark: 0x0c0703, lit: 0x33200f, rimCol: 0xffc386,
  },
  {
    id: "far", seed: 8.9, z: -300, peakFrac: 0.065, gamma: 1.18,
    freq: 0.0085, oct: 6, lacun: 2.45, gain: 0.50, sharp: 1.75, warp: 2.0,
    pow: 1.45, nT: 0.72, nAmp: 0.20, floor: 0.19,
    mFreq: 0.0059, mLow: 0.30, mHigh: 0.70,
    fogY0: 0.0, fogY1: 48.0, rockSize: 22.0, hiY0: 38.0, hiY1: 72.0,
    haze: 0.30, fogBase: 0.38, relief: 0.80, rim: 0.26, snow: 0.14,
    cloud: 0.16, cloudLo: 0.04, cloudHi: 0.40,
    dark: 0x1a1108, lit: 0x4a3520, rimCol: 0xffcb96,
  },
  {
    id: "distant", seed: 13.1, z: -470, peakFrac: 0.028, gamma: 1.14,
    freq: 0.0055, oct: 5, lacun: 2.50, gain: 0.50, sharp: 1.70, warp: 2.1,
    pow: 1.50, nT: 0.70, nAmp: 0.22, floor: 0.20,
    mFreq: 0.0037, mLow: 0.28, mHigh: 0.68,
    fogY0: 0.0, fogY1: 70.0, rockSize: 34.0, hiY0: 65.0, hiY1: 118.0,
    haze: 0.44, fogBase: 0.34, relief: 0.60, rim: 0.14, snow: 0.15,
    cloud: 0.16, cloudLo: 0.05, cloudHi: 0.44,
    dark: 0x2a1e12, lit: 0x5e4830, rimCol: 0xffd7ab,
  },
];

