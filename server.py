"""Serwer aplikacji audioviz: biblioteka utworów + wizualizacja.

JEDEN proces obsługuje wszystko, bez zależności zewnętrznych (stdlib):

    /                      -> przekierowanie na /viz/home.html (biblioteka)
    /viz/home.html         -> strona główna: utwory, upload, przygotowanie
    /viz/index.html        -> wizualizacja (statycznie, z Range dla WAV-ów)
    /api/state             -> JSON: utwory + zadania + możliwości środowiska
    /api/upload?name=x.wav -> PUT surowych bajtów = nowy utwór w data/
    /api/stems/x?stem=...  -> PUT surowych bajtów = pojedynczy stem do data/x/
    /api/run               -> POST {slug, steps|prepare} = uruchom skrypty
    /api/cancel?id=...     -> POST anulowanie zadania
    /api/tracks/<slug>     -> DELETE utwór (katalog + plik źródłowy)

Skrypty analizy są wołane jako PODPROCESY tym samym interpreterem, którym
uruchomiono serwer (czyli z .venv — tam jest librosa). Kolejka jest jedna:
separacja i analiza zjadają cały CPU, więc równoległe zadania tylko by się
dusiły nawzajem.

Uruchomienie (z korzenia repo):
    .venv/Scripts/python.exe server.py          # port 8080
    -> http://127.0.0.1:8080/viz/home.html      # biblioteka
"""
from __future__ import annotations

import http.server
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PY = sys.executable  # ten sam interpreter co serwer => ta sama .venv, ta sama librosa

AUDIO_EXT = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aiff", ".aif"}
STEMS = ("wokal", "bas", "bebny", "inne")
STEM_LABELS = {"wokal": "wokal", "bas": "bas", "bebny": "bębny", "inne": "inne"}
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB — WAV-y po 40-50 MB to norma, FLAC-i też
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
LOG_LINES = 400

# --------------------------------------------------------------------------- #
#  Szacowanie czasu kroków (ETA)
# --------------------------------------------------------------------------- #
# Czas podziału Demucs jest w przybliżeniu liniowy względem długości audio, ale
# ma STAŁY narzut (start procesu + ładowanie modelu). Model: t = a + b·dur.
# Współczynniki bierzemy z własnych pomiarów (data/.eta.json) — po trzech
# udanych krokach model uczy się na tej maszynie, zamiast zgadywać.
ETA_PATH = DATA / ".eta.json"
# Wartości z realnych przebiegów na tym CPU (2026-10-31): podział idzie modelem
# htdemucs (~10 s na segment 7.8 s + ~25 s na załadowanie sieci), stąd b≈1.6.
# htdemucs_ft (ensemble 4 sieci) to ~4× tyle. Analiza librosa jest tania,
# detekcja uderzeń — śladowa.
# separate: próg ≈ czas ładowania sieci (≈50 s), potem ≈2.2 s pracy na sekundę
# materiału — tak wychodzi z przebiegów htdemucs na tym CPU po odliczeniu krótkich
# klipów, w których cały koszt to padding do segmentu 7.8 s.
# ETA per sprzęt: separator na GPU jest ~6× szybszy (12 s materiału: 13 s vs 82 s),
# więc jeden zestaw stałych dla obu przypadków zawsze kłamał w którąś stronę.
# `separate` na GPU ≈ 6 s narzutu (ładowanie sieci) + 0.62 s na sekundę materiału.
ETA_DEFAULTS = {
    "gpu": {"separate": (6.0, 0.62), "analyze": (2.5, 0.28), "hits": (2.0, 0.02)},
    "cpu": {"separate": (50.0, 2.2), "analyze": (2.5, 0.28), "hits": (2.0, 0.02)},
}
ETA_MIN_SAMPLES = 3
ETA_LOCK = threading.Lock()
_DUR_CACHE: dict[str, float] = {}


def _source_path(slug: str) -> Path | None:
    for ext in sorted(AUDIO_EXT):
        p = DATA / f"{slug}{ext}"
        if p.is_file():
            return p
    return None


