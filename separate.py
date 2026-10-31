"""Podział utworu na 4 stem'y (wokal, bas, bębny, inne) modelem Demucs.

Wejście:  data/<utwór>.<wav|mp3|flac|m4a|ogg>
Wyjście: data/<utwór>/{wokal,bas,bebny,inne}.wav

Użycie (z korzenia repo):
    .venv/Scripts/python.exe separate.py data/familyties.wav
    .venv/Scripts/python.exe separate.py data/familyties.wav --model htdemucs_ft.yaml

Model: `htdemucs.yaml` (1 sieć) jest domyślny — na CPU ~3-4× szybszy od
`htdemucs_ft.yaml` (ensemble 4 sieci: 253 s vs 77 s dla 12 s materiału), a dla
wizualizacji różnica w jakości stemów jest nieistotna. Fine-tuned zostaje dla
tych, którym zależy na czystości podkładów.

Wymaga audio-separator + onnxruntime + torchaudio (patrz requirements.txt).

Nazwy plików: biblioteka audio-separator zapisuje `<baza>_(Vocals)_wokal.wav`
itd. — a cały dalszy pipeline (analyze_stems.py, wizualizacja) czyta proste
`wokal.wav`. Dlatego po separacji pliki są przenoszone pod nazwę docelową.
Bez tego analiza nie widzi stemów i kończy się komunikatem o braku pliku.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

STEM_KEYS = ("wokal", "bas", "bebny", "inne")
MODEL = "htdemucs.yaml"


def process_audio(file_path: str | Path, model_name: str = MODEL) -> int:
    path = Path(file_path)
    if not path.is_file():
        print(f"Błąd: plik '{file_path}' nie istnieje.", flush=True)
        return 2

    try:
        from audio_separator.separator import Separator
    except ModuleNotFoundError as exc:
        print(
            f"Błąd: nie mogę zaimportować audio-separator ({exc.name}).\n"
            "  uv pip install --python .venv/Scripts/python.exe -r requirements.txt",
            flush=True,
        )
        return 3

    output_dir = path.parent / path.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Pliki wyjściowe: {output_dir}", flush=True)

    # output_names nadaje polskie nazwy, ale biblioteka trzyma je DODATKOWO
    # w nazwie pliku (`<baza>_(Vocals)_wokal.wav`) — patrz normalizacja niżej.
    output_names = {"Vocals": "wokal", "Bass": "bas", "Drums": "bebny", "Other": "inne"}

    separator = Separator(output_dir=str(output_dir), output_format="WAV")
    print(f"Ładowanie modelu '{model_name}' (pierwsze użycie = pobranie ~300 MB)...", flush=True)
    separator.load_model(model_filename=model_name)

    print(f"Separacja {path.name} — to może potrwać kilka minut...", flush=True)
    produced = separator.separate(str(path), output_names)

    # --- normalizacja nazw: <baza>_(Vocals)_wokal.wav -> wokal.wav ---
    final = []
    for item in produced:
        src = Path(item)
        if not src.is_absolute():
            src = output_dir / src.name
        if not src.is_file():
            continue
        stem = next((k for k in STEM_KEYS if k in src.name.lower()), None)
        if stem is None:
            print(f"  ! nie rozpoznaję stemu w nazwie: {src.name}", flush=True)
            continue
        dst = output_dir / f"{stem}{src.suffix.lower()}"
        if src.resolve() != dst.resolve():
            if dst.exists():
                dst.unlink()
            src.replace(dst)
        final.append(dst)
        print(f"  -> {dst.name}", flush=True)

    missing = [k for k in STEM_KEYS if not (output_dir / f"{k}.wav").is_file()]
    if missing:
        print(f"Błąd: brakuje stemów: {', '.join(missing)}", flush=True)
        return 4
    print(f"Gotowe: {len(final)} stem'y w {output_dir}", flush=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="plik audio do podziału, np. data/<utwór>.wav")
    ap.add_argument("--model", default=MODEL, help=f"model Demucs (domyślnie {MODEL})")
    a = ap.parse_args()
    return process_audio(a.input, a.model)


if __name__ == "__main__":
    sys.exit(main())
