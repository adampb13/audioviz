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
  Kolor sfery zależy od energii całości, a pojedyncze iskry po bokach — od
  `peak` ścieżki „inne”, więc obie ścieżki muszą być w analizie.
- `?demo&t=123` — start bez gestu użytkownika, od 123 s (zegar własny, bez audio).
- `Spacja` — pauza · `H` — panel HUD · `S` — ustawienia · `Esc` — zamknij ustawienia ·
  `#err` — błędy JS ·
  `window.__viz` — sonda stanu (`t, energy, dropEnv, dropLog, bursts, fpsP95, calls,
  tris, ribbon, muted, bRaw/bRms…`).
- `?debug` dodatkowo: **ślad klatek** `window.__trace(n)` — pierścień 900 klatek
  (~6 s przy 144 fps) z próbką każdej klatki (`t, v, b, be, cb, d, o, e, st, g, p`).
  `__viz` odświeża się 4×/s, więc do pomiaru opóźnień („bas → struktura kuli”)
  potrzebny jest zapis per-klatka — inaczej rozdzielczość pomiaru to 250 ms.

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
| `inne` | **iskry z kuli** — cały ich wygląd: `peak` → gęstość emisji i rozmiar drobiny, `centroid_hz` → kolor (ciemny żar ↔ biały żar) i wysokość wylotu z kuli (patrz niżej). Wchodzi też w energię całości → rozmiar i kolor sfery |

Energia to mix stemów (`0.45 bas + 0.30 inne + 0.25 bebny`), więc wyciszenie ścieżki
odejmuje też jej udział w świetle i ekspozycji — cztery wyciszone = scena naprawdę cicha.
`WSZYSTKO` przywraca wszystkie; klik poza panelem zamyka panel bez zmiany stanu.


## Architektura (`viz/js/`)

