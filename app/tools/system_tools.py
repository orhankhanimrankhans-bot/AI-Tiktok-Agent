"""Read-only Windows and Python runtime information."""

from __future__ import annotations

import os
import platform
import shutil
from pathlib import Path
from typing import Any


def get_system_info() -> dict[str, Any]:
    usage = shutil.disk_usage(Path.cwd().anchor)
    return {
        "system": platform.system(), "release": platform.release(),
        "machine": platform.machine(), "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
    }
