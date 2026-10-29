# audioviz — pustynna fala światła

Kinowa, audio-reaktywna scena Three.js (WebGL2, custom GLSL): złoty, mglisty pustynny sen
napędzany plikiem `data/<utwór>/analysis.json`. Estetyka wg obrazu referencyjnego
(master prompt) — ciemna czekoladowa ziemia, koncentryczne fale światła od beatów,
żarząca sfera-serce, jedwabna wstęga wokalu, sylwetki gór w mgle, złoty pył i iskry.

## Uruchomienie

```bash
python viz/serve.py          # serwer na :8080, root = katalog repo
# przeglądarka: http://127.0.0.1:8080/viz/index.html
```

- `?track=<nazwa>` — utwór = katalog w `data/` (domyślnie `blindinglights`).
  Wymaga `data/<nazwa>/analysis.json` + stemów `wokal/bas/bebny/inne.wav`.
  Nowy utwór: `python analyze_stems.py <katalog>` (patrz `analyze_stems.py`).
- `?demo&t=123` — start bez gestu użytkownika, od 123 s (zegar własny, bez audio).
- `Spacja` — pauza · `H` — panel HUD · `#err` — błędy JS · `window.__viz` — sonda stanu.

## Architektura (`viz/js/`)

| plik | rola |
|---|---|
| `main.js` | boot, master clock (audio.currentTime / demo), pętla, LERP stanu, triggery |
| `data.js` | `Track`: analysis.json → Float32Array, percentyle, forwardFill pitch; `sampleAt` (interpolacja klatek), `EventCursor` (beaty/onsety) |
| `glsl.js` | wspólny GLSL: Ashima simplex 3D, FBM-4, ridged FBM, mgła exp2, paleta |
| `ground.js` | ziemia: gładka baza FBM + kolejka **max 2 fal** od beatów (blackout 450 ms, amp ≤ 0.22, 6 m/s, sin(d·0.35)); matowe oświetlenie od sfery, owalna sadzawka |
| `core.js` | sfera-żar (r=0.9, y=0.3 wkopana): emissive 0.5+1.2·en+0.3·bp (cap 1.35, tanh-sufit), bursztyn #7a3000→#ffcf8a; halo sprite; PointLight 6+18·energy |
| `ribbon.js` | wstęga wokalu: sztywna deska x ±80 na y=9, z=-28 (daleko za sferą); szerokość z RMSslow (0.3-3.3 m), jasność z RMSfast, kontur z pitch ±1.2 m; 3 warstwy additive, zero fbm w alpha |
| `mountains.js` | 3 warstwy gór (ridged FBM) jako sylwetki w mgle (z=170/235/310) |
| `atmosphere.js` | kopuła nieba (gradient + prawie niewidoczne chmury), pył 250 drobin nisko (y≤4), 8 hero bokeh od onsetów |
| `postfx.js` | RenderPass → UnrealBloom → grade (CA, winieta, ziarno, lift cieni) → OutputPass (ACES) |

## Mapowanie danych → efekt

| dane (stemy po polsku) | efekt |
|---|---|
| `bebny.events.beats`, `bas.events.beats` | impuls: fala na ziemi (1 bit = 1 fala, debounce 350 ms) + błysk sfery (`beatPulse`) |
| `bebny.events.onsets` (siła p95) | zapalenie kolejnej iskry-bokeh |
| `bas.rms_norm` | (przez `cross.energy`) energia → skala/jasność sfery |
| `wokal.pitch_midi` (ffill) | kontur Y wstęgi |
| `wokal.pitch_voiced_prob` | **voiced gate**: szerokość i widoczność wstęgi (nić ↔ pasmo) |
| `wokal.rms_norm` | jasność/grubość wstęgi, marszczenie sfery |
| `*.centroid_hz` (p95) | barwa wstęgi/sfery (bursztyn ↔ krem) |
| `inne.tempo_local_bpm` | prędkość chmur na kopule |
| `cross.energy` | `energySmooth` (wolna, λ=2) → jasność sfery, światło na ziemi, alpha pyłu, exposure |
| `bas.peak` (p95) | amplituda fali: 0.15 + peak·0.2 (max 0.35) |
| `wokal.events.sections` | HUD (numer sekcji) |

Zasady: wartości ciągłe — interpolacja klatek + wygładzanie wykładnicze
(α=0.12 RMS, α=0.08 pitch @60 fps → `damp` z λ=7.7 / 5.0; wokal: atak 17.3,
release 4.4). Beaty/onsety — triggery, bez interpolacji. Wszystkie czasy
w shaderach to czas utworu (pauza = stop efektów).

## Pętla weryfikacyjna

Przed „gotowe": `node --check viz/js/*.js`; przejazd po sekcjach w `?demo&t=`,
kadr na sekcję + `#err` pusty + `window.__viz`; PIL: profil jasności wierszami,
paleta 8 kolorów vs. referencja. Progi akceptacji (audyt): **clip% < 1%**
(piksele >250), **drawCalls < 25** (sama scena, bez passów bloom),
**tris < 800k**, **FPS p95 > 55**. Aktualnie: clip 0.00%, ~19 draw calls sceny
(33-34 z passami), 277k tris, p95 ~140 fps.
Referencja: `C:\Users\adamp\Downloads\Gemini_Generated_Image_q3xo6hq3xo6hq3xo.jpg`.
