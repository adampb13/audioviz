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
| `main.js` | boot, master clock (audio.currentTime / demo), pętla, LERP stanu, triggery: **1 fala + 1 puls sfery na KAŻDYM uderzeniu w stem "bebny"** (`events.hits`, próg 0.02, dedupe 50 ms; amplituda i życie fali rosną z siłą 0.10-0.22 / 2.6-6.0 s); iskierki błyskają na każdym uderzeniu |
| `data.js` | `Track`: analysis.json → Float32Array, percentyle, forwardFill pitch; `onsetT/onsetS` z `stems.bebny.events.hits` (fallback `onsets`); `sampleAt` (interpolacja klatek), `EventCursor` (beaty/onsety) |
| `glsl.js` | wspólny GLSL: Ashima simplex 3D, FBM-4, ridged FBM, mgła exp2, paleta |
| `ground.js` | ziemia: gładka baza FBM + kolejka **max 30 fal** (1 uderzenie = 1 fala, amp ≤ 0.22, 9 m/s, życie 2.6-6.0 s zależne od siły → zasięg 23-54 m, `sin(d·0.85)`); pole fal liczone **per-piksel** z analitycznym gradientem normalnej (zero faset z siatki), współśrodkowa (wspólna faza) nieregularność azymutalna; tłumienie radialne `exp(-r·0.010)` — pierścień dochodzi do krawędzi kadru, wygasanie od 72% życia; matowe oświetlenie, owalna sadzawka |
| `core.js` | sfera-żar (r=0.9, y=0.3 wkopana): emissive 0.5+1.2·en+0.3·bp (cap 1.35, tanh-sufit), bursztyn #7a3000→#ffcf8a; halo sprite; PointLight 6+18·energy |
| `ribbon.js` | wstęga wokalu = **prosta, pozioma rzeka jedwabiu rozpięta przez cały kadr**: geometria sztywna `x −45..+45` na `z=−28` (od prawej krawędzi ekranu do lewej, końce tuż za kadrem), **symetryczny taper** 12% długości z każdej strony (`width^0.7` + `alpha^2.2`) — pasmo zweża się i gaśnie zamiast być ucięte licem przy krawędzi. **Szerokość = głośność wokalu**: `rms_norm^0.8` mapowane 0.16 m (nić) → 6.6 m (masywny pas), wygładzone damp 3.0 (τ≈330 ms), więc bez pionowych „trąbek” na wejściu słowa. **Falowanie = lokalne tempo**: cała wstęga ma JEDNĄ fazę, całkowaną z `tempo_local_bpm` (0.30 rad/s przy 85 BPM → 1.9 rad/s przy ~180) — szybkie słowa marszczą pasmo, przeciągnięta nuta je prostuje; bo to całka, a nie `t × speed`, zmiana BPM zmienia tempo fal, a nie fazę (zero skoków). **Cisza = pasmo płaskie i skurczone**: brama frazy liczy `pitch_voiced_prob` **i energię** (pyin deklaruje `voiced` także przy `rms_norm<0.02` — 74 takie ramki w tym utworze), po 0.9 s hold + release τ≈1.4 s amplituda falowania spada do 0, a szerokość do 0.16 m — zostaje cienka złota nić, bez drgania. **Kolor**: złoto `#d9984a`; wysoka nuta (`pitch_midi>64`, mediana utworu 64.8) i piskliwa barwa (`centroid_hz`, mediana 2718 Hz) rozjaśniają wstęgę w stronę jasnego złota `#ffcf8a` z kremowymi prześwitami na włóknach (`#fff3d6`), nigdy w stronę zimnej bieli. Kontur melodii w Y płytki (±1.3 m). 320×8 segmentów, 3 warstwy additive, `depthWrite:false`; zero tekstur i zero bufora historii — cała zmienność płynie w uniformach |
| `mountains.js` | panorama = **5 pasm na z=−95/−135/−190/−270/−380**; grzbiet **wypalany na CPU przy starcie** (`ridgeProfile`: masyw λ~1 km ⊗ ridged fbm z domain warpem, 3-6 oktaw), więc vertex shader nie liczy ani jednego szumu (statyczna geometria, 768 kolumn × 6 wierszy na pasmo). **Głębia = perspektywa powietrzna**: każde pasmo miesza się ku jasnemu kolorowi nieba przy horyzoncie (mgła 6%→76%) i **jaśnieje** z odległością, zamiast ciemnieć (wcześniej 3 pasma były ciemniejsze + dobijała je `FogExp2` 0.009 → po 260 m 99.6% czerni, cała panorama była jedną plamą). Dodatkowo: gradient pionowy (ciemno u stóp → jaśniej przy grani), cieniowanie zboczy z **wygładzonego** nachylenia (okno ±40 kolumn — bez tego każda kolumna dostawała własny odcień i pasma czytały się jak pionowe prążki kurtyny), rim na krawędzi grzbietu, mgła u podstawy (doliny w oparach) i miękka krawędź (5%→32%) — dalekie granie wchodzą w niebo gradientem, nie nożem. `freq` odwrotnie proporcjonalne do odległości, żeby w każdym paśmie szczyty wypadały co ~60-90 px |
| `atmosphere.js` | kopuła nieba (gradient + prawie niewidoczne chmury), **gwiazdy: 320 statycznych punktów na sferze R=430, elewacja 8-37°** (dokładnie ta część nieba, którą widzi kamera i której nie zasłaniają góry; azimut ±65° od osi patrzenia), rozmiar 1.1-3.5 CSS px (`uScale` = pixelRatio, więc stały fizycznie), jasność 0.14-0.76, migotanie ±18% przy 0.016-0.056 Hz; pozycje **statyczne**, `depthTest` normalny → góry je zasłaniają; **bez sterowania dźwiękiem**. Do tego pył 250 drobin nisko (y≤4) i 8 hero bokeh od onsetów bębnów |
| `postfx.js` | RenderPass → UnrealBloom → grade (CA, winieta, ziarno, lift cieni) → OutputPass (ACES); w grade guard NaN/Inf na wyjściu — NaN nie przelatuje przez mipy blooma jako czarne prostokąty |

