"""Tests for skill loading, discovery, configuration, and isolation."""

from __future__ import annotations

import os
import unittest
from unittest.mock import Mock, patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from jarvis.skills import BaseSkill, SkillContext, SkillRegistry, SkillResult


class EchoSkill(BaseSkill):
    name = "echo"
    intents = ("echo",)

    def execute(self, context):
        return SkillResult(True, context.user_input)


class BrokenSkill(BaseSkill):
    name = "broken"
    intents = ("broken",)

    def execute(self, context):
        del context
        raise RuntimeError("private failure")


class SkillsFrameworkTests(unittest.TestCase):
    def test_skill_loading_and_selection(self):
        registry = SkillRegistry(enabled=("echo",))
        self.assertTrue(registry.register(EchoSkill()))
        result = registry.execute(SkillContext("hello", intent="echo"))
        self.assertTrue(result.success)
        self.assertEqual(result.response, "hello")
        self.assertEqual(registry.snapshot()["loaded"], ["echo"])

    def test_package_discovery_finds_common_interface(self):
        registry = SkillRegistry()
        discovered = registry.discover("jarvis.skills.catalog")
        self.assertIn("SystemHealthSkill", [skill.__name__ for skill in discovered])
        self.assertTrue(all(issubclass(skill, BaseSkill) for skill in discovered))

    def test_disabled_skill_is_not_selectable(self):
        registry = SkillRegistry(disabled=("echo",))
        self.assertFalse(registry.register(EchoSkill()))
        result = registry.execute(SkillContext("hello", intent="echo"))
        self.assertFalse(result.success)
        self.assertIn("unavailable or disabled", result.response)
        self.assertEqual(registry.snapshot()["states"]["echo"]["status"], "disabled")

    def test_skill_failure_isolated_and_registry_recovers(self):
        registry = SkillRegistry()
        registry.register(BrokenSkill())
        registry.register(EchoSkill())
        failed = registry.execute(SkillContext("secret", intent="broken"))
        recovered = registry.execute(SkillContext("still works", intent="echo"))
        self.assertFalse(failed.success)
        self.assertNotIn("private failure", failed.response)
        self.assertTrue(recovered.success)
        self.assertEqual(recovered.response, "still works")

    def test_dashboard_exposes_loaded_active_and_failed_skills(self):
        from PySide6.QtWidgets import QApplication
        from jarvis.dashboard import DashboardWindow

        app = QApplication.instance() or QApplication([])
        del app
        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
        registry = SkillRegistry()
        registry.register(EchoSkill())
        registry.active_skill = "echo"
        registry.failed_skill = "broken"
        window.jarvis = Mock(orchestrator=Mock(skills=registry))
        window._refresh_skill_status()
        self.assertEqual(window.status_pills["Loaded skills"].text(), "1")
        self.assertEqual(window.status_pills["Active skill"].text(), "echo")
        self.assertEqual(window.status_pills["Failed skill"].text(), "broken")
        window.close()


if __name__ == "__main__":
    unittest.main()
