# Blinding Lights — wizualizacja (Three.js)

Animacja sterowana przez `data/blindinglights/analysis.json` (wygenerowany przez `analyze_stems.py`)
i cztery stemy WAV odtwarzane zsynchronizowanie (zegar główny = wokal).

## Uruchomienie

Z korzenia repo:

```bash
.venv/Scripts/python.exe viz/serve.py          # port 8080
```

Potem w przeglądarce: `http://127.0.0.1:8080/viz/index.html` → **Start**.

Parametry URL:
- `?t=60` — start od 60 s,
- `?demo` — bez dźwięku, wirtualny zegar (podgląd / testy).

Klawisze: **Spacja** — pauza/wznowienie, **H** — ukrycie panelu danych.

Three.js 0.186.1 jest w `viz/node_modules` (`npm install` w `viz/`).

## Mapowanie danych na obraz

| Źródło | Efekt |
|---|---|
| miks `rms_norm` (szybko) + prędkość narastania | promień sfery (pierwszy plan) — atak widoczny natychmiast |
| miks `rms_norm` (wolno) | promień sfery (energia utrzymująca się), tempo deformacji/zorzy |
| wokal `pitch_voiced_prob` × `VOICE_GAIN` | głębokość deformacji sfery, widoczność fali wokalnej |
| miks centroid (ważony głośnością stemów) | kolor sfery: rampa głęboki granat -> jasny błękit |
| wokal `centroid_hz` | wysokość fali wokalnej (barwa: dźwięk jaśniejszy -> fala wyższa) |
| wokal `pitch_midi` | kontura melodyczna fali (środek unosi się z wysokością śpiewu) |
| wokal `rms_norm` | jasność grani fali |
| wokal `tempo_local_bpm` | tempo falowania fali |
| miks `tempo_local_bpm` | tempo transformacji sfery i zorzy |
| bębny `onsets` + `centroid_hz` | delikatne iskry z powierzchni sfery (kick/hat/werbel) |
| bębny `peak` | moc iskry |
| bębny `beats` | akcent iskry (cieplejszy kolor), pchnięcie kamery, rozjaśnienie sfery |
| zorza | tempo ∝ tempo miksu + energia, jasność ∝ energia |

## Rozbieżności z konspektem (świadome)

- **Rozmiar sfery:** konspekt mówił o promieniu ∝ RMS basu; w nowym modelu sfera rośnie od chwilowej głośności i energii miksu (szybki atak + wolna energia), a deformacja jest zasilana mocą wokalu — sfera pozostaje w miarę gładka, gdy wokal milczy (konspekt, test czystości).
- **Kolor sfery:** konspekt: rampa wg `CentroidHz`. Używamy centroidu miksu ważonego głośnością stemów (barwa całości, nie tylko wokalu).
- **Błyski:** konspekt: instancjonowane cząsteczki przy onsecie. W praktyce: mała pula iskier (140) z krótkim duchem, moc ∝ `peak`, akcent (zgodny z beatem) rozróżniony kolorem — celowo delikatne.
- **Progi perkusji** są liczone z rozkładu centroidu tego utworu (tercje), nie stałe.
- **Wzmocnienie głosu** (`VOICE_GAIN = 2.2`): `pitch_voiced_prob` ma medianę ~0,15 w klatkach z tonem.

## Struktura

- `serve.py` — serwer z obsługą Range (wymagane przez `<audio>`).
- `js/data.js` — ładowanie JSON, typowane tablice, interpolacja, progi, barwa miksu.
- `js/sphere.js` — sfera centralna: deformacja simplex (vertex shader), rampa koloru, poświata.
- `js/wave.js` — fala wokalna za sferą (kontura melodyczna, barwa → wysokość).
- `js/sparks.js` — pula iskier przy onsetach/beatach (instancjonowane punkty).
- `js/aurora.js` — zorza (GLSL): tempo ∝ tempo miksu, jasność ∝ energia.
- `js/postfx.js` — aberracja, soczewka, winieta.
- `js/main.js` — orkiestracja, sterowanie sferą/falą, zdarzenia bębnów, HUD.

Debug: `window.__viz` (stan, liczniki zdarzeń, track).

## Znane ograniczenia

- Test wykonano w headless Chromium (swiftshader, ~20 fps). Wydajność na prawdziwym GPU nie jest zmierzona.
- Synchronizacja stemów (korekta co ~400 ms, próg 50 ms) nie jest mierzona bezpośrednio; zweryfikowano zegar (wokal) i pauzę/wznowienie.
- `ERR_ABORTED` w konsoli dla WAV-ów to anulowane żądania Range przy seekowaniu, odtwarzanie działa.
