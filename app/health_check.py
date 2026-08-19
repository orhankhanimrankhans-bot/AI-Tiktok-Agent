"""Windows-friendly local health check that never prints secret values."""

from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

from app.memory import DATABASE, PROJECT_ROOT, initialize_database
from observability import get_logger


logger = get_logger("health_check")


def report(label: str, status: str, detail: str) -> bool:
    print(f"{status:<7} {label}: {detail}")
    return status == "PASS"


def main() -> int:
    results: list[bool] = []
    results.append(report("Python", "PASS", sys.version.split()[0]))
    for binary in ("ffmpeg", "ffprobe"):
        path = shutil.which(binary)
        results.append(report(binary, "PASS" if path else "FAIL", path or "not found in PATH"))
    initialize_database()
    try:
        with sqlite3.connect(DATABASE) as connection:
            connection.execute("SELECT 1 FROM videos LIMIT 1")
        results.append(report("SQLite memory", "PASS", str(DATABASE)))
    except sqlite3.Error as error:
        results.append(report("SQLite memory", "FAIL", str(error)))
    for directory in (PROJECT_ROOT / "output", PROJECT_ROOT / "output" / "pipeline", PROJECT_ROOT / "output" / "final"):
        directory.mkdir(parents=True, exist_ok=True)
        results.append(report("Directory", "PASS", str(directory.relative_to(PROJECT_ROOT))))
    ollama_ok = False
    try:
        import urllib.request
        with urllib.request.urlopen(os.getenv("OLLAMA_HOST", "http://localhost:11434") + "/api/tags", timeout=3):
            ollama_ok = True
    except Exception:
        logger.debug("Ollama health probe failed", exc_info=True, extra={"event": "health.ollama_unreachable"})
    report("Ollama", "PASS" if ollama_ok else "WARNING", "reachable" if ollama_ok else "not reachable; Gemini/OpenAI may still be configured")
    report("TikTok credentials", "PASS" if os.getenv("TIKTOK_CLIENT_KEY") else "WARNING", "configured" if os.getenv("TIKTOK_CLIENT_KEY") else "client key not set")
    report("Gemini", "PASS" if os.getenv("GEMINI_API_KEY") else "WARNING", "API key configured" if os.getenv("GEMINI_API_KEY") else "API key not set")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
