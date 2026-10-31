#!/usr/bin/env python3
"""
Analiza 4 stemów (wokal, bas, bebny, inne) biblioteką librosa -> jeden plik JSON
do wizualizacji audio (FFT, RMS, onsety, beaty, centroid, pitch, MFCC, chroma, ...).

Wszystkie serie czasowe są na wspólnej osi czasu: fps = SR / HOP (~59.9 fps),
więc frame i w każdym stemie odpowiada tej samej chwili: t = i * HOP / SR.

Użycie (z korzenia repo):
    .venv/Scripts/python.exe analyze_stems.py
    .venv/Scripts/python.exe analyze_stems.py --data-dir data/blindinglights --out data/blindinglights/analysis.json
    .venv/Scripts/python.exe analyze_stems.py --no-pitch
"""

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import librosa

import fast_viterbi

STEMS = ["wokal", "bas", "bebny", "inne"]

SR = 22050
HOP = 368            # SR / HOP ~= 59.92 fps -> wygodne dla animacji 60 fps
N_FFT = 2048
PITCH_FRAME = 4096   # dłuższe okno dla pyin, żeby obsłużyć niskie basy
N_VIZ_BANDS = 32     # pasma mel do wizualizacji (słupki/heatmapa)
FFT_MAX_HZ = 8000    # zakres zapisywanego średniego widma
FPS = SR / HOP

# Zakres pitch per stem (Hz). Perkusja: pitch nie ma sensu -> pomijamy.
PITCH_RANGE = {
    "wokal": ("C2", "C6"),
    "bas": ("C1", "C4"),
    "inne": ("C2", "C6"),
}

# Krumhansl-Schmuckler profile tonalne
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def to_list(x, nd=4):
    """Zaokrągla i zamienia numpy na listę Pythona; NaN/inf -> None (poprawny JSON)."""
    a = np.round(np.asarray(x, dtype=float), nd)
    return [float(v) if np.isfinite(v) else None for v in a.tolist()]


def rows_to_list(M, nd=4):
    return [to_list(row, nd) for row in np.asarray(M, dtype=float)]


def norm01(x):
    x = np.asarray(x, dtype=float)
    peak = np.nanmax(np.abs(x)) if x.size else 0.0
    return x / peak if peak > 0 else np.zeros_like(x)


def estimate_key(chroma_mean):
    best_r, best_key = -2.0, "?"
    for i in range(12):
        for prof, mode in ((KS_MAJOR, "major"), (KS_MINOR, "minor")):
            r = np.corrcoef(np.roll(prof, i), chroma_mean)[0, 1]
            if np.isfinite(r) and r > best_r:
                best_r, best_key = r, f"{PITCH_NAMES[i]} {mode}"
    return best_key, float(best_r)


