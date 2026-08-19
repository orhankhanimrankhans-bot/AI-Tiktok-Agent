"""Phase 1 acceptance coverage for the generic Jarvis workflow platform."""
from __future__ import annotations
import json, tempfile, unittest
from pathlib import Path

from jarvis.workflow.connector_registry import build_default_registry
from jarvis.workflow.connectors.file_connector import FileConnector
from jarvis.workflow.connectors.http_connector import HttpConnector
from jarvis.workflow.engine import WorkflowEngine
from jarvis.workflow.executor import WorkflowExecutor
from jarvis.workflow.expressions import resolve_value
from jarvis.workflow.models import WorkflowConnection,WorkflowDefinition,WorkflowNodeData
from jarvis.workflow.storage import ExecutionStore,WorkflowStore

class Response:
    status=200; headers={"Content-Type":"application/json"}
    def read(self): return b'{"ok":true}'
    def __enter__(self): return self
    def __exit__(self,*_args): return False

class WorkflowPhase1Tests(unittest.TestCase):
    def test_registry_search_and_coming_soon_state(self):
        registry=build_default_registry()
        facebook={item.name:item for item in registry.search("facebook")}
        self.assertIn("Facebook Graph API",facebook); self.assertIn("Facebook Webhook",facebook)
        self.assertTrue(facebook["Facebook Graph API"].implemented); self.assertFalse(facebook["Facebook Webhook"].implemented)

    def test_graph_validation_detects_required_failures(self):
        engine=WorkflowEngine(); self.assertIn("Workflow has no nodes.",engine.validate(WorkflowDefinition()))
        nodes=[WorkflowNodeData("same","manual_trigger","Manual Trigger"),WorkflowNodeData("same","http_request","HTTP Request")]
        self.assertTrue(any("duplicate" in error for error in engine.validate(WorkflowDefinition(nodes=nodes))))
        cycle_nodes=[WorkflowNodeData("a","manual_trigger","Manual Trigger"),WorkflowNodeData("b","text_data","Text")]
        cycle=WorkflowDefinition(nodes=cycle_nodes,connections=[WorkflowConnection("a","b"),WorkflowConnection("b","a")])
        self.assertTrue(any("cycle" in error for error in engine.validate(cycle)))

    def test_manual_text_http_demo_executes_generic_pipeline(self):
        registry=build_default_registry(); descriptor=registry.descriptor("http_request"); registry.register(descriptor,lambda:HttpConnector(opener=lambda request,timeout:Response()))
        nodes=[WorkflowNodeData("a","manual_trigger","Manual Trigger"),WorkflowNodeData("b","text_data","Text",settings={"fields":{"caption":"hello"}}),WorkflowNodeData("c","http_request","HTTP Request",settings={"operation":"request","method":"POST","url":"https://example.test/api","body":{"caption":"{{$json.caption}}"}})]
        workflow=WorkflowDefinition(name="Demo",nodes=nodes,connections=[WorkflowConnection("a","b"),WorkflowConnection("b","c")])
        with tempfile.TemporaryDirectory() as directory:
            record=WorkflowExecutor(store=ExecutionStore(Path(directory)),registry=registry).run(workflow)
        self.assertEqual(record.status,"success"); self.assertEqual([item["node_id"] for item in record.node_results],["a","b","c"])
        self.assertTrue(record.node_results[-1]["output"]["http"]["json"]["ok"])

    def test_ask_jarvis_reuses_injected_backend(self):
        workflow=WorkflowDefinition(nodes=[WorkflowNodeData("a","manual_trigger","Manual Trigger"),WorkflowNodeData("b","ask_jarvis","Ask Jarvis",settings={"operation":"ask","prompt":"{{$json.prompt}}"})],connections=[WorkflowConnection("a","b")])
        with tempfile.TemporaryDirectory() as directory:
            record=WorkflowExecutor(store=ExecutionStore(Path(directory)),jarvis_process=lambda prompt:f"Reply: {prompt}").run(workflow,{"prompt":"hello"})
        self.assertEqual(record.node_results[-1]["output"]["text"],"Reply: hello")

    def test_file_connector_enforces_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); file=root/"sample.txt"; file.write_text("Jarvis",encoding="utf-8")
            output=FileConnector(root).execute("read_file",{"file_path":str(file)},{},{})
            self.assertEqual(output["text"],"Jarvis")
            with self.assertRaises(PermissionError): FileConnector(root).execute("read_file",{"file_path":str(root.parent/"outside.txt")},{},{})

    def test_node_expression_atomic_storage_and_connection_cleanup(self):
        self.assertEqual(resolve_value('{{$node["Ask Jarvis"].output.text}}',{}, {"Ask Jarvis":{"text":"ready"}}),"ready")
        workflow=WorkflowDefinition(nodes=[WorkflowNodeData("a","manual_trigger","Manual Trigger"),WorkflowNodeData("b","text_data","Text")],connections=[WorkflowConnection("a","b")])
        workflow.remove_node("b"); self.assertEqual(workflow.connections,[])
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"flow.json"; WorkflowStore.save(workflow,path)
            self.assertTrue(path.exists()); self.assertFalse(path.with_suffix(".json.tmp").exists()); self.assertEqual(WorkflowStore.load(path).id,workflow.id)

if __name__=="__main__": unittest.main()
