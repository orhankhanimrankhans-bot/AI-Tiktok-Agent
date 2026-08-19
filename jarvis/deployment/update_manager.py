"""Staged, integrity-checked Windows update management with rollback."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import urllib.request
import urllib.parse
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from observability import get_logger, log_event


logger = get_logger("updates")
PROTECTED_NAMES = {".env", "data", "logs", "backups", "prompts", "updates"}


@dataclass(frozen=True)
class UpdateManifest:
    version: str
    url: str
    sha256: str


@dataclass(frozen=True)
class UpdateResult:
    success: bool
    message: str
    version: str = ""
    rollback_path: str = ""


def _version_tuple(value: str) -> tuple[tuple[int, ...], int, int]:
    try:
        normalized = value.strip().lower().lstrip("v")
        base, separator, prerelease = normalized.partition("-")
        numbers = tuple(int(part) for part in base.split("."))
        if not separator:
            return numbers, 1, 0
        match = re.fullmatch(r"rc(\d+)", prerelease)
        if not match:
            raise ValueError
        return numbers, 0, int(match.group(1))
    except ValueError as error:
        raise ValueError(f"Invalid version '{value}'. Use numeric semantic versions such as 1.2.3.") from error


class UpdateManager:
    def __init__(self, current_version: str, staging_dir: Path, *, urlopen=None,
                 notifier: Callable[[str], None] | None = None, copier=shutil.copy2) -> None:
        self.current_version = current_version
        self.staging_dir = Path(staging_dir)
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        self.urlopen = urlopen or urllib.request.urlopen
        self.notifier = notifier or (lambda _message: None)
        self.copier = copier

    def _require_secure_url(self, url: str) -> None:
        if self.urlopen is urllib.request.urlopen and urllib.parse.urlparse(url).scheme.casefold() != "https":
            raise ValueError("Production update URLs must use HTTPS.")

    def check(self, manifest_url: str, timeout: float = 15) -> UpdateManifest | None:
        if not manifest_url:
            raise ValueError("Set JARVIS_UPDATE_MANIFEST_URL before checking for updates.")
        self._require_secure_url(manifest_url)
        with self.urlopen(manifest_url, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        manifest = UpdateManifest(str(payload["version"]), str(payload["url"]), str(payload["sha256"]).lower())
        self._require_secure_url(manifest.url)
        if len(manifest.sha256) != 64:
            raise ValueError("Update manifest sha256 must contain 64 hexadecimal characters.")
        if _version_tuple(manifest.version) <= _version_tuple(self.current_version):
            log_event(logger, logging.INFO, "update.current", "Jarvis is already current", version=self.current_version)
            return None
        self.notifier(f"Jarvis {manifest.version} is available.")
        log_event(logger, logging.INFO, "update.available", "A newer Jarvis version is available", version=manifest.version)
        return manifest

    def download(self, manifest: UpdateManifest, timeout: float = 120) -> Path:
        self._require_secure_url(manifest.url)
        final_path = self.staging_dir / f"jarvis-{manifest.version}.zip"
        partial = final_path.with_suffix(".zip.part")
        digest = hashlib.sha256()
        try:
            with self.urlopen(manifest.url, timeout=timeout) as response, partial.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest().lower() != manifest.sha256:
                raise ValueError("Update integrity validation failed; SHA-256 does not match the manifest.")
            os.replace(partial, final_path)
            self.notifier(f"Jarvis {manifest.version} downloaded and verified.")
            log_event(logger, logging.INFO, "update.verified", "Update package downloaded and verified", version=manifest.version, success=True)
            return final_path
        except Exception:
            partial.unlink(missing_ok=True)
            logger.exception("Update download failed safely", extra={"event": "update.download_failed", "version": manifest.version})
            raise

    @staticmethod
    def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
        members = []
        for member in archive.infolist():
            path = Path(member.filename)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Unsafe update archive path: {member.filename}")
            if path.parts and path.parts[0].casefold() in PROTECTED_NAMES:
                continue
            members.append(member)
        return members

    def apply(self, archive_path: Path, install_dir: Path, version: str) -> UpdateResult:
        """Install or upgrade files transactionally while preserving user data."""
        install_dir = Path(install_dir).resolve()
        install_dir.mkdir(parents=True, exist_ok=True)
        rollback = self.staging_dir / f"rollback-{self.current_version}-to-{version}"
        if rollback.exists():
            shutil.rmtree(rollback)
        rollback.mkdir(parents=True)
        changed: list[Path] = []
        created: list[Path] = []
        journal = self.staging_dir / "update-journal.json"
        try:
            with tempfile.TemporaryDirectory(dir=self.staging_dir) as temp_folder:
                extracted = Path(temp_folder)
                with zipfile.ZipFile(archive_path) as archive:
                    members = self._safe_members(archive)
                    archive.extractall(extracted, members=members)
                for source in sorted(extracted.rglob("*")):
                    if not source.is_file():
                        continue
                    relative = source.relative_to(extracted)
                    if relative.parts[0].casefold() in PROTECTED_NAMES:
                        continue
                    target = install_dir / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if target.exists():
                        backup_target = rollback / relative
                        backup_target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(target, backup_target)
                        changed.append(relative)
                    else:
                        created.append(relative)
                    self.copier(source, target)
                    journal.write_text(json.dumps({"version": version, "changed": [str(p) for p in changed], "created": [str(p) for p in created]}), encoding="utf-8")
            journal.unlink(missing_ok=True)
            self.notifier(f"Jarvis {version} installed. Restart to finish the update.")
            log_event(logger, logging.INFO, "update.applied", "Update applied successfully", version=version, success=True)
            return UpdateResult(True, "Update installed successfully. Restart Jarvis to use it.", version, str(rollback))
        except Exception:
            for relative in reversed(created):
                (install_dir / relative).unlink(missing_ok=True)
            for relative in reversed(changed):
                source = rollback / relative
                if source.exists():
                    shutil.copy2(source, install_dir / relative)
            journal.unlink(missing_ok=True)
            logger.exception("Update apply failed and rollback completed", extra={"event": "update.rollback", "version": version})
            return UpdateResult(False, "Update failed. Previous installation was restored.", version, str(rollback))
