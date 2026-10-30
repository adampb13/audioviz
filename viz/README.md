# audioviz — pustynna fala światła

Kinowa, audio-reaktywna scena Three.js (WebGL2, custom GLSL): złoty, mglisty pustynny sen
napędzany plikiem `data/<utwór>/analysis.json`. Estetyka wg obrazu referencyjnego
(master prompt) — ciemna czekoladowa ziemia, koncentryczne fale światła od uderzeń bębnów,
żarząca sfera-serce, jedwabna wstęga wokalu, cztery pasma gór w mgle, gwiazdy.

Zasada nadrzędna: **mniej znaczy lepiej** — cisza + trzy elementy (ziemia, wstęga, sfera).
W scenie **nie ma żadnych cząstek** — ani pyłu tła, ani iskier z kuli. Sfera „świeci sobą":
powierzchnia, barwa i rozmiar. Wszystko, co zostaje, ma być gładkie.

## Uruchomienie

```bash
python viz/serve.py          # serwer na :8080, root = katalog repo
# przeglądarka: http://127.0.0.1:8080/viz/index.html
```

- `?track=<nazwa>` — utwór = katalog w `data/` (domyślnie `blindinglights`).
  Wymaga `data/<nazwa>/analysis.json` + stemów `wokal/bas/bebny/inne.wav`
  (wav-y są poza repo — odtwarzalne przez `separate.py` + `analyze_stems.py`).
- `?demo&t=123` — start bez gestu użytkownika, od 123 s (zegar własny, bez audio).
- `Spacja` — pauza · `H` — panel HUD · `S` — panel ścieżek · `#err` — błędy JS ·
  `window.__viz` — sonda stanu (`t, energy, dropEnv, dropLog, bursts, fpsP95, calls,
  tris, ribbon, muted…`).

## Panel ścieżek (testowanie interakcji)

Dyskretny przycisk w lewym dolnym rogu (↑ obok HUD, klawisz `S`) rozwija listę czterech
stemów. Wyciszenie ścieżki robi dwie rzeczy naraz: `muted` na elemencie audio (słychać,
co wypada) i **gain 0 na jej sygnale w pętli** (widać, co znika z animacji). Dzięki temu
każdą parę „ścieżka → obiekt” testuje się bez grzebania w kodzie:

| wyciszasz | znika |
|---|---|
| `wokal` | wstęga zjeżdża do cienkiej nici (szerokość 0.16 m, bez falowania) |
| `bas` | kula wygładza się do idealnej kuli, zero struktury i zero żebra na bit, zero rozbłysku na drop |
| `bebny` | zero fal na ziemi i zero pulsu sfery (już puszczone fale dożywają) |
| `inne` | sfera gaśnie: zero błysków i zero ciągłej jasności z RMS |

Energia to mix stemów (`0.45 bas + 0.30 inne + 0.25 bebny`), więc wyciszenie ścieżki
odejmuje też jej udział w świetle i ekspozycji — cztery wyciszone = scena naprawdę cicha.
`WSZYSTKO` przywraca wszystkie; klik poza panelem zamyka panel bez zmiany stanu.


## Architektura (`viz/js/`)

