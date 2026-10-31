import sys
from pathlib import Path

# Testy chodzą z korzenia repo bez instalowania pakietu (to nie jest paczka pip).
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
