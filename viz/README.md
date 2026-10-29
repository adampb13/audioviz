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
| `ground.js` | ziemia: zmarszczki FBM + kolejka 8 fal `{t0, amp, speed}` od beatów; złote grzbiety, sadzawka pod sferą |
| `core.js` | sfera-serce: skala z basu + beatPulse, energia → jasność/nasycenie, wokal → marszczenie |
| `ribbon.js` | wstęga wokalu: kurtyna 300×20, historia 6 s pitch/rms/prob w DataTexture; voiced gate (nić ↔ pełne pasmo); 3 warstwy additive |
| `mountains.js` | 3 warstwy gór (ridged FBM) jako sylwetki w mgle |
| `atmosphere.js` | kopuła nieba (gradient + chmury FBM w tempie utworu), pył 3000 (Points), 12 iskier od onsetów |
| `postfx.js` | RenderPass → UnrealBloom → grade (CA, winieta, ziarno, lift cieni) → OutputPass (ACES) |

## Mapowanie danych → efekt

| dane (stemy po polsku) | efekt |
|---|---|
| `bebny.events.beats`, `bas.events.beats` | impuls: fala na ziemi + błysk sfery (`beatPulse`, wykładniczy zanik) |
| `bebny.events.onsets` (siła p95) | zapalenie kolejnej iskry-bokeh |
| `bas.rms_norm` | skala sfery, kolor gorący |
| `wokal.pitch_midi` (ffill) | kontur Y wstęgi |
| `wokal.pitch_voiced_prob` | **voiced gate**: szerokość i widoczność wstęgi (nić ↔ pasmo) |
| `wokal.rms_norm` | jasność/grubość wstęgi, marszczenie sfery |
| `*.centroid_hz` (p95) | barwa wstęgi/sfery (bursztyn ↔ biało-złoty), migotanie pyłu |
| `inne.tempo_local_bpm` | prędkość chmur na kopule |
| `inne.rms_norm` + `bebny.peak` + bas | `energy` miksu → jasność sfery, światło na ziemi |
| `wokal.events.sections` | HUD (numer sekcji) |

Zasady: wartości ciągłe — interpolacja klatek + wygładzanie wykładnicze
(α=0.12 RMS, α=0.08 pitch @60 fps → `damp` z λ=7.7 / 5.0). Beaty/onsety — triggery,
bez interpolacji. Wszystkie czasy w shaderach to czas utworu (pauza = stop efektów).

## Pętla weryfikacyjna

Przed „gotowe": `node --check viz/js/*.js`; przejazd po sekcjach w `?demo&t=`,
kadr na sekcję + `#err` pusty + `window.__viz`; PIL: profil jasności wierszami,
paleta 8 kolorów vs. referencja, udział pikseli przepalonych (>250) ≈ 0%, fps ≥ 60.
Referencja: `C:\Users\adamp\Downloads\Gemini_Generated_Image_q3xo6hq3xo6hq3xo.jpg`.
