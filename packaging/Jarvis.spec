# PyInstaller specification. User state is deliberately not bundled.
from pathlib import Path

hiddenimports = ["pyttsx3.drivers.sapi5", "comtypes.stream"]
project_root = Path(SPECPATH).parent

a = Analysis(
    [str(Path(SPECPATH) / "windows_entry.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    excludes=[
        "tests", "data", "logs", "backups", "updates",
        "torch", "pandas", "pyarrow", "scipy", "numba", "matplotlib", "tensorboard",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Jarvis",
    console=False,
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Jarvis")
