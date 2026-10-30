"""Akcenty melodyczne sciezki "inne" -> analysis.json.

Detekcja: NAGLE ZMIANY GLOSNOSCI (nie spektralny flux, nie prominentne piki).
Dla kazdej klatki liczymy atak w dB = RMS(krotkie okno) - RMS(srednia ~230 ms).
Dodatni atak = moment, w ktorym sciezka "inne" naprawde sie podnosi. Ten sygnal
idzie za tym, co slychac, a nie za gestoscia widma — poprzednia wersja (flux +
wysokosc nuty + NMS) trafiala obok.

  attack_dB(t) = 20log10 rms_fast(t) - 20log10 rms_slow(t)
  pik ataku >= 3.5 dB, minimum 0.40 s miedzy pikami, potem NMS 0.50 s
  strength = attack / p95  (0..1)

Zapis: stems.inne.events.accents     = [[czas_s, strength_0_1], ...]
       stems.inne.events.accents_all = wszystkie piki ataku (do strojenia)

Uzycie:
    .venv/Scripts/python.exe detect_accents.py                 # wszystkie data/*/
    .venv/Scripts/python.exe detect_accents.py blindinglights  # jeden katalog
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import librosa
import numpy as np
from scipy.signal import find_peaks

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

SR = 22050
HOP = 256            # 11.6 ms
FAST = 1024          # 46 ms — okno "teraz"
SLOW = 20            # 20 klatek ~ 230 ms — okno "przed chwila"
MIN_GAP = 0.40       # 400 ms miedzy pikami ataku
MIN_DB = 3.5         # ponizej tego to nie "nagla zmiana glosnosci"
NMS_S = 0.50         # nie dwa rozblyski na jedno podniesienie


def detect(wav: Path):
    y, sr = librosa.load(str(wav), sr=SR, mono=True)

    rms = librosa.feature.rms(y=y, frame_length=FAST, hop_length=HOP)[0]
    db = librosa.amplitude_to_db(rms, ref=np.max)

    # lokalna srednia ~230 ms: to jest "poziom, na ktorym sciezka byla"
    k = np.ones(SLOW) / SLOW
    slow = np.convolve(db, k, "same")
    attack = db - slow

    times_all = librosa.frames_to_time(np.arange(len(attack)), sr=sr, hop_length=HOP)

    pk, props = find_peaks(
        attack,
        distance=int(MIN_GAP / (HOP / sr)),
        prominence=1.0,
        height=MIN_DB,
    )
    if len(pk) == 0:
        return [], []

    peak_db = props["peak_heights"]
    times = times_all[pk]
    strength = np.clip(peak_db / np.percentile(peak_db, 95), 0.0, 1.0)

    raw = [[round(float(a), 3), round(float(b), 3)] for a, b in zip(times, strength)]

    # NMS: jedno podniesienie glosnosci = jeden rozblysk
    order = np.argsort(-strength)
    alive = np.ones(len(times), bool)
    keep = []
    for i in order:
        if not alive[i]:
            continue
        keep.append(int(i))
        alive &= np.abs(times - times[i]) > NMS_S
    keep.sort()

    accents = [[round(float(times[i]), 3), round(float(strength[i]), 3)] for i in keep]
    return accents, raw


def process(folder: Path) -> None:
    wav = folder / "inne.wav"
    analysis = folder / "analysis.json"
    if not wav.exists() or not analysis.exists():
        print(f"  pomijam {folder.name} (brak inne.wav lub analysis.json)")
        return
    data = json.loads(analysis.read_text(encoding="utf-8"))
    accents, raw = detect(wav)
    ev = data["stems"]["inne"].setdefault("events", {})
    ev["accents"] = accents
    ev["accents_all"] = raw
    analysis.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    strong = sum(1 for _, s in accents if s >= 0.75)
    print(f"  {folder.name}: {len(accents)} akcentow ({strong} mocnych >=0.75), {len(raw)} pikow ataku")


def main() -> None:
    targets = sys.argv[1:]
    folders = [DATA / t for t in targets] if targets else sorted(p for p in DATA.iterdir() if p.is_dir())
    for f in folders:
        print(f"[{f.name}]")
        process(f)


if __name__ == "__main__":
    main()
