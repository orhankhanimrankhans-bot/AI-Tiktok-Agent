"""Continuous voice session lifecycle and recovery regression tests."""

from __future__ import annotations

import os
import time
import unittest
from unittest.mock import Mock


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


class ContinuousVoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication

        cls.app = QApplication.instance() or QApplication([])

    def test_session_lifecycle(self):
        from jarvis.dashboard import JarvisVoiceThread

        states: list[str] = []
        worker = None

        def speaker(_text):
            worker.request_stop()
            return True

        worker = JarvisVoiceThread(
            lambda: {"text": "hello", "language": "en"},
            lambda _text: "hi",
            speaker,
            recovery_delay_seconds=0,
        )
        self.assertEqual(worker.state, "Idle")
        worker.state_changed.connect(states.append)
        worker.run()

        self.assertEqual(states, ["Listening", "Processing", "Speaking", "Stopped"])
        self.assertEqual(worker.state, "Stopped")

    def test_repeated_conversations_without_another_start(self):
        from jarvis.dashboard import JarvisVoiceThread

        utterances = iter([
            {"text": "first", "language": "en"},
            {"text": "second", "language": "en"},
        ])
        handled: list[str] = []
        spoken: list[str] = []
        worker = None

        def listener():
            return next(utterances)

        def handler(text):
            handled.append(text)
            return f"reply {text}"

        def speaker(text):
            spoken.append(text)
            if len(spoken) == 2:
                worker.request_stop()
            return True

        worker = JarvisVoiceThread(listener, handler, speaker, recovery_delay_seconds=0)
        worker.run()

        self.assertEqual(handled, ["first", "second"])
        self.assertEqual(spoken, ["reply first", "reply second"])

    def test_microphone_failure_recovers_and_continues(self):
        from jarvis.dashboard import JarvisVoiceThread

        listener = Mock(side_effect=[OSError("device disconnected"), {"text": "back", "language": "en"}])
        errors: list[str] = []
        worker = None

        def speaker(_text):
            worker.request_stop()
            return True

        worker = JarvisVoiceThread(listener, lambda _text: "recovered", speaker,
                                   max_recovery_attempts=2, recovery_delay_seconds=0)
        worker.request_failed.connect(errors.append)
        worker.run()

        self.assertEqual(listener.call_count, 2)
        self.assertEqual(len(errors), 1)
        self.assertNotIn("device disconnected", errors[0])
        self.assertEqual(worker.state, "Stopped")

    def test_speech_recognition_errors_stop_after_configured_limit(self):
        from jarvis.dashboard import JarvisVoiceThread

        listener = Mock(side_effect=RuntimeError("recognition engine failed"))
        errors: list[str] = []
        worker = JarvisVoiceThread(listener, Mock(), Mock(),
                                   max_recovery_attempts=1, recovery_delay_seconds=0)
        worker.request_failed.connect(errors.append)
        worker.run()

        self.assertEqual(listener.call_count, 2)
        self.assertEqual(len(errors), 2)
        self.assertEqual(worker.state, "Stopped")

    def test_dashboard_event_loop_remains_responsive(self):
        from PySide6.QtCore import QTimer
        from jarvis.dashboard import JarvisVoiceThread

        ticks: list[bool] = []
        worker = None

        def listener():
            time.sleep(0.08)
            return {"text": "hello", "language": "en"}

        def speaker(_text):
            worker.request_stop()
            return True

        worker = JarvisVoiceThread(listener, lambda _text: "hi", speaker, recovery_delay_seconds=0)
        timer = QTimer()
        timer.timeout.connect(lambda: ticks.append(True))
        timer.start(5)
        worker.start()
        while worker.isRunning():
            self.app.processEvents()
            time.sleep(0.002)
        timer.stop()

        self.assertGreater(len(ticks), 2)


if __name__ == "__main__":
    unittest.main()
