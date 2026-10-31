<#
  audioviz — instalacja wszystkich zależności projektu.

  Uruchomienie (z korzenia repo, w PowerShell):
      ./setup.ps1

  Co robi:
    1. sprawdza Pythona (3.11+),
    2. tworzy .venv (jeśli nie ma),
    3. instaluje requirements.txt (pełny, przypięty zestaw: torch,
       audio-separator, onnxruntime, torchaudio, librosa, ...),
    4. npm install w viz/ (Three.js),
    5. sprawdza, czy audio-separator naprawdę się importuje,
    6. wypisuje komendę startową.

  Skrypt jest idempotentny — można go puszczać wielokrotnie.
#>
[CmdletBinding()]
param(
    [string]$PythonVersion = "3.11",
    [switch]$SkipNode
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$venv = Join-Path $root ".venv"
$py = Join-Path $venv "Scripts/python.exe"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "!!  $msg" -ForegroundColor Red; exit 1 }

Step "Python $PythonVersion"
$base = Get-Command python -ErrorAction SilentlyContinue
if (-not $base) { Fail "Nie ma 'python' w PATH. Zainstaluj Python $PythonVersion z python.org i włącz 'Add to PATH'." }
$ver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
Write-Host "    python $ver ($($base.Source))"
if ([version]$ver -lt [version]"3.11") { Fail "Za stary Python ($ver). Potrzebny 3.11+ (torch/demucs)." }

Step "Środowisko .venv"
if (-not (Test-Path $py)) {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        & uv venv $venv --python $PythonVersion
    } else {
        & python -m venv $venv
    }
} else {
    Write-Host "    .venv już istnieje — używam"
}
if (-not (Test-Path $py)) { Fail "Nie udało się utworzyć .venv" }

Step "Zależności Pythona (requirements.txt)"
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if ($uvCmd) {
    & uv pip install --python $py -r (Join-Path $root "requirements.txt")
} else {
    & $py -m ensurepip --upgrade | Out-Null
    & $py -m pip install --upgrade pip | Out-Null
    & $py -m pip install -r (Join-Path $root "requirements.txt")
}
if ($LASTEXITCODE -ne 0) { Fail "Instalacja zależności nie powiodła się (kod $LASTEXITCODE)." }

Step "Sprawdzenie krytycznych modułów"
& $py -c @"
import importlib
mods = [
    ('audio_separator.separator', 'audio-separator'),
    ('onnxruntime', 'onnxruntime'),
    ('torch', 'torch'),
    ('torchaudio', 'torchaudio'),
    ('librosa', 'librosa'),
    ('soundfile', 'soundfile'),
    ('numpy', 'numpy'),
    ('scipy', 'scipy'),
]
bad = []
for mod, name in mods:
    try:
        m = importlib.import_module(mod)
        print('   ok  %-18s %s' % (name, getattr(m, '__version__', '')))
    except Exception as exc:
        bad.append('%s (%s: %s)' % (name, type(exc).__name__, exc))
if bad:
    raise SystemExit('BRAK: ' + '; '.join(bad))
"@
if ($LASTEXITCODE -ne 0) { Fail "Brakuje modułów Pythona — patrz lista wyżej." }

if (-not $SkipNode) {
    Step "Three.js (viz/)"
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Host "    !  Brak npm — pomijam. Wizualizacja nie ruszy bez viz/node_modules/three." -ForegroundColor Yellow
    } else {
        Push-Location (Join-Path $root "viz")
        try {
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Fail "npm install nie powiódł się (kod $LASTEXITCODE)." }
        } finally { Pop-Location }
    }
}

Step "Gotowe"
Write-Host @"
    Start:   .venv/Scripts/python.exe server.py
    Otwórz:  http://127.0.0.1:8080/viz/home.html

    Podział utworu:  .venv/Scripts/python.exe separate.py data/<utwór>.wav
    Analiza:         .venv/Scripts/python.exe analyze_stems.py data/<utwór>
"@ -ForegroundColor Green
