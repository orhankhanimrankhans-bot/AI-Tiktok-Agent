from __future__ import annotations
import os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")

class DialogStylingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication
        cls.app=QApplication.instance() or QApplication([])

    def test_destructive_confirmation_is_dark_readable_and_named(self):
        from PySide6.QtWidgets import QMessageBox
        from jarvis.dialogs import create_confirmation_box
        box=create_confirmation_box(None,"Delete node","Delete the selected node and its connections?","Delete","Cancel",True)
        self.assertIn("#0F151B",box.styleSheet()); self.assertIn("#F1F5F8",box.styleSheet())
        delete=box.button(QMessageBox.StandardButton.Yes); cancel=box.button(QMessageBox.StandardButton.Cancel)
        self.assertEqual(delete.text(),"Delete"); self.assertEqual(cancel.text(),"Cancel"); self.assertEqual(delete.objectName(),"jarvisDangerButton")
        box.close()

    def test_application_dialog_theme_is_scoped_to_dialog_types(self):
        from jarvis.dialogs import DIALOG_STYLESHEET,JarvisDialogStyle
        JarvisDialogStyle.install(self.app)
        self.assertIn("QMessageBox QLabel",self.app.styleSheet())
        self.assertNotIn("* {",DIALOG_STYLESHEET)

    def test_cancelled_node_delete_preserves_workflow(self):
        from jarvis.workflow.workflow_page import WorkflowPage
        with tempfile.TemporaryDirectory() as directory:
            page=WorkflowPage(storage_path=Path(directory)/"flow.json"); page.add_node("Triggers","Manual Trigger")
            item=next(iter(page.canvas.nodes.values())); item.setSelected(True); item.data.settings={"configured":True}
            with patch("jarvis.workflow.workflow_page.show_confirmation",return_value=False): page.delete_selected()
            self.assertEqual(len(page.workflow.nodes),1)
            with patch("jarvis.workflow.workflow_page.show_confirmation",return_value=True): page.delete_selected()
            self.assertEqual(len(page.workflow.nodes),0); page.close()

if __name__=="__main__": unittest.main()
