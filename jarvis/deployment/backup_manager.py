"""Consistent backups and validated restore for Jarvis user state."""

from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from observability import get_logger, log_event


logger = get_logger("backups")


class BackupManager:
    def __init__(self, database: Path, config_file: Path, prompts_dir: Path, backups_dir: Path) -> None:
        self.database = Path(database)
        self.config_file = Path(config_file)
        self.prompts_dir = Path(prompts_dir)
        self.backups_dir = Path(backups_dir)
        self.backups_dir.mkdir(parents=True, exist_ok=True)

    def create_backup(self, label: str = "automatic") -> Path:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = self.backups_dir / f"jarvis-{label}-{timestamp}.zip"
        with tempfile.TemporaryDirectory() as folder:
            consistent_db = Path(folder) / "jarvis_memory.db"
            if self.database.exists():
                with closing(sqlite3.connect(self.database)) as source, closing(sqlite3.connect(consistent_db)) as target:
                    source.backup(target)
            with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                if consistent_db.exists():
                    archive.write(consistent_db, "data/jarvis_memory.db")
                if self.config_file.exists():
                    archive.write(self.config_file, "config/.env")
                if self.prompts_dir.exists():
                    for prompt in self.prompts_dir.rglob("*"):
                        if prompt.is_file():
                            archive.write(prompt, Path("prompts") / prompt.relative_to(self.prompts_dir))
        log_event(logger, logging.INFO, "backup.created", "Jarvis backup created", backup=str(destination), success=True)
        return destination

    def create_automatic_backup_if_due(self, max_age_hours: float = 24) -> Path | None:
        existing = sorted(self.backups_dir.glob("jarvis-automatic-*.zip"), reverse=True)
        if existing:
            age_seconds = datetime.now(timezone.utc).timestamp() - existing[0].stat().st_mtime
            if age_seconds < max_age_hours * 3600:
                return None
        return self.create_backup("automatic")

    def restore(self, backup_path: Path) -> bool:
        """Validate every artifact before atomically replacing user state."""
        with tempfile.TemporaryDirectory() as folder, zipfile.ZipFile(backup_path) as archive:
            root = Path(folder)
            allowed = {"data/jarvis_memory.db", "config/.env"}
            for name in archive.namelist():
                path = Path(name)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError(f"Unsafe backup path: {name}")
                if name not in allowed and not name.startswith("prompts/"):
                    raise ValueError(f"Unexpected backup artifact: {name}")
            archive.extractall(root)
            restored_db = root / "data" / "jarvis_memory.db"
            if restored_db.exists():
                with closing(sqlite3.connect(restored_db)) as connection:
                    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise ValueError("Backup database failed SQLite integrity validation.")
                self.database.parent.mkdir(parents=True, exist_ok=True)
                os.replace(restored_db, self.database)
            restored_config = root / "config" / ".env"
            if restored_config.exists():
                self.config_file.parent.mkdir(parents=True, exist_ok=True)
                os.replace(restored_config, self.config_file)
            restored_prompts = root / "prompts"
            if restored_prompts.exists():
                self.prompts_dir.mkdir(parents=True, exist_ok=True)
                for source in restored_prompts.rglob("*"):
                    if source.is_file():
                        target = self.prompts_dir / source.relative_to(restored_prompts)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        os.replace(source, target)
        log_event(logger, logging.INFO, "backup.restored", "Jarvis backup restored", backup=str(backup_path), success=True)
        return True