| plik | rola |
|---|---|
| `main.js` | boot, master clock (audio.currentTime / demo), pętla, LERP stanu, triggery: **1 fala + 1 puls sfery na KAŻDYM uderzeniu w stem „bebny”** (`events.hits`, próg 0.02, dedupe 50 ms), **błysk sfery na KAŻDYM onsiecie „inne”**, **żebro struktury na KAŻDYM bicie „bas”**, **rozbłysk do bieli na drop**; ekspozycja, HUD, `__viz` |
| `data.js` | `Track`: analysis.json → Float32Array, percentyle, forwardFill pitch. `onsetT/onsetS` z `stems.bebny.events.hits` (fallback `onsets`), `otherOnsetT/S` (756 onsetów „inne”, /p95), `bassBeatT/S` (391 bitów basu), `bassOnsetT/S`, `oRmsP95`; `sampleAt` (interpolacja klatek), `EventCursor` (zdarzenia bez interpolacji) |
| `glsl.js` | wspólny GLSL: Ashima simplex 3D, FBM-4, ridged FBM, mgła exp2, paleta |
| `ground.js` | ziemia: gładka baza FBM + kolejka **max 30 fal** (1 uderzenie = 1 fala, amp ≤ 0.22, 9 m/s, życie 2.6-6.0 s zależne od siły → zasięg 23-54 m, `sin(d·0.85)`); pole fal liczone **per-piksel** z analitycznym gradientem normalnej (zero faset z siatki), współśrodkowa (wspólna faza) nieregularność azymutalna; tłumienie radialne `exp(-r·0.010)` — pierścień dochodzi do krawędzi kadru, wygasanie od 72% życia; matowe oświetlenie, owalna sadzawka |
| `core.js` | sfera-żar (r = 0.9, y = 0.3, wkopana), halo i PointLight. Cztery niezależne wejścia: **„inne” → barwa i jasność**, **„bas” → struktura**, **energia całości → rozmiar**, **mocny dźwięk → biel** (dokładne liczby w tabeli niżej). Bez cząstek. Rozmiar: `1 + 0.85·energy^1.15 + beatPulse·0.10` (1.00 → 1.85). Światło: `1.2 + glow·2.8 + white·2.6`, `distance 15 + scale·4`. Halo: krycie `0.06 + glow·0.07 + white·0.10`, barwa idzie za akcentem |
| `ribbon.js` | wstęga wokalu = **prosta, pozioma rzeka jedwabiu**: geometria sztywna, `HALF_X` = 1/3 szerokości kadru, `z = −28`, wyśrodkowana, **symetryczny taper 22%** długości (`width^0.7` + `alpha^2.2`). **Szerokość = głośność wokalu** (`rms_norm^0.8` → 0.16–4.6 m, damp 3.0), **falowanie = lokalne tempo** (jedna faza całkowana z `tempo_local_bpm`), **cisza = pasmo płaskie i skurczone do nici** (brama `pitch_voiced_prob` × energia, hold 0.9 s, release τ≈1.4 s), **kolor** = złoto jaśniejące od `pitch_midi` i `centroid_hz`. Kontur melodii w Y płytki, lead 80 ms. Zero tekstur i historii — cała zmienność w uniformach |
| `ridge.js` | czysta matematyka grzbietu (bez `three`): `ridgeProfile` + tabela `RANGES` (4 pasma: near −95, mid −165, far −300, distant −470 m). Wydzielone, żeby sylwetkę policzyć w node: `node viz/scripts/crest_preview.mjs` |
| `mountains.js` | panorama = **4 pasma**, grzbiet **wypalany na CPU przy starcie** do tekstury R32F (768 kolumn × 6 wierszy na pasmo) — vertex shader nie liczy szumu. **Głębia = perspektywa powietrzna** (każde pasmo jaśnieje ku kolorowi nieba, zero `FogExp2` na pasmach), cieniowanie zboczy z wygładzonego nachylenia (±40 kolumn), rim na grani, mgła u podstawy, miękka krawędź. **Statyczne — zero sterowania dźwiękiem** |
| `atmosphere.js` | kopuła nieba (gradient + prawie niewidoczne chmury, prędkość od tempa) + **320 statycznych gwiazd** na sferze R = 430, elewacja 8–37°, azimut ±65°, migotanie ±18%. Bez pyłu i bez bokeh-iskier |
| `settings.js` | panel ścieżek: przycisk + lista stemów w lewym dolnym rogu; trzyma `gain[id] ∈ {0,1}` czytany w pętli i woła `onToggle` (main.js wycisza audio). Bez zależności od sceny, żeby dało się go testować osobno |
| `postfx.js` | RenderPass → UnrealBloom (0.55 / 0.75 / próg 0.6) → grade (CA, winieta, ziarno, lift cieni) → OutputPass (ACES); w grade guard NaN/Inf na wyjściu — NaN nie przelatuje przez mipy blooma jako czarne prostokąty |
| `serve.py` | statyczny serwer na :8080 (root = repo) |

Usunięte (martwe albo wyparte): `burst.js` (osobny system cząstek — teraz w `core.js`),
`basscore.js`, `fog.js`, `rings.js`.

## Mapowanie danych → efekt

