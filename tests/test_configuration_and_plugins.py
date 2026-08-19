"""Configuration security and fault-isolated plugin lifecycle tests."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from jarvis import config
from jarvis.plugins import BasePlugin, PluginManager, PluginValidation


class RecordingPlugin(BasePlugin):
    name = "recording"

    def __init__(self):
        self.events = []

    def initialize(self, context):
        super().initialize(context)
        self.events.append("init")

    def validate(self):
        self.events.append("validate")
        return PluginValidation()

    def start(self):
        self.events.append("start")

    def stop(self):
        self.events.append("stop")

    def shutdown(self):
        self.events.append("shutdown")


class BrokenPlugin(BasePlugin):
    name = "broken"

    def start(self):
        raise RuntimeError("secret plugin detail")


class ConfigurationAndPluginTests(unittest.TestCase):
    def test_missing_api_key_is_actionable_but_nonfatal(self):
        report = config.validate_configuration({"OPENAI_API_KEY": ""})
        issue = next(item for item in report.issues if item.key == "OPENAI_API_KEY")
        self.assertEqual(issue.severity, "warning")
        self.assertIn(".env", issue.message)

    def test_invalid_config_is_reported_clearly(self):
        report = config.validate_configuration({
            "JARVIS_OPENAI_MODEL": "",
            "JARVIS_OPENAI_TIMEOUT": -1,
            "JARVIS_OPENAI_MAX_RETRIES": -2,
            "JARVIS_INTENT_CONFIDENCE_THRESHOLD": 2,
        })
        self.assertFalse(report.valid)
        keys = {item.key for item in report.issues}
        self.assertTrue({"JARVIS_OPENAI_MODEL", "JARVIS_OPENAI_TIMEOUT", "JARVIS_OPENAI_MAX_RETRIES", "JARVIS_INTENT_CONFIDENCE_THRESHOLD"}.issubset(keys))

    def test_safe_summary_never_contains_api_key(self):
        secret = "sk-private-value"
        report = config.validate_configuration({"OPENAI_API_KEY": secret})
        rendered = repr(report.safe_summary())
        self.assertNotIn(secret, rendered)
        self.assertIn("api_key_configured", rendered)

    def test_disabled_plugin_never_initializes(self):
        plugin = RecordingPlugin()
        manager = PluginManager(disabled=("recording",))
        self.assertFalse(manager.register(plugin))
        self.assertEqual(manager.start_all(), {})
        self.assertEqual(plugin.events, [])
        self.assertEqual(manager.snapshot()["recording"]["phase"], "disabled")

    def test_lifecycle_order(self):
        plugin = RecordingPlugin()
        manager = PluginManager(context={"safe": True})
        manager.register(plugin)
        self.assertTrue(manager.start_plugin("recording"))
        manager.shutdown_all()
        self.assertEqual(plugin.events, ["init", "validate", "start", "stop", "shutdown"])

    def test_failed_plugin_does_not_block_healthy_plugin_or_recovery(self):
        broken = BrokenPlugin()
        healthy = RecordingPlugin()
        manager = PluginManager()
        manager.register(broken)
        manager.register(healthy)
        result = manager.start_all()
        self.assertFalse(result["broken"])
        self.assertTrue(result["recording"])
        self.assertEqual(manager.snapshot()["broken"]["phase"], "failed")
        self.assertEqual(manager.snapshot()["broken"]["error"], "RuntimeError")
        self.assertNotIn("secret plugin detail", repr(manager.snapshot()))
        self.assertTrue(manager.stop_plugin("recording"))
        self.assertTrue(manager.start_plugin("recording"))

    def test_dashboard_shows_redacted_config_and_plugin_controls(self):
        import os
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from PySide6.QtWidgets import QApplication
        from jarvis.dashboard import DashboardWindow

        self.__class__.qt_app = QApplication.instance() or QApplication([])
        report = config.validate_configuration({"OPENAI_API_KEY": "sk-never-render"})
        manager = PluginManager()
        manager.register(RecordingPlugin())
        manager.start_all()
        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
        window.jarvis = SimpleNamespace(config_report=report, plugins=manager, shutdown=manager.shutdown_all)
        window._refresh_configuration_and_plugins()
        self.assertIn("api_key_configured: True", window.config_view.toPlainText())
        self.assertNotIn("sk-never-render", window.config_view.toPlainText())
        self.assertIn("recording: running", window.plugin_view.toPlainText())
        window._stop_plugins()
        self.assertIn("recording: stopped", window.plugin_view.toPlainText())
        window.close()


if __name__ == "__main__":
    unittest.main()
