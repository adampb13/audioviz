# audio-reactive — The Weeknd „Blinding Lights"

Wizualizacja audio-reactywna (Three.js, WebGL2) napędzana **wyłącznie** wynikami
analizy offline (`data/blindinglights/analysis.json` + 4 stemy WAV). Bez FFT
w czasie rzeczywistym — każdy element sceny jest funkcją danych z JSON-a.

## Kompozycja (wg konspektu „mniej znaczy więcej")

| Element sceny | Dane | Mapowanie |
|---|---|---|
| **Wstęga wokalna** (hero, `ribbon.js`) | `wokal.pitch_midi`, `wokal.rms_norm`, `wokal.pitch_voiced_prob` | wysokość Y = kontur melodii (okno ~3.5 s wstecz); grubość i emisja ∝ głośność; przezroczystość ∝ voiced prob — wdech = rozpuszczenie w mroku |
| **Okręgi na podłodze** (`rings.js`) | `bebny.events.onsets`, `bebny.peak` | płaska płaszczyzna + SDF w fragmencie; każdy onset stopy/werbla = pierścień-kropla; jasność i grubość ∝ peak/siła |
| **Rdzeń basowy** (`basscore.js`) | `bas.rms_norm`, `bas.events.onsets`, `bas.centroid_hz`, `bas.tempo_local_bpm` | miękkie kuliste światło na poziomie podłogi; asymetryczny LERP (szybki atak λ3.0, leniwe opadanie λ0.45) = bicie serca; barwa miedź→złoto z centroidu (gatowana energią) |
| **Mgła / dym** (`fog.js`) | `inne.chroma`, `inne.tempo_local_bpm`, energia miksu | fbm-szum na odwróconej sferze; przepływ ∝ chwilowe tempo; odcień z chromy w ciepłej palecie (brąz/miedź/złoto/róż); podświetlenie od dołu |
| **Globalny blask** (`main.js`) | `mixRms` (4 stemy) | gamma 1.25 na energii: cisza → niemal czerń, refren → pełny rozbłysk; steruje mgłą, bloomem i poświatą okręgów |

## Sterowanie

- **Start / spacja** — play/pauza (klik odblokowuje WebAudio — wymóg przeglądarek)
- **H** — ukryj/pokaż HUD
- `?demo` — podgląd bez dźwięku (wirtualny zegar, HUD pokazuje „DEMO")
- `?t=SEK` — start od sekundy (np. `?demo&t=58`)

## Uruchomienie

```
python viz/serve.py        # http://127.0.0.1:8080/viz/index.html
```

## Struktura

- `viz/index.html` — overlay startowy, HUD, importmap (three z `./vendor/`)
- `viz/js/main.js` — orkiestracja: zegar, pętla, kamera, bloom, HUD, `__viz` (sonda)
- `viz/js/data.js` — `Track`: Float32Array z JSON, interpolacja, onsety, chroma, sekcje
- `viz/js/ribbon.js` / `rings.js` / `basscore.js` / `fog.js` — warstwy sceny
- `viz/js/postfx.js` — winieta + cień aberracji/soczewki przy mocnej stopie
- `analysis/` — pipeline generujący `analysis.json` (demucs + librosa + pyin)

## Kalibracje świadome

- `VOICE_GAIN = 2.2` — mediana `pitch_voiced_prob` w klatkach z wykrytym tonem
  to ~0.15; bez wzmocnienia wokal byłby prawie niewidoczny.
- Progi onsetów bębnów z percentyli utworu (`dOnsetThr`), siła onsetu i peak
  normalizowane do p95/p99 — skale zależą od utworu, więc liczone z danych.
- GPU: przy software renderingu (SwiftShader) HUD pokazuje ostrzeżenie
  `⚠ RENDEROWANIE PROGRAMOWE` — scena wymaga akceleracji sprzętowej.
