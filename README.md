# audioviz — instalacja i uruchomienie

Wizualizacja utworu w czasie rzeczywistym: podział na 4 stem'y (Demucs),
analiza rytmu/barwy każdego stemu do `data/<utwór>/analysis.json`,
a na końcu scena Three.js czytająca ten plik.

## Jednym poleceniem (Windows / PowerShell)

```powershell
./setup.ps1
```

Skrypt sprawdza Pythona, tworzy `.venv`, instaluje **wszystkie** zależności
Pythona z `requirements.txt` (pełny, zamknięty zestaw — wersje przypięte),
robi `npm install` dla Three.js w `viz/` i wypisuje co dalej.

## Ręcznie

```powershell
# 1. Środowisko Pythona (3.11+)
uv venv .venv --python 3.11
uv pip install --python .venv/Scripts/python.exe -r requirements.txt

# 2. Three.js dla wizualizacji
cd viz; npm install; cd ..

# 3. Serwer: biblioteka + wizualizacja na jednym porcie
.venv/Scripts/python.exe server.py
# -> http://127.0.0.1:8080/viz/home.html   (biblioteka utworów)
```

`requirements.txt` jest generowany z działającego `.venv`, więc zawiera także
zależności pośrednie (`torch`, `onnxruntime`, `torchaudio`, `numba`, ...).
Bez `onnxruntime` i `torchaudio` pakiet `audio-separator` instaluje się, ale
`import` wywala się przy pierwszym użyciu — dlatego są przypięte jawnie.

### GPU (opcjonalnie, ale mocno skraca podział)

`torch` z PyPI to wheel **CPU** — audio-separator działa wtedy poprawnie, tylko
wolno i bez ostrzeżenia. Wykrycie jest jednym warunkiem, `torch.cuda.is_available()`,
więc wystarczy dołożyć build CUDA (Blackwell/sm_120 wymaga CUDA 12.8+):

```powershell
uv pip install --python .venv/Scripts/python.exe `
    --index-url https://download.pytorch.org/whl/cu130 "torch==2.14.0+cu130"
```

`setup.ps1` robi to sam, gdy znajdzie `nvidia-smi` (`-SkipGpu` pomija). O tym,
czy przebieg poszedł na karcie, mówi pierwsza linia logu zadania w bibliotece:
`Akceleracja: GPU · NVIDIA GeForce RTX 5060 Ti · CUDA 13.0`.

Zmierzone na RTX 5060 Ti — materiał 12 s:

| etap | CPU | GPU |
|---|---|---|
| podział (`htdemucs.yaml`) | 82 s | **13 s** |
| cały przebieg (podział + analiza + uderzenia) | 63 s | **27 s** |

## Pipeline

Wszystko da się uruchomić z biblioteki w przeglądarce (kolejka zadań),
albo z konsoli, po kolei:

```powershell
.venv/Scripts/python.exe separate.py data/utwor.wav        # -> data/utwor/{wokal,bas,bebny,inne}.wav
.venv/Scripts/python.exe analyze_stems.py data/utwor       # -> data/utwor/analysis.json
```

`separate.py` domyślnie używa `htdemucs.yaml` (pobierany przy pierwszym
uruchomieniu). `--model htdemucs_ft.yaml` daje czystsze stem'y, ale na CPU trwa
~3× dłużej (zmierzone: 12 s materiału → 77 s vs 253 s); na GPU różnica jest
nieistotna, więc można spokojnie sięgnąć po `_ft`.

### Szybkość analizy

Analiza była wolna z jednego powodu: `librosa.pyin` liczy Viterbi na macierzy
przejść o wymiarze „liczba stanów × liczba stanów” (~900 × 900 dla zakresu
C1–C6) i robi to dla czterech stemów. Zmierzone: **178 s** dla utworu 259 s,
z czego ~80% to sam Viterbi.

Dwie zmiany, obie w `analyze_stems.py` + `fast_viterbi.py`:

1. **Viterbi pasmowy.** W macierzy przejść `transition_local(window="triangle")`
   realne są tylko przekątne w pasmie ±kilku stanów, reszta to `log(1e-308)`.
   Podmieniamy `librosa.sequence._viterbi` na wersję pasmową (numba, pętla po
   pasmie zamiast po pełnej macierzy). Wynik jest **identyczny** z oryginałem —
   pilnuje tego `tests/test_fast_viterbi.py` (porównanie pełnej ścieżki stanów
   i log-prawdopodobieństwa na macierzy w formacie librysy). Podmiana działa
   tylko dla przetestowanych wersji librysy; na nieznanej wersji zostaje oryginał.
2. **Cztery procesy zamiast wątków.** Stemy liczą się równolegle w osobnych
   procesach (`--workers`, domyślnie 4), a każdy dostaje `cpu // workers` wątków
   BLAS/numba (`threadpoolctl`). Wcześniej 16 wątków na jednym procesie
   dławiło się na barierach numby i dawało ~1.2× zamiast 4×.