def peak_envelope(y, n_frames):
    """Maksimum |y| w każdym oknie N_FFT z tym samym układem ramek co RMS (center=True)."""
    yp = np.pad(np.abs(y), (N_FFT // 2, N_FFT // 2))
    fr = librosa.util.frame(yp, frame_length=N_FFT, hop_length=HOP)
    return fr.max(axis=0)[:n_frames]


def analyze_stem(name, path, do_pitch):
    log(f"[{name}] wczytywanie {path.name}")
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    duration = len(y) / SR
    log(f"[{name}] długość {duration:.2f}s, {len(y)} próbek @ {SR} Hz")

    # --- STFT / FFT -------------------------------------------------------
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))   # (1025, T)
    power = S ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)
    T = S.shape[1]

    # --- Energia ----------------------------------------------------------
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=1.0, amin=1e-6)
    peak = peak_envelope(y, T)
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=N_FFT, hop_length=HOP)[0]

    # --- Widmo / barwa ----------------------------------------------------
    centroid = librosa.feature.spectral_centroid(S=S, sr=SR)[0]
    bandwidth = librosa.feature.spectral_bandwidth(S=S, sr=SR)[0]
    rolloff = librosa.feature.spectral_rolloff(S=S, sr=SR, roll_percent=0.85)[0]
    flatness = librosa.feature.spectral_flatness(S=S)[0]
    contrast = librosa.feature.spectral_contrast(S=S, sr=SR)           # (7, T)

    # Dominująca częstotliwość (pasmo 30 Hz – 4 kHz), None w ciszy
    band = (freqs >= 30) & (freqs <= 4000)
    dom_idx = S[band].argmax(axis=0)
    dominant_hz = freqs[band][dom_idx]
    dominant_hz = np.where(rms > 0.02 * rms.max(), dominant_hz, np.nan)

    # Średnie widmo (dB) do wykresu statycznego
    fft_mask = freqs <= FFT_MAX_HZ
    fft_avg_db = librosa.amplitude_to_db(S.mean(axis=1), ref=1.0, amin=1e-8)[fft_mask]

    # Pasma mel (dB) do heatmapy / słupków
    mel = librosa.feature.melspectrogram(S=power, sr=SR, n_mels=N_VIZ_BANDS, fmin=30, fmax=SR / 2)
    mel_db = librosa.power_to_db(mel, ref=1.0, top_db=80)

    # --- Barwa / harmonia -------------------------------------------------
    mfcc = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=13, n_fft=N_FFT, hop_length=HOP)
    chroma = librosa.feature.chroma_stft(y=y, sr=SR, n_fft=N_FFT, hop_length=HOP)  # (12, T)
    chroma_argmax = chroma.argmax(axis=0)
    chroma_active = np.where(chroma.max(axis=0) > 0.1, chroma_argmax, -1)
    key, key_r = estimate_key(chroma.mean(axis=1))

    # --- Onsety / rytm ----------------------------------------------------
    onset_env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, n_fft=N_FFT)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP,
                                              units="frames", backtrack=False)
    onset_times = librosa.frames_to_time(onset_frames, sr=SR, hop_length=HOP)
    onset_strength = onset_env[onset_frames] if len(onset_frames) else np.array([])

    tempo_arr, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR,
                                                     hop_length=HOP, units="frames")
    tempo = float(np.atleast_1d(tempo_arr)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=SR, hop_length=HOP)
    tempo_local = librosa.feature.tempo(onset_envelope=onset_env, sr=SR, hop_length=HOP,
                                        aggregate=None)

    # --- Pitch (pyin) -----------------------------------------------------
    pitch = None
    if do_pitch and name in PITCH_RANGE:
        fmin, fmax = (librosa.note_to_hz(n) for n in PITCH_RANGE[name])
        log(f"[{name}] pitch (pyin) {PITCH_RANGE[name][0]}–{PITCH_RANGE[name][1]} ...")
        f0, voiced, vprob = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=SR,
                                         frame_length=PITCH_FRAME, hop_length=HOP)
        pitch = {"f0": f0, "voiced": voiced.astype(float), "voiced_prob": vprob}

    # --- Segmentacja struktury (sekcje utworu) ----------------------------
    seg_feat = np.vstack([librosa.util.normalize(mfcc, axis=1),
                          librosa.util.normalize(chroma, axis=1)])
    k = int(np.clip(round(duration / 25), 3, 12))
    bounds = np.unique(librosa.segment.agglomerative(seg_feat, k))
    if bounds.size == 0 or bounds[0] != 0:
        bounds = np.concatenate([[0], bounds])

    feats = dict(
        T=T, rms=rms, rms_db=rms_db, rms_norm=norm01(rms), peak=peak, zcr=zcr,
        centroid=centroid, bandwidth=bandwidth, rolloff=rolloff, flatness=flatness,
        contrast=contrast, dominant_hz=dominant_hz, mel_db=mel_db,
        mfcc=mfcc, chroma=chroma, chroma_active=chroma_active,
        onset_env=onset_env, onset_norm=norm01(onset_env), tempo_local=tempo_local,
        fft_avg_db=fft_avg_db,
    )
    if pitch is not None:
        feats["pitch"] = pitch

    events = dict(
        onsets=[[float(t), float(s)] for t, s in zip(onset_times, onset_strength)],
        beats=[float(t) for t in beat_times],
        sections=[[float(bounds[i] * HOP / SR),
                    float((bounds[i + 1] if i + 1 < len(bounds) else T) * HOP / SR)]
                  for i in range(len(bounds))],
    )

    voiced_f0 = pitch["f0"][~np.isnan(pitch["f0"])] if pitch is not None else np.array([])
    summary = dict(
        duration=round(duration, 3),
        rms_peak=float(rms.max()),
        rms_db_mean=float(rms_db.mean()),
        rms_db_p05=float(np.percentile(rms_db, 5)),
        rms_db_p95=float(np.percentile(rms_db, 95)),
        dynamic_range_db=float(np.percentile(rms_db, 95) - np.percentile(rms_db, 5)),
        crest_factor=float(peak.max() / (rms.max() + 1e-12)),
        tempo_bpm=tempo,
        beat_count=int(len(beat_times)),
        onset_count=int(len(onset_times)),
        onset_rate_per_s=float(len(onset_times) / duration) if duration else 0.0,
        centroid_hz_mean=float(np.nanmean(centroid)),
        flatness_mean=float(flatness.mean()),
        key=key, key_correlation=round(key_r, 3),
        pitch_voiced_ratio=float(pitch["voiced"].mean()) if pitch is not None else None,
        pitch_hz_median=float(np.median(voiced_f0)) if voiced_f0.size else None,
        pitch_hz_min=float(voiced_f0.min()) if voiced_f0.size else None,
        pitch_hz_max=float(voiced_f0.max()) if voiced_f0.size else None,
        sections_count=int(len(bounds)),
    )
    log(f"[{name}] tempo {tempo:.1f} BPM, onsety {len(onset_times)}, klucz {key}, "
        f"klatki {T}")
    return feats, events, summary