| dane (stemy po polsku) | obiekt | dokładne mapowanie |
|---|---|---|
| `bebny.events.hits` (804, próg 0.02, dedupe 50 ms) | **ziemia** + rozmiar sfery | 1 uderzenie = 1 fala: `amp = 0.10 + 0.12·s`, `speed 9 m/s`, `life = 2.6 + 3.4·s`; ten sam atak daje `beatPulse` (`0.10 + 0.90·s`, zanik 3/s) → `scale = 1 + 0.85·en^1.15 + bp·0.10` |
| `inne.events.onsets` (756; próg tylko 0.02, dedupe 40 ms) | **barwa na bit** | każdy onset: `flash = max(flash, 0.30 + 0.70·s)`, zanik 6.5/s (~0.15 s) → `uFlash` miesza bazę w „zarumienioną” czerwień `(1.0, 0.24, 0.08)` z siłą `0.95·uFlash` — **kula wyraźnie zmienia kolor na każdym dźwięku „inne”**, bez rozjaśniania (biel ma osobne wejście) |
| `inne.rms_norm` / `oRmsP95` | **jasność sfery** | `glow ← 0.95·oRmsN + 0.60·flash` (atak 7/s, zejście 3/s) → `uEnergy = 0.05 + 0.78·glow`, `uGain = 0.26 + 0.46·glow` |
| `inne.centroid_hz` / p95 | **odcień** | `uHot` — przesuwa bursztyn ku cieplejszej pomarańczy |
| `bas.rms_norm` (atak 9/s, zejście 2.4/s) | **struktura sfery** | bramka `smoothstep(0.50, 0.85)` → `uStruct`: szum `2.2→4.8` + drugi przebieg `0.45·uStruct`; amplituda `uWobble = 0.018 + 0.035·bassG` (max 5.3% promienia). Poniżej 0.50 basu kula jest idealnie gładka |
| `bas.events.beats` (391, ~2/s) | **żebro struktury** | każdy bit: `uBeat = 0.55 + 0.45·s` (zanik 7/s, ~0.2 s), dwa żebra `sin(dot(n,dir)·5.5±t)` o amplitudzie 1.35 i 0.75 w polu przemieszczenia — kula wyraźnie się marszczy w rytm basu; mocny bit w głośnym fragmencie dodatkowo rozbłyskuje |
| `energy − dropEnv` (`dropEnv` = energia damp τ 2.5 s) | **rozbłysk do bieli (drop)** | warunki: skok > 0.20 **i** `energy > 0.55` **i** `dropEnv < 0.42`, edge + cooldown 1.4 s → `loudHit(0.4–1.0)`: `uWhite` do ~1, zanik 7.5/s. W Blinding Lights odpala raz, t ≈ 118.5 s |
| `energy` (0.45·bas + 0.30·inne + 0.25·bebny peak, /p95) | **rozmiar sfery** + ziemia + obraz | `scale = 1 + 0.85·energy^1.15` (wygładzane 6/s) → cisza ≈ 1.2, najmocniejsze momenty ≈ 1.85 (kula rośnie o ~55% średnicy); `uCoreGlow` ziemi, jasność światła kuli, ekspozycja `1.05 + 0.3·energy` |
| głośność × siła transientu | **biel** | onset „inne”: `uWhite = clamp(ss(0.52, 0.88, energy)·(0.45 + 0.75·s))`; bit basu: `ss(0.56, 0.90, energy)·(0.35 + 0.80·s)` — biel dopiero gdy w danej chwili jest naprawdę głośno; zanik 7.5/s, sufit shadera otwiera się z 0.72 do 2.0 |
| `wokal.rms_norm` | **wstęga** | szerokość 0.16–4.6 m + jasność, damp 3.0 |
| `wokal.pitch_midi` (ffill, brama voiced) | wstęga | kontur Y (±1.3 m), damp 5.0 / 12.0 (barwa) |
| `wokal.pitch_voiced_prob` × `wokal.rms_norm` | wstęga | brama frazy: hold 0.9 s, release τ≈1.4 s → cisza = cienka nić bez falowania |
| `wokal.centroid_hz` / p95 | wstęga | złoto `#d9984a` → jasne złoto `#ffcf8a` przy wysokich/piskliwych dźwiękach |
| `tempo_local_bpm` | wstęga + niebo | faza falowania (całkowana) i prędkość chmur `uTime·bpm/120` |
| `wokal.events.sections` | HUD | numer sekcji `sec n/8` |
| czas utworu | kamera, gwiazdy | dryf kamery (`sin(t·0.1)·0.8`, y 7±0.4), migotanie gwiazd |

