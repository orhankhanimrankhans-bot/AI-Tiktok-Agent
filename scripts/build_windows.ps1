param(
    [string]$Python = "py -3.12",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $ProjectRoot ".build-windows"
$VenvPython = Join-Path $BuildRoot "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Invoke-Expression "$Python -m venv `"$BuildRoot`""
}
if (-not $SkipInstall) {
    & $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $ProjectRoot "requirements-windows.lock")
}
Push-Location $ProjectRoot
try {
    & $VenvPython -m unittest discover -s tests -v
    & $VenvPython -m PyInstaller --clean --noconfirm "packaging\Jarvis.spec"
    Get-FileHash "dist\Jarvis\Jarvis.exe" -Algorithm SHA256
} finally {
    Pop-Location
}
