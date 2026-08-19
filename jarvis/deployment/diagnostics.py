"""Read-only startup diagnostics for installation support."""

from __future__ import annotations

import shutil
import sqlite3
import sys
from contextlib import closing
from pathlib import Path


def startup_diagnostics(*, user_root: Path, database: Path, config_report) -> dict:
    checks = {
        "python": sys.version.split()[0],
        "packaged": bool(getattr(sys, "frozen", False)),
        "user_root": str(user_root),
        "user_root_writable": False,
        "database": "missing",
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "configuration_valid": bool(config_report.valid),
        "configuration_issues": len(config_report.issues),
    }
    try:
        user_root.mkdir(parents=True, exist_ok=True)
        probe = user_root / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        checks["user_root_writable"] = True
    except OSError:
        pass
    if database.exists():
        try:
            with closing(sqlite3.connect(database)) as connection:
                checks["database"] = connection.execute("PRAGMA integrity_check").fetchone()[0]
        except sqlite3.Error:
            checks["database"] = "error"
    return checks
