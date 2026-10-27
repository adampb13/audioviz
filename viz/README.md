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
| wokal `pitch_midi` | wysokość wstęgi (Y), interpolacja między klatkami |
| wokal `pitch_voiced_prob` × `VOCAL_ALPHA_GAIN` | przezroczystość i szerokość wstęgi |
| wokal `rms_norm` | grubość i jasność |
| wokal `flatness`, `zcr` | strzępienie krawędzi i gubienie cząsteczek |
| bas `rms_norm` | grawitacja tła (cząsteczki opadają), ugięcie kadru |
| bas `pitch_midi` | częstotliwość falowania kadru (soczewka) |
| bas `bandwidth_hz` | opór ośrodka (wolniejsze opadanie przy szerokim basie) |
| bębny `onsets` + `centroid_hz` | kick (eksplozja), hi-hat (iskry), werbel (rozbłysk) |
| bębny `peak` | aberracja chromatyczna przy uderzeniu |
| bębny `beats` | pchnięcie kamery przy onsecie zgodnym z beatem |
| inne `chroma` | kolor zorzy (ważona suma barw 12 półtonów) |
| inne `mel_db` (32 pasma) | zasłony zorzy |
| inne `rms_norm` | jasność zorzy |
| `events.sections` (wokal) + średnia energia | reżyser: prędkość kamery, FOV, grubość, jasność |

## Rozbieżności z konspektem (świadome)

- **`cross.energy_share`** to jedna liczba na stem dla całego utworu, nie da się z niej wykryć „najcięższych momentów”. Zamiast tego intensywność liczona jest ze średniej energii miksu w każdej sekcji.
- **Pchnięcie kamery:** kick nie pada na beat w tych danych (0 przypadków z 196), więc każdy onset zgodny z beatem (±90 ms) pcha kamerę — kick mocno (0,35), reszta lekko (0,12).
- **Progi perkusji** są liczone z rozkładu centroidu tego utworu (tercje), nie stałe.
- **Wzmocnienie alfy wokalu** (`VOCAL_ALPHA_GAIN = 2.2`): `pitch_voiced_prob` ma medianę ~0,15 w klatkach z tonem.
- **Intro:** konspekt zakłada statyczną kamerę i ciemność w sekcji 1. Według danych sekcja 1 ma intensywność 0,66 (energia jest wysoka już od początku), więc kamera się porusza. Do zmiany w `main.js` (`S.I`).
- **Intensywność w sekcji:** `intensywność = 0,6·sekcja + 0,4·miks` — sekcje dają kierunek, miks dynamikę wewnątrz.

## Struktura

- `serve.py` — serwer z obsługą Range (wymagane przez `<audio>`).
- `js/data.js` — ładowanie JSON, typowane tablice, interpolacja, progi.
- `js/ribbon.js` — wstęga wokalu (historia próbek, ogon, strzępy).
- `js/particles.js` — cząsteczki: tło, eksplozje, iskry.
- `js/aurora.js` — zorza (GLSL) i paleta z chromy.
- `js/postfx.js` — aberracja, soczewka, winieta.
- `js/main.js` — orkiestracja, reżyser, zdarzenia bębnów, HUD.

Debug: `window.__viz` (stan, liczniki zdarzeń, track).

## Znane ograniczenia

- Test wykonano w headless Chromium (swiftshader, ~20 fps). Wydajność na prawdziwym GPU nie jest zmierzona.
- Synchronizacja stemów (korekta co ~400 ms, próg 50 ms) nie jest mierzona bezpośrednio; zweryfikowano zegar (wokal) i pauzę/wznowienie.
- `ERR_ABORTED` w konsoli dla WAV-ów to anulowane żądania Range przy seekowaniu, odtwarzanie działa.
