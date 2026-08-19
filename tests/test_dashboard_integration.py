"""Integration coverage for the ChatGPT-connected PySide6 dashboard."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


class DashboardIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication

        cls.app = QApplication.instance() or QApplication([])

    def test_startup_survives_backend_failure(self):
        from jarvis.dashboard import DashboardWindow

        with patch("jarvis.main.Jarvis", side_effect=RuntimeError("API unavailable")):
            window = DashboardWindow()
        self.assertEqual(window.activity_pill.text(), "ERROR")
        self.assertFalse(window.message_input.isEnabled())
        self.assertIn("backend failed", window.chat_view.toPlainText().lower())
        window.close()

    def test_background_message_send_and_receive(self):
        from jarvis.dashboard import JarvisRequestThread

        states: list[str] = []
        responses: list[str] = []
        worker = JarvisRequestThread(lambda message: f"Reply: {message}", "hello")
        worker.state_changed.connect(states.append)
        worker.response_ready.connect(responses.append)

        worker.run()

        self.assertEqual(states, ["Thinking", "Executing"])
        self.assertEqual(responses, ["Reply: hello"])

    def test_api_failure_becomes_user_friendly_error(self):
        from jarvis.dashboard import JarvisRequestThread

        failures: list[str] = []

        def fail(_message):
            raise TimeoutError("secret upstream detail")

        worker = JarvisRequestThread(fail, "hello")
        worker.request_failed.connect(failures.append)
        worker.run()

        self.assertEqual(len(failures), 1)
        self.assertIn("Please try again", failures[0])
        self.assertIn("Reference:", failures[0])
        self.assertNotIn("secret upstream detail", failures[0])

    def test_persisted_history_renders_with_timestamps(self):
        from jarvis.dashboard import DashboardWindow

        history = [
            {"role": "user", "content": "Earlier question", "created_at": "2026-08-15T10:30:00"},
            {"role": "assistant", "content": "Earlier answer", "created_at": "2026-08-15T10:31:00"},
        ]
        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
        with patch("jarvis.memory.memory.get_recent_messages", return_value=history):
            window._load_conversation_history()

        rendered = window.chat_view.toPlainText()
        self.assertIn("Earlier question", rendered)
        self.assertIn("Earlier answer", rendered)
        self.assertIn("2026-08-15", rendered)
        window.close()

    def test_whatsapp_pending_confirmation_progress_is_visible(self):
        from jarvis.dashboard import DashboardWindow
        from jarvis.messaging_context import messaging

        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
        with (
            patch.object(messaging.context, "awaiting_confirmation", True),
            patch.object(messaging.context, "awaiting_message_text", False),
        ):
            window._update_whatsapp_progress()

        self.assertEqual(window.status_pills["WhatsApp action"].text(), "Awaiting confirm")
        window.close()


if __name__ == "__main__":
    unittest.main()