def serialize_stem(feats, events, summary, N, do_pitch):
    """Przycina serie do wspólnej długości N i zapisuje jako listy."""
    t = lambda a: a[..., :N]
    frames = dict(
        rms=to_list(t(feats["rms"])),
        rms_db=to_list(t(feats["rms_db"]), 2),
        rms_norm=to_list(t(feats["rms_norm"])),
        peak=to_list(t(feats["peak"])),
        zcr=to_list(t(feats["zcr"])),
        centroid_hz=to_list(t(feats["centroid"]), 1),
        bandwidth_hz=to_list(t(feats["bandwidth"]), 1),
        rolloff_hz=to_list(t(feats["rolloff"]), 1),
        flatness=to_list(t(feats["flatness"])),
        spectral_contrast=rows_to_list(t(feats["contrast"]), 2),
        dominant_hz=to_list(t(feats["dominant_hz"]), 1),
        mel_db=rows_to_list(t(feats["mel_db"]), 1),
        mfcc=rows_to_list(t(feats["mfcc"]), 2),
        chroma=rows_to_list(t(feats["chroma"]), 3),
        chroma_active=[int(v) for v in t(feats["chroma_active"])],
        onset_strength=to_list(t(feats["onset_env"])),
        onset_norm=to_list(t(feats["onset_norm"])),
        tempo_local_bpm=to_list(t(feats["tempo_local"]), 2),
    )
    if do_pitch and "pitch" in feats:
        frames["pitch_hz"] = to_list(t(feats["pitch"]["f0"]), 2)
        frames["pitch_midi"] = to_list(
            t(librosa.hz_to_midi(np.where(np.isfinite(feats["pitch"]["f0"]),
                                          feats["pitch"]["f0"], np.nan))), 2)
        frames["pitch_voiced_prob"] = to_list(t(feats["pitch"]["voiced_prob"]), 3)
    return dict(
        summary=summary,
        fft_avg_db=to_list(feats["fft_avg_db"], 1),
        frames=frames,
        events=events,
    )


