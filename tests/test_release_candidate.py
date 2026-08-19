"""Jarvis v2.0 RC1 version, security, and release metadata gates."""

from __future__ import annotations

import json
import logging
import tempfile
import unittest
from pathlib import Path

from jarvis import __version__
from jarvis.deployment.update_manager import UpdateManager, _version_tuple
from jarvis.messaging_context import MessagingManager
from observability import JsonFormatter, redact_sensitive


class ReleaseCandidateTests(unittest.TestCase):
    def test_version_metadata_is_synchronized(self):
        project = Path(__file__).resolve().parents[1]
        installer = (project / "packaging" / "Jarvis.iss").read_text(encoding="utf-8")
        self.assertEqual(__version__, "2.0.0-rc1")
        self.assertIn('#define MyAppVersion "2.0.0-rc1"', installer)

    def test_rc_version_ordering(self):
        self.assertLess(_version_tuple("2.0.0-rc1"), _version_tuple("2.0.0"))
        self.assertLess(_version_tuple("2.0.0-rc1"), _version_tuple("2.0.0-rc2"))
        self.assertGreater(_version_tuple("2.0.0-rc1"), _version_tuple("1.9.9"))

    def test_production_update_transport_requires_https(self):
        with tempfile.TemporaryDirectory() as folder:
            manager = UpdateManager(__version__, Path(folder))
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                manager.check("http://updates.example.test/manifest.json")

    def test_structured_log_redacts_credentials_recursively(self):
        secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
        record = logging.LogRecord("jarvis.security", logging.ERROR, __file__, 1, f"Bearer {secret}", (), None)
        record.event = "security.test"
        record.user_input = f"OPENAI_API_KEY={secret}"
        record.context = {"access_token": secret, "safe": "visible"}
        rendered = JsonFormatter().format(record)
        payload = json.loads(rendered)
        self.assertNotIn(secret, rendered)
        self.assertIn("[REDACTED]", rendered)
        self.assertEqual(payload["context"]["safe"], "visible")

    def test_redactor_preserves_normal_user_text(self):
        self.assertEqual(redact_sensitive("Basit ko message karo"), "Basit ko message karo")

    def test_exact_urdu_confirmation_aliases(self):
        self.assertEqual(MessagingManager.confirmation_intent("بھیجو"), "confirm")
        self.assertEqual(MessagingManager.confirmation_intent("بھیج دو"), "confirm")
        self.assertEqual(MessagingManager.confirmation_intent("مت بھیجو"), "cancel")
        # The direct route reaches the real adapter, so presence is verified statically.
        source = Path(__file__).resolve().parents[1].joinpath("jarvis", "main.py").read_text(encoding="utf-8")
        self.assertIn('"سینڈ کرو"', source)

    def test_gitignore_protects_runtime_secrets_and_state(self):
        project = Path(__file__).resolve().parents[1]
        ignore = (project / ".gitignore").read_text(encoding="utf-8")
        for entry in (".env", "data/", "logs/"):
            self.assertIn(entry, ignore)


if __name__ == "__main__":
    unittest.main()
