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

## Pipeline

Wszystko da się uruchomić z biblioteki w przeglądarce (kolejka zadań),
albo z konsoli, po kolei:

```powershell
.venv/Scripts/python.exe separate.py data/utwor.wav        # -> data/utwor/{wokal,bas,bebny,inne}.wav
.venv/Scripts/python.exe analyze_stems.py data/utwor       # -> data/utwor/analysis.json
```

`separate.py` domyślnie używa `htdemucs_ft.yaml` (~300 MB modeli, pobierane
przy pierwszym uruchomieniu); `--model htdemucs.yaml` to szybszy wariant.

## Struktura

```
server.py          # serwer statyczny + API + kolejka zadań (stdlib, :8080)
separate.py        # Demucs: 4 stem'y
analyze_stems.py   # analiza stemów -> analysis.json
detect_hits.py     # detekcja uderzeń (używane przez analyze_stems)
viz/               # scena Three.js (index.html, home.html, js/)
data/<utwór>/      # źródło + stem'y + analysis.json (pliki audio poza repo)
```
