from __future__ import annotations
import os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")

class ProfessionalWorkflowUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication
        cls.app=QApplication.instance() or QApplication([])

    def test_facebook_search_is_ranked_and_has_provider_widgets(self):
        from jarvis.workflow.connector_registry import build_default_registry
        from jarvis.workflow.node_picker import NodePickerPanel,NodeSearchResult
        registry=build_default_registry(); results=registry.search("face")
        self.assertTrue(results); self.assertTrue(all("facebook" in (item.provider+" "+item.name).casefold() for item in results[:5]))
        panel=NodePickerPanel(registry); panel.open_for(False); panel.search.setText("face")
        first=panel.results.item(0); self.assertIsInstance(panel.results.itemWidget(first),NodeSearchResult)
        self.assertTrue(str(first.data(256)).startswith("facebook_"))
        panel.close()

    def test_add_after_connects_selected_source_and_preserves_provider(self):
        from jarvis.workflow.workflow_page import WorkflowPage
        with tempfile.TemporaryDirectory() as directory:
            page=WorkflowPage(storage_path=Path(directory)/"flow.json")
            with patch("jarvis.workflow.workflow_page.QTimer.singleShot"):
                registry=page.registry; page._add_descriptor(registry.descriptor("manual_trigger"))
                source=page.workflow.nodes[0]; page._add_after_node_id=source.id
                page._add_descriptor(registry.descriptor("facebook_graph_api"))
            self.assertEqual(page.workflow.connections[-1].source,source.id)
            self.assertEqual(page.workflow.connections[-1].target,page.workflow.nodes[-1].id)
            self.assertEqual(page.workflow.nodes[-1].settings["credential_id"],"facebook_default")
            page.close()

    def test_three_column_editor_exposes_real_parameter_widgets(self):
        from jarvis.workflow.connector_registry import build_default_registry
        from jarvis.workflow.models import WorkflowNodeData
        from jarvis.workflow.node_editor import DataViewer,ExpressionField,NodeEditorDialog
        descriptor=build_default_registry().descriptor("facebook_graph_api")
        node=WorkflowNodeData("fb","facebook_graph_api","Facebook Graph API",settings=dict(descriptor.defaults))
        dialog=NodeEditorDialog(node,descriptor,{"local_path":"C:/video.mp4"})
        self.assertEqual(len(dialog.findChildren(DataViewer)),2)
        self.assertIn("credential_id",dialog.widgets); self.assertIn("method",dialog.widgets); self.assertIn("node",dialog.widgets)
        self.assertIsInstance(dialog.widgets["fields"],ExpressionField)
        dialog.close()

if __name__=="__main__": unittest.main()
