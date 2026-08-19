"""Path-contained local filesystem tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable


class FileSandbox:
    def __init__(self, allowed_roots: Iterable[Path]) -> None:
        self.allowed_roots = tuple(Path(root).resolve() for root in allowed_roots)
        if not self.allowed_roots:
            raise ValueError("At least one filesystem root is required.")

    def resolve(self, path: str) -> Path:
        candidate = Path(path).expanduser().resolve()
        if not any(candidate == root or root in candidate.parents for root in self.allowed_roots):
            raise PermissionError("Path is outside the configured allowed roots.")
        return candidate

    def list_directory(self, path: str) -> dict[str, Any]:
        directory = self.resolve(path)
        if not directory.is_dir():
            raise NotADirectoryError(path)
        entries = sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))[:200]
        return {"path": str(directory), "entries": [{"name": item.name, "is_directory": item.is_dir()} for item in entries]}

    def read_text_file(self, path: str, max_characters: int = 100000) -> dict[str, Any]:
        target = self.resolve(path)
        if target.stat().st_size > max_characters * 4:
            raise ValueError("File exceeds the safe read limit.")
        return {"path": str(target), "content": target.read_text(encoding="utf-8", errors="replace")[:max_characters]}

    def search_files(self, path: str, pattern: str) -> dict[str, Any]:
        root = self.resolve(path)
        if not root.is_dir() or not pattern.strip():
            raise ValueError("A valid directory and non-empty pattern are required.")
        needle = pattern.casefold()
        matches = [str(item) for item in root.rglob("*") if item.is_file() and needle in item.name.casefold()][:50]
        return {"path": str(root), "pattern": pattern, "matches": matches}

    def create_folder(self, path: str) -> dict[str, Any]:
        target = self.resolve(path)
        target.mkdir(parents=False, exist_ok=True)
        return {"path": str(target), "created": target.is_dir()}
