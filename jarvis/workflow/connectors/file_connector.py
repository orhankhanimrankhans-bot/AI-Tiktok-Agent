"""Sandboxed, read-only file connector."""
from __future__ import annotations
from pathlib import Path
from .base import BaseConnector

class FileConnector(BaseConnector):
    def __init__(self, allowed_root: Path): self.allowed_root = allowed_root.resolve()
    def operations(self): return ("read_file",)
    def execute(self, operation, config, input_data, context):
        if operation != "read_file": raise ValueError(f"Unsupported file operation: {operation}")
        path = Path(str(config.get("file_path") or input_data.get("file_path") or "")).expanduser().resolve()
        try: path.relative_to(self.allowed_root)
        except ValueError: raise PermissionError(f"File must be inside {self.allowed_root}") from None
        if not path.is_file(): return {**input_data, "file_path": str(path), "exists": False, "size": 0}
        result = {"file_path": str(path), "exists": True, "size": path.stat().st_size}
        if config.get("include_text", True) and path.stat().st_size <= 2_000_000:
            result["text"] = path.read_text(encoding="utf-8", errors="replace")
        return {**input_data, **result}
