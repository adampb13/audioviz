"""Lokalny serwer wizualizacji.

Obsługuje nagłówek HTTP Range (wymagany, żeby <audio> mogło seekować po WAV-ach)
oraz poprawne MIME dla modułów JS (na Windows rejestr potrafi podać text/plain).

Uruchomienie z korzenia repo:
    .venv/Scripts/python.exe viz/serve.py          # port 8080
    -> http://127.0.0.1:8080/viz/index.html
"""
import http.server
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wav": "audio/wav",
    }
    _limit = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

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
        # Klient (przeglądarka) potrafi przerwać pobieranie w połowie — to nie jest błąd serwera
        try:
            if self._limit is None:
                return super().copyfile(source, outputfile)
            remaining = self._limit
            while remaining > 0:
                chunk = source.read(min(65536, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (ConnectionResetError, BrokenPipeError):
            pass


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as srv:
        print(f"Serwer: http://127.0.0.1:{PORT}/viz/index.html  (root: {ROOT})", flush=True)
        srv.serve_forever()
