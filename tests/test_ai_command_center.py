"""Integration coverage for the PySide6 AI Command Center UI layer."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


class AICommandCenterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication

        cls.app = QApplication.instance() or QApplication([])

    def make_window(self):
        from jarvis.dashboard import DashboardWindow

        with patch.object(DashboardWindow, "_connect_backend"):
            return DashboardWindow()

    def test_required_navigation_and_page_switching(self):
        window = self.make_window()
        expected = [
            "Home", "Chat", "Voice", "WhatsApp", "TikTok", "Memory",
            "Tasks", "Logs", "Updates", "Backups", "Settings", "System Health",
        ]
        self.assertEqual(list(window.nav_buttons), expected)
        window._navigate("WhatsApp")
        self.assertIs(window.page_stack.currentWidget(), window.pages["WhatsApp"])
        self.assertEqual(window.nav_buttons["WhatsApp"].objectName(), "navActive")
        window.close()

    def test_home_owns_command_center_and_chat_routes_home(self):
        window = self.make_window()
        self.assertIs(window.page_stack.currentWidget(), window.pages["Home"])
        self.assertTrue(window.pages["Home"].isAncestorOf(window.command_pipeline))

        window._navigate("Chat")

        self.assertIs(window.page_stack.currentWidget(), window.pages["Home"])
        self.assertEqual(window.nav_buttons["Chat"].objectName(), "navActive")
        window.close()

    def test_small_restart_button_relaunches_directly(self):
        from PySide6.QtWidgets import QApplication

        window = self.make_window()
        self.assertEqual(window.restart_button.width(), 92)
        with (
            patch("jarvis.dashboard.QProcess.startDetached", return_value=True) as restart,
            patch.object(QApplication, "quit") as quit_app,
        ):
            window.restart_button.click()

        restart.assert_called_once()
        program, arguments, working_directory = restart.call_args.args
        self.assertTrue(program)
        self.assertEqual(arguments, ["-X", "utf8", "-m", "jarvis.dashboard"])
        self.assertTrue(working_directory.endswith("AI_TikTok_Agent"))
        quit_app.assert_called_once_with()
        window.close()

    def test_failed_restart_keeps_current_window_open(self):
        from PySide6.QtWidgets import QApplication

        window = self.make_window()
        with (
            patch("jarvis.dashboard.QProcess.startDetached", return_value=(False, -1)),
            patch.object(QApplication, "quit") as quit_app,
        ):
            window.restart_button.click()

        quit_app.assert_not_called()
        self.assertIn("could not restart", window.notification_label.text().lower())
        window.close()

    def test_chat_renders_safe_code_blocks_and_timestamps(self):
        window = self.make_window()
        window._append_chat_message("Jarvis", "Try:\n```python\nprint('<safe>')\n```", "assistant")
        rendered = window.chat_view.toHtml()
        plain = window.chat_view.toPlainText()
        self.assertIn("print('&lt;safe&gt;')", rendered)
        self.assertIn("python", plain)
        self.assertRegex(plain, r"\d{4}-\d{2}-\d{2}")
        window.close()

    def test_copy_and_regenerate_actions(self):
        window = self.make_window()
        window.last_assistant_message = "copy me"
        window._copy_last_response()
        self.assertEqual(self.app.clipboard().text(), "copy me")

        window.last_user_message = "again"
        with patch.object(window, "_submit_message") as submit:
            window._regenerate_last_response()
        self.assertEqual(window.message_input.text(), "again")
        submit.assert_called_once_with()
        window.close()

    def test_theme_shortcuts_and_responsive_status_panel(self):
        window = self.make_window()
        window._apply_theme("light")
        self.assertEqual(window.theme_name, "light")
        self.assertEqual(len(window.shortcuts), 5)
        window.resize(900, 700)
        window._apply_responsive_layout()
        self.assertTrue(window.status_panel.isHidden())
        window.resize(1300, 800)
        window._apply_responsive_layout()
        self.assertFalse(window.status_panel.isHidden())
        window.close()

    def test_live_status_tracks_ai_task_tools_and_voice(self):
        window = self.make_window()
        window._set_request_state("Executing")
        self.assertEqual(window.status_pills["AI state"].text(), "Executing")
        self.assertEqual(window.status_pills["Active task"].text(), "Chat request")
        self.assertEqual(window.status_pills["Tools running"].text(), "1")
        window._set_voice_state("Listening")
        self.assertEqual(window.status_pills["Voice"].text(), "Listening")
        window.close()

    def test_api_failure_is_visible_in_command_center(self):
        from jarvis.dashboard import DashboardWindow

        with patch("jarvis.main.Jarvis", side_effect=RuntimeError("unavailable")):
            window = DashboardWindow()
        self.assertEqual(window.status_pills["AI state"].text(), "Error")
        self.assertEqual(window.status_pills["API status"].text(), "Error")
        self.assertIn("backend failed", window.chat_view.toPlainText().lower())
        window.close()


if __name__ == "__main__":
    unittest.main()
