"""Windows install, upgrade, integrity, backup, restore, and diagnostics tests."""

from __future__ import annotations

import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path

from jarvis import config
from jarvis.deployment.backup_manager import BackupManager
from jarvis.deployment.crash_reporting import write_crash_report
from jarvis.deployment.diagnostics import startup_diagnostics
from jarvis.deployment.update_manager import UpdateManager, UpdateManifest


class FakeResponse(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *_args): self.close()


def make_zip(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)


class DeploymentPackagingTests(unittest.TestCase):
    def test_fresh_install_excludes_user_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); archive = root / "release.zip"; install = root / "install"
            make_zip(archive, {
                "Jarvis.exe": b"binary", "jarvis/app.py": b"code",
                ".env": b"should-not-install", "data/jarvis_memory.db": b"should-not-install",
                "logs/jarvis.jsonl": b"should-not-install",
            })
            result = UpdateManager("0.1.0", root / "staging").apply(archive, install, "0.2.0")
            self.assertTrue(result.success)
            self.assertEqual((install / "Jarvis.exe").read_bytes(), b"binary")
            self.assertFalse((install / ".env").exists())
            self.assertFalse((install / "data").exists())

    def test_upgrade_preserves_settings_memory_and_logs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); install = root / "install"; install.mkdir()
            (install / "Jarvis.exe").write_bytes(b"old")
            for relative, content in ((".env", b"secret"), ("data/memory.db", b"memory"), ("logs/app.log", b"logs")):
                path = install / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
            archive = root / "release.zip"
            make_zip(archive, {"Jarvis.exe": b"new", ".env": b"overwrite", "data/memory.db": b"overwrite", "logs/app.log": b"overwrite"})
            result = UpdateManager("0.1.0", root / "staging").apply(archive, install, "0.2.0")
            self.assertTrue(result.success)
            self.assertEqual((install / "Jarvis.exe").read_bytes(), b"new")
            self.assertEqual((install / ".env").read_bytes(), b"secret")
            self.assertEqual((install / "data/memory.db").read_bytes(), b"memory")
            self.assertEqual((install / "logs/app.log").read_bytes(), b"logs")

    def test_failed_upgrade_rolls_back_previous_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); install = root / "install"; install.mkdir()
            (install / "a.txt").write_text("old-a"); (install / "b.txt").write_text("old-b")
            archive = root / "release.zip"; make_zip(archive, {"a.txt": b"new-a", "b.txt": b"new-b"})
            calls = 0
            def failing_copy(source, target):
                nonlocal calls
                calls += 1
                if calls == 2: raise OSError("disk full")
                target.write_bytes(Path(source).read_bytes())
            result = UpdateManager("0.1.0", root / "staging", copier=failing_copy).apply(archive, install, "0.2.0")
            self.assertFalse(result.success)
            self.assertEqual((install / "a.txt").read_text(), "old-a")
            self.assertEqual((install / "b.txt").read_text(), "old-b")

    def test_manifest_check_download_and_integrity(self):
        package = b"verified package"
        manifest_payload = json.dumps({"version": "0.2.0", "url": "package", "sha256": hashlib.sha256(package).hexdigest()}).encode()
        notifications = []
        def urlopen(url, timeout):
            del timeout
            return FakeResponse(manifest_payload if url == "manifest" else package)
        with tempfile.TemporaryDirectory() as folder:
            manager = UpdateManager("0.1.0", Path(folder), urlopen=urlopen, notifier=notifications.append)
            manifest = manager.check("manifest")
            downloaded = manager.download(manifest)
            self.assertEqual(downloaded.read_bytes(), package)
            self.assertEqual(len(notifications), 2)
            bad = UpdateManifest("0.3.0", "package", "0" * 64)
            with self.assertRaisesRegex(ValueError, "integrity"):
                manager.download(bad)

    def test_sqlite_config_and_prompts_backup_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); database = root / "data" / "jarvis.db"; database.parent.mkdir()
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("CREATE TABLE memory(value TEXT)"); connection.execute("INSERT INTO memory VALUES ('before')")
                connection.commit()
            env = root / ".env"; env.write_text("OPENAI_API_KEY=secret", encoding="utf-8")
            prompts = root / "prompts"; prompts.mkdir(); (prompts / "system.txt").write_text("original", encoding="utf-8")
            manager = BackupManager(database, env, prompts, root / "backups")
            backup = manager.create_backup("test")
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE memory SET value='after'")
                connection.commit()
            env.write_text("changed", encoding="utf-8"); (prompts / "system.txt").write_text("changed", encoding="utf-8")
            self.assertTrue(manager.restore(backup))
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT value FROM memory").fetchone()[0], "before")
            self.assertEqual(env.read_text(encoding="utf-8"), "OPENAI_API_KEY=secret")
            self.assertEqual((prompts / "system.txt").read_text(encoding="utf-8"), "original")
            automatic = manager.create_automatic_backup_if_due(max_age_hours=24)
            self.assertIsNotNone(automatic)
            self.assertIsNone(manager.create_automatic_backup_if_due(max_age_hours=24))

    def test_crash_report_redacts_sensitive_lines_and_diagnostics_run(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            try:
                raise RuntimeError("API_KEY=do-not-log")
            except RuntimeError as error:
                report = write_crash_report(root, type(error), error, error.__traceback__)
            text = report.read_text(encoding="utf-8")
            self.assertNotIn("do-not-log", text)
            result = startup_diagnostics(user_root=root / "user", database=root / "missing.db", config_report=config.validate_configuration())
            self.assertTrue(result["user_root_writable"])
            self.assertEqual(result["database"], "missing")

    def test_reproducible_windows_packaging_files_exist(self):
        project = Path(__file__).resolve().parents[1]
        required = ["requirements-windows.lock", "packaging/Jarvis.spec", "packaging/Jarvis.iss", "scripts/build_windows.ps1"]
        self.assertEqual([name for name in required if not (project / name).is_file()], [])
        spec = (project / "packaging/Jarvis.spec").read_text(encoding="utf-8")
        self.assertIn('datas=[]', spec)
        self.assertNotIn('.env.example', spec)


if __name__ == "__main__":
    unittest.main()
