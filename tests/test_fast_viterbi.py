"""Pasmowy Viterbi musi dawać identyczną ścieżkę jak wersja z librysy.

To jest cały sens optymalizacji: skoro wynik jest ten sam, nie ma ryzyka, że
wizualizacja „wygląda inaczej” niż przed przyspieszeniem — zmienia się tylko
czas liczenia.
"""
import numpy as np
import pytest

import fast_viterbi


def _banded(n_states: int, band: int, scale: float = 0.3) -> np.ndarray:
    """Macierz pasmowa jak z `transition_local(window="triangle")`."""
    out = np.full((n_states, n_states), -np.inf)
    for i in range(n_states):
        lo, hi = max(0, i - band), min(n_states, i + band + 1)
        out[i, lo:hi] = -scale * np.abs(np.arange(lo, hi) - i)
    return out


def _librosa_style(n_states: int, band: int, seed: int = 0) -> np.ndarray:
    """To, co realnie dostaje `_viterbi`: log(transition + tiny) — czyli pełna macierz.

    Librosa dodaje `np.finfo(float).tiny` do zer, więc „brak przejścia” ląduje
    w macierzy jako log(1e-308) ≈ -708 zamiast -inf. Nasze wycinanie musi to
    rozpoznać, inaczej macierz byłaby gęsta i optymalizacja nic by nie dała.
    """
    rng = np.random.default_rng(seed)
    prob = np.where(np.isfinite(_banded(n_states, band)), np.exp(_banded(n_states, band)), 0.0)
    prob /= prob.sum(axis=0, keepdims=True)
    return np.log(prob + np.finfo(float).tiny) + rng.normal(scale=1e-12, size=prob.shape)


def _path(method, log_prob, log_trans):
    return method(log_prob, log_trans, np.log(np.full(log_trans.shape[0], 1.0 / log_trans.shape[0])))


@pytest.mark.parametrize("n_states,band,n_steps", [(24, 3, 40), (96, 8, 60)])
def test_matches_librosa_on_librosa_style_matrix(n_states, band, n_steps):
    rng = np.random.default_rng(7)
    log_trans = _librosa_style(n_states, band)
    log_prob = rng.normal(size=(n_steps, n_states))

    ref_states, ref_logp = _path(fast_viterbi._orig_viterbi, log_prob, log_trans)
    fast_states, fast_logp = _path(fast_viterbi._fast_viterbi, log_prob, log_trans)

    assert np.array_equal(ref_states, fast_states)
    assert np.allclose(ref_logp, fast_logp, rtol=0, atol=1e-9)


def test_sparsify_prunes_the_tiny_floor():
    """Po przycięciu kolumna ma tyle wpisów, ile realne pasmo — nie całe 2n."""
    log_trans = _librosa_style(200, 6)
    src, weight = fast_viterbi._sparsify(log_trans)

    assert src.shape[0] < 200 // 2, f"pasmo nie zostało przycięte (depth={src.shape[0]})"
    assert src.shape[0] >= 2 * 6, "przycięcie zjadło realne przejścia"
    # każda kolumna ma realne przejścia, a puste miejsca to padding -inf,
    # który nigdy nie wygra maksimum
    assert (np.isfinite(weight).sum(axis=0) > 0).all()
    assert np.isneginf(weight).any()


def test_self_test_passes():
    assert fast_viterbi._self_test()


def test_install_is_idempotent(monkeypatch):
    monkeypatch.setattr(fast_viterbi, "_installed", False)
    monkeypatch.setattr(fast_viterbi, "_SUPPORTED", ("0.0.0-test",))
    assert fast_viterbi.install(force=True) is True
    assert fast_viterbi.install() is True


def test_install_refuses_unknown_librosa(monkeypatch):
    """Nieznana wersja librysy = brak gwarancji równoważności, więc zostaje oryginał."""
    monkeypatch.setattr(fast_viterbi, "_installed", False)
    monkeypatch.setattr(fast_viterbi, "_SUPPORTED", ("0.0.0-test",))
    assert fast_viterbi.install() is False
