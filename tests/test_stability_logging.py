"""Regression coverage for Prompt 2 stability and observability boundaries."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from observability import JsonFormatter, get_request_id, request_context


class StructuredLoggingTests(unittest.TestCase):
    def test_request_context_and_json_formatter(self):
        import logging

        record = logging.LogRecord(
            "jarvis.test", logging.INFO, __file__, 1, "hello", (), None
        )
        record.event = "test.event"
        with request_context("request-123"):
            payload = json.loads(JsonFormatter().format(record))
            self.assertEqual(get_request_id(), "request-123")
        self.assertEqual(payload["request_id"], "request-123")
        self.assertEqual(payload["event"], "test.event")

    def test_automatic_request_ids_are_unique(self):
        with request_context() as first_request_id:
            self.assertEqual(get_request_id(), first_request_id)
        with request_context() as second_request_id:
            self.assertEqual(get_request_id(), second_request_id)

        self.assertNotEqual(first_request_id, second_request_id)
        self.assertEqual(len(first_request_id), 32)
        self.assertEqual(len(second_request_id), 32)


class MemoryRegressionTests(unittest.TestCase):
    def test_conversation_memory_round_trip(self):
        from jarvis.memory import JarvisMemory

        with tempfile.TemporaryDirectory() as directory:
            memory = JarvisMemory.__new__(JarvisMemory)
            memory.db_path = Path(directory) / "memory.db"
            memory._initialize_database()
            memory.add_message("user", "hello", "en")
            self.assertEqual(memory.get_recent_messages()[-1]["content"], "hello")
            memory.set_preference("contact", "Basit")
            self.assertEqual(memory.get_preference("contact"), "Basit")
            memory.record_action("test", "target", "success")
            memory.clear_conversation()
            self.assertEqual(memory.get_recent_messages(), [])


class ConversationRegressionTests(unittest.TestCase):
    def test_conversation_reply_uses_model_and_persists_both_turns(self):
        from jarvis.conversation import JarvisConversation
        from jarvis.llm_client import LLMResponse

        client = Mock()
        client.model = "test-model"
        client.create_response.return_value = LLMResponse(text="Hello from ChatGPT")
        conversation = JarvisConversation(client=client)
        with patch("jarvis.conversation.memory.add_message") as add_message:
            answer = conversation.reply("hello", language="en")
        self.assertEqual(answer, "Hello from ChatGPT")
        self.assertEqual(add_message.call_count, 2)

    def test_desktop_request_recovers_from_unhandled_failure(self):
        from jarvis.main import Jarvis

        jarvis = Jarvis()
        with patch.object(jarvis, "_process_request", side_effect=RuntimeError("boom")):
            response = jarvis.process("hello")
        self.assertIn("Reference:", response)


class WhatsAppRegressionTests(unittest.TestCase):
    def test_explicit_send_routes_to_verified_adapter_once(self):
        from jarvis.main import Jarvis

        result = SimpleNamespace(success=True, status="MESSAGE_SENT", message="sent")
        with (
            patch("jarvis.main.whatsapp.send_prepared_message", return_value=result) as send,
            patch("jarvis.main.memory.add_message"),
        ):
            response = Jarvis().process("send karo")
        self.assertEqual(response, "sent")
        send.assert_called_once_with()


class TikTokRegressionTests(unittest.TestCase):
    def test_stage_runner_preserves_success_and_failure_contract(self):
        from app import orchestrator

        with patch("app.orchestrator.subprocess.run", return_value=SimpleNamespace(returncode=0)):
            self.assertTrue(orchestrator.run_module("app.fake", "TEST"))
        with patch("app.orchestrator.subprocess.run", return_value=SimpleNamespace(returncode=7)):
            with self.assertRaises(RuntimeError):
                orchestrator.run_module("app.fake", "TEST")


class VoiceRegressionTests(unittest.TestCase):
    def test_continuous_voice_worker_completes_one_cycle_and_stops(self):
        try:
            from jarvis.dashboard import JarvisVoiceThread
        except ImportError as exc:
            self.skipTest(f"PySide6 voice dashboard unavailable: {exc}")

        listener = Mock(return_value={"text": "hello", "language": "en"})
        handler = Mock(return_value="hi")
        worker = None

        def speaker(text):
            self.assertEqual(text, "hi")
            worker.request_stop()
            return True

        worker = JarvisVoiceThread(listener, handler, speaker)
        worker.run()
        listener.assert_called_once_with()
        handler.assert_called_once_with("hello")


class DashboardStartupRegressionTests(unittest.TestCase):
    def test_dashboard_shell_constructs_without_backend_blocking(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtWidgets import QApplication
            from jarvis.dashboard import DashboardWindow
        except ImportError as exc:
            self.skipTest(f"PySide6 unavailable: {exc}")

        app = QApplication.instance() or QApplication([])
        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
            self.assertEqual(window.windowTitle(), "Jarvis Control Center")
            self.assertIsNone(window.request_thread)
            window.close()
        app.processEvents()


if __name__ == "__main__":
    unittest.main()