def _stem_worker(job):
    """Jeden stem w osobnym procesie (spawn-safe: argumenty to tylko proste typy).

    Wątki: procesy dzielą rdzenie, więc każdy dostaje `cpu // workers` wątków.
    Bez tego cztery procesy po 16 wątków (numba + BLAS) wzajemnie się dusiły
    i całość była ~2x wolniejsza niż na jednym rdzeniu per proces.
    """
    name, path, do_pitch, threads = job
    import numba
    import threadpoolctl

    prev = numba.get_num_threads()
    numba.set_num_threads(threads)
    fast_viterbi.install()
    try:
        with threadpoolctl.threadpool_limits(threads):
            return name, analyze_stem(name, Path(path), do_pitch=do_pitch)
    finally:
        numba.set_num_threads(prev)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default="data/blindinglights")
    ap.add_argument("--out", default=None, help="domyślnie <data-dir>/analysis.json")
    ap.add_argument("--no-pitch", action="store_true", help="pomiń pyin (dużo szybsze)")
    ap.add_argument("--workers", type=int, default=0,
                    help="procesy na stem (0 = auto: po jednym na stem, max 4, min 1)")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out = Path(args.out) if args.out else data_dir / "analysis.json"
    paths = {s: data_dir / f"{s}.wav" for s in STEMS}
    missing = [str(p) for p in paths.values() if not p.is_file()]
    if missing:
        raise SystemExit(f"Brak plików: {missing}")

    t0 = time.time()
    workers = args.workers or min(len(STEMS), max(1, os.cpu_count() or 1))
    threads = max(1, (os.cpu_count() or 1) // max(1, workers))
    fast = fast_viterbi.install()
    log(f"Pitch: {'szybki Viterbi (pasmowy)' if fast else 'librosa (pełna macierz)'} | "
        f"procesy: {workers} × {threads} wątków")

    jobs = [(s, str(paths[s]), not args.no_pitch, threads) for s in STEMS]
    results = {}
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for name, res in pool.map(_stem_worker, jobs):
                results[name] = res
    else:
        for job in jobs:
            name, res = _stem_worker(job)
            results[name] = res

    # Wspólna oś czasu: najkrótsza seria określa N
    N = min(f["T"] for f, _, _ in results.values())
    log(f"Wspólna długość: {N} klatek ({N / FPS:.2f}s @ {FPS:.2f} fps)")

    stems_out = {s: serialize_stem(f, e, sm, N, do_pitch=not args.no_pitch)
                 for s, (f, e, sm) in results.items()}

    # Relacje między stemami
    rms_mat = np.vstack([results[s][0]["rms_norm"][:N] for s in STEMS])
    corr = np.corrcoef(rms_mat)
    total_energy = sum(results[s][0]["rms"][:N].sum() for s in STEMS)
    cross = dict(
        rms_norm_correlation={a: {b: round(float(corr[i, j]), 4) for j, b in enumerate(STEMS)}
                              for i, a in enumerate(STEMS)},
        energy_share={s: round(float(results[s][0]["rms"][:N].sum() / total_energy), 4)
                      for s in STEMS},
        tempo_bpm_per_stem={s: round(results[s][2]["tempo_bpm"], 2) for s in STEMS},
    )

    payload = dict(
        meta=dict(
            song=data_dir.name,
            generated_at=datetime.now(timezone.utc).isoformat(),
            librosa_version=librosa.__version__,
            sample_rate=SR, hop_length=HOP, n_fft=N_FFT,
            fps=round(FPS, 4), n_frames=N, duration=round(N / FPS, 3),
            stems=STEMS, pitch_enabled=not args.no_pitch,
            pitch_range_note={k: list(v) for k, v in PITCH_RANGE.items()},
            fft_avg_freqs_hz=[round(float(f), 2) for f in
                              librosa.fft_frequencies(sr=SR, n_fft=N_FFT)[librosa.fft_frequencies(sr=SR, n_fft=N_FFT) <= FFT_MAX_HZ]],
            description=("Wszystkie serie frames.* mają długość n_frames i dzielą oś czasu "
                         "t = i / fps. events.onsets: [czas_s, siła]; beats/sections: czasy w s."),
        ),
        time_s=to_list(np.arange(N) / FPS, 4),
        stems=stems_out,
        cross=cross,
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    size_mb = out.stat().st_size / 1e6
    log(f"Zapisano {out} ({size_mb:.1f} MB) w {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
