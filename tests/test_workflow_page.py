"""Coverage for the integrated Jarvis Workflow Builder."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


class WorkflowPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication
        cls.app = QApplication.instance() or QApplication([])

    def test_top_navigation_replaces_train_with_workflow(self):
        from jarvis.dashboard import DashboardWindow

        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
        self.assertEqual(list(window.top_mode_buttons), ["DASHBOARD", "WORKFLOW", "TOOLS"])
        self.assertNotIn("TRAIN", window.top_mode_buttons)

        window.top_mode_buttons["WORKFLOW"].click()

        self.assertIs(window.page_stack.currentWidget(), window.pages["Workflow"])
        self.assertEqual(window.top_mode_buttons["WORKFLOW"].objectName(), "topModeActive")
        window.close()

    def test_nodes_connections_tabs_and_local_save(self):
        from jarvis.workflow import WorkflowPage

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "workflow.json"
            page = WorkflowPage(storage_path=path)
            self.assertTrue(page.empty_state.isVisibleTo(page))

            page.add_node("Triggers", "Manual Trigger")
            page.add_node("Jarvis", "Ask Jarvis")
            self.assertEqual(len(page.workflow.nodes), 2)
            self.assertEqual(len(page.workflow.connections), 1)
            self.assertFalse(page.empty_state.isVisibleTo(page))

            page.show_tab("EXECUTIONS")
            self.assertEqual(page.stack.currentIndex(), 1)
            page.show_tab("EVALUATIONS")
            self.assertEqual(page.stack.currentIndex(), 2)

            page.publish_workflow()
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "published")
            self.assertEqual(len(payload["nodes"]), 2)
            page.close()

    def test_jarvis_ai_generates_demo_workflow(self):
        from PySide6.QtWidgets import QDialog
        from jarvis.workflow import WorkflowPage

        with tempfile.TemporaryDirectory() as temp_dir:
            page = WorkflowPage(storage_path=Path(temp_dir) / "workflow.json")
            with patch("jarvis.workflow.workflow_page.JarvisAIDialog.exec", return_value=QDialog.DialogCode.Accepted):
                page.open_ai_builder()
            self.assertEqual([node.title for node in page.workflow.nodes], [
                "Schedule", "Ask Jarvis", "Create Script", "Generate Voice", "Render Video", "TikTok",
            ])
            self.assertEqual(len(page.workflow.connections), 5)
            page.close()

    def test_node_picker_is_expanded_readable_and_contains_facebook(self):
        from jarvis.workflow.workflow_page import NodeSelectionDialog

        dialog = NodeSelectionDialog()
        categories = {
            dialog.tree.topLevelItem(index).text(0): dialog.tree.topLevelItem(index)
            for index in range(dialog.tree.topLevelItemCount())
        }
        self.assertTrue(all(item.isExpanded() for item in categories.values()))
        social = categories["Social"]
        names = [social.child(index).text(0) for index in range(social.childCount())]
        self.assertIn("Facebook", names)
        self.assertFalse(dialog.add_button.isEnabled())
        facebook = social.child(names.index("Facebook"))
        dialog.tree.setCurrentItem(facebook)
        self.assertTrue(dialog.add_button.isEnabled())
        self.assertIn("background:#101417", dialog.styleSheet())
        dialog.close()


if __name__ == "__main__":
    unittest.main()
