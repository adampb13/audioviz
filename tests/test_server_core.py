"""Testy czystych funkcji serwera: nazwy utworów, ETA, walidacja adresów.

Nie podnosimy tu HTTP-a ani nie wołamy yt-dlp — sieć i porty to nie miejsce na
testy jednostkowe. Sprawdzamy to, co łatwo zepsuć przy refaktorze: model ETA
(musiał dostać wersję, bo po przyspieszeniu analizy stare pomiary kłamały)
oraz blokadę adresów lokalnych w `_check_url` (ochrona przed SSRF).
"""
import json
import math

import pytest

import server


# --- nazwy i adresy -------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Żółć i Beat!.mp3", "zolc-i-beat-.mp3"),
        ("  Daft Punk - Instant Crush (Official Video)  ", "daft-punk-instant-crush-official-video"),
        ("???", "utwor"),
    ],
)
def test_slugify(raw, expected):
    assert server.slugify(raw) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8080/x",
        "http://127.0.0.1/x",
        "http://10.1.2.3/x",
        "http://192.168.0.5/x",
        "http://169.254.169.254/latest/meta-data",
        "http://172.16.0.1/x",
        "http://router.local/x",
        "file:///C:/Windows/win.ini",
        "ftp://example.com/x",
        "https://",
    ],
)
def test_check_url_blocks_local_and_non_http(url):
    with pytest.raises(ValueError):
        server._check_url(url)


@pytest.mark.parametrize(
    "url",
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "http://example.com/a.mp3"],
)
def test_check_url_allows_public(url):
    assert server._check_url(url) == url


# --- ETA ------------------------------------------------------------------

@pytest.fixture
def eta_path(tmp_path, monkeypatch):
    path = tmp_path / ".eta.json"
    monkeypatch.setattr(server, "ETA_PATH", path)
    monkeypatch.setattr(server, "_device", lambda: "cpu")
    return path


def test_eta_default_grows_with_duration():
    short = server.eta_seconds("analyze", 30.0, model={"version": server.ETA_VERSION})
    long = server.eta_seconds("analyze", 300.0, model={"version": server.ETA_VERSION})
    assert short < long
    assert short >= 1.0


def test_eta_model_discards_samples_from_other_version(eta_path):
    eta_path.write_text(
        json.dumps({"version": server.ETA_VERSION - 1, "analyze@cpu": [[100, 1], [200, 2], [300, 3]]}),
        encoding="utf-8",
    )
    model = server._eta_model()
    assert "analyze@cpu" not in model
    assert model["version"] == server.ETA_VERSION


def test_eta_model_keeps_current_version(eta_path):
    samples = [[100, 1], [200, 2], [300, 3]]
    eta_path.write_text(json.dumps({"version": server.ETA_VERSION, "analyze@cpu": samples}), encoding="utf-8")
    assert server._eta_model()["analyze@cpu"] == samples


def test_record_eta_stamps_version_and_refits(eta_path):
    """Po trzech pomiarach ETA ma wynikać z pomiarów, nie z domyślnych stałych."""
    for duration in (100.0, 200.0, 300.0):
        server.record_eta("analyze", duration, 10.0 + 0.1 * duration)

    model = json.loads(eta_path.read_text(encoding="utf-8"))
    assert model["version"] == server.ETA_VERSION
    assert len(model["analyze@cpu"]) == 3

    estimate = server.eta_seconds("analyze", 400.0)
    expected = 10.0 + 0.1 * 400.0
    assert math.isclose(estimate, expected, rel_tol=0.05), estimate


def test_short_clip_is_recorded_but_ignored_by_fit(eta_path):
    """Klip krótszy niż ETA_MIN_DUR trafia do pliku, ale nie wchodzi do fitu.

    Inaczej 8-sekundowy klip (prawie sam start Pythona) zaniżałby nachylenie
    dla pełnych utworów.
    """
    for duration, elapsed in ((5.0, 30.0), (6.0, 30.0), (12.0, 30.0)):
        server.record_eta("analyze", duration, elapsed)

    model = json.loads(eta_path.read_text(encoding="utf-8"))
    assert len(model["analyze@cpu"]) == 3

    estimate = server.eta_seconds("analyze", 300.0)
    a, b = server.ETA_DEFAULTS["cpu"]["analyze"]
    assert math.isclose(estimate, a + b * 300.0, rel_tol=0.01), estimate


def test_eta_samples_are_capped(eta_path):
    for i in range(40):
        server.record_eta("analyze", 100.0 + i, 10.0 + 0.05 * i)
    model = json.loads(eta_path.read_text(encoding="utf-8"))
    assert len(model["analyze@cpu"]) <= 8
