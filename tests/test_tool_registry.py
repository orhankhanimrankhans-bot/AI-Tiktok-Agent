from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.core.jarvis_core import JarvisCore
from app.core.models import Approval, ToolCall, ToolResult
from app.tools.registry import ToolValidationError


class ToolRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.core = JarvisCore(root / "agent.db")
        self.core.files.allowed_roots = (root.resolve(),)
        self.core.initialize()
        self.root = root

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_read_only_tool_executes_and_is_audited(self) -> None:
        result = self.core.tools.request(ToolCall("get_system_info"))
        self.assertIsInstance(result, ToolResult)
        self.assertTrue(result.success)

    def test_unknown_arguments_are_rejected_before_audit(self) -> None:
        with self.assertRaises(ToolValidationError):
            self.core.tools.request(ToolCall("get_system_info", {"command": "whoami"}))

    def test_path_traversal_is_blocked(self) -> None:
        result = self.core.tools.request(ToolCall("read_text_file", {"path": str(self.root.parent / "secret.txt")}))
        self.assertIsInstance(result, ToolResult)
        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "PermissionError")

    def test_safe_action_executes_in_assisted_mode(self) -> None:
        destination = self.root / "Jarvis Test"
        result = self.core.tools.request(ToolCall("create_folder", {"path": str(destination)}))
        self.assertIsInstance(result, ToolResult)
        self.assertTrue(result.success)
        self.assertTrue(destination.is_dir())

    def test_emergency_stop_blocks_new_actions(self) -> None:
        self.core.emergency_stop()
        result = self.core.tools.request(ToolCall("get_system_info"))
        self.assertIsInstance(result, ToolResult)
        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "PERMISSION_DENIED")


if __name__ == "__main__":
    unittest.main()
