"""Zgodność wstecz: `python viz/serve.py [port]` -> serwer aplikacji z server.py.

Cała obsługa HTTP (statyka z Range + API biblioteki) siedzi w `server.py` w
korzeniu repo. Ten plik zostaje, bo ta komenda jest opisana w README i w
nawykach — ale nie duplikuje kodu.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import run  # noqa: E402

if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 8080)