Zasady: wartości ciągłe — interpolacja klatek + `damp` (wykładnicze, niezależne od fps);
beaty/onsety — triggery bez interpolacji. Wszystkie czasy w shaderach to czas utworu
(pauza = stop efektów). Efekty nigdy nie czytają zegara ściennego.

## Dane: uderzenia bębnów

`analyze_stems.py` liczy onsety librosy z `delta=0.07` — to gubi ~1/4 uderzeń
(ghost notes, ciche stopy). Dlatego fale biorą się z `stems.bebny.events.hits`,
liczonych osobno przez `detect_hits.py` (spektralny flux mel + peak-picking
z lokalną medianą jako progiem, `wait=3` ramki = 50 ms):

```
.venv/Scripts/python.exe detect_hits.py                 # wszystkie utwory
.venv/Scripts/python.exe detect_hits.py blindinglights  # jeden
```

Blinding Lights: 804 uderzenia (3.96/s, mediana odstępu 180 ms), pokrycie
100% lokalnych maksimów obwiedni powyżej 0.25·p95. Każde uderzenie = jedna
fala (+ puls sfery); siła steruje amplitudą (0.10-0.22) i życiem (2.6-6.0 s, czyli
zasięgiem 23-54 m — pierścień gaśnie dopiero przy krawędzi kadru).

## Pętla weryfikacyjna

Przed „gotowe”: `node --check viz/js/*.js` **oraz** `grep -n '^<<<<<<<\|^>>>>>>>' viz/js/*.js`
(marker konfliktu wewnątrz literału GLSL przechodzi `node --check` i psuje tylko shader);
przejazd po sekcjach w `?demo&t=`, kadr na sekcję, `#err` pusty, `window.__viz`.
Po edycji modułu ES: `cdp('Network.setCacheDisabled', cacheDisabled=True)` — inaczej
przeglądarka podaje starą wersję i wygląda to jak zepsuty patch.

Progi akceptacji (audyt): **clip% < 1%** (piksele > 250), **drawCalls < 25** (sama scena,
bez passów bloom), **tris < 800k**, **FPS p95 > 55**. Aktualnie (2560×1440 @DPR 1.25):
123–135 fps p95, 27 draw calli, 267k tris, `#err` pusty.

Referencja: `C:\Users\adamp\Downloads\Gemini_Generated_Image_q3xo6hq3xo6hq3xo.jpg`.

## Odporność obrazu (artefakty)

Mrugające czarne prostokąty mają w tej scenie trzy realne źródła — wszystkie
załatane, bo każdy z nich potrafi zabić cały kadr:

1. **NaN w shaderze** — `pow(x, y)` z `x < 0` (`1.0 - abs(dot(N,V))` potrafi zejść
   pod zero o 1e-7) i `normalize()` zerowego wektora (`cross(dFdx, dFdy)` gdy pasmo
   jest widziane brzegiem, `atan(0,0)` w środku ziemi, `L + V` na osi kamera-sfera).
   NaN w buforze HDR nie kończy się jednym pikselem: rozchodzi się po mipach blooma
   i wraca jako **prostokątny czarny blok**, który „mruga", bo zależy od ruchu pasma.
   Wszystkie podstawy `pow` mają `clamp`, wszystkie `normalize` guard na długości,
   a `postfx.js` zeruje NaN/Inf na wyjściu kompozytu.
2. **Odwrócone `smoothstep(1.0, 0.78, x)`** — w GLSL niezdefiniowane (edge0 > edge1);
   zamienione na `1.0 - smoothstep(0.78, 1.0, x)`.
3. **Utrata kontekstu GPU / VRAM** — `pixelRatio` 2 na ekranie 4K to 33 mln px
   w buforze i dwa render-targety half-float (~800 MB). Stąd budżet `MAX_BUF_PIXELS`
   ≈ 9 mln px (schodki 0.5) i `webglcontextrestored` → `composer.reset()`.
   Diagnostyka: `window.__viz.ctxLost` (0 = kontekst nigdy nie padł) oraz `?debug`,
   które wystawia `window.__dbg = {renderer, scene, camera, post, ground, core,
   ribbon, mountains, atmosphere}` — można wtedy schować obiekt i sprawdzić, czy
   artefakt znika (bisect zamiast zgadywania).
