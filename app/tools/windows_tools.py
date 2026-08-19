"""Allowlisted Windows application actions; no model-generated commands are executed."""

from __future__ import annotations

import os
import subprocess
import time
from typing import Any


APPLICATIONS: dict[str, dict[str, Any]] = {
    "notepad": {"target": "notepad.exe", "process": "notepad.exe", "aliases": ("text editor",)},
    "calculator": {"target": "calc.exe", "process": "calculatorapp.exe", "aliases": ("calc",)},
    "vscode": {"target": "vscode://", "process": "code.exe", "aliases": ("vs code", "visual studio code", "code")},
    "chrome": {"target": "https://www.google.com", "process": "chrome.exe", "aliases": ("google chrome",)},
    "whatsapp": {"target": "whatsapp:", "process": "whatsapp.exe", "aliases": ("whats app",)},
}


def normalize_application(application: str) -> str:
    value = " ".join(application.lower().strip().split())
    for name, definition in APPLICATIONS.items():
        if value == name or value in definition["aliases"]:
            return name
    raise ValueError(f"Application is not allowlisted: {application}")


def _is_running(process_name: str) -> bool:
    completed = subprocess.run(
        ["tasklist.exe", "/FI", f"IMAGENAME eq {process_name}", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, timeout=10, check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return process_name.casefold() in completed.stdout.casefold()


def open_application(application: str) -> dict[str, Any]:
    name = normalize_application(application)
    definition = APPLICATIONS[name]
    target = definition["target"]
    try:
        os.startfile(target)  # type: ignore[attr-defined]
    except OSError as error:
        raise RuntimeError(f"Windows could not open {name}: {error}") from error
    time.sleep(1)
    verified = _is_running(definition["process"])
    return {
        "application": name,
        "launch_requested": True,
        "verified_running": verified,
        "message": f"{name.title()} is open." if verified else f"Windows accepted the request to open {name.title()}, but Jarvis could not confirm its process yet.",
    }
