// Podgląd sylwetki panoramy BEZ przeglądarki: liczy profile z ridge.js i wypisuje
// je w ZMIENNYCH EKRANU (0..1), żeby dało się ocenić kompozycję (czy szczyt nie
// wychodzi za kadr, czy przełęcze są widoczne) zanim cokolwiek trafi do sceny.
//
//   node scripts/crest_preview.mjs > $TMPDIR/crest.json
//
// Kolejność: near → distant (w tej kolejności rysuje się je na obrazku).
import {
  RANGES, BASE_Y, TOP_NDC, ndcY, worldYAtNdc, halfWidthAt, bakeCrest, clamp01,
} from "../js/ridge.js";

const COLS = 1600;
const ASPECT = 16 / 9;
const out = { aspect: ASPECT, horizon: 0.5 - ndcY(0, -1e7) / 2, layers: [] };

for (const R of RANGES) {
  const hw = halfWidthAt(R.z, ASPECT);
  const yTop = worldYAtNdc(TOP_NDC, R.z);
  const ndcBase = ndcY(BASE_Y, R.z);
  const nPeak = (1 - 2 * R.peakFrac - ndcBase) / (TOP_NDC - ndcBase);

  const { crest } = bakeCrest(-hw * 1.15, hw * 1.15, COLS, R, (v) => Math.pow(clamp01(v), R.gamma) * nPeak);

  const pts = [];
  for (let c = 0; c < COLS; c++) {
    const x = -hw * 1.15 + (2 * hw * 1.15) * (c / (COLS - 1));
    const wy = BASE_Y + crest[c] * (yTop - BASE_Y);
    pts.push([0.5 + (x / hw) * 0.5, 0.5 - ndcY(wy, R.z) / 2]);
  }
  const peakY = Math.min(...pts.map((p) => p[1]));
  const baseY = 0.5 - ndcBase / 2;
  out.layers.push({
    id: R.id, z: R.z, baseY, peakY, passY: Math.max(...pts.slice(200, -200).map((p) => p[1])),
    band: baseY - peakY, pts: pts.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]),
  });
}

process.stdout.write(JSON.stringify(out));
