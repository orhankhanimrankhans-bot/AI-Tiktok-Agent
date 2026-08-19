"""Redacted local crash reports for packaged Jarvis diagnostics."""

from __future__ import annotations

import json
import platform
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path


SENSITIVE_MARKERS = ("api_key", "token", "secret", "password", "authorization")


def _redact(text: str) -> str:
    lines = []
    for line in text.splitlines():
        lines.append("[REDACTED SENSITIVE LINE]" if any(marker in line.casefold() for marker in SENSITIVE_MARKERS) else line)
    return "\n".join(lines)


def write_crash_report(logs_dir: Path, error_type, error, tb) -> Path:
    crash_dir = Path(logs_dir) / "crashes"
    crash_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc)
    path = crash_dir / f"crash-{timestamp.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    payload = {
        "timestamp": timestamp.isoformat(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "error_type": getattr(error_type, "__name__", str(error_type)),
        "message": _redact(str(error)),
        "traceback": _redact("".join(traceback.format_exception(error_type, error, tb))),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def install_crash_handler(logs_dir: Path) -> None:
    if getattr(sys.excepthook, "_jarvis_crash_handler", False):
        return
    previous = sys.excepthook

    def handler(error_type, error, tb):
        try:
            write_crash_report(logs_dir, error_type, error, tb)
        finally:
            previous(error_type, error, tb)

    handler._jarvis_crash_handler = True  # type: ignore[attr-defined]
    sys.excepthook = handler