| plik | rola |
|---|---|
| `main.js` | boot, master clock (audio.currentTime / demo), pętla, LERP stanu, triggery: **1 fala + 1 puls sfery na KAŻDYM uderzeniu w stem „bebny”** (`events.hits`, próg 0.02, dedupe 50 ms); struktura sfery NIE ma triggerów — płynie z ciągłej obwiedni basu; ekspozycja, HUD, `__viz` |
| `data.js` | `Track`: analysis.json → Float32Array, percentyle, forwardFill pitch. `onsetT/onsetS` z `stems.bebny.events.hits` (fallback `onsets`), `bassBeatT/S` (391 bitów basu), `bassOnsetT/S`, `oRmsP95`; `sampleAt` (interpolacja klatek), `EventCursor` (zdarzenia bez interpolacji) |
| `glsl.js` | wspólny GLSL: Ashima simplex 3D, FBM-4, ridged FBM, mgła exp2 |
| `ground.js` | ziemia: gładka baza FBM + kolejka **max 30 fal** (1 uderzenie = 1 fala, amp ≤ 0.22, 9 m/s, życie 2.6-6.0 s zależne od siły → zasięg 23-54 m, `sin(d·0.85)`); pole fal liczone **per-piksel** z analitycznym gradientem normalnej (zero faset z siatki), współśrodkowa (wspólna faza) nieregularność azymutalna; tłumienie radialne `exp(-r·0.010)` — pierścień dochodzi do krawędzi kadru, wygasanie od 72% życia; matowe oświetlenie, owalna sadzawka |
| `core.js` | sfera-żar (r = 0.9, y = 0.3, wkopana), halo i PointLight. Wejścia: **„bas” → ciągła struktura powłoki**, **energia całości → rozmiar bazowy i rozświetlenie barwy** (`uGlow`), **uderzenie w „bebny” → puls rozmiaru**. Rozmiar: `(1 + 0.85·energy^1.15) · (1 + 0.26·pulse)` (puls: atak 22/s, zejście 9/s). **Barwa**: `uGlow = smoothstep(0.20, 1.00, energy)` (atak 3/s, powrót 1.1/s), w shaderze `G = uGlow²` — cicho = głęboki bursztyn (`ENERGY 0.45`, `GAIN 0.50`, `HOT 0.50`, sufﬁt `0.78`), głośno = jasny kremowo-złoty żar (`hot → (1.0, 0.74, 0.34)`, `gain +0.16·G`, sufﬁt `0.78 + 0.10·G`); niska składowa niebieska trzyma halo złotym. Kwadrat `G` zostawia złoto w środku skali — inaczej cały refren byłby biały. Światło `2.4 + 1.3·glow`, halo krycie `0.10 + 0.08·glow`, barwa `(1.0, 0.72 + 0.15·glow, 0.44 + 0.22·glow)` |
| `ribbon.js` | wstęga wokalu = **prosta, pozioma rzeka jedwabiu**: geometria sztywna, `HALF_X` = 1/3 szerokości kadru, `z = −28`, wyśrodkowana, **symetryczny taper 22%** długości (`width^0.7` + `alpha^2.2`). **Szerokość = głośność wokalu** (`rms_norm^0.8` → 0.16–4.6 m, damp 3.0), **falowanie = lokalne tempo** (jedna faza całkowana z `tempo_local_bpm`), **cisza = pasmo płaskie i skurczone do nici** (brama `pitch_voiced_prob` × energia, hold 0.9 s, release τ≈1.4 s), **kolor** = złoto jaśniejące od `pitch_midi` i `centroid_hz`. Kontur melodii w Y płytki, lead 80 ms. Zero tekstur i historii — cała zmienność w uniformach |
| `ridge.js` | czysta matematyka grzbietu (bez `three`): `ridgeProfile` + tabela `RANGES` (4 pasma: near −95, mid −165, far −300, distant −470 m). Wydzielone, żeby sylwetkę policzyć w node: `node viz/scripts/crest_preview.mjs` |
| `mountains.js` | panorama = **4 pasma**, grzbiet **wypalany na CPU przy starcie** do tekstury R32F (768 kolumn × 6 wierszy na pasmo) — vertex shader nie liczy szumu. **Głębia = perspektywa powietrzna** (każde pasmo jaśnieje ku kolorowi nieba, zero `FogExp2` na pasmach), cieniowanie zboczy z wygładzonego nachylenia (±40 kolumn), rim na grani, mgła u podstawy, miękka krawędź. **Statyczne — zero sterowania dźwiękiem** |
| `atmosphere.js` | kopuła nieba (gradient + prawie niewidoczne chmury, prędkość od tempa) + **320 statycznych gwiazd** na sferze R = 430, elewacja 8–37°, azimut ±65°, migotanie ±18%. Bez pyłu i bez bokeh-iskier |
| `settings.js` | panel lewego dolnego rogu: ścieżki (wokal / bas / **fale** / inne) z podpisem, co każda rysuje w scenie, **głośność ogólna** (suwak 0–100%, `el.volume` wszystkich czterech elementów) i **preset barwy**. Trzyma `gain[id] ∈ {0,1}` czytany w pętli i woła `onToggle` / `onVolume` / `onPreset`. Bez zależności od sceny, żeby dało się go testować osobno |
| `palette.js` | cztery **presety barwy całej sceny** (złoty = domyślny/obecny, neonowy, deep blue, zielony). Jeden preset przestawia niebo, mgłę, ziemię, pasma gór, wstęgę, żar kuli, iskry, gwiazdy, tint gradingu ORAZ akcenty UI przez zmienne CSS `--acc/--acc2/--ink`. Warstwy dostają kolory przez własne `setPalette()` — same zapisy uniformów, więc przełączanie w trakcie grania jest darmowe (bez rekompilacji shaderów) |
| `postfx.js` | RenderPass → UnrealBloom (0.55 / 0.75 / próg 0.6) → grade (CA, winieta, ziarno, lift cieni) → OutputPass (ACES); w grade guard NaN/Inf na wyjściu — NaN nie przelatuje przez mipy blooma jako czarne prostokąty |
| `particles.js` | **iskry wylatujące z kuli** (`Sparks`) — pełny obraz ścieżki „inne" w danej chwili: **(a) gęstość** ← obwiednia `peak` (`0.15 + 2.8·env^1.7` iskier/s, atak 9/s, powrót 2.2/s), więc gęsty fragment sypie drobinami, a cichy ledwo jedną; **(b) rozmiar i prędkość** ← `peak` (`0.72–2.63 m`); **(c) kolor** ← `centroid_hz` w log2 między p10 a p95 (ciemny pad `(1.0, 0.24, 0.03)` → złoto → biały żar `(1.0, 0.96, 0.88)`); **(d) elewacja startu** ← też `centroid_hz` (ciemne dźwięki z dolnej flanki kuli, jasne z górnej). Start **na powierzchni sfery** (`core.surfaceRadius() × 1.02`), naprzemiennie lewa/prawa; wyrzut wzdłuż normalnej `1.25–3.05 m/s` + w górę, grawitacja `1.35`, opór `0.32`, życie `2.0–3.5 s`, wygaszanie od 45% (iskra spokojnie opada i gaśnie). Dodatkowo przekroczenie progu `peak = 0.50` (p98, refrakcja 0.45 s) daje jedną iskrę „na błysk" — tylko prawdziwe transjenty, nie każdy szum. Pula 48, jeden draw call, additive, `depthWrite: false`. W panelu H `peak` i `centroid` mają kropkę • — to one sterują iskrami |
| `hud.js` | panel **H**: **wszystkie parametry ramkowe wszystkich czterech ścieżek** (21 na ścieżkę: rms, rms_norm, rms_db, peak, zcr, centroid, bandwidth, rolloff, flatness, spectral_contrast ×7, dominant, mel_db ×32, mfcc ×13, chroma ×12, chroma_active, onset_strength, onset_norm, tempo, pitch_hz, pitch_midi, voiced_prob; bębny nie mają pól `pitch*`, pusta grupa nie trafia do panelu) — dwie kolumny flex (wokal+bas+bębny / inne+scena), jeden scrollbar, nagłówek sekcji zwija ją klikiem. Definicja pól jest **jedna** (`stemParams` w data.js), więc nowe pole w analizie pojawia się w panelu bez zmian w hud.js. Skala słupka: stała dla wielkości unormowanych (`ABS_RANGE`: 0–1, dB, midi), inaczej p98 wartości bezwzględnej — jeden głośny moment nie ściska skali. Druga kolumna to blok **scena**: `t` vs `audio.currentTime` i ich różnica (rozjazd zegarów), `seek`, sekcja, stan, fps/klatka/px/draw calls/trójkąty, `uGlow/uStruct/uWobble/pulse/skala/promień`, **surowe próbki → obwiednie** z ▲▼ (widać, czy scena goni dźwięk), stan iskier, liczniki zdarzeń, utwór/miks. Animacja wyłącznie na `transform` (zero reflow), słupki 30×/s, liczby 4×/s |
| `serve.py` | statyczny serwer na :8080 (root = repo) |