## Mapowanie danych → efekt

| dane (stemy po polsku) | efekt |
|---|---|
| `bebny.events.beats`, `bas.events.beats` | impuls: fala na ziemi (1 bit = 1 fala, debounce 350 ms) + błysk sfery (`beatPulse`) |
| `bebny.events.onsets` (siła p95) | zapalenie kolejnej iskry-bokeh |
| `bas.rms_norm` | (przez `cross.energy`) energia → skala/jasność sfery |
| `wokal.pitch_midi` (ffill) | kontur Y wstęgi |
| `wokal.pitch_voiced_prob` | **voiced gate + brama frazy**: szerokość i widoczność wstęgi (nić ↔ pasmo); 0.9 s podtrzymania po dźwięcznej ramce |
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

Przed „gotowe": `node --check viz/js/*.js`; przejazd po sekcjach w `?demo&t=`,
kadr na sekcję + `#err` pusty + `window.__viz`; PIL: profil jasności wierszami,
paleta 8 kolorów vs. referencja. Progi akceptacji (audyt): **clip% < 1%**
(piksele >250), **drawCalls < 25** (sama scena, bez passów bloom),
**tris < 800k**, **FPS p95 > 55**. Aktualnie: clip 0.00%, ~19 draw calls sceny
(33-34 z passami), 286k tris, p95 ~140 fps. Czas klatki wstęgi (taper + tekstura historii): p50 6.9 ms, p99 9-12 ms, przy 3200×1800 (2560×1440 @DPR 1.25) 143 fps — 2 klatki >16.7 ms na 12 s.
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