def audio_duration(slug: str) -> float:
    """Długość materiału w sekundach: soundfile → analysis.json → 180 s."""
    if slug in _DUR_CACHE:
        return _DUR_CACHE[slug]
    dur = 0.0
    src = _source_path(slug)
    if src:
        try:
            import soundfile as sf  # noqa: PLC0415 — opcjonalna zależność
            dur = float(sf.info(str(src)).duration)
        except Exception:  # noqa: BLE001 — bez soundfile zostaje fallback
            dur = 0.0
    if dur <= 0:
        try:
            meta = json.loads((DATA / slug / "analysis.json").read_text(encoding="utf-8"))
            dur = float((meta.get("meta") or {}).get("duration") or 0.0)
        except Exception:  # noqa: BLE001
            dur = 0.0
    if dur <= 0:
        dur = 180.0
    _DUR_CACHE[slug] = dur
    return dur


_DEVICE: str | None = None


def _device() -> str:
    """„gpu" tylko gdy torch ma build CUDA — inaczej separator liczy na CPU."""
    global _DEVICE
    if _DEVICE is None:
        try:
            import torch

            _DEVICE = "gpu" if torch.cuda.is_available() else "cpu"
        except Exception:  # noqa: BLE001 — brak torch to po prostu CPU
            _DEVICE = "cpu"
    return _DEVICE