Efekt (ten sam plik `analysis.json`, ta sama scena):

| | przed | po |
|---|---|---|
| analiza utworu 259 s (`analyze_stems.py`) | 178 s | **42 s** (4.2×) |
| krok analizy w serwerze, utwór 225 s | — | **21 s** |
| cały przebieg „pobierz z sieci → gotowe” | — | **~50 s** |

Różnice w `analysis.json` po przyspieszeniu to wyłącznie szum zaokrągleń
(float32 w mel/MFCC, maxdiff 0.01); `pitch` i `onsets` są identyczne.

`analyze_stems.py --workers N` pozwala zejść do 1 (debug) albo podbić, jeśli
masz więcej rdzeni niż 4 — powyżej liczby rdzeni nic nie zyskasz.

### Pobieranie z sieci (domyślna droga w bibliotece)

Na stronie głównej, nad strefą wgrywania, jest panel „pobierz z sieci": wpisujesz
tytuł (albo wklejasz link), wybierasz wynik i reszta dzieje się sama — `yt-dlp`
ściąga bestaudio, `ffmpeg` zamienia je na `data/<utwór>.wav`, a potem lecą te same
kroki co przy wgraniu pliku (podział → analiza → uderzenia). Limit: 15 min na
materiał (dłuższe to zwykle składanki/radio).

`yt-dlp` jest w `requirements.txt`; `ffmpeg` to osobny program w `PATH`
(`winget install Gyan.FFmpeg`, `brew install ffmpeg`). Bez niego panel pokaże
`pobieranie brak` w nagłówku zamiast wywalać się w połowie pobierania.

Wgranie pliku w bibliotece od razu uruchamia podział i analizę (bez klikania),
z logami na żywo i szacowanym czasem każdego kroku. ETA liczy się z modelu
`czas ≈ a + b · długość` uczonego na zmierzonych przebiegach (`data/.eta.json`,
osobno dla GPU i CPU),
a po każdym kroku jest korygowana o realne tempo tego zadania. Pomiary noszą
znacznik wersji potoku (`ETA_VERSION` w `server.py`): po zmianie czasu kroku
stare próbki są odrzucane, żeby ETA nie kłamała o rząd wielkości.

## Testy

```powershell
uv pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m pytest -q      # 27 passed, ~6 s, bez sieci i bez GPU
```

Testy pilnują trzech rzeczy, które łatwo zepsuć przy refaktorze: równoważności
pasmowego Viterbi z librysą, modelu ETA (wersjonowanie próbek, dopasowanie po
trzech pomiarach, pomijanie klipów krótszych niż `ETA_MIN_DUR`) i blokady
adresów lokalnych w `_check_url` (ochrona przed SSRF w `/api/fetch`).

## Struktura

```
server.py          # serwer statyczny + API + kolejka zadań (stdlib, :8080)
separate.py        # Demucs: 4 stem'y
analyze_stems.py   # analiza stemów -> analysis.json (4 procesy, pasmowy Viterbi)
fast_viterbi.py    # podmiana librosa._viterbi na wersję pasmową (numba)
detect_hits.py     # detekcja uderzeń (używane przez analyze_stems)
viz/               # scena Three.js (index.html, home.html, js/, logo.png, favicon.png)
tests/             # pytest: Viterbi, ETA, walidacja URL
data/<utwór>/      # źródło + stem'y + analysis.json (pliki audio poza repo)
```
