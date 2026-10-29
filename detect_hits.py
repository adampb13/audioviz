"""Detektor uderzen w stemie bebnow -> data/<track>/analysis.json: stems.bebny.events.hits

Libroso-owy onset_detect (delta=0.07) gubi ~1/3 uderzen (ghost notes, slabiej akcentowane
stopy). Tu liczymy spektralny flux (mel) i robimy peak-picking z PROGIEM ADAPTACYJNYM
(lokalna mediana + margines), wiec kazdy transient nad szumem jest zdarzeniem.

Wynik: hits = [[czas_s, sila], ...], sila znormalizowana do p95 (0..~1).
Uruchomienie:  .venv/Scripts/python.exe detect_hits.py [track ...]
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 368          # == analyze_stems.py -> 59.92 fps
N_FFT = 2048
TRACKS = ["blindinglights", "familyties"]


def detect_hits(y):
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, n_fft=N_FFT)
    env = env - env.min()
    p95 = float(np.percentile(env, 95)) or 1.0
    e = env / p95
    n = len(e)

    # prog adaptacyjny: lokalna mediana (okno ~0.5 s) + margines
    win = 31
    pad = np.pad(e, win // 2, mode="edge")
    local_med = np.array([np.median(pad[i:i + win]) for i in range(n)])
    thr = local_med + 0.05

    frames, prev = [], -10**9
    for i in range(2, n - 2):
        if e[i] < thr[i]:
            continue
        if e[i] < e[i - 1] or e[i] < e[i + 1]:     # lokalne maksimum (pre/post max)
            continue
        if e[i] < e[i - 2] or e[i] < e[i + 2]:
            continue
        if i - prev < 3:                            # min 50 ms miedzy uderzeniami
            continue
        frames.append(i)
        prev = i

    frames = np.array(frames, dtype=int)
    times = librosa.frames_to_time(frames, sr=SR, hop_length=HOP)
    strengths = np.clip(e[frames] / 1.0, 0.0, 2.0)
    return env, e, times, strengths


def coverage(env, e, times):
    """Ile lokalnych maksimow powyzej 0.25*p95 zostalo przechwyconych (kontrola jakosci)."""
    p95 = float(np.percentile(env, 95)) or 1.0
    have = set()
    for t in times:
        have.add(int(round(t * SR / HOP)))
    strong, caught = 0, 0
    for i in range(2, len(env) - 2):
        if env[i] / p95 < 0.25:
            continue
        if env[i] < env[i - 1] or env[i] < env[i + 1] or env[i] < env[i - 2] or env[i] < env[i + 2]:
            continue
        strong += 1
        if any(abs(i - f) <= 2 for f in have):
            caught += 1
    return caught, strong


def main(tracks):
    for name in tracks:
        d = Path("data") / name
        aj, wav = d / "analysis.json", d / "bebny.wav"
        if not aj.exists() or not wav.exists():
            print(f"{name}: brak analysis.json/bebny.wav — pomijam")
            continue
        y, _ = librosa.load(str(wav), sr=SR, mono=True)
        env, e, times, strengths = detect_hits(y)
        caught, strong = coverage(env, e, times)
        data = json.loads(aj.read_text(encoding="utf-8"))
        data["stems"]["bebny"]["events"]["hits"] = [
            [round(float(t), 4), round(float(s), 4)] for t, s in zip(times, strengths)]
        aj.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        gaps = np.diff(times)
        print(f"{name}: hits {len(times)} ({len(times)/len(y)*SR:.2f}/s) | pokrycie {caught}/{strong} "
              f"mocnych maksimow | odstep min {gaps.min():.3f}s mediana {np.median(gaps):.2f}s | "
              f"zapisane -> {aj}")


if __name__ == "__main__":
    main(sys.argv[1:] or TRACKS)
