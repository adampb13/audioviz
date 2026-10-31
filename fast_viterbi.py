"""Szybki drop-in dla `librosa.sequence._viterbi` (librosa 0.11).

Dlaczego: `pyin()` to ~75 % czasu analizy, a w `pyin()` ~90 % czasu zjada
Viterbi. Wbudowany `_viterbi` liczy dla każdej klatki pełną macierz
`value[t-1] + log_trans.T` (n_states²), choć macierz przejść jest pasmowa:
dla 4 oktaw i `bins_per_semitone=10` to 960 stanów, z czego w kolumnie
niezerowe jest ~140. Reszta to `-inf`, które i tak przegrywa z maksimum.

Ten moduł robi to samo, ale po niezerowych przejściach: O(T · m · nnz_col)
zamiast O(T · m²), w dodatku równolegle po kolumnach stanów. Wynik jest
identyczny — argmax jest ten sam, więc ścieżka stanów i log-prawdopodobieństwo
się nie zmieniają.

Instalacja jest jawna i weryfikowana: `install()` podmienia funkcję tylko
wtedy, gdy (a) wersja librysy jest ta, pod którą pisany był moduł, i (b)
samo-test na losowych danych daje identyczną ścieżkę jak oryginał.
W przeciwnym razie zostaje wolna, ale poprawna ścieżka librysy.
"""
from __future__ import annotations

import numpy as np
import numba
import librosa
import librosa.sequence as _seq

# Wersja librysy, pod którą zweryfikowano równoważność (patrz wymagania).
_SUPPORTED = ("0.11.0",)

_orig_viterbi = _seq._viterbi
_installed = False


@numba.njit(cache=True, parallel=True)
def _viterbi_sparse(log_prob, src, weight, log_p_init):
    """Viterbi po strukturze rzadkiej.

    src[i, j], weight[i, j] — i-ta niezerowa źródłowa kolumna stanu ``j``.
    Wiersze ``src`` ponad liczbę niezerowych wpisów w kolumnie mają
    ``weight = -inf``, więc nie mogą wygrać.
    """
    n_steps, n_states = log_prob.shape
    depth = src.shape[0]

    value = np.full((n_steps, n_states), -np.inf, dtype=np.float64)
    ptr = np.zeros((n_steps, n_states), dtype=np.uint16)

    value[0] = log_prob[0] + log_p_init

    for t in range(1, n_steps):
        prev = value[t - 1]
        for j in numba.prange(n_states):
            best = -np.inf
            best_k = np.uint16(0)
            for i in range(depth):
                cand = prev[src[i, j]] + weight[i, j]
                if cand > best:
                    best = cand
                    best_k = src[i, j]
            value[t, j] = log_prob[t, j] + best
            ptr[t, j] = best_k

    state = np.zeros(n_steps, dtype=np.uint16)
    state[-1] = np.argmax(value[-1])
    for t in range(n_steps - 2, -1, -1):
        state[t] = ptr[t + 1, state[t + 1]]

    return state, value[-1:, state[-1]]


def _sparsify(log_trans: np.ndarray, prune_nats: float = 60.0):
    """Zamień macierz przejść na (src, weight) z paddingiem -inf.

    Librosa liczy `np.log(transition + tiny)`, więc zera („brak przejścia”)
    trafiają do macierzy jako log(~1e-308) ≈ -708. Takie przejścia są o setki
    natów gorsze od każdej realnej krawędzi i nigdy nie wygrywają argmaxu,
    o ile istnieje choć jedna realna krawędź wchodząca do stanu. Wszystkie
    stany mają niepuste pasmo, więc wycinamy wpisy poniżej `prune_nats`
    natów od maksimum kolumny — wynik Viterbiego zostaje ten sam.
    """
    col_max = log_trans.max(axis=0, keepdims=True)
    mask = log_trans > (col_max - prune_nats)
    per_col = mask.sum(axis=0)
    depth = int(per_col.max()) if per_col.size else 0
    n = log_trans.shape[1]
    src = np.zeros((depth, n), dtype=np.int64)
    weight = np.full((depth, n), -np.inf, dtype=np.float64)
    for j in range(n):
        idx = np.flatnonzero(mask[:, j])
        src[: idx.size, j] = idx
        weight[: idx.size, j] = log_trans[idx, j]
    return src, weight


def _fast_viterbi(log_prob, log_trans, log_p_init):
    src, weight = _sparsify(np.asarray(log_trans, dtype=np.float64))
    return _viterbi_sparse(
        np.ascontiguousarray(log_prob, dtype=np.float64), src, weight, log_p_init
    )


def _self_test(seed: int = 0) -> bool:
    """Czy szybka ścieżka daje dokładnie tę samąViterbi ścieżkę?"""
    rng = np.random.default_rng(seed)
    n_states, n_steps, band = 37, 64, 5
    log_trans = np.full((n_states, n_states), -np.inf)
    for i in range(n_states):
        for d in range(-band, band + 1):
            if 0 <= i + d < n_states:
                log_trans[i, i + d] = -abs(d) * 0.3
    log_prob = rng.normal(size=(n_steps, n_states))
    p_init = np.log(np.full(n_states, 1.0 / n_states))

    state_a, logp_a = _orig_viterbi(log_prob, log_trans, p_init)
    state_b, logp_b = _fast_viterbi(log_prob, log_trans, p_init)
    return bool(np.array_equal(state_a, state_b)) and bool(
        np.allclose(logp_a, logp_b, rtol=0, atol=1e-9)
    )


def install(force: bool = False) -> bool:
    """Podmień `librosa.sequence._viterbi`. Zwraca True, gdy szybka ścieżka działa."""
    global _installed
    if _installed:
        return True
    if librosa.__version__ not in _SUPPORTED and not force:
        return False
    if not _self_test():
        return False
    _seq._viterbi = _fast_viterbi
    _installed = True
    return True