def _eta_model() -> dict:
    try:
        raw = json.loads(ETA_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — brak pliku to normalny start
        return {}
    return raw if isinstance(raw, dict) else {}


ETA_MIN_DUR = 20.0   # krótsze klipy to sam narzut (padding do segmentu) — fałszują nachylenie


def _eta_fit(samples: list) -> tuple[float, float]:
    """Najmniejsze kwadraty dla t = a + b·d; za mało rozrzutu → mediana ilorazów.

    Pomijamy materiał krótszy niż ETA_MIN_DUR: 6-sekundowy klip to jeden segment
    7.8 s plus ładowanie modelu, więc jego „sekundy na sekundę" zaniżają model
    dla pełnych utworów o czynnik ~2.
    """
    pts = [(float(d), float(t)) for d, t in samples if float(d) >= ETA_MIN_DUR]
    if len(pts) < ETA_MIN_SAMPLES:
        raise ValueError("za mało pomiarów")
    md = sum(d for d, _ in pts) / len(pts)
    mt = sum(t for _, t in pts) / len(pts)
    var = sum((d - md) ** 2 for d, _ in pts)
    if var < 1e-6:
        raise ValueError("brak rozrzutu długości")
    b = sum((d - md) * (t - mt) for d, t in pts) / var
    a = mt - b * md
    a = max(0.0, min(600.0, a))
    b = max(0.02, min(6.0, b))
    return a, b


def eta_seconds(step: str, duration: float, model: dict | None = None) -> float:
    dev = _device()
    a, b = ETA_DEFAULTS[dev].get(step, (2.0, 0.2))
    # klucz z urządzeniem: pomiary z CPU nie mogą psuć ETA na GPU (i odwrotnie)
    samples = (model if model is not None else _eta_model()).get(f"{step}@{dev}") or []
    try:
        a, b = _eta_fit(samples)
    except (ValueError, TypeError):
        pass
    return max(1.0, a + b * max(1.0, duration))


def fmt_dur(sec: float) -> str:
    """2 min 5 s · 47 s · 1 h 3 min — do logów i UI."""
    sec = max(0, int(round(sec)))
    if sec < 60:
        return f"{sec} s"
    m, s = divmod(sec, 60)
    if m < 60:
        return f"{m} min {s:02d} s" if s else f"{m} min"
    h, m = divmod(m, 60)
    return f"{h} h {m:02d} min"


def record_eta(step: str, duration: float, elapsed: float) -> None:
    """Zapisz pomiar, żeby kolejne ETA było liczone z rzeczywistości, nie z sufitu."""
    with ETA_LOCK:
        model = _eta_model()
        key = f"{step}@{_device()}"
        arr = list(model.get(key) or [])
        arr.append([round(float(duration), 2), round(float(elapsed), 2)])
        model[key] = arr[-8:]
        try:
            DATA.mkdir(parents=True, exist_ok=True)
            ETA_PATH.write_text(json.dumps(model, indent=1), encoding="utf-8")
        except OSError:
            pass



# --------------------------------------------------------------------------- #
#  Narzędzia
# --------------------------------------------------------------------------- #
def slugify(name: str) -> str:
    """Nazwa pliku -> bezpieczny slug katalogu w data/ (bez polskich znaków)."""
    s = name.strip().lower()
    s = s.translate(str.maketrans("ąćęłńóśźż", "acelnoszz"))
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-._")
    return s[:64] or "utwor"


def human_bytes(n: int) -> str:
    for unit, div in (("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= div:
            return f"{n / div:.0f} {unit}" if div >= 1 << 20 else f"{n / div:.1f} {unit}"
    return f"{n} B"


def _python_has(module: str) -> bool:
    """Czy w środowisku serwera da się zaimportować moduł (bez pobocznych efektów)."""
    try:
        r = subprocess.run(
            [PY, "-c", f"import {module}"],
            capture_output=True, timeout=60, cwd=str(ROOT),
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


# --------------------------------------------------------------------------- #
#  Skanowanie data/ + podsumowania analysis.json
# --------------------------------------------------------------------------- #
# analysis.json to ~26 MB dla 3.5-minutowego utworu (dziesiątki serii co ~60 fps).
# Parsowanie go przy każdym odświeżeniu listy byłoby marnotrawstwem, a strona
# odpytuje stan co ~1 s. Dlatego: jedno parsowanie na wersję pliku (klucz =
# mtime+rozmiar), wynik trzymany w pamięci I w sidecarze `analysis.meta.json`,
# żeby po restarcie serwera nie czytać 26 MB od nowa.
_META_CACHE: dict[str, dict] = {}
_META_LOCK = threading.Lock()


def _summary_from_analysis(path: Path) -> dict:
    """Czyta analysis.json i wyciąga tylko to, czego potrzebuje biblioteka."""
    with path.open("r", encoding="utf-8") as f:
        d = json.load(f)
    meta = d.get("meta") or {}
    stems = d.get("stems") or {}
    frames = 0
    for name in STEMS:
        st = stems.get(name) or {}
        fr = st.get("frames") or {}
        if isinstance(fr, dict):
            for key in ("rms", "energy", "rms_norm"):
                if isinstance(fr.get(key), list):
                    frames = max(frames, len(fr[key]))
                    break
    hits = ((stems.get("bebny") or {}).get("events") or {}).get("hits") or []
    sections = d.get("sections") or meta.get("sections") or []
    duration = meta.get("duration")
    if not duration and isinstance(d.get("time_s"), list) and d["time_s"]:
        duration = float(d["time_s"][-1])
    return {
        "duration": round(float(duration), 2) if duration else None,
        "fps": round(float(float(meta.get("fps") or 0)), 2) or None,
        "frames": frames,
        "sections": len(sections) if isinstance(sections, list) else 0,
        "hits": len(hits),
        "stems_with_data": [
            s for s in STEMS if isinstance(stems.get(s), dict) and stems[s].get("frames")
        ],
    }


def analysis_summary(path: Path) -> dict:
    st = path.stat()
    sign = f"{st.st_mtime_ns}:{st.st_size}"   # „podpis” wersji pliku: mtime + rozmiar
    with _META_LOCK:
        cached = _META_CACHE.get(str(path))
        if cached and cached.get("sign") == sign:
            return cached

    sidecar = path.with_name("analysis.meta.json")
    if sidecar.is_file():
        try:
            s = json.loads(sidecar.read_text(encoding="utf-8"))
            if s.get("sign") == sign:
                with _META_LOCK:
                    _META_CACHE[str(path)] = s
                return s
        except (OSError, ValueError):
            pass

    info = {"sign": sign, "bytes": st.st_size, "mtime": int(st.st_mtime)}
    try:
        info.update(_summary_from_analysis(path))
    except (OSError, ValueError) as e:  # uszkodzony JSON nie może wywalić listy
        info.update({"broken": f"{type(e).__name__}: {e}"[:200], "hits": 0, "frames": 0})
    with _META_LOCK:
        _META_CACHE[str(path)] = info
    try:
        sidecar.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return info


def _write_sidecar(slug: str) -> None:
    """Po zadaniu: przelicz od razu, przy okazji odświeżając sidecar."""
    with _META_LOCK:
        _META_CACHE.pop(str(DATA / slug / "analysis.json"), None)
    aj = DATA / slug / "analysis.json"
    if aj.is_file():
        analysis_summary(aj)


def scan_tracks() -> list[dict]:
    tracks: dict[str, dict] = {}
    if not DATA.is_dir():
        return []

    def entry(slug: str) -> dict:
        return tracks.setdefault(slug, {
            "slug": slug, "title": None, "source": None, "stems": [],
            "analysis": None, "dir": False,
        })

    for p in sorted(DATA.iterdir(), key=lambda x: x.name.lower()):
        if p.is_dir():
            t = entry(p.name)
            t["dir"] = True
            t["stems"] = [s for s in STEMS if any((p / f"{s}{e}").is_file() for e in AUDIO_EXT)]
            aj = p / "analysis.json"
            if aj.is_file():
                t["analysis"] = analysis_summary(aj)
        elif p.suffix.lower() in AUDIO_EXT:
            t = entry(p.stem)
            t["source"] = {
                "file": p.name,
                "bytes": p.stat().st_size,
                "pretty": human_bytes(p.stat().st_size),
            }

    out = []
    for slug, t in tracks.items():
        a = t["analysis"]
        has_core = bool(a and a.get("frames") and len(t["stems"]) == len(STEMS))
        has_hits = bool(a and a.get("hits"))
        missing = []
        if not t["stems"]:
            missing.append("separate")
        if not a:
            missing.append("analyze")
        elif not has_core:
            missing.append("analyze")
        if a and not has_hits:
            missing.append("hits")
        if t["stems"] and not t["source"]:
            state = "stems"
        elif t["source"] and not t["stems"]:
            state = "source"
        elif not t["stems"] and not t["source"]:
            state = "empty"
        else:
            state = "stems"
        if a:
            state = "analyzed"
        if has_core and has_hits:
            state = "ready"
        t["missing"] = sorted(set(missing), key=["separate", "analyze", "hits"].index)
        t["state"] = state
        t["playable"] = state == "ready"
        out.append(t)

    order = {"ready": 0, "analyzed": 1, "stems": 2, "source": 3, "empty": 4}
    out.sort(key=lambda t: (order.get(t["state"], 9), t["slug"]))
    return out


# --------------------------------------------------------------------------- #
#  Zadania (jeden worker, kolejka FIFO)
# --------------------------------------------------------------------------- #
STEP_INFO = {
    "separate": {"label": "podział na stem'y", "tool": "audio-separator (Demucs)"},
    "analyze": {"label": "analiza (librosa)", "tool": "analyze_stems.py"},
    "hits": {"label": "detekcja uderzeń", "tool": "detect_hits.py"},
}
STEP_ORDER = ["separate", "analyze", "hits"]

CAPS: dict[str, bool] = {}


def probe_caps() -> dict:
    CAPS.update({
        "separator": _python_has("audio_separator"),
        "librosa": _python_has("librosa"),
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    })
    return CAPS


class Job:
    def __init__(self, slug: str, steps: list[str]):
        self.id = uuid.uuid4().hex[:10]
        self.slug = slug
        self.steps = [{"key": s, "label": STEP_INFO[s]["label"], "status": "queued"} for s in steps]
        self.status = "queued"          # queued | running | done | error | cancelled
        self.current: str | None = None
        self.created = time.time()
        self.started: float | None = None
        self.finished: float | None = None
        self.error: str | None = None
        self.lines: deque[dict] = deque(maxlen=LOG_LINES)
        self.duration = audio_duration(slug)          # długość materiału (s)
        model = _eta_model()
        self.eta = {s: eta_seconds(s, self.duration, model) for s in steps}
        self.eta_scale = 1.0                          # korekta po zmierzonym kroku
        self.step_started: float | None = None
        self.step_actual: dict[str, float] = {}
        self._proc: subprocess.Popen | None = None
        self._cancel = threading.Event()

    def log(self, text: str, level: str = "out") -> None:
        self.lines.append({"t": round(time.time() - (self.started or self.created), 2),
                           "text": text.rstrip()[:400], "level": level})

    def as_dict(self, tail: int = 60) -> dict:
        now = self.finished or time.time()
        total = 0.0
        left = 0.0
        steps_out = []
        for s in self.steps:
            key = s["key"]
            base = self.eta.get(key) or 0.0
            if s["status"] == "done":
                est = self.step_actual.get(key, base)
                eta_left = 0.0
            else:
                est = base * self.eta_scale
                if s["status"] == "running" and self.step_started:
                    eta_left = max(0.0, est - (now - self.step_started))
                else:
                    eta_left = est
            total += est
            left += eta_left
            steps_out.append({**s, "eta": round(est, 1), "eta_left": round(eta_left, 1)})
        return {
            "id": self.id, "slug": self.slug, "steps": steps_out, "status": self.status,
            "current": self.current, "error": self.error,
            "elapsed": round(now - (self.started or self.created), 1),
            "queue_pos": _QUEUE.qsize() if self.status == "queued" else 0,
            "lines": list(self.lines)[-tail:],
            "duration": round(self.duration, 1),
            "eta_total": round(total, 1),
            "eta_left": round(left, 1),
        }

    def cancel(self) -> None:
        self._cancel.set()
        p = self._proc
        if p and p.poll() is None:
            self.log("anulowanie — zatrzymuję proces", "err")
            try:
                p.terminate()
            except OSError:
                pass


_JOBS: dict[str, Job] = {}
_JOBS_LOCK = threading.Lock()
_QUEUE: queue.Queue[Job] = queue.Queue()


def _cmd_for(step: str, slug: str) -> list[str]:
    src = next((DATA / f"{slug}{e}" for e in sorted(AUDIO_EXT)
                if (DATA / f"{slug}{e}").is_file()), None)
    if step == "separate":
        if not src:
            raise ValueError("brak pliku źródłowego (data/<utwór>.<ext>)")
        return [PY, str(ROOT / "separate.py"), str(src)]
    if step == "analyze":
        return [PY, str(ROOT / "analyze_stems.py"),
                "--data-dir", str(DATA / slug), "--out", str(DATA / slug / "analysis.json")]
    if step == "hits":
        return [PY, str(ROOT / "detect_hits.py"), slug]
    raise ValueError(f"nieznany krok: {step}")


def _run_step(job: Job, step: str) -> None:
    job.current = step
    for s in job.steps:
        if s["key"] == step:
            s["status"] = "running"
    if step == "separate" and not CAPS.get("separator"):
        raise RuntimeError(
            "brak modułu audio-separator w tym środowisku — podział na stem'y nie ruszy. "
            "Zainstaluj: uv pip install --python .venv/Scripts/python.exe -r requirements.txt  "
            "(albo wgraj gotowe stem'y przyciskiem „wgraj stem'y”)"
        )
    cmd = _cmd_for(step, job.slug)
    job.log("$ " + " ".join(cmd[1:]))
    est = job.eta.get(step, 0.0) * job.eta_scale
    job.step_started = time.time()
    job.log(f"szacowany czas (materiał {fmt_dur(job.duration)}): ~{fmt_dur(est)}", "eta")
    if step == "separate":
        job.log("model: htdemucs (1 sieć). Czystrze (i ~4× dłużej): "
                "separate.py --model htdemucs_ft.yaml", "eta")
    proc = subprocess.Popen(
        cmd, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
        env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"},
    )
    job._proc = proc
    assert proc.stdout is not None
    for line in proc.stdout:
        if job._cancel.is_set():
            break
        job.log(line)
    rc = proc.wait()
    job._proc = None
    if job._cancel.is_set():
        raise _Cancelled()
    if rc != 0:
        raise RuntimeError(f"{STEP_INFO[step]['label']}: proces zakończył się kodem {rc}")
    for s in job.steps:
        if s["key"] == step:
            s["status"] = "done"

    # Pomiar trafia do modelu (kolejne zadania dostają coraz lepsze ETA), a jeśli
    # ten krok poszedł inaczej niż zakładaliśmy — korygujemy szacunek reszty.
    took = time.time() - (job.step_started or time.time())
    job.step_actual[step] = took
    record_eta(step, job.duration, took)
    est0 = job.eta.get(step) or 0.0
    if est0 > 0.5:
        job.eta_scale = max(0.25, min(4.0, job.eta_scale * (took / est0)))
    job.log(f"zmierzone: {fmt_dur(took)} (szacowano ~{fmt_dur(est0)})", "eta")


class _Cancelled(Exception):
    pass


def _worker() -> None:
    while True:
        job = _QUEUE.get()
        if job is None:
            return
        with _JOBS_LOCK:
            job.status = "running"
            job.started = time.time()
        try:
            for step in [s["key"] for s in job.steps]:
                if job._cancel.is_set():
                    raise _Cancelled()
                _run_step(job, step)
            job.status = "done"
            job.log("gotowe", "ok")
        except _Cancelled:
            job.status = "cancelled"
            job.error = "anulowane"
            for s in job.steps:
                if s["status"] == "running":
                    s["status"] = "error"
        except Exception as e:  # noqa: BLE001 — każdy błąd kroku ma trafić do UI
            job.status = "error"
            job.error = str(e)[:400]
            job.log(str(e), "err")
            for s in job.steps:
                if s["status"] == "running":
                    s["status"] = "error"
        finally:
            job.finished = time.time()
            job.current = None
            _write_sidecar(job.slug)
            _QUEUE.task_done()


def enqueue(slug: str, steps: list[str]) -> Job:
    steps = [s for s in STEP_ORDER if s in set(steps)]
    if not steps:
        raise ValueError("brak kroków do wykonania")
    if not SLUG_RE.match(slug):
        raise ValueError("nieprawidłowa nazwa utworu")
    with _JOBS_LOCK:
        for j in _JOBS.values():
            if j.slug == slug and j.status in ("queued", "running"):
                raise ValueError("ten utwór już się przetwarza")
        job = Job(slug, steps)
        _JOBS[job.id] = job
        # trzymamy tylko 20 ostatnich zadań — to nie jest historia, tylko podgląd
        if len(_JOBS) > 20:
            for k in sorted(_JOBS, key=lambda k: _JOBS[k].created)[:-20]:
                if _JOBS[k].status not in ("queued", "running"):
                    _JOBS.pop(k, None)
    _QUEUE.put(job)
    return job


def job_for(slug: str) -> dict | None:
    with _JOBS_LOCK:
        for j in _JOBS.values():
            if j.slug == slug and j.status in ("queued", "running"):
                return j.as_dict()
    return None


# --------------------------------------------------------------------------- #
#  HTTP
# --------------------------------------------------------------------------- #
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript",
        ".json": "application/json", ".wav": "audio/wav",
        ".flac": "audio/flac", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
        ".woff2": "font/woff2", ".svg": "image/svg+xml",
    }
    server_version = "audioviz/1.0"
    _limit: int | None = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # --- logowanie: jednoznaczne, bez zrzutu nagłówków na każdy request ---
    def log_message(self, fmt: str, *args) -> None:
        if os.environ.get("AUDIOVIZ_QUIET"):
            return
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # --- statyka z obsługą Range (bez tego <audio> nie seekuje po WAV) ---
    def send_head(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        m = RANGE_RE.match(rng) if rng else None
        if not m or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416)
            return None
        f = open(path, "rb")
        f.seek(start)
        self._limit = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(self._limit))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        try:
            if self._limit is None:
                return super().copyfile(source, outputfile)
            remaining = self._limit
            while remaining > 0:
                chunk = source.read(min(1 << 16, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (ConnectionResetError, BrokenPipeError):
            pass
        finally:
            self._limit = None

    # ---------------------------- pomocnicze ---------------------------- #
    def _json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionResetError, BrokenPipeError):
            pass

    def _err(self, code: int, msg: str) -> None:
        self._json({"error": msg}, code)

    def _body(self, limit: int = MAX_UPLOAD) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            raise ValueError("puste ciało żądania")
        if n > limit:
            raise ValueError(f"plik za duży (limit {human_bytes(limit)})")
        buf = bytearray()
        while len(buf) < n:
            chunk = self.rfile.read(min(1 << 20, n - len(buf)))
            if not chunk:
                break
            buf += chunk
        return bytes(buf)

    def _stream_to(self, tmp: Path, limit: int = MAX_UPLOAD) -> int:
        """Zapisuje ciało żądania prosto do pliku — WAV-y mają po 40-50 MB,
        a buforowanie ich w RAM kończyłoby się podwojeniem pamięci na upload."""
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            raise ValueError("puste ciało żądania")
        if n > limit:
            raise ValueError(f"plik za duży (limit {human_bytes(limit)})")
        got = 0
        with tmp.open("wb") as f:
            while got < n:
                chunk = self.rfile.read(min(1 << 20, n - got))
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
        if got != n:
            tmp.unlink(missing_ok=True)
            raise ValueError("przesyłanie przerwane")
        return got

    def _json_body(self) -> dict:
        raw = self._body(limit=1 << 20)
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise ValueError("niepoprawny JSON") from None

    # ------------------------------- GET ------------------------------- #
    def do_GET(self):
        url = urlparse(self.path)
        path, qs = unquote(url.path), parse_qs(url.query)
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/viz/home.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path.startswith("/api/"):
            return self._api_get(path, qs)
        return super().do_GET()

    def _api_get(self, path: str, qs: dict) -> None:
        if path == "/api/state":
            tracks = scan_tracks()
            for t in tracks:
                t["job"] = job_for(t["slug"])
            with _JOBS_LOCK:
                # Zakończone zadanie zostaje w odpowiedzi jeszcze 2 minuty: panel
                # w przeglądarce musi zdążyć pokazać „gotowe" i zmierzone czasy —
                # wcześniej znikało w tej samej sekundzie, w której kończyło pracę,
                # więc użytkownik zostawał z zamrożonym licznikiem na ekranie.
                now = time.time()
                jobs = [j.as_dict() for j in _JOBS.values()
                        if j.status in ("queued", "running")
                        or (j.finished is not None and now - j.finished < 120)]
            return self._json({"tracks": tracks, "jobs": jobs, "caps": CAPS})
        if path.startswith("/api/job/"):
            jid = path.rsplit("/", 1)[-1]
            with _JOBS_LOCK:
                job = _JOBS.get(jid)
            if not job:
                return self._err(404, "nie ma takiego zadania")
            return self._json(job.as_dict(tail=200))
        return self._err(404, "nieznany endpoint")

    # ------------------------------- PUT ------------------------------- #
    def do_PUT(self):
        url = urlparse(self.path)
        path, qs = unquote(url.path), parse_qs(url.query)
        try:
            if path == "/api/upload":
                return self._put_upload(qs)
            m = re.fullmatch(r"/api/stems/([^/]+)", path)
            if m:
                return self._put_stem(m.group(1), qs)
            return self._err(404, "nieznany endpoint")
        except ValueError as e:
            return self._err(400, str(e))
        except OSError as e:
            return self._err(500, f"zapis nie udał się: {e}")

    def _put_upload(self, qs: dict) -> None:
        name = (qs.get("name") or [""])[0]
        ext = Path(name).suffix.lower()
        if ext not in AUDIO_EXT:
            raise ValueError(f"nieobsługiwany format {ext or '(brak)'} — dozwolone: "
                             + ", ".join(sorted(AUDIO_EXT)))
        slug = slugify(Path(name).stem)
        DATA.mkdir(exist_ok=True)
        target = DATA / f"{slug}{ext}"
        tmp = target.with_suffix(ext + ".part")
        size = self._stream_to(tmp)
        os.replace(tmp, target)
        # jeśli wcześniej wgrany był plik w innym formacie, nie zostawiamy dwóch źródeł
        for other in DATA.glob(f"{slug}.*"):
            if other.is_file() and other.suffix.lower() in AUDIO_EXT and other != target:
                other.unlink(missing_ok=True)
        self._json({"ok": True, "slug": slug, "file": target.name,
                    "bytes": size, "pretty": human_bytes(size)})

    def _put_stem(self, slug: str, qs: dict) -> None:
        stem = (qs.get("stem") or [""])[0]
        if stem not in STEMS:
            raise ValueError("nieprawidłowa ścieżka — dozwolone: " + ", ".join(STEMS))
        if not SLUG_RE.match(slug):
            raise ValueError("nieprawidłowa nazwa utworu")
        ext = (qs.get("ext") or [".wav"])[0].lower()
        if ext not in AUDIO_EXT:
            raise ValueError("nieobsługiwany format stemu")
        d = DATA / slug
        d.mkdir(parents=True, exist_ok=True)
        target = d / f"{stem}{ext}"
        tmp = target.with_suffix(ext + ".part")
        size = self._stream_to(tmp)
        os.replace(tmp, target)
        for other in d.glob(f"{stem}.*"):
            if other.is_file() and other != target and other.suffix.lower() in AUDIO_EXT:
                other.unlink(missing_ok=True)
        self._json({"ok": True, "slug": slug, "stem": stem,
                    "file": target.name, "pretty": human_bytes(size)})

    # ------------------------------- POST ------------------------------ #
    def do_POST(self):
        url = urlparse(self.path)
        path, qs = unquote(url.path), parse_qs(url.query)
        try:
            if path == "/api/run":
                return self._post_run()
            if path == "/api/cancel":
                jid = (qs.get("id") or [""])[0]
                with _JOBS_LOCK:
                    job = _JOBS.get(jid)
                if not job:
                    return self._err(404, "nie ma takiego zadania")
                job.cancel()
                return self._json({"ok": True})
            return self._err(404, "nieznany endpoint")
        except ValueError as e:
            return self._err(400, str(e))

    def _post_run(self) -> None:
        body = self._json_body()
        slug = body.get("slug") or ""
        if not SLUG_RE.match(slug):
            raise ValueError("nieprawidłowa nazwa utworu")
        track = next((t for t in scan_tracks() if t["slug"] == slug), None)
        if not track:
            raise ValueError("nie ma takiego utworu")
        if body.get("prepare"):
            steps = list(track["missing"])
            # analiza bez detekcji uderzeń daje utwór, którego nie da się puścić —
            # kroki są łańcuchem, więc „przygotuj" dociąga zależności
            if "analyze" in steps and "hits" not in steps:
                steps.append("hits")
            steps = [s for s in STEP_ORDER if s in set(steps)]
            if not steps:
                raise ValueError("ten utwór jest już przygotowany")
        else:
            steps = body.get("steps") or []
        # walidacja wejść, żeby błąd był od razu w UI, a nie po minucie w logu
        if "separate" in steps and not track["source"]:
            raise ValueError("brak pliku źródłowego — wgraj audio albo stem'y")
        # Świeżo wgrany plik nie ma jeszcze stemów, ale podział jest w tym samym
        # zadaniu — dopiero gdy nikt ich nie zrobi, analiza nie ma wejścia.
        if ("analyze" in steps and "separate" not in steps
                and len(track["stems"]) < len(STEMS)):
            raise ValueError("analiza wymaga czterech stemów (wokal, bas, bębny, inne)")
        job = enqueue(slug, steps)
        self._json({"ok": True, "job": job.as_dict()}, 202)

    # ------------------------------ DELETE ----------------------------- #
    def do_DELETE(self):
        url = urlparse(self.path)
        path = unquote(url.path)
        m = re.fullmatch(r"/api/tracks/([^/]+)", path)
        if not m:
            return self._err(404, "nieznany endpoint")
        slug = m.group(1)
        if not SLUG_RE.match(slug) or self.headers.get("X-Confirm") != slug:
            return self._err(400, "potwierdź usunięcie nagłówkiem X-Confirm")
        with _JOBS_LOCK:
            busy = any(j.slug == slug and j.status in ("queued", "running") for j in _JOBS.values())
        if busy:
            return self._err(409, "utwór jest właśnie przetwarzany")
        removed = []
        d = DATA / slug
        if d.is_dir():
            shutil.rmtree(d)
            removed.append(f"{slug}/")
        for ext in AUDIO_EXT:
            f = DATA / f"{slug}{ext}"
            if f.is_file():
                f.unlink()
                removed.append(f.name)
        with _META_LOCK:
            _META_CACHE.pop(str(d / "analysis.json"), None)
        self._json({"ok": True, "removed": removed})


def run(port: int = 8080) -> None:
    DATA.mkdir(exist_ok=True)
    probe_caps()
    threading.Thread(target=_worker, daemon=True, name="jobs").start()
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as srv:
        srv.daemon_threads = True
        print(f"audioviz: http://127.0.0.1:{port}/viz/home.html", flush=True)
        print(f"  root: {ROOT}", flush=True)
        print(f"  python: {CAPS.get('python')} | librosa: {CAPS.get('librosa')} | "
              f"separator: {CAPS.get('separator')}", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nstop", flush=True)


if __name__ == "__main__":
    # `import torch` (dla detekcji GPU) trwa ~3 s — robimy to w tle, żeby pierwsze
    # żądanie ETA nie czekało na import.
    threading.Thread(target=_device, daemon=True).start()
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 8080)
