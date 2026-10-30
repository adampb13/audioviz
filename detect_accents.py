"""Znaczace akcenty melodyczne sciezki "inne" -> analysis.json.

Problem, ktory to rozwiazuje: `events.onsets` to szerokopasmowy detektor
transientow (~756 uderzen na utwor, ~4/s). Jego sila koreluje z "znaczacym
uderzeniem melodii" tylko w ~0.58, wiec bramkowanie po niej albo gubi wazne
uderzenia, albo (przy nizszym progu) daje stroboskop.

Pipeline:
  1. obwiednia onsetow w pasmie melodycznym 250-4000 Hz -> piki (prominencja),
  2. dla kazdego piku: sila = prominencja(p95) x sqrt(glosnosc pasma),
  3. wysokosc nuty: dominujacy szczyt widma 180-1600 Hz w oknie 140 ms,
  4. salience = sila * (0.55 + 0.45 * wysokosc_znormalizowana),
  5. non-max suppression w oknie NMS_S -> zostaje JEDEN, najbardziej znaczacy
     akcent na ~1.6 s (zamiast migotania na kazdej nucie motywu).

Zapis: stems.inne.events.accents     = [[czas_s, salience_0_1], ...]  (uzywane przez scene)
       stems.inne.events.accents_all = surowe piki (do strojenia progow)

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
HOP = 512           # 23 ms
MIN_GAP = 0.22      # 220 ms - najgestsze sensowne uderzenie melodii
NMS_S = 1.6         # okno non-max suppression: jeden akcent na ~1.6 s
MIN_SCORE = 0.45    # ponizej tego to ozdobnik, nie akcent melodii
BAND = (250.0, 4000.0)
PITCH_BAND = (180.0, 1600.0)


def _rolling_median(x: np.ndarray, w: int = 5) -> np.ndarray:
    out = np.full(len(x), np.nan, dtype=float)
    for i in range(len(x)):
        seg = x[max(0, i - w // 2): i + w // 2 + 1]
        seg = seg[~np.isnan(seg)]
        if len(seg):
            out[i] = float(np.median(seg))
    return out


def _dominant_pitch(y: np.ndarray, sr: int):
    """Wysokosc dominujacego szczytu widma w pasmie melodii (szybkie, bez pyin)."""
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    mask = (freqs >= PITCH_BAND[0]) & (freqs <= PITCH_BAND[1])
    M, fb = S[mask], freqs[mask]
    ar = np.arange(M.shape[1])
    idx = np.argmax(M, axis=0)
    mag = M[idx, ar]
    i0 = np.clip(idx, 1, M.shape[0] - 2)
    a, b, c = M[i0 - 1, ar], M[i0, ar], M[i0 + 1, ar]
    d = 0.5 * (a - c) / (a - 2 * b + c + 1e-9)          # doprecyzowanie szczytu
    f0 = fb[i0] * 2 ** (d * (fb[1] / fb[0] - 1))
    f0 = np.where(mag > np.percentile(mag, 40), f0, np.nan)
    return _rolling_median(f0), librosa.frames_to_time(ar, sr=sr, hop_length=HOP)


def detect(wav: Path):
    y, sr = librosa.load(str(wav), sr=SR, mono=True)

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = S[(freqs >= BAND[0]) & (freqs <= BAND[1])]

    # obwiednia onsetow: dodatnia roznica logarytmu widma w pasmie melodycznym
    mel = np.log1p(band * 10.0)
    flux = np.concatenate([[0.0], np.maximum(0.0, np.diff(mel, axis=1)).sum(0)])
    k = np.hanning(3)
    flux = np.convolve(flux, k / k.sum(), "same")

    # glosnosc pasma w dB (referencja: glosnosc utworu) - "duze" uderzenie to
    # nie tylko ostry atak, ale tez glosny atak
    env = librosa.amplitude_to_db(np.sqrt((band ** 2).mean(0)), ref=np.max)
    env = np.concatenate([[env[0]], env])

    pk, props = find_peaks(
        flux,
        distance=int(MIN_GAP * sr / HOP),
        prominence=float(np.percentile(flux, 60)) * 0.6,
    )
    if len(pk) == 0:
        return [], []

    prom = props["prominences"]
    loud = env[pk]
    strength = (prom / np.percentile(prom, 95)) * (np.clip((loud + 50.0) / 50.0, 0, 1) ** 0.5)
    strength = np.clip(strength / np.percentile(strength, 95), 0.0, 1.0)

    times = librosa.frames_to_time(pk, sr=sr, hop_length=HOP)

    # wysokosc nuty 140 ms po uderzeniu: wyzej w frazie = wazniejsza nuta
    f0, ft = _dominant_pitch(y, sr)
    pitch = np.full(len(times), np.nan)
    for i, at in enumerate(times):
        v = f0[(ft >= at) & (ft <= at + 0.14)]
        v = v[~np.isnan(v)]
        if len(v):
            pitch[i] = float(np.median(v))
    known = pitch[~np.isnan(pitch)]
    lo, hi = (np.percentile(known, 5), np.percentile(known, 95)) if len(known) else (0.0, 1.0)
    pn = np.clip((np.nan_to_num(pitch, nan=hi) - lo) / (hi - lo + 1e-9), 0.0, 1.0)

    salience = strength * (0.55 + 0.45 * pn)

    raw = [[round(float(a), 3), round(float(b), 3)] for a, b in zip(times, salience)]

    # non-max suppression: zostaje jeden, najbardziej znaczacy akcent w oknie
    order = np.argsort(-salience)
    alive = np.ones(len(times), bool)
    keep = []
    for i in order:
        if not alive[i] or salience[i] < MIN_SCORE:
            continue
        keep.append(int(i))
        alive &= np.abs(times - times[i]) > NMS_S
    keep.sort()

    peak = float(np.percentile(salience[keep], 95)) if keep else 1.0
    accents = [[round(float(times[i]), 3), round(float(min(1.0, salience[i] / peak)), 3)] for i in keep]
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
    print(f"  {folder.name}: {len(accents)} akcentow ({strong} mocnych >=0.75), {len(raw)} surowych pikow")


def main() -> None:
    targets = sys.argv[1:]
    folders = [DATA / t for t in targets] if targets else sorted(p for p in DATA.iterdir() if p.is_dir())
    for f in folders:
        print(f"[{f.name}]")
        process(f)


if __name__ == "__main__":
    main()