Usunięte (martwe albo wyparte): `burst.js` (osobny system cząstek — teraz w `core.js`),
`basscore.js`, `fog.js`, `rings.js`.

### Presety barwy

`palette.js` trzyma cztery palety; wybór idzie z panelu ustawień (`S`) i działa
natychmiast, także w trakcie grania. Jeden preset ustawia **całą** scenę i UI —
nie ma stanu, w którym niebieska scena ma złoty HUD.

| preset | barwa wiodąca | charakter |
|---|---|---|
| **złoty** (domyślny) | bursztyn `#d9984a` | dotychczasowy wygląd, 1:1 z poprzednią paletą |
| **neonowy** | magenta `#ff3fa4` | fioletowe tło, cyjanowe iskry i gwiazdy (kontrast punktowy) |
| **deep blue** | błękit `#4f9fe8` | zimna tonacja filmowa, stalowe góry, księżycowa kula |
| **zielony** | szmaragd `#4fc48a` | ciemna zieleń w tle, jasna mięta w świetle |

Zasady, które trzymają palety spójnymi (i dlatego tło nie „świeci" jak obiekty):
jedna barwa wiodąca + jedna poboczna; tło zawsze ciemniejsze i mniej nasycone od
źródeł światła; łuna nad horyzontem (`glow`) to osobny, głębszy kolor niż akcent
(przy pełnym nasyceniu niebo zlewało się w jeden pas i gubiło głębię); góry to
prawie neutralne sylwetki, nie lakiery. Wartości `core.*`/`spark.*` są w
przestrzeni liniowej (idą do shaderów), `css.*` w sRGB (idą do arkusza).

Aby dodać preset: dopisz wpis w `PRESETS`, dodaj klucz do `PRESET_ORDER` — UI
i `applyPreset` obsłużą go bez zmian w innych plikach.


## Mapowanie danych → efekt

| dane (stemy po polsku) | obiekt | dokładne mapowanie |
|---|---|---|
| `bebny.events.hits` (804, próg 0.02, dedupe 50 ms) | **ziemia** + **rozmiar sfery** | 1 uderzenie = 1 fala: `amp = 0.10 + 0.12·s`, `speed 9 m/s`, `life = 2.6 + 3.4·s`; ten sam atak daje `beatPulse = 0.50 + 0.50·s` (zanik 3/s), który w kuli idzie przez obwiednię `pulse` (atak 22/s, zejście 9/s) → `scale = base · (1 + 0.26·pulse)`, czyli do **+26% promienia** na uderzenie — puls wyraźnie widoczny, ale bez szarpnięć |
| `bas.rms_norm` (w kuli: **atak 16/s ≈ 62 ms**, zejście 3.6/s) | **struktura sfery — CIĄGŁA** | Do kuli idzie **surowa** (znormalizowana do p95) próbka basu — wygładza ją tylko jeden filtr, ten w `core.js`. Wcześniej bas szedł przez `S.bRms` (atak 7.7/s), a potem przez drugi filtr w kuli (3.2/s): kaskada dawała **~120 ms** opóźnienia faktury za uderzeniem (pomiar `__trace`: maksimum korelacji przy 17 klatkach @144 fps). Teraz **~69 ms** (10 klatek) — poniżej progu odczuwalnej asynchronii, a faktura nadal nie „strobuje”, bo jedna klatka zmienia obwiednię o ~0.01. `smoothstep(0.25, 0.90)` → `uStruct`. Przemieszczenie **wyłącznie radialne** (`r = R + disp·uWobble`), pole to suma dwóch szumów o średniej 0, bez wyróżnionego kierunku — dlatego kula zawsze zostaje kulą. `uWobble = 0.014 + 0.034·bassG` (max ~4.8% promienia), częstotliwość `1.15 → 2.0`, tempo falowania `t·(0.14 + 0.30·uStruct)`. Ten sam `disp` trafia do fragmentu jako `vDisp` i moduluje **jasność** (`relief = 1 + vDisp·0.52·uStruct`): garby łapią światło, doliny ciemnieją. **Zero impulsów na bit** — faktura oddycha razem z obecnością basu |
| `bas.events.beats` (391, ~2/s) | **nieużywane przez scenę** | wcześniej każdy bit dawał `uBeat` (żebro + przyspieszenie falowania) — usunięte, bo czytało się jako „uderzenia” zmieniające fakturę. Struktura jest teraz wyłącznie ciągła. Kolor kuli idzie za `energy` (a ta zawiera bas), nie za pojedynczym bitem |
| `energy − dropEnv` (`dropEnv` = energia damp τ 2.5 s) | **tylko diagnostyka** | warunki: skok > 0.20 **i** `energy > 0.55` **i** `dropEnv < 0.42`, edge + cooldown 1.4 s → wpis w `dropLog`/`__viz`. Struktury nie szarpie (jest ciągła), koloru nie dotyka bezpośrednio (idzie on za `energy`). W Blinding Lights odpala raz, t ≈ 118.5 s |
| `energy` (0.45·bas + 0.30·inne + 0.25·bebny peak, /p95) | **rozmiar i kolor sfery** + ziemia + obraz | `scale = 1 + 0.85·energy^1.15` (wygładzane 6/s) → cisza ≈ 1.2, najmocniejsze momenty ≈ 1.85 (kula rośnie o ~55% średnicy); `uCoreGlow` ziemi, jasność światła kuli, ekspozycja `1.05 + 0.3·energy` |
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

### Zegar po przewinięciu (restart)

`el.currentTime = 0` w HTMLAudioElement jest **asynchroniczne**: element jeszcze przez
kilka–kilkanaście klatek raportuje starą pozycję (zmierzone: 31.48 s po restarcie).
Zegar czytający to bezpośrednio wystrzeliwał w przyszłość → kursor zdarzeń przeskakiwał
na koniec listy, a `lastWaveT` lądował przed nami — czyli **zero fal do końca utworu**.
Dlatego:

- `beginSeek(t)` po każdym przewinięciu (restart, wznowienie) — `currentTime()` stoi na
  celu, dopóki element go nie potwierdzi (`|Δ| < 0.30 s`, bezpiecznik 500 ms);
- `resetCursors(t)` zeruje też debounce fal (`lastWaveT = t - 2`);
- w pętli siatka bezpieczeństwa: cofnięcie zegara o > 0.25 s → `resetCursors` + `ground.reset()`;
- wszystkie resety warstw przez `safeReset()` — brak metody nie przerywa już restartu
  (objaw ze starego cache: `TypeError: ground.reset is not a function`; leczy Ctrl+F5).

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
