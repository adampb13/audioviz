"""Akcenty melodyczne sciezki "inne" -> analysis.json.

Detekcja: NAGLE ZMIANY GLOSNOSCI w pasmie melodii (100-4000 Hz), nie flux, nie
wysokosc nuty. Atak w dB = RMS(23 ms) - RMS(~230 ms) policzone na sygnale
przefiltrowanym 100-4000 Hz — czyli "o ile sciezka wlasnie sie podniosla"
wzgledem tego, co bylo przed chwila.

Dlaczego pasmo i dlaczego normalizacja lokalna:
  * klawisze w intrze maja dominujaca 172-690 Hz — pelnopasmowy RMS ich nie widzi,
    bo zalewa je pad; pasmo 100-4000 Hz widzi je dobrze,
  * intro jest ciche (atak 1.5-4 dB), refren glosny (atak 4-9 dB). Prog stal in dB
    albo gubil intro, albo dawal stroboskop w refrenie. Dlatego sila jest
    normalizowana do lokalnego p90 (+-6 s): kazda sekcja ma swoje "duze uderzenie".

  kandydaci: piki ataku >= 1.2 dB, prominencja >= 0.8 dB, min. 0.18 s odstepu
  sila:      attack / p90(attack w +-6 s)  -> 0..1
  wybor:     sila >= 0.42, NMS 0.34 s

Wychodzi ~1.5 zdarzenia/s (mediana odstepu 0.64 s): kazda wyrazna nuta melodii
jest widoczna, a mocniejsze podniesienia glosnosci sa mocniejsze wizualnie.

Zapis: stems.inne.events.accents     = [[czas_s, strength_0_1], ...]
       stems.inne.events.accents_all = wszyscy kandydaci (do strojenia)

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
from scipy.signal import butter, find_peaks, sosfilt

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

SR = 22050
HOP = 256            # 11.6 ms
FAST = 512           # 23 ms — okno "teraz"
SLOW = 20            # 20 klatek ~ 232 ms — okno "przed chwila"
BAND = (100.0, 4000.0)
CTX = 6.0            # normalizacja sily do +-6 s
MIN_DB = 1.2         # kandydat: co najmniej tyle dB nad lokalna srednia
MIN_PROM = 0.8
MIN_GAP = 0.18
MIN_STRENGTH = 0.42
NMS_S = 0.34


def detect(wav: Path):
    y, sr = librosa.load(str(wav), sr=SR, mono=True)
    sos = butter(4, [BAND[0], BAND[1]], btype="band", fs=sr, output="sos")
    yb = sosfilt(sos, y)

    rms = librosa.feature.rms(y=yb, frame_length=FAST, hop_length=HOP)[0]
    db = librosa.amplitude_to_db(rms, ref=np.max)
    attack = db - np.convolve(db, np.ones(SLOW) / SLOW, "same")

    hop_s = HOP / sr
    t = librosa.frames_to_time(np.arange(len(attack)), sr=sr, hop_length=HOP)

    pk, _ = find_peaks(
        attack,
        distance=int(MIN_GAP / hop_s),
        prominence=MIN_PROM,
        height=MIN_DB,
    )
    if len(pk) == 0:
        return [], []

    times = t[pk]
    amp = attack[pk]

    # sila wzgledem lokalnego kontekstu — kazda sekcja ma swoje "duze uderzenie"
    global_p90 = float(np.percentile(amp, 90))
    strength = np.zeros(len(times))
    for i, at in enumerate(times):
        m = (times >= at - CTX) & (times <= at + CTX)
        hi = float(np.percentile(amp[m], 90)) if m.sum() >= 5 else global_p90
        strength[i] = np.clip(amp[i] / max(hi, 1.5), 0.0, 1.0)

    raw = [[round(float(a), 3), round(float(b), 3)] for a, b in zip(times, strength)]

    order = np.argsort(-strength)
    alive = np.ones(len(times), bool)
    keep: list[int] = []
    for i in order:
        if not alive[i] or strength[i] < MIN_STRENGTH:
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
    if accents:
        gaps = np.diff([a[0] for a in accents])
        print(f"  {folder.name}: {len(accents)} akcentow ({len(accents)/accents[-1][0]*60:.0f}/min), "
              f"mediana odstepu {np.median(gaps):.2f} s, {len(raw)} kandydatow")
    else:
        print(f"  {folder.name}: 0 akcentow")


def main() -> None:
    targets = sys.argv[1:]
    folders = [DATA / t for t in targets] if targets else sorted(p for p in DATA.iterdir() if p.is_dir())
    for f in folders:
        print(f"[{f.name}]")
        process(f)


if __name__ == "__main__":
    main()
